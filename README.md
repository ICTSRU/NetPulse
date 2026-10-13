# نبض الشبكة — SRU NetPulse · v1.2

منصة متابعة جودة الإنترنت ودعم الأعطال لجامعة سليمان الراجحي — الإدارة التنفيذية للاتصالات وتقنية المعلومات / مركز عمليات تقنية المعلومات (ITOC).

| Layer | Technology |
|---|---|
| Frontend | `index.html` — single-file Arabic RTL app (GitHub Pages) |
| Backend | Google Apps Script Web App (`backend/Code.gs`) |
| Database | Google Sheet (7 tabs, auto-created by `setup()`) |
| Auth | Google Sign-In, **@sr.edu.sa only**, verified server-side; every sign-in logged |
| Speed test | Cloudflare speed endpoints (download / upload / ping / jitter) |

## Brand
The approved logo and all export sizes are in `assets/brand/` — see `assets/brand/BRAND.md`.

## Features
- **قياس الإنترنت** — download, upload, ping, jitter with live gauge; result saved per building.
- **الإبلاغ عن مشكلة** — department (canonical `sru-departments.json`, grouped), building, spot, issue type, time, description, optional attached speed result. Ticket IDs `NP-1001…`.
- **متابعة البلاغات** — status stepper + processing timeline; e-mail on creation and on every status change.
- **الشبكة والمباني** — building status from **monitoring data** (push endpoint), **manual update** by the tech team, or a clearly labelled **estimate** from the last 24h of user tests + open tickets.
- **لوحة الفريق الفني** (tech/admin) — KPIs (open, avg first response, avg resolution, network alerts), trend, tickets by building, average speed by building.
- **إدارة البلاغات** — filters, search, update drawer, CSV export.
- **Demo mode** — runs fully in the browser when `API_URL`/`CLIENT_ID` are empty.

## Sheet tabs
`SignInLog` · `Users` · `Locations` · `NetworkStatus` · `SpeedTests` · `Tickets` · `TicketLog`

Roles (`Users` tab, column `Role`): `user` (default for everyone) · `tech` · `admin`.

## Deployment (≈15 minutes)
1. **Sheet + script** — create a Google Sheet "SRU NetPulse DB" → Extensions → Apps Script. Paste `backend/Code.gs`; enable "Show appsscript.json" in Project Settings and paste `backend/appsscript.json`.
2. Run **`setup`** once (authorize). Edit the `Locations` tab to SRU's real buildings/zones (seed rows are placeholders).
3. **OAuth Client ID** — Google Cloud Console → APIs & Services → Credentials → *OAuth client ID* → *Web application*. Authorized JavaScript origin: `https://ictsru.github.io` (and any test origin). Consent screen: **Internal**.
4. **Script properties** (Project Settings):
   | Key | Value |
   |---|---|
   | `CLIENT_ID` | the client ID from step 3 |
   | `ADMIN_EMAILS` | e.g. `m.elmahdy@sr.edu.sa` |
   | `NOTIFY_EMAIL` | NOC / helpdesk mailbox |
   | `MONITOR_KEY` | long random secret (for monitoring push) |
   | `STALE_HOURS` | optional, default `6` |
5. **Deploy** → New deployment → Web app → *Execute as: Me*, *Who has access: Anyone* → copy the `/exec` URL. (Access is "Anyone" because GitHub Pages cannot send Google cookies; **every call is authorised by the verified @sr.edu.sa ID token**.)
6. In `index.html` set `CONFIG.API_URL` and `CONFIG.CLIENT_ID`.
7. Add logos to `assets/` (see `assets/README.md`) and push to GitHub (e.g. repo `ICTSRU/NetPulse`, Pages from `main`).

## Monitoring integration (recommended automation)
Push live building status every 5 minutes from n8n / Zabbix / PRTG / the Wi-Fi controller:
```json
POST <API_URL>
{ "action":"pushStatus", "key":"<MONITOR_KEY>", "source":"zabbix",
  "items":[{"building":"مبنى كلية الطب","status":"slow","note":"Uplink 92%"}] }
```
Allowed status values: `ok`, `warn`, `slow`, `down`, `maintenance`. The `building` must match the `Locations` tab exactly.

## Security notes
- ID token verified via Google `tokeninfo` (audience, `email_verified`, `hd = sr.edu.sa`); cached ≤10 min.
- Users see only their own tickets; staff actions require `tech`/`admin`.
- All inputs length-capped and protected against spreadsheet formula injection.
- No personal data is sent to the speed-test server (anonymous byte transfers only).
