# WhatsApp Bot Admin Control Center

The bot now serves an integrated admin panel on the **same port 3000** as the existing webhook.

Open:

```text
http://SERVER_IP:3000/admin
```

## What it provides

- Overall health status
- Baileys connection state and reconnect control
- Auth/session directory check
- Cloudflare tunnel status and current URL
- Manual tunnel URL registration/reporting
- PM2 process list, restart controls and machine metrics
- Recent PM2 logs
- WhatsApp group discovery
- Test WhatsApp message
- Full diagnostic checklist
- Safe automatic repair for common disconnected states
- Existing `/health` and `/send-file` endpoints remain unchanged

## Admin authentication

The panel asks for an admin secret and stores it in browser local storage. The API expects:

```text
x-admin-secret: <ADMIN_SECRET>
```

Set a dedicated `ADMIN_SECRET` in the PM2 environment. If it is not set, the current code falls back to `SHARED_SECRET` for backwards compatibility; change this before exposing the panel publicly.

Recommended PM2 environment:

```text
PORT=3000
ADMIN_SECRET=<long-random-value>
SHARED_SECRET=<different-long-random-value>
TEST_GROUP_JID=<target-group-jid>
APPS_SCRIPT_WEBAPP_URL=<apps-script-web-app-url>
URL_UPDATE_SECRET=<apps-script-url-update-secret>
```

## Tunnel controls

The existing `tunnel.sh` continues to own the Quick Tunnel lifecycle and automatic URL reporting. The admin panel can restart its PM2 process when detected, report the current URL, or save/report a manually supplied `trycloudflare.com` URL.

A manual URL is a **registration override**, not a way to manufacture a Cloudflare tunnel. The URL must already point to the running webhook.

## PM2

The admin panel discovers PM2 processes dynamically. It does not assume a fixed process name. The bot restart action looks for a process associated with `whatsapp` or `server.js`; the tunnel action looks for a process associated with `tunnel` or `cloudflared`.

## Security

Keep these out of source control:

- `auth_info/`
- `.env`
- `cloudflare`

Use the included `.env.example` as a configuration reference. Because the current legacy `server.js` and `tunnel.sh` contain hard-coded values, rotate those secrets when the repository is made private and move runtime values into the PM2 environment.
