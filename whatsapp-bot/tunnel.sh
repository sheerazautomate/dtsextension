#!/usr/bin/env bash
#
# Starts a Cloudflare quick tunnel pointed at localhost:3000, watches its
# output for the current trycloudflare.com URL, and POSTs that URL to the
# Apps Script Web App endpoint so Apps Script always knows the live address.
#
# Periodically re-reports the URL (heartbeat) so Apps Script's "last seen"
# timestamp stays fresh — this prevents the admin panel from incorrectly
# flagging a healthy tunnel as stale/offline.
#
# Also polls Apps Script for a pending "restartTunnel" command (queued from
# the admin panel). On that command we cycle cloudflared ourselves: kill the
# current process, start a new one, and wait for the new URL. We do NOT
# rely on `tail -F` exiting — that pipe stays open after cloudflared dies,
# which is why the Restart tunnel button previously killed the tunnel and
# never brought a new URL back.
#
# A single supervisor loop is the only thing that starts/stops cloudflared
# (the poller just drops a restart flag). That avoids races between the
# two background loops.
#
# Requirements: cloudflared, curl, jq (apt install jq)
#
# Usage: ./tunnel.sh
# Run this under pm2 instead of running "cloudflared tunnel --url ..." directly.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load whatsapp-bot/.env if present so this script and server.js share config.
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$SCRIPT_DIR/.env"
  set +a
fi

# ==== CONFIG — env / .env override these defaults ====
# APPS_SCRIPT_SECRET must match AdminPanel.js ADMIN_PANEL_SECRET (getStatus / ack).
# URL_UPDATE_SECRET must match waUrlRegistry.js URL_UPDATE_SECRET (URL POST).
# They are different secrets on purpose. If the log says "Reported URL" but the
# admin panel never changes, read the curl response — a secret mismatch comes
# back as {"error":"Unauthorized"}.
APPS_SCRIPT_WEBAPP_URL="${APPS_SCRIPT_WEBAPP_URL:-${APPS_SCRIPT_URL:-}}"
APPS_SCRIPT_SECRET="${APPS_SCRIPT_SECRET:-}"
URL_UPDATE_SECRET="${URL_UPDATE_SECRET:-}"
LOCAL_PORT="${LOCAL_PORT:-${PORT:-3000}}"
COMMAND_POLL_INTERVAL="${COMMAND_POLL_INTERVAL:-10}"
HEARTBEAT_INTERVAL="${HEARTBEAT_INTERVAL:-300}"          # re-report URL every 5 minutes
HEALTH_CHECK_INTERVAL="${HEALTH_CHECK_INTERVAL:-60}"     # verify tunnel is reachable
HEALTH_CHECK_TIMEOUT="${HEALTH_CHECK_TIMEOUT:-10}"
HEALTH_GRACE_SECONDS="${HEALTH_GRACE_SECONDS:-45}"       # skip health checks after a start
RESTART_DEBOUNCE_SECONDS="${RESTART_DEBOUNCE_SECONDS:-20}"
# =================================

LOG_FILE="/tmp/cloudflared.log"
PID_FILE="/tmp/cloudflared.pid"
URL_FILE="/tmp/cloudflared.url"
RESTART_FILE="/tmp/cloudflared.restart"
START_TS_FILE="/tmp/cloudflared.start_ts"
LAST_COMMAND_ID=""
LAST_HEARTBEAT=0
LAST_HEALTH_CHECK=0
LAST_RESTART_AT=0

if [ -z "$APPS_SCRIPT_WEBAPP_URL" ] || echo "$APPS_SCRIPT_WEBAPP_URL" | grep -q 'YOUR_DEPLOYMENT_ID'; then
  echo "ERROR: APPS_SCRIPT_URL is not set. Copy .env.example to .env and fill it in."
  exit 1
fi
if [ -z "$APPS_SCRIPT_SECRET" ]; then
  echo "ERROR: APPS_SCRIPT_SECRET is not set. Copy .env.example to .env and fill it in."
  exit 1
fi
if [ -z "$URL_UPDATE_SECRET" ]; then
  echo "ERROR: URL_UPDATE_SECRET is not set. It must match the Apps Script URL_UPDATE_SECRET property."
  exit 1
fi

report_url() {
  local url="$1"
  local resp body code
  resp=$(curl -sL -w '\n%{http_code}' -X POST "${APPS_SCRIPT_WEBAPP_URL}" \
    -H "Content-Type: application/json" \
    -d "{\"secret\":\"${URL_UPDATE_SECRET}\",\"url\":\"${url}\"}")
  code=$(printf '%s\n' "$resp" | tail -n1)
  body=$(printf '%s\n' "$resp" | sed '$d')
  echo "Reported URL to Apps Script (HTTP ${code}): ${body}"
}

ack_command() {
  local id="$1"
  curl -sL -X POST "${APPS_SCRIPT_WEBAPP_URL}?action=ackCommand" \
    -H "Content-Type: application/json" \
    -d "{\"secret\":\"${APPS_SCRIPT_SECRET}\",\"target\":\"tunnel\",\"id\":\"${id}\",\"result\":{\"ok\":true}}" > /dev/null
}

# Check if the tunnel URL is actually reachable by hitting /health through it.
# Returns 0 (success) if reachable and healthy, 1 otherwise.
health_check() {
  local url="$1"
  if [ -z "$url" ]; then
    return 1
  fi
  local response
  response=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$HEALTH_CHECK_TIMEOUT" "${url}/health" 2>/dev/null)
  if [ "$response" = "200" ]; then
    return 0
  fi
  return 1
}

cloudflared_alive() {
  local pid
  pid=$(cat "$PID_FILE" 2>/dev/null || true)
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

kill_cloudflared() {
  local pid
  pid=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "Stopping cloudflared PID $pid"
    kill "$pid" 2>/dev/null || true
    local i=0
    while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 10 ]; do
      sleep 0.5
      i=$((i + 1))
    done
    if kill -0 "$pid" 2>/dev/null; then
      echo "cloudflared PID $pid still alive — sending SIGKILL"
      kill -9 "$pid" 2>/dev/null || true
    fi
  fi
  rm -f "$PID_FILE"
}

start_cloudflared() {
  kill_cloudflared
  # Drop the old URL/log so the watcher cannot re-report a dead tunnel,
  # and so a new four-word URL is always treated as fresh.
  rm -f "$URL_FILE"
  : > "$LOG_FILE"
  cloudflared tunnel --url "http://localhost:${LOCAL_PORT}" >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  date +%s > "$START_TS_FILE"
  echo "cloudflared started (PID $(cat "$PID_FILE")), watching $LOG_FILE for URL..."
}

request_restart() {
  date +%s > "$RESTART_FILE"
}

# Four hyphenated words only — never matches cloudflared's internal
# https://api.trycloudflare.com backend URL.
extract_tunnel_url() {
  grep -oE 'https://[a-z]+-[a-z]+-[a-z]+-[a-z]+\.trycloudflare\.com' "$LOG_FILE" 2>/dev/null | tail -n1
}

# Polls the log file (not `tail -F`) so a cloudflared death/restart cannot
# stall URL detection. Runs as a background loop.
watch_log_loop() {
  local url last
  while true; do
    url=$(extract_tunnel_url)
    last=$(cat "$URL_FILE" 2>/dev/null || true)
    if [ -n "$url" ] && [ "$url" != "$last" ]; then
      echo "Detected new tunnel URL: $url"
      echo "$url" > "$URL_FILE"
      report_url "$url"
    fi
    sleep 1
  done
}

# --- Background loop: poll Apps Script for a pending "restartTunnel" command ---
# Requires `jq` (apt install jq) for reliable JSON parsing.
# Does not start/stop cloudflared itself — only raises the restart flag
# the supervisor honours. That way a click cannot race a health-check kill.
command_poll_loop() {
  while true; do
    sleep "$COMMAND_POLL_INTERVAL"
    RESPONSE=$(curl -sL "${APPS_SCRIPT_WEBAPP_URL}?action=getStatus&secret=${APPS_SCRIPT_SECRET}")
    CMD_ID=$(echo "$RESPONSE" | jq -r '.pendingCommands.tunnel.id // empty' 2>/dev/null)
    CMD_NAME=$(echo "$RESPONSE" | jq -r '.pendingCommands.tunnel.command // empty' 2>/dev/null)

    if [ -n "$CMD_ID" ] && [ "$CMD_ID" != "$LAST_COMMAND_ID" ] && [ "$CMD_NAME" = "restartTunnel" ]; then
      LAST_COMMAND_ID="$CMD_ID"
      NOW=$(date +%s)
      if [ "$LAST_RESTART_AT" -gt 0 ] && [ $((NOW - LAST_RESTART_AT)) -lt "$RESTART_DEBOUNCE_SECONDS" ]; then
        echo "Received restartTunnel command ($CMD_ID) — ignored, last restart was $((NOW - LAST_RESTART_AT))s ago"
        ack_command "$CMD_ID"
        continue
      fi
      echo "Received restartTunnel command ($CMD_ID) — cycling cloudflared for a fresh URL"
      LAST_RESTART_AT=$NOW
      request_restart
      ack_command "$CMD_ID"
    fi
  done
}

shutdown() {
  echo "Shutting down tunnel.sh — stopping cloudflared and background loops"
  kill_cloudflared
  jobs -p | while read -r job; do
    kill "$job" 2>/dev/null || true
  done
  exit 0
}
trap shutdown SIGINT SIGTERM

start_cloudflared
watch_log_loop &
command_poll_loop &

# --- Supervisor: the only place that starts cloudflared after boot.
#     Handles admin-panel restarts, crashes, and failed health checks. ---
while true; do
  sleep 1
  NOW=$(date +%s)

  if [ -f "$RESTART_FILE" ]; then
    rm -f "$RESTART_FILE"
    echo "Restart flag set — cycling cloudflared"
    LAST_RESTART_AT=$NOW
    start_cloudflared
    continue
  fi

  if ! cloudflared_alive; then
    echo "cloudflared not running — restarting..."
    LAST_RESTART_AT=$NOW
    start_cloudflared
    continue
  fi

  CURRENT_URL=$(cat "$URL_FILE" 2>/dev/null || true)

  # Periodic heartbeat: re-report the current URL to keep Apps Script timestamp fresh
  if [ -n "$CURRENT_URL" ] && [ $((NOW - LAST_HEARTBEAT)) -ge "$HEARTBEAT_INTERVAL" ]; then
    echo "Heartbeat: re-reporting tunnel URL ($CURRENT_URL) to Apps Script"
    report_url "$CURRENT_URL"
    LAST_HEARTBEAT=$NOW
  fi

  STARTED_AT=$(cat "$START_TS_FILE" 2>/dev/null || echo 0)
  IN_GRACE=0
  if [ $((NOW - STARTED_AT)) -lt "$HEALTH_GRACE_SECONDS" ]; then
    IN_GRACE=1
  fi

  if [ "$IN_GRACE" -eq 0 ] && [ -n "$CURRENT_URL" ] && [ $((NOW - LAST_HEALTH_CHECK)) -ge "$HEALTH_CHECK_INTERVAL" ]; then
    if health_check "$CURRENT_URL"; then
      echo "Health check: tunnel is reachable ($CURRENT_URL)"
    else
      echo "Health check FAILED: tunnel not reachable ($CURRENT_URL) — requesting restart"
      rm -f "$URL_FILE"
      request_restart
    fi
    LAST_HEALTH_CHECK=$NOW
  fi
done
