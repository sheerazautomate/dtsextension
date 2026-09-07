#!/usr/bin/env bash
#
# Starts a Cloudflare quick tunnel pointed at localhost:3000, watches its
# output for the current trycloudflare.com URL, and POSTs that URL to the
# Apps Script Web App endpoint so Apps Script always knows the live address.
#
# Also polls Apps Script for a pending "restartTunnel" command (queued from
# the admin panel) and, when found, kills the current cloudflared process so
# the main loop below respawns it with a fresh URL.
#
# The current cloudflared PID is written to a file (not just a shell
# variable) because command_poll_loop runs as a backgrounded subshell —
# subshells only get a COPY of variables at the moment they're forked and
# never see later updates from the parent. A shared file avoids that.
#
# Usage: ./tunnel.sh
# Run this under pm2 instead of running "cloudflared tunnel --url ..." directly.

# ==== CONFIG — fill these in ====
APPS_SCRIPT_WEBAPP_URL="https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"
APPS_SCRIPT_SECRET="arsh7999"  # must match Code.gs SHARED_SECRET
LOCAL_PORT=3000
COMMAND_POLL_INTERVAL=10
# =================================

LOG_FILE="/tmp/cloudflared.log"
PID_FILE="/tmp/cloudflared.pid"
LAST_URL=""
LAST_COMMAND_ID=""

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
#     restart cloudflared if it dies (from a crash or from the kill above) ---
while true; do
  tail -F "$LOG_FILE" 2>/dev/null | while read -r line; do
    # Requires the real four-word-hyphenated pattern, so it can never match
    # cloudflared's own internal "api.trycloudflare.com" backend URL.
    URL=$(echo "$line" | grep -oE 'https://[a-z]+-[a-z]+-[a-z]+-[a-z]+\.trycloudflare\.com')

    if [ -n "$URL" ] && [ "$URL" != "$LAST_URL" ]; then
      echo "Detected new tunnel URL: $URL"
      LAST_URL="$URL"
      report_url "$URL"
      echo "Reported URL to Apps Script."
    fi
  done

  # If we get here, cloudflared exited (crash or killed by the command poller).
  CURRENT_PID=$(cat "$PID_FILE" 2>/dev/null)
  if [ -z "$CURRENT_PID" ] || ! kill -0 "$CURRENT_PID" 2>/dev/null; then
    echo "cloudflared not running — restarting..."
    start_cloudflared
  fi
  sleep 1
done
