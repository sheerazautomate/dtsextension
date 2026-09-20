# Admin Panel — Setup & Deployment Guide

This covers wiring up the new central hub (`apps-script/Code.gs`), the instrumented
`whatsapp-bot`, the extension's heartbeat, and deploying `admin-panel/` both locally
and to Vercel.

Do these **in order** — later steps depend on secrets/URLs from earlier ones.

---

## 1. Pick one shared secret

Generate one long random string (e.g. `openssl rand -hex 24`) and use it **everywhere**
below as `SHARED_SECRET`. Every component must use the exact same value:
`apps-script/Code.gs`, `whatsapp-bot/.env`, `whatsapp-bot/tunnel.sh`, the extension
popup's "Shared Secret" field, and the admin panel's `APPS_SCRIPT_SECRET`.

> The `"blahblah"` placeholder flagged in the previous security review is gone from
> the defaults in code, but you still need to actually set a real value — nothing
> generates one for you.

## 2. Patch the existing Apps Script

Use `apps-script-patch/` (see `ADMIN_PANEL_SETUP.md` inside it) — **not** a from-scratch
`Code.gs`. The real project already runs a dashboard, PDF-generation/WhatsApp pipeline,
and Drive upload, so this is a small additive patch (one new file, two small edits)
against the existing `Code.js`/`router.js`, not a replacement.

1. Add `AdminPanel.js` as a new file in the Apps Script editor.
2. Apply the small edits to `Code.js` (`doGet`) and `router.js` (`doPost`) shown in
   `ADMIN_PANEL_SETUP.md`.
3. Set `ADMIN_PANEL_SECRET` in `AdminPanel.js` to your generated secret — this is a
   new, separate secret from the project's existing three (`SHARED_SECRET`,
   `WHATSAPP_SHARED_SECRET`, `URL_UPDATE_SECRET`); don't reuse those.
4. **Deploy → Manage deployments → Edit → New version → Deploy** (editing files alone
   doesn't update the live `/exec` endpoint).
5. Your `/exec` URL doesn't change — you're patching the same deployment, not creating
   a new one.

Wherever the rest of this guide below says "your `SHARED_SECRET`," read that as
`ADMIN_PANEL_SECRET` for anything talking to the admin panel specifically.

> Apps Script web apps always return HTTP 200 from `doGet`/`doPost` — there's no way to
> set real HTTP status codes. Every response includes an `ok` boolean instead; check
> that field, not the HTTP status, in anything you build against this.

## 3. Update the browser extension

In the extension popup, set:
- **Apps Script Web App URL** → the `/exec` URL from step 2
- **Shared Secret** → your `SHARED_SECRET`

No code changes needed beyond what's already in `extension/content.js` — it now pushes a
heartbeat every 20s and will act on a `triggerRun` command automatically. Reload the
extension (`about:debugging` → Reload, or re-load unpacked) to pick up the updated
`extension/content.js`.

## 4. Update whatsapp-bot

```bash
cd whatsapp-bot
cp .env.example .env
```

Edit `.env`:
```
WHATSAPP_GROUP_JID=<run: node get-groups.js, if you don't already know it>
WHATSAPP_SHARED_SECRET=<your SHARED_SECRET>
APPS_SCRIPT_URL=<the /exec URL from step 2>
APPS_SCRIPT_SECRET=<your SHARED_SECRET>
```

Edit `tunnel.sh` directly (bash scripts don't read `.env` here) and set:
```bash
APPS_SCRIPT_WEBAPP_URL="<the /exec URL from step 2>"
APPS_SCRIPT_SECRET="<your SHARED_SECRET>"
```

Install the new dependency and (re)start under pm2:
```bash
npm install
chmod +x tunnel.sh
pm2 delete dts-whatsapp-bot dts-tunnel 2>/dev/null  # if they already exist
pm2 start ecosystem.config.js
pm2 save
```

If you haven't yet done the boot-persistence step flagged previously, do it now:
```bash
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u sheeraz --hp /home/sheeraz
```

`tunnel.sh`'s command-polling loop needs `jq`:
```bash
sudo apt install -y jq
```

## 5. Run the admin panel locally

```bash
cd admin-panel
cp .env.example .env.local
```

Edit `.env.local`:
```
APPS_SCRIPT_URL=<the /exec URL from step 2>
APPS_SCRIPT_SECRET=<your SHARED_SECRET>
LOCAL_BOT_URL=http://localhost:3000
LOCAL_BOT_SECRET=<your SHARED_SECRET, same as WHATSAPP_SHARED_SECRET>
LOCAL_CLOUDFLARED_LOG=/tmp/cloudflared.log
```

```bash
npm install
npm run dev
```

Open `http://localhost:3000` — **note this is the same port the bot uses.** If you're
running the panel on the same machine as the bot, start the panel on a different port:
```bash
npm run dev -- -p 4000
```
Then open `http://localhost:4000`. The "Local Diagnostics" section only lights up
when it can actually reach `localhost:3000` and `/tmp/cloudflared.log` — i.e. when
you're running the panel on the same host as the bot.

## 6. Deploy to Vercel

1. Push `admin-panel/` to your GitHub repo (private, once you flip it).
2. In Vercel: **New Project** → import the repo → set **Root Directory** to
   `admin-panel`.
3. Add environment variables (Project Settings → Environment Variables):
   - `APPS_SCRIPT_URL`
   - `APPS_SCRIPT_SECRET`
   - Leave `LOCAL_BOT_URL` / `LOCAL_BOT_SECRET` / `LOCAL_CLOUDFLARED_LOG` unset — on
     Vercel there's no localhost bot or local log file to reach, and the Local
     Diagnostics section will correctly show "no local services reachable."
4. Deploy.

You now have the same panel running two ways: locally with full local-machine
visibility (pm2 process list, cloudflared log tail, direct bot health check), and on
Vercel with everything routed through Apps Script — tunnel URL, bot heartbeat,
extension heartbeat, event log, and the same four control actions.

## 7. Verify end to end

- [ ] Apps Script `getStatus` returns `{ ok: true, ... }` — test with:
      `curl "<exec-url>?action=getStatus&secret=<SHARED_SECRET>"`
- [ ] `whatsapp-bot` logs show heartbeats going out (or check the panel's Bot card —
      it should go from "unknown" to "live" within ~15s of starting the bot)
- [ ] `tunnel.sh` reports a URL and the panel's Tunnel card shows it
- [ ] Open the DTS Dashboard tab with the extension running — the Extension card
      should populate within ~20s
- [ ] Click **Send test message** in the panel — confirm it lands in the WhatsApp
      group within a few seconds
- [ ] Click **Restart tunnel** — confirm `tunnel.sh` logs show it killing/respawning
      `cloudflared` and a new URL gets reported
- [ ] Click **Restart bot** — confirm pm2 shows a restart (`pm2 list`) and the bot
      reconnects to WhatsApp without needing to re-scan a QR code (session persists
      in `auth_info/`)

## Notes on what "full control" actually means here

- **Restart bot / restart tunnel / trigger run** are all **asynchronous and
  best-effort** — the panel queues a command in Apps Script; the relevant service
  picks it up on its next poll (bot/tunnel: ~10–15s, extension: ~20s, and only while
  its poller is actually running — a dead bot obviously can't poll for a "restart
  bot" command, though pm2 restarting it and it resuming polling is the actual
  recovery path in that case).
- There's no push channel (no websockets) — Apps Script can't reach into your host or
  browser directly, which is why everything here is poll-based.
- **You chose no access protection on the panel itself.** Since Vercel deployments
  are reachable by URL even without a custom domain, anyone who has (or guesses) that
  URL can trigger these actions once deployed. The `APPS_SCRIPT_SECRET` stays
  server-side (in Vercel env vars, never sent to the browser), so at least that secret
  isn't directly exposed — but the panel's own actions are unauthenticated by design,
  per your call. If that changes, Vercel's built-in **Deployment Protection**
  (Project Settings → Deployment Protection → Password Protection) is the fastest way
  to add a gate without touching any code.
