# Changelog — SRU NetPulse

## v1.5 — 2026-10-13
### Changed
- `CONFIG.API_URL` updated to the new Web App deployment: `https://script.google.com/macros/s/AKfycbzkYXiwgENHM9WlCBCsuYkMDK347diwDi_aJPLrPHy7zTFO6OERgpIRVf3OrngYUwdDuw/exec` (replaces the v1.4 URL).
- Version bumped to 1.5 in frontend and backend.

## v1.4 — 2026-10-13
### Changed
- Backend Web App URL hard-coded in `CONFIG.API_URL`: `https://script.google.com/macros/s/AKfycbwNQJ7YyuuCc9grSfxDYrvz04e4-zOBKMKG3aa19pPc7fV8lEBXu473KOMp7X8hLVNIsQ/exec`.
- Demo mode now runs only when `API_URL` is empty; with the URL set the platform always uses the live Google Sheet.
### Added
- Startup reachability check: the sign-in screen shows a clear message if the Web App is not deployed with access "Anyone" or if `CLIENT_ID` is missing.

## v1.3 — 2026-10-13
### Added
- Sign-in now accepts **@sr.edu.sa and @srcolleges.org** (frontend `CONFIG.DOMAINS`; backend Script property `ALLOWED_DOMAINS`, default `sr.edu.sa,srcolleges.org`). The Google ID token's `hd` must match one of them.
- **Mobile number**: required once at first sign-in (profile prompt), editable from the top-bar phone icon, pre-filled and required on every report. Saudi numbers normalised to `+9665XXXXXXXX`; international `+E.164` accepted; Arabic-Indic digits accepted.
- `Mobile` column in `Users`, `Tickets` and `SignInLog`; mobile shown (tap-to-call) in the ticket panel, included in CSV export and in the NOC new-ticket e-mail.
- Automatic schema migration: the backend appends any missing header to existing tabs, so the v1.2 Sheet upgrades in place.
### Changed
- Version bumped to 1.3.

## v1.2 — 2026-10-13
### Added
- Official platform logo (approved option 6 — «نبض الشبكة» ring + pulse badge) as a full brand pack in `assets/brand/`: SVG (mark, white, mono, lockup, white lockup, app icon), PNG sizes, `favicon.svg`, `favicon.ico`, `apple-touch-icon.png`, `site.webmanifest`.
### Changed
- Logo integrated in the header band (centre), the top bar, the sign-in card and the browser tab (favicon + theme colour); installable on mobile home screens via the web manifest.
- Sign-in card now shows the platform lockup with a "managed by ITOC" line.
- Page title and e-mail header use the Arabic name «نبض الشبكة».
- Version bumped to 1.2 in frontend and backend.

## v1.1 — 2026-10-13
### Changed
- Added official logos to `assets/`: `sru-logo.png` (header right), `ictd-logo.png` (header left), `itoc-logo.png` (sign-in card + footer bottom-left, linked to the ITOC forms hub).
- Version bumped to 1.1 in frontend and backend.

## v1.0 — 2026-10-13
### Added
- Arabic RTL single-page frontend (`index.html`) in SRU visual identity, with ITOC-branded sign-in screen (@sr.edu.sa only) and ITOC footer link.
- Speed test (download / upload / ping / jitter) with live gauge, verdict, and "report with this result".
- Problem reporting with canonical SRU departments (grouped), building, spot, issue type, connection type, attached speed result.
- Ticket tracking with status stepper and processing timeline.
- Network & buildings status: monitoring push → manual update → labelled estimate (tests + tickets).
- Tech-team dashboard (KPIs, trend, by-building charts), ticket management (filters, CSV export), manual network status.
- Apps Script backend: token verification, sign-in log, roles, auto-priority, e-mail notifications, `pushStatus` endpoint, `setup()`.
- Demo mode (localStorage) when API is not configured.
