# Changelog — SRU NetPulse

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
