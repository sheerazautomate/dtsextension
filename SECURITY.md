# Security

This document is the operator checklist for secrets in this repo. The
WhatsApp session, shared secrets, Drive/Sheet IDs, and a live tunnel URL
were previously committed. That is fixed **going forward** on this branch.
Git history still contains the old files until it is rewritten.

## What must never be committed

| Path / value | Why |
|---|---|
| `whatsapp-bot/auth_info/` | Live Baileys session. Anyone with these files can impersonate the linked WhatsApp account. |
| `whatsapp-bot/.env` | Bot secrets and Apps Script URL. |
| `admin-panel/.env.local` | Admin panel secrets. |
| `whatsapp-bot/chat_history.json`, `known_contacts.json`, `scheduled_messages.json`, `scheduled-attachments/` | Message contents, phone numbers, group JIDs. |
| `whatsapp-bot/cloudflare`, `whatsapp-bot/get groups` | Live tunnel URL and real group JIDs. |
| `.clasp.json` | Apps Script project id. |
| Hard-coded `arsh7999`, `blahblah`, group JIDs, Drive folder IDs | Trivial or identifying secrets in source. |

`.gitignore` now covers these. Do not `git add -f` them. Do not `git add .` from the repo root while the bot is running.

## Rotate everything that was in Git

The old values are still in history (`main`, this branch, clones). Treat them as public.

1. **WhatsApp session**
   - On the phone: WhatsApp → Linked Devices → log out the bot device.
   - Delete `whatsapp-bot/auth_info/` on the host (or move it aside).
   - Restart the bot (`pm2 restart dts-whatsapp-bot`) and scan a new QR from `pm2 logs dts-whatsapp-bot`.

2. **Shared secrets** — generate new ones, do not reuse `arsh7999` / `blahblah`:

   ```bash
   openssl rand -hex 24
   ```

   Set them in **both** places:
   - `whatsapp-bot/.env` (see `.env.example`)
   - Apps Script → Project Settings → Script properties (see `backend/SCRIPT_PROPERTIES.example`)

   Then **Deploy → Manage deployments → Edit → New version** so `/exec` picks up the Apps Script changes.

3. **Extension popup** — put the new `SHARED_SECRET` in the extension settings. It is stored in `browser.storage.local`, not in this repo.

4. **Admin panel** — `admin-panel/.env.local` `APPS_SCRIPT_SECRET` must match `ADMIN_PANEL_SECRET`.

5. **ntfy topic** — if `dts` was used, pick a hard-to-guess topic and set script property `NTFY_TOPIC`.

## Host setup after pulling this branch

```bash
cd ~/GitHub/dtsextension
git checkout arena/01a07bb2-dtsextension
git pull

cd whatsapp-bot
cp -n .env.example .env   # does not overwrite an existing .env
# edit .env: APPS_SCRIPT_URL, APPS_SCRIPT_SECRET, URL_UPDATE_SECRET,
#            WHATSAPP_SHARED_SECRET, WHATSAPP_GROUP_JID

# confirm runtime files are untracked
git status --short   # should NOT list auth_info/ or .env

pm2 restart dts-whatsapp-bot dts-tunnel
```

The bot and tunnel **refuse to start** if required env vars are missing. That is intentional.

Apps Script files no longer contain secrets. Until you set Script properties and redeploy, `/send-file` auth, CSV upload, and tunnel URL updates will 401.

## Optional: purge history

Removing files in a new commit does not erase them from old commits. To purge:

```bash
# destructive — backup first, coordinate with every clone
git filter-repo --invert-paths \
  --path whatsapp-bot/auth_info/ \
  --path whatsapp-bot/chat_history.json \
  --path whatsapp-bot/known_contacts.json \
  --path whatsapp-bot/scheduled_messages.json \
  --path whatsapp-bot/scheduled-attachments/ \
  --path whatsapp-bot/cloudflare \
  --path 'whatsapp-bot/get groups'
```

Then force-push every branch that contained those paths, and unlink the WhatsApp device as above. If the GitHub repo was ever public, assume the session and secrets are burned even after a purge.
