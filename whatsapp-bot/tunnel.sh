#!/usr/bin/env bash
#
# Starts a Cloudflare quick tunnel pointed at localhost:3000, watches its
# output for the current trycloudflare.com URL, and POSTs that URL to the
# Apps Script Web App endpoint so Apps Script always knows the live address.
#
# Usage: ./tunnel-and-report.sh
# Run this under pm2 instead of running "cloudflared tunnel --url ..." directly.

# ==== CONFIG — fill these in ====
APPS_SCRIPT_WEBAPP_URL="https://script.google.com/macros/s/AKfycbwhuxqihQeDPgNxWsJ97dRKolqh44VMvEXekHi8SNShsWCaPGbqLvazGYaqq7wunttSMQ/exec"
URL_UPDATE_SECRET="blahblah"   # must match Apps Script's URL_UPDATE_SECRET
LOCAL_PORT=3000
# =================================

LOG_FILE="/tmp/cloudflared.log"
LAST_URL=""

# Start cloudflared in the background, logging to a file
cloudflared tunnel --url "http://localhost:${LOCAL_PORT}" > "$LOG_FILE" 2>&1 &
CLOUDFLARED_PID=$!

echo "cloudflared started (PID $CLOUDFLARED_PID), watching $LOG_FILE for URL..."

# Tail the log and react whenever a trycloudflare.com URL appears
tail -F "$LOG_FILE" | while read -r line; do
  URL=$(echo "$line" | grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com')

  if [ -n "$URL" ] && [ "$URL" != "$LAST_URL" ]; then
    echo "Detected new tunnel URL: $URL"
    LAST_URL="$URL"

    curl -s -X POST "$APPS_SCRIPT_WEBAPP_URL" \
      -H "Content-Type: application/json" \
      -d "{\"secret\":\"${URL_UPDATE_SECRET}\",\"url\":\"${URL}\"}"

    echo ""
    echo "Reported URL to Apps Script."
  fi
done
