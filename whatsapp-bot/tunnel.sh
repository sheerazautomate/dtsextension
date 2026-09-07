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
# the admin panel) and, when found, kills the current cloudflared process so
# the main loop below respawns it with a fresh URL.
#
# The current cloudflared PID is written to a file (not just a shell
# variable) because backgrounded subshells only get a COPY of variables at
# the moment they're forked and never see later updates from the parent.
# A shared file avoids that.
#
# Requirements: cloudflared, curl, jq (apt install jq)
#
# Usage: ./tunnel.sh
# Run this under pm2 instead of running "cloudflared tunnel --url ..." directly.

# ==== CONFIG — fill these in ====
APPS_SCRIPT_WEBAPP_URL="https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"
APPS_SCRIPT_SECRET="arsh7999"  # must match Code.gs SHARED_SECRET
LOCAL_PORT=3000
COMMAND_POLL_INTERVAL=10
HEARTBEAT_INTERVAL=300          # re-report URL every 5 minutes (seconds)
HEALTH_CHECK_INTERVAL=60        # verify tunnel is reachable every 60 seconds
HEALTH_CHECK_TIMEOUT=10         # seconds to wait for health endpoint
# =================================

LOG_FILE="/tmp/cloudflared.log"
PID_FILE="/tmp/cloudflared.pid"
URL_FILE="/tmp/cloudflared.url"
LAST_URL=""
LAST_COMMAND_ID=""
LAST_HEARTBEAT=0
LAST_HEALTH_CHECK=0

report_url() {
  local url="$1"
  curl -s -X POST "${APPS_SCRIPT_WEBAPP_URL}" \
    -H "Content-Type: application/json" \
    -d "{\"secret\":\"${APPS_SCRIPT_SECRET}\",\"url\":\"${url}\"}" > /dev/null
}

ack_command() {
  local id="$1"
  curl -s -X POST "${APPS_SCRIPT_WEBAPP_URL}?action=ackCommand" \
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

start_cloudflared() {
  cloudflared tunnel --url "http://localhost:${LOCAL_PORT}" > "$LOG_FILE" 2>&1 &
  CLOUDFLARED_PID=$!
  echo "$CLOUDFLARED_PID" > "$PID_FILE"
  echo "cloudflared started (PID $CLOUDFLARED_PID), watching $LOG_FILE for URL..."
}

# --- Background loop: poll Apps Script for a pending "restartTunnel" command ---
# Requires `jq` (apt install jq) for reliable JSON parsing.
# Runs as a backgrounded subshell — always reads the PID from $PID_FILE,
# never from a variable, since it can't see this script's later updates.
command_poll_loop() {
  while true; do
    sleep "$COMMAND_POLL_INTERVAL"
    RESPONSE=$(curl -s "${APPS_SCRIPT_WEBAPP_URL}?action=getStatus&secret=${APPS_SCRIPT_SECRET}")
    CMD_ID=$(echo "$RESPONSE" | jq -r '.pendingCommands.tunnel.id // empty' 2>/dev/null)
    CMD_NAME=$(echo "$RESPONSE" | jq -r '.pendingCommands.tunnel.command // empty' 2>/dev/null)

    if [ -n "$CMD_ID" ] && [ "$CMD_ID" != "$LAST_COMMAND_ID" ] && [ "$CMD_NAME" = "restartTunnel" ]; then
      echo "Received restartTunnel command ($CMD_ID) — killing cloudflared to force a fresh URL"
      LAST_COMMAND_ID="$CMD_ID"
      ack_command "$CMD_ID"
      CURRENT_PID=$(cat "$PID_FILE" 2>/dev/null)
      if [ -n "$CURRENT_PID" ]; then
        kill "$CURRENT_PID" 2>/dev/null
        echo "Killed cloudflared PID $CURRENT_PID"
      fi
    fi
  done
}

start_cloudflared
command_poll_loop &

# --- Foreground loop: tail the log and react whenever a URL appears; also
#     restart cloudflared if it dies (from a crash or from the kill above).
#     Periodically re-reports the URL (heartbeat) and checks tunnel health. ---
while true; do
  tail -F "$LOG_FILE" 2>/dev/null | while read -r line; do
    # Requires the real four-word-hyphenated pattern, so it can never match
    # cloudflared's own internal "api.trycloudflare.com" backend URL.
    URL=$(echo "$line" | grep -oE 'https://[a-z]+-[a-z]+-[a-z]+-[a-z]+\.trycloudflare\.com')

    if [ -n "$URL" ] && [ "$URL" != "$LAST_URL" ]; then
      echo "Detected new tunnel URL: $URL"
      LAST_URL="$URL"
      echo "$URL" > "$URL_FILE"
      report_url "$URL"
      echo "Reported URL to Apps Script."
      LAST_HEARTBEAT=$(date +%s)
    fi
  done

  # If we get here, the tail pipe closed (cloudflared may have exited).
  CURRENT_PID=$(cat "$PID_FILE" 2>/dev/null)
  if [ -z "$CURRENT_PID" ] || ! kill -0 "$CURRENT_PID" 2>/dev/null; then
    echo "cloudflared not running — restarting..."
    start_cloudflared
  fi

  # --- Periodic heartbeat: re-report the current URL to keep Apps Script timestamp fresh ---
  NOW=$(date +%s)
  if [ -n "$LAST_URL" ] && [ $((NOW - LAST_HEARTBEAT)) -ge "$HEARTBEAT_INTERVAL" ]; then
    echo "Heartbeat: re-reporting tunnel URL ($LAST_URL) to Apps Script"
    report_url "$LAST_URL"
    LAST_HEARTBEAT=$NOW
  fi

  # --- Periodic health check: verify the tunnel is actually reachable ---
  NOW=$(date +%s)
  if [ -n "$LAST_URL" ] && [ $((NOW - LAST_HEALTH_CHECK)) -ge "$HEALTH_CHECK_INTERVAL" ]; then
    if health_check "$LAST_URL"; then
      echo "Health check: tunnel is reachable ($LAST_URL)"
    else
      echo "Health check FAILED: tunnel not reachable ($LAST_URL) — restarting cloudflared"
      CURRENT_PID=$(cat "$PID_FILE" 2>/dev/null)
      if [ -n "$CURRENT_PID" ]; then
        kill "$CURRENT_PID" 2>/dev/null
      fi
      # Clear the URL so we don't keep reporting a dead tunnel
      LAST_URL=""
      rm -f "$URL_FILE"
    fi
    LAST_HEALTH_CHECK=$NOW
  fi

  sleep 1
done
