# Changelog — SRU NetPulse

## v2.2 — 2026-10-28
### Fixed
- **«الإبلاغ عن مشكلة» on mobile:** the form and the tips card were forced side by side, squeezing the form into a narrow strip; they now stack on screens ≤ 820 px. Inputs use 16 px text on mobile (no iOS zoom), cards have tighter padding, and the active tab scrolls into view in the mobile menu.
- Mobile-number field now has the same styling as the other fields.
### Changed
- **وصف المشكلة is optional** (frontend and backend); empty descriptions show «—» in e-mails and the ticket panel.
- **Missing required fields are highlighted:** red border and light-red background, label in red, a «هذا الحقل مطلوب» message under each field (or a format hint for an invalid mobile number), a summary alert at the top, and the page scrolls to the first missing field. The highlight clears as soon as the field is filled. Required: الكلية / الجهة، نوع المشكلة، المبنى، رقم الجوال.

## v2.1 — 2026-10-28
### Changed
- University buildings updated to: مبنى 1 · مبنى 2 · مبنى 3 · مبنى 4 · شطر الطالبات · سكن الطلاب · سكن الطالبات (`setup` seed, demo data, monitoring example).
- `Locations-v2.1.tsv` — ready-to-paste rows for the live Sheet's `Locations` tab (cell A2).

## v2.0 — 2026-10-13
### Added
- **«المسؤول» is now a dropdown** of the ICTD team, grouped by unit (ICTD / ITOC / NOC / DSSC / AAU), showing name — title; «— غير مُسند —» option; «تعيين لي» picks your own entry.
- New `Team` tab (Name, Title, Unit, Email, Active, SortOrder) seeded by `setup` with the 14-member ICTD list; edit the tab to add, remove (Active = FALSE) or reorder people — no code change.
- Team members are **automatically given the tech-team role** (access to لوحة الفريق الفني / إدارة البلاغات); an explicit `Users` role still takes priority.
- **Assignment e-mail** «أُسند إليك بلاغ» to the assignee (location, priority, reporter + tap-to-call mobile, description, button to open the ticket).
- Ticket list filter by assignee: كل المسؤولين / المسندة إليّ / غير مُسندة / each member.
- `Tickets` column `AssigneeEmail` (added automatically).

## v1.9 — 2026-10-13
### Added
- **Weekly KPI report** (`sendWeeklyReport`, trigger every Sunday 07:00 Riyadh, installed by `setup`) to `REPORT_EMAILS` (default m.elmahdy@sr.edu.sa): new/resolved/open/auto-closed tiles with week-over-week change; KPI table vs targets (satisfaction, first response, resolution time, reopen %, survey response rate) marked محقق / غير محقق; top buildings with bars; issue-type mix; reopened tickets; user speed-test median; CSV of the week's tickets attached.
- `WeeklyKPIs` tab — one row per week, a cumulative evidence log for the operational plan.
- KPI targets configurable via Script properties `TARGET_SAT`, `TARGET_RESPONSE_MIN`, `TARGET_RESOLVE_HOURS`, `TARGET_REOPEN_PCT`.
- Admin button «إرسال التقرير الآن» (تحديث حالة الشبكة page).
### Changed
- **Ticket management made explicit:** «معالجة» button on every row; panel redesigned with one-click status buttons (استلام البلاغ / بدء المعالجة / تم الحل / إغلاق / مفتوح), «تعيين لي», and a **«الرد على المُبلِّغ»** field that is e-mailed even when the status does not change (new «رد من الفريق الفني» e-mail).
- «تم الحل» now requires the action taken (sent to the reporter with the Yes/No question).
- Unexpected errors are shown as a message instead of failing silently.

## v1.8 — 2026-10-13
### Added
- **«هل حُلّت مشكلتك؟»** — the «تم الحل» e-mail now carries two buttons (✓ نعم، حُلّت / ✗ لا، ما زالت المشكلة); the same question appears in the ticket panel.
  - **Yes** → ticket closed, answer recorded.
  - **No** → optional comment, ticket **reopened automatically** (status مفتوح, priority raised to at least «عالية», reopen counter +1) and the NOC receives a «أُعيد فتح البلاغ» e-mail.
- **Auto-close:** daily trigger `autoCloseResolved` (installed by `setup`) closes tickets left «تم الحل» with no answer after `AUTOCLOSE_DAYS` (default 3).
- **Satisfaction KPI** on the tech dashboard: satisfaction % (yes ÷ answers, 30 days, colour-coded ≥85% green / ≥70% amber / below red), response rate and reopened count; plus a table of the latest «لم تُحل» answers with user comments.
- New `Feedback` tab (Timestamp, TicketId, Email, Answer, Note, Building, IssueType, Cycle) and `Tickets` columns `Feedback`, `FeedbackAt`, `ReopenCount` — added automatically to the existing Sheet.
- Timeline labels for confirmed / reopened / auto-closed events; feedback and reopen count shown to staff and exported to CSV.
### Changed
- Manifest: added scopes for the auto-close trigger and the signed-in user's e-mail; web-app access set to `DOMAIN`.

## v1.7 — 2026-10-13
### Changed
- **Redesigned e-mails** (reporter confirmation, status update, resolved, NOC alert): branded header with the «نبض الشبكة» logo, progress tracker (مفتوح → قيد المراجعة → قيد المعالجة → تم الحل), coloured status badge, details table, call-to-action button and ITOC footer. Table-based layout for Outlook/Gmail; sender name «نبض الشبكة — SRU NetPulse»; no-reply.
- NOC alert now shows reporter, tap-to-call mobile, department, location, attached speed test and suggested priority.
### Added
- **Link in every e-mail** — opens the ticket directly (`/exec?ticket=NP-1001`); the platform opens that ticket after sign-in. Optional Script property `APP_URL` overrides the link.
- `backend/Brand.gs` — logo images embedded for e-mails (inline cid images, no external hosting).

## v1.6 — 2026-10-13
### Added
- **No-Client-ID mode (default):** the platform page is served directly by Apps Script (`doGet` → `backend/Index.html`); Google signs the user in and `Session.getActiveUser()` identifies them. No Google Cloud project or OAuth Client ID is needed.
- GitHub page keeps the branded ITOC sign-in card; its button «الدخول بالبريد الجامعي» opens the Apps Script page.
- `apiCall()` server entry point used through `google.script.run`; shared `route_()` for both hosting modes.
- Profile prompt now also asks for the **full name** when it is not on file (Apps Script does not expose the Google display name).
- `backend/Index.html`: generated copy of `index.html` with all logos embedded (Apps Script cannot serve the `assets/` folder).
### Changed
- Health check moved to `?health=1`; plain `/exec` now returns the platform page.
- Google Sign-In (Client ID) mode is kept as an option and activates automatically if `CONFIG.CLIENT_ID` is set.

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
