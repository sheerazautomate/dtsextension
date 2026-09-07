# Apps Script — Admin Panel Integration (additive patch)

This replaces the earlier "replace Code.gs wholesale" advice, which was wrong for
your actual project — your script already runs a real dashboard (`doGet`), a
PDF-generation + WhatsApp-sending pipeline (`Code.js`), a Drive CSV upload, and a
bulk-delete tool. None of that gets touched.

## What changed

| File | Change |
|---|---|
| **`AdminPanel.js`** | **New file.** Doesn't define `doGet`/`doPost` — only Code.js and router.js may do that (Apps Script allows exactly one of each per project). Called *from* them. |
| **`Code.js`** | `doGet` gets one `if` block added at the top: `?action=getStatus` returns JSON for the panel; anything else (i.e. opening the URL normally) still renders the Dashboard exactly as before. |
| **`router.js`** | `doPost` gets one `if` block added at the top for `?action=...` (heartbeats/commands), plus two small `try/catch` blocks that log to the new event sheet after the *existing* CSV-upload and tunnel-update paths run — their behavior and return values are unchanged. |
| **`waUrlRegistry.js`** | **Untouched.** `getWhatsAppWebhookUrl()` still reads the same `WHATSAPP_TUNNEL_URL` property it always has — the admin panel reads that same property for its Tunnel card rather than inventing a second one. |
| **`extension.js`, `Report_Generator.js`, `Bulk_Delete.js`, `fileDownload.js`, `appsscript.json`** | **Untouched.** |

## Why a separate secret

You already have three different secret constants in this project — `SHARED_SECRET`
(extension.js), `WHATSAPP_SHARED_SECRET` (Code.js), `URL_UPDATE_SECRET`
(waUrlRegistry.js). Apps Script merges top-level `var`/`const` declarations across
*all* files in a project into one shared global scope, so `AdminPanel.js` uses its own
`ADMIN_PANEL_SECRET` — reusing any of the existing names would have silently
overwritten one of them depending on file load order (undefined, not something to
rely on).

Set `ADMIN_PANEL_SECRET` as an Apps Script **Script property** (not in source). Use
the same value in the bot's `.env` as `APPS_SCRIPT_SECRET`. See
`backend/SCRIPT_PROPERTIES.example` and `SECURITY.md`. It is a different property
name from `SHARED_SECRET` / `WHATSAPP_SHARED_SECRET` / `URL_UPDATE_SECRET` so the
Apps Script global scope cannot collide.

## Install

1. In the Apps Script editor, add a new file named `AdminPanel.js` (or `AdminPanel.gs`
   — extension doesn't matter to Apps Script) and paste in its contents.
2. Open `Code.js` and `router.js` in this project and replace their contents with the
   versions here (or apply the diffs manually if you'd rather review each line —
   both are small).
3. Set Script properties from `backend/SCRIPT_PROPERTIES.example` (including `ADMIN_PANEL_SECRET`). Never put the real values in source.
4. **Deploy → Manage deployments → Edit (pencil icon) → New version → Deploy.**
   Editing files alone does not update the live `/exec` endpoint — you already know
   this from the Apps Script deployment-staleness issue noted previously, but it's
   easy to forget on a second pass.
5. Point the whatsapp-bot, tunnel.sh, and admin panel at the same `/exec` URL you
   already have (it doesn't change), with `APPS_SCRIPT_SECRET` = your new
   `ADMIN_PANEL_SECRET`.

## Verify nothing broke

- [ ] Open the web app URL directly (no `?action=`) — the Dashboard still opens
- [ ] `curl "<exec-url>?action=getStatus&secret=<ADMIN_PANEL_SECRET>"` returns
      `{ "ok": true, ... }`
- [ ] The extension's CSV upload still returns `{ ok, rows, macroLog, macroError }`
      as before
- [ ] `tunnel.sh`'s existing URL-registry updates still work — check
      `getWhatsAppWebhookUrl()` still resolves (a manual PDF send / next scheduled
      report cycle should still reach WhatsApp)
- [ ] A new `AdminEventLog` sheet tab appears after the first heartbeat/CSV
      upload/tunnel update

## Separate, pre-existing issue worth fixing (not caused by this patch)

`runAllTehsilScripts` and `onEdit` are each defined **twice** — once in `Code.js`,
once in `Report_Generator.js`. Apps Script silently uses one when a function name is
duplicated across files in the same project; which one wins isn't something the
platform guarantees, so this has likely been quietly inconsistent already —
particularly since only the `Code.js` version has WhatsApp sending wired in
(`sendPdfToWhatsApp` calls inside each Tehsil generator). If `Report_Generator.js`'s
copies have been shadowing `Code.js`'s, reports could be generating without ever
reaching WhatsApp.

Worth deciding which version is authoritative and deleting the other — I can do that
edit once you confirm which one you actually want to keep (they're not identical:
`Report_Generator.js`'s `onEdit` sets an extra "On The Way" status message and its
`runAllTehsilScripts` uses 10s waits instead of 5s).
