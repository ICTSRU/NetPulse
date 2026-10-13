/**
 * ============================================================
 *  نبض الشبكة — SRU NetPulse (منصة جودة الإنترنت)
 *  Backend: Google Apps Script + Google Sheets
 *  Version: 1.9  (2026-10-13)
 *  Owner:   ICTD — IT Operations Center (ITOC)
 * ============================================================
 *  Script Properties (Project Settings → Script properties):
 *  HOSTING MODES
 *    A) Apps Script-hosted (default, no Client ID needed): the platform page is served by
 *       doGet() from the file "Index"; deploy Execute as: Me, Who has access:
 *       "Anyone within Sulaiman Al Rajhi University". Google signs the user in and
 *       Session.getActiveUser() identifies them.
 *    B) GitHub-hosted with Google Sign-In: needs CLIENT_ID and access "Anyone" (doPost path).
 *
 *    CLIENT_ID       (mode B only) Google OAuth Web Client ID used by the frontend
 *    ALLOWED_DOMAINS (optional) comma-separated, default: sr.edu.sa,srcolleges.org
 *    ADMIN_EMAILS    (optional) comma-separated bootstrap admins
 *    NOTIFY_EMAIL    (optional) NOC/helpdesk mailbox notified on every new ticket
 *    MONITOR_KEY     (optional) shared secret for the monitoring push endpoint
 *    STALE_HOURS     (optional) hours before a monitoring status is considered stale (default 6)
 *    AUTOCLOSE_DAYS  (optional) days after «تم الحل» with no reply before auto-close (default 3)
 *    REPORT_EMAILS   (optional) weekly report recipients, comma-separated (default m.elmahdy@sr.edu.sa)
 *    TARGET_SAT / TARGET_RESPONSE_MIN / TARGET_RESOLVE_HOURS / TARGET_REOPEN_PCT  (optional) KPI targets
 *                    defaults: 85 (%) / 60 (min) / 24 (h) / 10 (%)
 *    SEND_EMAILS     (optional) "false" to disable all e-mails (default true)
 *    APP_URL         (optional) link used in e-mails; default = this Web App's /exec URL
 *
 *  First run: select function `setup` → Run (creates all tabs + seed data).
 * ============================================================
 */

const APP = { NAME: 'SRU NetPulse', VERSION: '1.9' };

const SHEETS = {
  SIGNIN:   { name: 'SignInLog',     headers: ['Timestamp', 'Email', 'Name', 'Date', 'Time', 'Role', 'Client', 'Mobile'] },
  USERS:    { name: 'Users',         headers: ['Email', 'Name', 'Role', 'Active', 'Notes', 'Mobile'] },
  LOCS:     { name: 'Locations',     headers: ['Building', 'College', 'Active', 'SortOrder'] },
  NETSTAT:  { name: 'NetworkStatus', headers: ['Building', 'Status', 'Source', 'Note', 'UpdatedAt', 'UpdatedBy'] },
  TESTS:    { name: 'SpeedTests',    headers: ['Timestamp', 'Email', 'Building', 'DownloadMbps', 'UploadMbps', 'PingMs', 'JitterMs', 'Connection', 'Server', 'Client'] },
  TICKETS:  { name: 'Tickets',       headers: ['TicketId', 'CreatedAt', 'Email', 'Name', 'Department', 'Building', 'Spot', 'IssueType', 'Connection', 'OccurredAt', 'Description', 'Status', 'Priority', 'Assignee', 'FirstResponseAt', 'ResolvedAt', 'UpdatedAt', 'Resolution', 'DownloadMbps', 'UploadMbps', 'PingMs', 'Mobile', 'Feedback', 'FeedbackAt', 'ReopenCount'] },
  LOG:      { name: 'TicketLog',     headers: ['Timestamp', 'TicketId', 'Action', 'Status', 'Note', 'By'] },
  FEEDBACK: { name: 'Feedback',      headers: ['Timestamp', 'TicketId', 'Email', 'Answer', 'Note', 'Building', 'IssueType', 'Cycle'] },
  WEEKLY:   { name: 'WeeklyKPIs',    headers: ['WeekStart', 'WeekEnd', 'NewTickets', 'Resolved', 'OpenAtEnd', 'SatisfactionPct', 'ResponseRatePct', 'Answers', 'AvgFirstResponseMin', 'AvgResolveHours', 'Reopened', 'ReopenPct', 'AutoClosed', 'TopBuilding', 'TopIssue', 'SpeedTests', 'MedianDownMbps', 'SentTo', 'SentAt'] }
};

const TICKET_STATUS = ['open', 'review', 'progress', 'resolved', 'closed'];
const NET_STATUS    = ['ok', 'warn', 'slow', 'down', 'maintenance', 'unknown'];
const PRIORITIES    = ['low', 'medium', 'high', 'critical'];
const ROLES         = ['user', 'tech', 'admin'];

const STATUS_AR = { open: 'مفتوح', review: 'قيد المراجعة', progress: 'قيد المعالجة', resolved: 'تم الحل', closed: 'مغلق' };

/* ---------------- Entry points ---------------- */

function doGet(e) {
  if (e && e.parameter && e.parameter.health) {
    return json_({ ok: true, app: APP.NAME, version: APP.VERSION, time: new Date().toISOString() });
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('نبض الشبكة — SRU NetPulse')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Mode A entry point — called from the page with google.script.run.apiCall(action, payload). */
function apiCall(action, payload) {
  try {
    if (action === 'pushStatus') return { ok: false, error: 'UNKNOWN_ACTION' };
    return route_(String(action || ''), sessionUser_(), payload || {});
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

/** Mode A identity: the Google account signed in to the Apps Script page. */
function sessionUser_() {
  const email = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) throw new Error('AUTH_REQUIRED');
  const domain = email.split('@')[1] || '';
  if (allowedDomains_().indexOf(domain) === -1) throw new Error('AUTH_DOMAIN');
  const row = userRow_(email);
  const name = row && row.Name ? String(row.Name) : '';
  return { email: email, name: name || email.split('@')[0], nameMissing: !name, picture: '', role: roleOf_(email) };
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = String(body.action || '');

    // Machine-to-machine endpoint for monitoring tools (n8n / Zabbix / PRTG / Meraki webhooks)
    if (action === 'pushStatus') return json_(pushStatus_(body));

    const user = authenticate_(body.idToken);
    return json_(route_(action, user, body));
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function route_(action, user, body) {
    switch (action) {
      case 'login':          return login_(user, body);
      case 'saveProfile':    return saveProfile_(user, body.data || {});
      case 'getStatus':      return { ok: true, buildings: buildingStatus_() };
      case 'saveSpeedTest':  return saveSpeedTest_(user, body.data || {});
      case 'createTicket':   return createTicket_(user, body.data || {});
      case 'myTickets':      return { ok: true, tickets: myTickets_(user) };
      case 'getTicket':      return getTicket_(user, body.ticketId);
      case 'teamData':       requireRole_(user, ['tech', 'admin']); return teamData_();
      case 'updateTicket':   requireRole_(user, ['tech', 'admin']); return updateTicket_(user, body.data || {});
      case 'feedback':       return feedback_(user, body.data || {});
      case 'sendWeeklyReport': requireRole_(user, ['admin']); return { ok: true, sentTo: sendWeeklyReport() };
      case 'setBuildingStatus': requireRole_(user, ['tech', 'admin']); return setBuildingStatus_(user, body.data || {});
      default: return { ok: false, error: 'UNKNOWN_ACTION' };
    }
}

/* ---------------- Authentication (Google ID token, @sr.edu.sa only) ---------------- */

function authenticate_(idToken) {
  if (!idToken) throw new Error('AUTH_REQUIRED');
  const cache = CacheService.getScriptCache();
  const key = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken)).slice(0, 40);
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('AUTH_INVALID');
  const info = JSON.parse(res.getContentText());

  const clientId = prop_('CLIENT_ID');
  const domains = allowedDomains_();
  const email = String(info.email || '').toLowerCase();
  const domain = email.split('@')[1] || '';

  if (!clientId || info.aud !== clientId) throw new Error('AUTH_AUDIENCE');
  if (String(info.email_verified) !== 'true') throw new Error('AUTH_UNVERIFIED');
  if (domains.indexOf(domain) === -1 || String(info.hd || '').toLowerCase() !== domain) throw new Error('AUTH_DOMAIN');

  const user = { email: email, name: info.name || email, picture: info.picture || '', role: roleOf_(email) };
  const ttl = Math.max(60, Math.min(600, Number(info.exp) - Math.floor(Date.now() / 1000)));
  cache.put(key, JSON.stringify(user), ttl);
  return user;
}

function allowedDomains_() {
  return (prop_('ALLOWED_DOMAINS') || 'sr.edu.sa,srcolleges.org').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
}

function userRow_(email) {
  return readAll_(SHEETS.USERS).find(r => String(r.Email).toLowerCase() === email) || null;
}

/** Saudi mobiles → +9665XXXXXXXX; other international numbers accepted in +E.164 form. */
function normalizeMobile_(v) {
  let s = String(v || '').replace(/[\s\-().]/g, '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  if (/^00/.test(s)) s = '+' + s.slice(2);
  let m;
  if ((m = s.match(/^(?:\+?966|0)?(5\d{8})$/))) return '+966' + m[1];
  if (/^\+\d{8,15}$/.test(s)) return s;
  throw new Error('BAD_MOBILE');
}

function saveProfile_(user, d) {
  const mobile = normalizeMobile_(d.mobile);
  const name = clean_(d.name, 120);
  if (name) user.name = name;
  upsertUserMobile_(user, mobile, name);
  return { ok: true, mobile: mobile, name: user.name };
}

function upsertUserMobile_(user, mobile, name) {
  const sh = sheet_(SHEETS.USERS);
  const data = sh.getDataRange().getValues();
  const H = data[0];
  const ce = H.indexOf('Email'), cm = H.indexOf('Mobile'), cn = H.indexOf('Name');
  const idx = data.findIndex((r, i) => i > 0 && String(r[ce]).toLowerCase() === user.email);
  if (idx > 0) {
    sh.getRange(idx + 1, cm + 1).setValue("'" + mobile);
    if (name) sh.getRange(idx + 1, cn + 1).setValue(name);
  }
  else appendRow_(SHEETS.USERS, { Email: user.email, Name: user.name, Role: 'user', Active: true, Notes: 'self-registered', Mobile: "'" + mobile });
}

function roleOf_(email) {
  const admins = (prop_('ADMIN_EMAILS') || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (admins.indexOf(email) > -1) return 'admin';
  const u = userRow_(email);
  if (u && String(u.Active).toLowerCase() !== 'false' && ROLES.indexOf(String(u.Role)) > -1) return String(u.Role);
  return 'user';
}

function requireRole_(user, roles) {
  if (roles.indexOf(user.role) === -1) throw new Error('FORBIDDEN');
}

/* ---------------- Actions ---------------- */

function login_(user, body) {
  const now = new Date();
  const row = userRow_(user.email);
  user.mobile = row && row.Mobile ? String(row.Mobile).replace(/^'/, '') : '';
  const tz = Session.getScriptTimeZone();
  appendRow_(SHEETS.SIGNIN, {
    Timestamp: now, Email: user.email, Name: user.name,
    Date: Utilities.formatDate(now, tz, 'yyyy-MM-dd'),
    Time: Utilities.formatDate(now, tz, 'HH:mm:ss'),
    Role: user.role, Client: clean_(body.client, 200), Mobile: user.mobile ? "'" + user.mobile : ''
  });
  return {
    ok: true, user: user, version: APP.VERSION,
    locations: readAll_(SHEETS.LOCS)
      .filter(r => String(r.Active).toLowerCase() !== 'false' && r.Building)
      .sort((a, b) => (Number(a.SortOrder) || 99) - (Number(b.SortOrder) || 99))
      .map(r => ({ building: String(r.Building), college: String(r.College || '') })),
    buildings: buildingStatus_(),
    tickets: myTickets_(user)
  };
}

function saveSpeedTest_(user, d) {
  const row = {
    Timestamp: new Date(), Email: user.email, Building: clean_(d.building, 120),
    DownloadMbps: num_(d.download), UploadMbps: num_(d.upload),
    PingMs: num_(d.ping), JitterMs: num_(d.jitter),
    Connection: clean_(d.connection, 40), Server: clean_(d.server, 80), Client: clean_(d.client, 200)
  };
  if (!(row.DownloadMbps >= 0) || row.DownloadMbps > 20000) throw new Error('INVALID_TEST');
  appendRow_(SHEETS.TESTS, row);
  return { ok: true };
}

function createTicket_(user, d) {
  const desc = clean_(d.description, 500);
  if (!d.building || !d.issueType || desc.length < 5) throw new Error('MISSING_FIELDS');
  const mobile = normalizeMobile_(d.mobile);
  const row0 = userRow_(user.email);
  if (!row0 || !row0.Mobile) upsertUserMobile_(user, mobile);
  d.mobile = mobile;

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let id;
  try {
    const props = PropertiesService.getScriptProperties();
    const next = (Number(props.getProperty('TICKET_SEQ')) || 1000) + 1;
    props.setProperty('TICKET_SEQ', String(next));
    id = 'NP-' + next;
    const now = new Date();
    appendRow_(SHEETS.TICKETS, {
      TicketId: id, CreatedAt: now, Email: user.email, Name: user.name,
      Department: clean_(d.department, 150), Building: clean_(d.building, 120), Spot: clean_(d.spot, 120),
      IssueType: clean_(d.issueType, 80), Connection: clean_(d.connection, 40),
      OccurredAt: d.occurredAt ? new Date(d.occurredAt) : now, Description: desc,
      Status: 'open', Priority: suggestPriority_(d), Assignee: '', FirstResponseAt: '', ResolvedAt: '',
      UpdatedAt: now, Resolution: '',
      DownloadMbps: d.test ? num_(d.test.download) : '', UploadMbps: d.test ? num_(d.test.upload) : '',
      PingMs: d.test ? num_(d.test.ping) : '', Mobile: "'" + mobile
    });
    appendRow_(SHEETS.LOG, { Timestamp: now, TicketId: id, Action: 'created', Status: 'open', Note: '', By: user.email });
  } finally { lock.releaseLock(); }

  notifyNewTicket_(id, user, d, desc);
  return { ok: true, ticketId: id };
}

/** Auto-triage: full outage or very slow measured speed → higher priority. */
function suggestPriority_(d) {
  const t = String(d.issueType || '');
  if (t.indexOf('انقطاع كامل') > -1) return 'high';
  if (d.test && Number(d.test.download) > 0 && Number(d.test.download) < 2) return 'high';
  return 'medium';
}

function myTickets_(user) {
  return readAll_(SHEETS.TICKETS)
    .filter(r => String(r.Email).toLowerCase() === user.email)
    .map(publicTicket_)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function getTicket_(user, ticketId) {
  const t = readAll_(SHEETS.TICKETS).find(r => r.TicketId === ticketId);
  if (!t) throw new Error('NOT_FOUND');
  const isStaff = user.role === 'tech' || user.role === 'admin';
  if (!isStaff && String(t.Email).toLowerCase() !== user.email) throw new Error('FORBIDDEN');
  const log = readAll_(SHEETS.LOG).filter(r => r.TicketId === ticketId).map(r => ({
    at: iso_(r.Timestamp), action: r.Action, status: r.Status, note: r.Note,
    by: isStaff ? r.By : (String(r.By).toLowerCase() === user.email ? r.By : 'الفريق الفني')
  }));
  return { ok: true, ticket: publicTicket_(t), log: log };
}

function teamData_() {
  const since = Date.now() - 90 * 86400000;
  const tickets = readAll_(SHEETS.TICKETS)
    .filter(r => r.CreatedAt && new Date(r.CreatedAt).getTime() >= since || ['open', 'review', 'progress'].indexOf(r.Status) > -1)
    .map(publicTicket_)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const testsSince = Date.now() - 30 * 86400000;
  const tests = readAll_(SHEETS.TESTS)
    .filter(r => r.Timestamp && new Date(r.Timestamp).getTime() >= testsSince)
    .map(r => ({ at: iso_(r.Timestamp), building: r.Building, down: Number(r.DownloadMbps) || 0, up: Number(r.UploadMbps) || 0, ping: Number(r.PingMs) || 0 }));
  const feedback = readAll_(SHEETS.FEEDBACK)
    .filter(r => r.Timestamp && new Date(r.Timestamp).getTime() >= since)
    .map(r => ({ at: iso_(r.Timestamp), ticketId: r.TicketId, answer: r.Answer, note: r.Note, building: r.Building, issueType: r.IssueType }));
  return { ok: true, tickets: tickets, tests: tests, feedback: feedback, buildings: buildingStatus_() };
}

function updateTicket_(user, d) {
  if (d.status && TICKET_STATUS.indexOf(d.status) === -1) throw new Error('BAD_STATUS');
  if (d.priority && PRIORITIES.indexOf(d.priority) === -1) throw new Error('BAD_PRIORITY');
  const sh = sheet_(SHEETS.TICKETS);
  const data = sh.getDataRange().getValues();
  const H = data[0];
  const c = name => H.indexOf(name);
  const rowIdx = data.findIndex((r, i) => i > 0 && r[c('TicketId')] === d.ticketId);
  if (rowIdx < 1) throw new Error('NOT_FOUND');

  const row = data[rowIdx];
  const now = new Date();
  const prevStatus = row[c('Status')];
  if (d.status) row[c('Status')] = d.status;
  if (d.priority) row[c('Priority')] = d.priority;
  if (d.assignee !== undefined) row[c('Assignee')] = clean_(d.assignee, 120);
  if (d.resolution !== undefined) row[c('Resolution')] = clean_(d.resolution, 500);
  if (!row[c('FirstResponseAt')] && d.status && d.status !== 'open') row[c('FirstResponseAt')] = now;
  if ((d.status === 'resolved' || d.status === 'closed') && !row[c('ResolvedAt')]) row[c('ResolvedAt')] = now;
  if (d.status === 'resolved' && prevStatus !== 'resolved') { row[c('Feedback')] = ''; row[c('FeedbackAt')] = ''; }
  row[c('UpdatedAt')] = now;
  sh.getRange(rowIdx + 1, 1, 1, row.length).setValues([row]);

  const note = clean_(d.note, 500);
  appendRow_(SHEETS.LOG, { Timestamp: now, TicketId: d.ticketId, Action: 'updated', Status: row[c('Status')], Note: note, By: user.email });

  if (d.status && d.status !== prevStatus) {
    notifyReporter_(row[c('Email')], d.ticketId, row[c('Status')], note || row[c('Resolution')]);
  } else if (note) {
    notifyReply_(row[c('Email')], d.ticketId, row[c('Status')], note);   // reply only, status unchanged
  }
  return { ok: true, status: row[c('Status')] };
}

/**
 * «هل حُلّت مشكلتك؟» — answer from the reporter (e-mail buttons or ticket panel).
 *  yes → ticket closed;  no → ticket reopened (status open, priority raised, NOC alerted).
 */
function feedback_(user, d) {
  const answer = d.answer === 'yes' ? 'yes' : d.answer === 'no' ? 'no' : '';
  if (!answer) throw new Error('BAD_ANSWER');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = sheet_(SHEETS.TICKETS);
    const data = sh.getDataRange().getValues(); const H = data[0]; const c = n => H.indexOf(n);
    const i = data.findIndex((r, k) => k > 0 && r[c('TicketId')] === d.ticketId);
    if (i < 1) throw new Error('NOT_FOUND');
    const row = data[i];
    if (String(row[c('Email')]).toLowerCase() !== user.email) throw new Error('FORBIDDEN');
    if (row[c('Status')] !== 'resolved') {
      return { ok: true, already: true, status: row[c('Status')], feedback: row[c('Feedback')] || '' };
    }
    const now = new Date(); const note = clean_(d.note, 500);
    const cycle = (Number(row[c('ReopenCount')]) || 0) + 1;
    row[c('Feedback')] = answer; row[c('FeedbackAt')] = now; row[c('UpdatedAt')] = now;
    if (answer === 'yes') {
      row[c('Status')] = 'closed';
    } else {
      row[c('Status')] = 'open';
      row[c('ResolvedAt')] = '';
      row[c('ReopenCount')] = cycle;
      const order = ['low', 'medium', 'high', 'critical'];
      row[c('Priority')] = order[Math.min(3, Math.max(2, order.indexOf(row[c('Priority')]) + 1))];
    }
    sh.getRange(i + 1, 1, 1, row.length).setValues([row]);
    appendRow_(SHEETS.FEEDBACK, { Timestamp: now, TicketId: d.ticketId, Email: user.email, Answer: answer, Note: note,
      Building: row[c('Building')], IssueType: row[c('IssueType')], Cycle: cycle });
    appendRow_(SHEETS.LOG, { Timestamp: now, TicketId: d.ticketId, Action: answer === 'yes' ? 'confirmed' : 'reopened',
      Status: row[c('Status')], Note: note || (answer === 'yes' ? 'أكّد المستخدم حل المشكلة' : 'أفاد المستخدم بأن المشكلة لم تُحل'), By: user.email });
    if (answer === 'no') notifyReopen_(d.ticketId, user, row[c('Building')], row[c('IssueType')], note, row[c('Assignee')]);
    return { ok: true, status: row[c('Status')], feedback: answer };
  } finally { lock.releaseLock(); }
}

/** Daily trigger: close tickets left «تم الحل» with no answer for AUTOCLOSE_DAYS. */
function autoCloseResolved() {
  const days = Number(prop_('AUTOCLOSE_DAYS')) || 3;
  const limit = Date.now() - days * 86400000;
  const sh = sheet_(SHEETS.TICKETS);
  const data = sh.getDataRange().getValues(); const H = data[0]; const c = n => H.indexOf(n);
  const now = new Date(); let n = 0;
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (r[c('Status')] === 'resolved' && !r[c('Feedback')] && r[c('ResolvedAt')] && new Date(r[c('ResolvedAt')]).getTime() < limit) {
      r[c('Status')] = 'closed'; r[c('Feedback')] = 'none'; r[c('UpdatedAt')] = now;
      sh.getRange(i + 1, 1, 1, r.length).setValues([r]);
      appendRow_(SHEETS.LOG, { Timestamp: now, TicketId: r[c('TicketId')], Action: 'auto-closed', Status: 'closed',
        Note: 'أُغلق تلقائيًا لعدم الرد خلال ' + days + ' أيام', By: 'system' });
      n++;
    }
  }
  return n;
}

function setBuildingStatus_(user, d) {
  upsertStatus_(d.building, d.status, 'manual', d.note, user.email);
  return { ok: true, buildings: buildingStatus_() };
}

/**
 * Monitoring push — POST JSON:
 * { "action":"pushStatus", "key":"<MONITOR_KEY>", "items":[{"building":"مبنى كلية الطب","status":"slow","note":"Uplink 92%"}] }
 */
function pushStatus_(body) {
  const key = prop_('MONITOR_KEY');
  if (!key || body.key !== key) return { ok: false, error: 'BAD_KEY' };
  const items = Array.isArray(body.items) ? body.items.slice(0, 100) : [];
  items.forEach(it => upsertStatus_(it.building, it.status, 'monitoring', it.note, clean_(body.source || 'monitoring', 60)));
  return { ok: true, updated: items.length };
}

function upsertStatus_(building, status, source, note, by) {
  building = clean_(building, 120);
  if (!building || NET_STATUS.indexOf(status) === -1) throw new Error('BAD_STATUS');
  const sh = sheet_(SHEETS.NETSTAT);
  const data = sh.getDataRange().getValues();
  const idx = data.findIndex((r, i) => i > 0 && r[0] === building);
  const row = [building, status, source, clean_(note, 300), new Date(), by];
  if (idx > 0) sh.getRange(idx + 1, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
}

/**
 * Effective building status:
 *  1) monitoring/manual entry newer than STALE_HOURS → used as-is (source shown to users)
 *  2) otherwise an estimate from the last 24h of speed tests + open tickets (source = "estimate")
 */
function buildingStatus_() {
  const staleMs = (Number(prop_('STALE_HOURS')) || 6) * 3600000;
  const now = Date.now();
  const locs = readAll_(SHEETS.LOCS).filter(r => String(r.Active).toLowerCase() !== 'false' && r.Building);
  const stat = readAll_(SHEETS.NETSTAT);
  const tests = readAll_(SHEETS.TESTS).filter(r => r.Timestamp && now - new Date(r.Timestamp).getTime() < 86400000);
  const open = readAll_(SHEETS.TICKETS).filter(r => ['open', 'review', 'progress'].indexOf(r.Status) > -1);

  return locs.map(l => {
    const b = String(l.Building);
    const bt = tests.filter(t => t.Building === b).map(t => Number(t.DownloadMbps) || 0);
    const med = median_(bt);
    const openCount = open.filter(t => t.Building === b).length;
    const s = stat.find(r => r.Building === b);
    const fresh = s && s.UpdatedAt && (now - new Date(s.UpdatedAt).getTime() < staleMs);

    let status = 'unknown', source = 'estimate', note = '', updatedAt = '';
    if (fresh) {
      status = s.Status; source = s.Source; note = s.Note; updatedAt = iso_(s.UpdatedAt);
    } else {
      if (openCount >= 3 || (bt.length >= 3 && med < 5)) status = 'slow';
      else if (openCount >= 1 || (bt.length >= 3 && med < 15)) status = 'warn';
      else if (bt.length) status = 'ok';
      updatedAt = bt.length ? iso_(new Date()) : '';
    }
    return { building: b, college: String(l.College || ''), status: status, source: source, note: note,
             updatedAt: updatedAt, tests24h: bt.length, medianDown: Math.round(med * 10) / 10, openTickets: openCount };
  });
}

/* ---------------- Notifications (v1.7 branded e-mails) ---------------- */

const STATUS_STYLE = {
  open:     { bg: '#fdecec', fg: '#c62828' },
  review:   { bg: '#e6f3fa', fg: '#0a6eaa' },
  progress: { bg: '#fff4e0', fg: '#a35f00' },
  resolved: { bg: '#e7f6ee', fg: '#1a7a43' },
  closed:   { bg: '#f0eef4', fg: '#5f5872' }
};

function appUrl_() {
  return prop_('APP_URL') || ScriptApp.getService().getUrl() || '';
}
function ticketUrl_(id) {
  const u = appUrl_();
  return u ? u + (u.indexOf('?') > -1 ? '&' : '?') + 'ticket=' + encodeURIComponent(id) : '';
}
function fmtDate_(d) {
  return d ? Utilities.formatDate(new Date(d), 'Asia/Riyadh', 'yyyy/MM/dd — hh:mm a').replace('AM', 'ص').replace('PM', 'م') : '—';
}

function sendMail_(to, subject, html, preheader) {
  if (prop_('SEND_EMAILS') === 'false' || !to) return;
  try {
    MailApp.sendEmail({
      to: to, subject: subject, name: 'نبض الشبكة — SRU NetPulse',
      noReply: true, htmlBody: html, inlineImages: brandBlobs_(),
      body: preheader + '\n' + appUrl_()
    });
  } catch (e) {
    // noReply is only allowed for Google Workspace accounts — retry without it
    try { MailApp.sendEmail({ to: to, subject: subject, name: 'نبض الشبكة — SRU NetPulse', htmlBody: html, inlineImages: brandBlobs_(), body: preheader }); }
    catch (e2) { console.warn('mail failed', e2); }
  }
}

function notifyNewTicket_(id, user, d, desc) {
  const rows = [
    ['رقم البلاغ', '<b style="font-size:16px;color:#501e8c">' + esc_(id) + '</b>'],
    ['الحالة', badge_('open')],
    ['الموقع', esc_(d.building) + (d.spot ? ' — ' + esc_(d.spot) : '')],
    ['نوع المشكلة', esc_(d.issueType)],
    ['وقت البلاغ', fmtDate_(new Date())],
    ['الوصف', esc_(desc)]
  ];
  sendMail_(user.email, 'تم استلام بلاغك ' + id + ' — نبض الشبكة',
    mailShell_({
      preheader: 'تم استلام بلاغك ' + id + ' وتحويله إلى الفريق الفني.',
      title: 'تم استلام بلاغك',
      intro: 'مرحبًا ' + esc_(user.name) + '، شكرًا لك. تم استلام بلاغك وتحويله إلى الفريق الفني، وسنوافيك بأي تحديث على حالته.',
      steps: 'open', rows: rows,
      button: { text: 'متابعة البلاغ', url: ticketUrl_(id) },
      note: 'لتسريع المعالجة، يمكنك إجراء قياس للسرعة من المنصة وإرفاقه بالبلاغ.'
    }), 'تم استلام بلاغك ' + id);

  const noc = prop_('NOTIFY_EMAIL');
  if (noc) {
    const t = d.test ? num_(d.test.download) + ' ↓ / ' + num_(d.test.upload) + ' ↑ Mbps · ' + num_(d.test.ping) + ' ms' : 'لم يُرفق قياس';
    sendMail_(noc, '[NetPulse] بلاغ جديد ' + id + ' — ' + d.building + ' — ' + d.issueType,
      mailShell_({
        preheader: 'بلاغ جديد ' + id + ' في ' + d.building,
        title: 'بلاغ جديد يحتاج متابعة',
        intro: 'وصل بلاغ جديد إلى منصة نبض الشبكة. الأولوية المقترحة: <b>' + (suggestPriority_(d) === 'high' ? 'عالية' : 'متوسطة') + '</b>.',
        steps: 'open',
        rows: [
          ['رقم البلاغ', '<b style="font-size:16px;color:#501e8c">' + esc_(id) + '</b>'],
          ['المُبلِّغ', esc_(user.name) + '<br><span style="color:#6b5a80" dir="ltr">' + esc_(user.email) + '</span>'],
          ['الجوال', '<a href="tel:' + esc_(d.mobile) + '" style="color:#0a6eaa;text-decoration:none" dir="ltr">' + esc_(d.mobile) + '</a>'],
          ['الجهة', esc_(d.department || '—')],
          ['الموقع', esc_(d.building) + (d.spot ? ' — ' + esc_(d.spot) : '')],
          ['نوع المشكلة', esc_(d.issueType) + ' <span style="color:#6b5a80">(' + esc_(d.connection || '') + ')</span>'],
          ['آخر قياس', '<span dir="ltr">' + esc_(t) + '</span>'],
          ['الوصف', esc_(desc)]
        ],
        button: { text: 'فتح البلاغ في المنصة', url: ticketUrl_(id) }
      }), 'بلاغ جديد ' + id);
  }
}

function notifyReporter_(email, id, status, note) {
  if (status === 'resolved') return notifyResolved_(email, id, note);
  const done = status === 'closed';
  sendMail_(email, (done ? 'تم حل بلاغك ' : 'تحديث على بلاغك ') + id + ': ' + (STATUS_AR[status] || status),
    mailShell_({
      preheader: 'حالة بلاغك ' + id + ' الآن: ' + (STATUS_AR[status] || status),
      title: done ? 'تم حل بلاغك ✓' : 'تحديث على بلاغك',
      intro: done ? 'يسعدنا إبلاغك بأن الفريق الفني أنهى معالجة بلاغك. إن استمرت المشكلة يمكنك إرسال بلاغ جديد من المنصة.'
                  : 'قام الفريق الفني بتحديث حالة بلاغك.',
      steps: status,
      rows: [
        ['رقم البلاغ', '<b style="font-size:16px;color:#501e8c">' + esc_(id) + '</b>'],
        ['الحالة الحالية', badge_(status)],
        ['وقت التحديث', fmtDate_(new Date())]
      ].concat(note ? [['ملاحظة الفريق الفني', esc_(note)]] : []),
      button: { text: 'عرض تفاصيل البلاغ', url: ticketUrl_(id) }
    }), 'تحديث على بلاغك ' + id);
}

function notifyResolved_(email, id, note) {
  const days = Number(prop_('AUTOCLOSE_DAYS')) || 3;
  const yes = ticketUrl_(id) + '&fb=yes', no = ticketUrl_(id) + '&fb=no';
  const btn = (url, text, bg) => '<td align="center" style="padding:0 6px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" bgcolor="' + bg + '" style="border-radius:6px">' +
    '<a href="' + url + '" target="_blank" style="display:inline-block;min-width:170px;padding:13px 18px;font-family:Tahoma,Arial,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px">' + text + '</a></td></tr></table></td>';
  sendMail_(email, 'تم حل بلاغك ' + id + ' — هل حُلّت مشكلتك؟',
    mailShell_({
      preheader: 'أنهى الفريق الفني معالجة بلاغك ' + id + '. أخبرنا: هل حُلّت مشكلتك؟',
      title: 'تم حل بلاغك ✓',
      intro: 'أنهى الفريق الفني معالجة بلاغك. نرجو تأكيد النتيجة بضغطة واحدة — إجابتك تساعدنا على قياس جودة الخدمة وتحسينها.',
      steps: 'resolved',
      rows: [
        ['رقم البلاغ', '<b style="font-size:16px;color:#501e8c">' + esc_(id) + '</b>'],
        ['الحالة الحالية', badge_('resolved')],
        ['وقت الحل', fmtDate_(new Date())]
      ].concat(note ? [['الإجراء المتخذ', esc_(note)]] : []),
      extra: '<p style="margin:24px 0 10px;text-align:center;font-size:17px;font-weight:bold;color:#3a1464;font-family:Tahoma,Arial,sans-serif">هل حُلّت مشكلتك؟</p>' +
        '<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 8px"><tr>' +
        btn(yes, '✓ نعم، حُلّت', '#1a7a43') + btn(no, '✗ لا، ما زالت المشكلة', '#c62828') + '</tr></table>' +
        '<p style="margin:8px 0 0;text-align:center;font-size:12px;color:#6b5a80;font-family:Tahoma,Arial,sans-serif">عند اختيار «لا» يُعاد فتح البلاغ تلقائيًا بأولوية أعلى. وإن لم يصلنا رد خلال ' + days + ' أيام يُغلق البلاغ تلقائيًا.</p>'
    }), 'هل حُلّت مشكلتك؟ ' + id);
}

function notifyReopen_(id, user, building, issueType, note, assignee) {
  const noc = prop_('NOTIFY_EMAIL');
  if (!noc) return;
  sendMail_(noc, '[NetPulse] أُعيد فتح البلاغ ' + id + ' — المشكلة لم تُحل',
    mailShell_({
      preheader: 'أفاد المستخدم بأن المشكلة في البلاغ ' + id + ' لم تُحل',
      title: 'أُعيد فتح بلاغ',
      intro: 'أفاد المُبلِّغ بأن المشكلة <b>لم تُحل</b> بعد إغلاقها، فأُعيد فتح البلاغ تلقائيًا ورُفعت أولويته.',
      steps: 'open',
      rows: [
        ['رقم البلاغ', '<b style="font-size:16px;color:#501e8c">' + esc_(id) + '</b>'],
        ['المُبلِّغ', esc_(user.name) + '<br><span style="color:#6b5a80" dir="ltr">' + esc_(user.email) + '</span>'],
        ['الموقع', esc_(building)], ['نوع المشكلة', esc_(issueType)],
        ['المسؤول السابق', esc_(assignee || '—')],
        ['تعليق المستخدم', esc_(note || '—')]
      ],
      button: { text: 'فتح البلاغ في المنصة', url: ticketUrl_(id) }
    }), 'أُعيد فتح البلاغ ' + id);
}

function notifyReply_(email, id, status, note) {
  sendMail_(email, 'رد جديد على بلاغك ' + id + ' — نبض الشبكة',
    mailShell_({
      preheader: 'رد من الفريق الفني على بلاغك ' + id,
      title: 'رد من الفريق الفني',
      intro: 'أضاف الفريق الفني ردًا على بلاغك:',
      steps: status,
      rows: [
        ['رقم البلاغ', '<b style="font-size:16px;color:#501e8c">' + esc_(id) + '</b>'],
        ['الحالة الحالية', badge_(status)],
        ['الرد', '<span style="color:#241436">' + esc_(note) + '</span>'],
        ['وقت الرد', fmtDate_(new Date())]
      ],
      button: { text: 'عرض البلاغ', url: ticketUrl_(id) }
    }), 'رد جديد على بلاغك ' + id);
}

/* ---------------- Weekly KPI report (every Sunday 07:00, Asia/Riyadh) ---------------- */

function weekStats_(from, to, tickets, feedback, tests, log) {
  const inR = d => d && new Date(d) >= from && new Date(d) < to;
  const created = tickets.filter(t => inR(t.CreatedAt));
  const resolved = tickets.filter(t => inR(t.ResolvedAt));
  const fb = feedback.filter(f => inR(f.Timestamp));
  const yes = fb.filter(f => f.Answer === 'yes').length, no = fb.filter(f => f.Answer === 'no').length;
  const autoClosed = log.filter(l => l.Action === 'auto-closed' && inR(l.Timestamp)).length;
  const reopenedIds = {}; log.filter(l => l.Action === 'reopened' && inR(l.Timestamp)).forEach(l => reopenedIds[l.TicketId] = 1);
  const fr = created.filter(t => t.FirstResponseAt).map(t => (new Date(t.FirstResponseAt) - new Date(t.CreatedAt)) / 60000);
  const rs = resolved.map(t => (new Date(t.ResolvedAt) - new Date(t.CreatedAt)) / 3600000);
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const count = (arr, k) => { const m = {}; arr.forEach(t => { const v = t[k] || '—'; m[v] = (m[v] || 0) + 1; }); return Object.keys(m).map(x => [x, m[x]]).sort((a, b) => b[1] - a[1]); };
  const wt = tests.filter(t => inR(t.Timestamp)).map(t => Number(t.DownloadMbps) || 0);
  const answered = yes + no, asked = answered + autoClosed;
  return {
    created: created.length, resolved: resolved.length,
    openAtEnd: tickets.filter(t => new Date(t.CreatedAt) < to && ['open', 'review', 'progress'].indexOf(t.Status) > -1).length,
    sat: answered ? Math.round(yes * 100 / answered) : null, answers: answered,
    respRate: asked ? Math.round(answered * 100 / asked) : null,
    firstResp: avg(fr), resolveH: avg(rs),
    reopened: Object.keys(reopenedIds).length,
    reopenPct: resolved.length ? Math.round(Object.keys(reopenedIds).length * 100 / resolved.length) : null,
    autoClosed: autoClosed,
    byBuilding: count(created, 'Building'), byIssue: count(created, 'IssueType'),
    reopenList: tickets.filter(t => reopenedIds[t.TicketId]),
    tests: wt.length, medianDown: wt.length ? Math.round(median_(wt) * 10) / 10 : null
  };
}

function sendWeeklyReport() {
  const tz = 'Asia/Riyadh';
  const end = new Date(Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'00:00:00") + '+03:00');   // today 00:00 Riyadh
  const start = new Date(end.getTime() - 7 * 86400000), prevStart = new Date(start.getTime() - 7 * 86400000);
  const T = readAll_(SHEETS.TICKETS), F = readAll_(SHEETS.FEEDBACK), S = readAll_(SHEETS.TESTS), L = readAll_(SHEETS.LOG);
  const w = weekStats_(start, end, T, F, S, L), p = weekStats_(prevStart, start, T, F, S, L);
  const tg = { sat: Number(prop_('TARGET_SAT')) || 85, resp: Number(prop_('TARGET_RESPONSE_MIN')) || 60,
               res: Number(prop_('TARGET_RESOLVE_HOURS')) || 24, reo: Number(prop_('TARGET_REOPEN_PCT')) || 10 };
  const d = x => Utilities.formatDate(x, tz, 'yyyy/MM/dd');
  const period = d(start) + ' — ' + d(new Date(end.getTime() - 1));
  const fmtMin = m => m === null ? '—' : (m < 60 ? Math.round(m) + ' دقيقة' : (m / 60).toFixed(1) + ' ساعة');
  const fmtH = h => h === null ? '—' : (h < 48 ? h.toFixed(1) + ' ساعة' : (h / 24).toFixed(1) + ' يوم');
  const pct = v => v === null ? '—' : v + '%';
  const delta = (a, b, goodUp, unit) => {
    if (a === null || b === null || a === b) return '<span style="color:#9a90aa">● ثابت</span>';
    const up = a > b, good = goodUp ? up : !up;
    return '<span style="color:' + (good ? '#1a7a43' : '#c62828') + '">' + (up ? '▲' : '▼') + ' ' + Math.abs(Math.round((a - b) * 10) / 10) + (unit || '') + '</span>';
  };
  const status = (ok) => ok === null ? '<span style="color:#9a90aa">لا بيانات</span>' :
    ok ? '<span style="background:#e7f6ee;color:#1a7a43;padding:2px 10px;border-radius:10px;font-weight:bold">محقق</span>'
       : '<span style="background:#fdecec;color:#c62828;padding:2px 10px;border-radius:10px;font-weight:bold">غير محقق</span>';
  const cell = 'padding:9px 10px;border-bottom:1px solid #eee8f5;font-size:13px;font-family:Tahoma,Arial,sans-serif';
  const th = 'padding:9px 10px;background:#f0ebf8;color:#501e8c;font-size:12px;font-weight:bold;font-family:Tahoma,Arial,sans-serif;text-align:right';
  const kpiRows = [
    ['نسبة رضا المستفيدين', pct(w.sat), tg.sat + '% فأكثر', delta(w.sat, p.sat, true, '%'), status(w.sat === null ? null : w.sat >= tg.sat)],
    ['متوسط زمن الاستجابة الأولى', fmtMin(w.firstResp), tg.resp + ' دقيقة أو أقل', delta(w.firstResp && Math.round(w.firstResp), p.firstResp && Math.round(p.firstResp), false, ' د'), status(w.firstResp === null ? null : w.firstResp <= tg.resp)],
    ['متوسط زمن الحل', fmtH(w.resolveH), tg.res + ' ساعة أو أقل', delta(w.resolveH && Math.round(w.resolveH * 10) / 10, p.resolveH && Math.round(p.resolveH * 10) / 10, false, ' س'), status(w.resolveH === null ? null : w.resolveH <= tg.res)],
    ['نسبة البلاغات المُعاد فتحها', pct(w.reopenPct), tg.reo + '% أو أقل', delta(w.reopenPct, p.reopenPct, false, '%'), status(w.reopenPct === null ? null : w.reopenPct <= tg.reo)],
    ['معدل الاستجابة لاستبيان الحل', pct(w.respRate), '—', delta(w.respRate, p.respRate, true, '%'), '—']
  ];
  const kpiTable = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee8f5;border-collapse:collapse;margin-top:6px">' +
    '<tr><th style="' + th + '">المؤشر</th><th style="' + th + '">القيمة</th><th style="' + th + '">المستهدف</th><th style="' + th + '">مقارنة بالأسبوع السابق</th><th style="' + th + '">الحالة</th></tr>' +
    kpiRows.map(r => '<tr>' + r.map((v, i) => '<td style="' + cell + (i === 1 ? ';font-weight:bold;color:#3a1464' : '') + '">' + v + '</td>').join('') + '</tr>').join('') + '</table>';
  const tile = (label, val, sub) => '<td width="25%" align="center" style="padding:12px 4px;background:#faf8fd;border:1px solid #eee8f5;font-family:Tahoma,Arial,sans-serif">' +
    '<div style="font-size:24px;font-weight:bold;color:#3a1464">' + val + '</div><div style="font-size:12px;color:#6b5a80">' + label + '</div>' +
    (sub ? '<div style="font-size:11px;margin-top:2px">' + sub + '</div>' : '') + '</td>';
  const tiles = '<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin:10px 0"><tr>' +
    tile('بلاغات جديدة', w.created, delta(w.created, p.created, false)) + tile('بلاغات محلولة', w.resolved, delta(w.resolved, p.resolved, true)) +
    tile('مفتوحة بنهاية الأسبوع', w.openAtEnd, '') + tile('أُغلقت تلقائيًا', w.autoClosed, '') + '</tr></table>';
  const maxB = w.byBuilding.length ? w.byBuilding[0][1] : 1;
  const bTable = w.byBuilding.length ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + w.byBuilding.slice(0, 6).map(r =>
    '<tr><td width="38%" style="' + cell + '">' + esc_(r[0]) + '</td><td style="' + cell + '"><div style="background:#501e8c;height:12px;border-radius:6px;width:' + Math.max(6, Math.round(r[1] * 100 / maxB)) + '%"></div></td>' +
    '<td width="70" style="' + cell + ';font-weight:bold">' + r[1] + ' <span style="color:#9a90aa;font-weight:normal">(' + Math.round(r[1] * 100 / (w.created || 1)) + '%)</span></td></tr>').join('') + '</table>'
    : '<p style="color:#9a90aa;font-size:13px">لا توجد بلاغات هذا الأسبوع.</p>';
  const iTable = w.byIssue.length ? '<p style="margin:6px 0 0;font-size:13px;line-height:2;font-family:Tahoma,Arial,sans-serif">' +
    w.byIssue.slice(0, 6).map(r => '<span style="display:inline-block;background:#e6f3fa;color:#0a5a8a;border-radius:12px;padding:2px 10px;margin:2px">' + esc_(r[0]) + ' · <b>' + r[1] + '</b></span>').join(' ') + '</p>' : '';
  const rTable = w.reopenList.length ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee8f5;border-collapse:collapse">' +
    '<tr><th style="' + th + '">رقم البلاغ</th><th style="' + th + '">المبنى</th><th style="' + th + '">نوع المشكلة</th><th style="' + th + '">مرات إعادة الفتح</th></tr>' +
    w.reopenList.map(t => '<tr><td style="' + cell + '"><a href="' + ticketUrl_(t.TicketId) + '" style="color:#0a6eaa">' + esc_(t.TicketId) + '</a></td><td style="' + cell + '">' + esc_(t.Building) + '</td><td style="' + cell + '">' + esc_(t.IssueType) + '</td><td style="' + cell + '">' + (Number(t.ReopenCount) || 1) + '</td></tr>').join('') + '</table>'
    : '<p style="color:#1a7a43;font-size:13px">لا توجد بلاغات أُعيد فتحها هذا الأسبوع ✓</p>';
  const h = (t) => '<h2 style="margin:22px 0 6px;font-size:16px;color:#3a1464;font-family:Tahoma,Arial,sans-serif;border-right:4px solid #1ba3d6;padding-right:8px">' + t + '</h2>';
  const html = mailShell_({
    preheader: 'التقرير الأسبوعي لنبض الشبكة ' + period + ' — الرضا ' + pct(w.sat) + ' · بلاغات ' + w.created,
    title: 'التقرير الأسبوعي لجودة الإنترنت',
    intro: 'ملخص أداء خدمة الإنترنت ومعالجة البلاغات للفترة <b dir="ltr">' + period + '</b>، مع مؤشرات الأداء مقابل المستهدفات لاستخدامها دليلًا في الخطة التشغيلية.',
    extra: tiles + h('مؤشرات الأداء الرئيسية (KPIs)') + kpiTable +
      h('أكثر المباني بلاغات') + bTable + iTable +
      h('البلاغات المُعاد فتحها') + rTable +
      h('جودة الاتصال من قياسات المستخدمين') +
      '<p style="font-size:13px;color:#3d2f52;font-family:Tahoma,Arial,sans-serif;line-height:1.9">عدد القياسات: <b>' + w.tests + '</b> · وسيط سرعة التحميل: <b dir="ltr">' + (w.medianDown === null ? '—' : w.medianDown + ' Mbps') + '</b> (الأسبوع السابق: <span dir="ltr">' + (p.medianDown === null ? '—' : p.medianDown + ' Mbps') + '</span>)</p>' +
      '<p style="margin-top:14px;font-size:12px;color:#6b5a80;font-family:Tahoma,Arial,sans-serif">📎 مرفق: سجل بلاغات الأسبوع (CSV). تُحفظ مؤشرات كل أسبوع تلقائيًا في تبويب <b>WeeklyKPIs</b> كسجل تراكمي للأدلة.</p>',
    button: { text: 'فتح لوحة الفريق الفني', url: appUrl_() ? appUrl_() + '#team' : '' }, extraFirst: true
  });
  // CSV attachment of the week's tickets
  const cols = ['TicketId', 'CreatedAt', 'Name', 'Email', 'Mobile', 'Department', 'Building', 'IssueType', 'Status', 'Priority', 'Assignee', 'FirstResponseAt', 'ResolvedAt', 'Feedback', 'ReopenCount', 'Description', 'Resolution'];
  const wk = T.filter(t => t.CreatedAt && new Date(t.CreatedAt) >= start && new Date(t.CreatedAt) < end);
  const csv = '﻿' + cols.join(',') + '\n' + wk.map(t => cols.map(c => '"' + String(t[c] instanceof Date ? Utilities.formatDate(t[c], tz, 'yyyy-MM-dd HH:mm') : (t[c] === undefined ? '' : t[c])).replace(/^'/, '').replace(/"/g, '""') + '"').join(',')).join('\n');
  const att = Utilities.newBlob(csv, 'text/csv', 'NetPulse-tickets-' + Utilities.formatDate(start, tz, 'yyyy-MM-dd') + '.csv');
  const to = prop_('REPORT_EMAILS') || 'm.elmahdy@sr.edu.sa';
  MailApp.sendEmail({ to: to, subject: '📊 التقرير الأسبوعي — نبض الشبكة (' + period + ')', name: 'نبض الشبكة — SRU NetPulse',
    htmlBody: html, inlineImages: brandBlobs_(), attachments: [att], body: 'التقرير الأسبوعي لنبض الشبكة ' + period });
  appendRow_(SHEETS.WEEKLY, { WeekStart: start, WeekEnd: new Date(end.getTime() - 1), NewTickets: w.created, Resolved: w.resolved, OpenAtEnd: w.openAtEnd,
    SatisfactionPct: w.sat === null ? '' : w.sat, ResponseRatePct: w.respRate === null ? '' : w.respRate, Answers: w.answers,
    AvgFirstResponseMin: w.firstResp === null ? '' : Math.round(w.firstResp), AvgResolveHours: w.resolveH === null ? '' : Math.round(w.resolveH * 10) / 10,
    Reopened: w.reopened, ReopenPct: w.reopenPct === null ? '' : w.reopenPct, AutoClosed: w.autoClosed,
    TopBuilding: w.byBuilding.length ? w.byBuilding[0][0] : '', TopIssue: w.byIssue.length ? w.byIssue[0][0] : '',
    SpeedTests: w.tests, MedianDownMbps: w.medianDown === null ? '' : w.medianDown, SentTo: to, SentAt: new Date() });
  return to;
}

function badge_(st) {
  const c = STATUS_STYLE[st] || STATUS_STYLE.closed;
  return '<span style="display:inline-block;background:' + c.bg + ';color:' + c.fg + ';font-weight:bold;font-size:13px;padding:3px 12px;border-radius:12px">' + (STATUS_AR[st] || st) + '</span>';
}

/** Progress tracker: مفتوح → قيد المراجعة → قيد المعالجة → تم الحل */
function steps_(st) {
  const order = ['open', 'review', 'progress', 'resolved'];
  const idx = st === 'closed' ? 3 : Math.max(0, order.indexOf(st));
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 6px"><tr>' +
    order.map((k, i) => {
      const on = i <= idx;
      return '<td width="25%" align="center" style="padding:0 3px;font-family:Tahoma,Arial,sans-serif">' +
        '<div style="height:6px;border-radius:3px;background:' + (on ? '#501e8c' : '#e4dcef') + '"></div>' +
        '<div style="font-size:12px;padding-top:6px;color:' + (on ? '#501e8c' : '#9a90aa') + ';font-weight:' + (i === idx ? 'bold' : 'normal') + '">' + STATUS_AR[k] + '</div></td>';
    }).join('') + '</tr></table>';
}

function mailShell_(o) {
  const rows = (o.rows || []).map((r, i) =>
    '<tr><td width="120" valign="top" style="padding:10px 14px;background:' + (i % 2 ? '#ffffff' : '#faf8fd') + ';color:#6b5a80;font-size:13px;font-family:Tahoma,Arial,sans-serif;border-bottom:1px solid #eee8f5">' + r[0] + '</td>' +
    '<td valign="top" style="padding:10px 14px;background:' + (i % 2 ? '#ffffff' : '#faf8fd') + ';color:#241436;font-size:14px;line-height:1.7;font-family:Tahoma,Arial,sans-serif;border-bottom:1px solid #eee8f5">' + r[1] + '</td></tr>').join('');
  const btn = o.button && o.button.url ?
    '<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:24px auto 8px"><tr><td align="center" bgcolor="#501e8c" style="border-radius:6px">' +
    '<a href="' + o.button.url + '" target="_blank" style="display:inline-block;padding:13px 36px;font-family:Tahoma,Arial,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px">' + o.button.text + ' ←</a></td></tr></table>' +
    '<div style="text-align:center;font-size:11px;color:#9a90aa;font-family:Tahoma,Arial,sans-serif">أو انسخ الرابط: <a href="' + o.button.url + '" style="color:#0a6eaa;word-break:break-all" dir="ltr">' + o.button.url + '</a></div>' : '';
  return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background:#f3eff9" dir="rtl">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0">' + esc_(o.preheader || '') + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f3eff9"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e4dcef" dir="rtl">' +
    // header
    '<tr><td bgcolor="#3a1464" style="background:#3a1464;padding:22px 26px" align="right">' +
      '<img src="cid:nplogo" width="210" alt="نبض الشبكة — SRU NetPulse" style="display:block;border:0;width:210px;height:auto"></td></tr>' +
    '<tr><td style="height:4px;background:#1ba3d6;font-size:0;line-height:0">&nbsp;</td></tr>' +
    // body
    '<tr><td style="padding:26px 28px 8px;font-family:Tahoma,Arial,sans-serif" align="right">' +
      '<h1 style="margin:0 0 10px;font-size:21px;color:#3a1464;font-family:Tahoma,Arial,sans-serif">' + o.title + '</h1>' +
      '<p style="margin:0;font-size:14px;line-height:1.9;color:#3d2f52">' + o.intro + '</p>' +
      (o.steps ? steps_(o.steps) : '') +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border:1px solid #eee8f5;border-radius:8px;overflow:hidden">' + rows + '</table>' +
      (o.extraFirst ? (o.extra || '') + btn : btn + (o.extra || '')) +
      (o.note ? '<p style="margin:18px 0 0;padding:10px 14px;background:#e6f3fa;border-radius:6px;font-size:13px;color:#0a5a8a;line-height:1.8">💡 ' + o.note + '</p>' : '') +
    '</td></tr>' +
    // footer
    '<tr><td style="padding:22px 28px 24px;font-family:Tahoma,Arial,sans-serif;border-top:1px solid #eee8f5" align="right">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
      '<td align="right" style="font-size:12px;color:#6b5a80;line-height:1.8;font-family:Tahoma,Arial,sans-serif">' +
        '<b style="color:#3a1464">جامعة سليمان الراجحي</b><br>الإدارة التنفيذية للاتصالات وتقنية المعلومات<br>مركز عمليات تقنية المعلومات (ITOC)</td>' +
      '<td align="left" valign="middle" width="110"><a href="https://ictsru.github.io/ITOC/#forms" target="_blank"><img src="cid:itoclogo" width="100" alt="ITOC" style="display:block;border:0;width:100px;height:auto"></a></td>' +
      '</tr></table>' +
      '<p style="margin:14px 0 0;font-size:11px;color:#9a90aa;font-family:Tahoma,Arial,sans-serif">هذه رسالة آلية من منصة نبض الشبكة — يرجى عدم الرد عليها. الإصدار ' + APP.VERSION + '</p>' +
    '</td></tr></table></td></tr></table></body></html>';
}

/* ---------------- Setup ---------------- */

function setup() {
  Object.keys(SHEETS).forEach(k => sheet_(SHEETS[k]));
  const locs = sheet_(SHEETS.LOCS);
  if (locs.getLastRow() < 2) {
    // Seed buildings — EDIT this tab to match SRU's real buildings/zones.
    const seed = [
      ['مبنى كلية الطب', 'كلية الطب', true, 1],
      ['مبنى كلية التمريض', 'كلية التمريض', true, 2],
      ['مبنى كلية العلوم التطبيقية', 'كلية العلوم التطبيقية', true, 3],
      ['مبنى كلية الأعمال', 'كلية الأعمال', true, 4],
      ['المبنى الإداري', '', true, 5],
      ['المكتبة', '', true, 6],
      ['شطر الطالبات', 'شطر الطالبات', true, 7],
      ['السكن الجامعي', '', true, 8]
    ];
    locs.getRange(2, 1, seed.length, 4).setValues(seed);
  }
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('TICKET_SEQ')) p.setProperty('TICKET_SEQ', '1000');
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'autoCloseResolved')) {
    ScriptApp.newTrigger('autoCloseResolved').timeBased().everyDays(1).atHour(6).create();
  }
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'sendWeeklyReport')) {
    ScriptApp.newTrigger('sendWeeklyReport').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(7).create();
  }
  ss_().toast('SRU NetPulse: setup complete (v' + APP.VERSION + ')');
}

/* ---------------- Helpers ---------------- */

function ss_() {
  const id = prop_('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
}

function sheet_(def) {
  const ss = ss_();
  let sh = ss.getSheetByName(def.name);
  if (!sh) {
    sh = ss.insertSheet(def.name);
    sh.getRange(1, 1, 1, def.headers.length).setValues([def.headers])
      .setFontWeight('bold').setBackground('#501e8c').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.setRightToLeft(true);
  } else {
    // Schema migration: append any header the current version expects but the sheet lacks.
    const have = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(String);
    const missing = def.headers.filter(h => have.indexOf(h) === -1);
    if (missing.length) {
      sh.getRange(1, have.filter(Boolean).length + 1, 1, missing.length).setValues([missing])
        .setFontWeight('bold').setBackground('#501e8c').setFontColor('#ffffff');
    }
  }
  return sh;
}

function readAll_(def) {
  const sh = sheet_(def);
  const v = sh.getDataRange().getValues();
  if (v.length < 2) return [];
  const H = v[0];
  return v.slice(1).map(r => { const o = {}; H.forEach((h, i) => o[h] = r[i]); return o; });
}

function appendRow_(def, obj) {
  const sh = sheet_(def);
  const H = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.appendRow(H.map(h => obj[h] === undefined ? '' : obj[h]));
}

function publicTicket_(r) {
  return {
    id: r.TicketId, createdAt: iso_(r.CreatedAt), email: r.Email, name: r.Name, department: r.Department,
    building: r.Building, spot: r.Spot, issueType: r.IssueType, connection: r.Connection,
    occurredAt: iso_(r.OccurredAt), description: r.Description, status: r.Status, priority: r.Priority,
    assignee: r.Assignee, firstResponseAt: iso_(r.FirstResponseAt), resolvedAt: iso_(r.ResolvedAt),
    updatedAt: iso_(r.UpdatedAt), resolution: r.Resolution,
    mobile: String(r.Mobile || '').replace(/^'/, ''),
    feedback: r.Feedback || '', feedbackAt: iso_(r.FeedbackAt), reopenCount: Number(r.ReopenCount) || 0,
    test: r.DownloadMbps !== '' ? { download: Number(r.DownloadMbps), upload: Number(r.UploadMbps), ping: Number(r.PingMs) } : null
  };
}

/** Strip control chars, cap length, neutralise spreadsheet formula injection. */
function clean_(v, max) {
  let s = String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max || 200);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}
function num_(v) { const n = Number(v); return isFinite(n) ? Math.round(n * 100) / 100 : ''; }
function iso_(d) { return d instanceof Date ? d.toISOString() : (d ? String(d) : ''); }
function median_(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function esc_(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
