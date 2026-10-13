/**
 * ============================================================
 *  نبض الشبكة — SRU NetPulse (منصة جودة الإنترنت)
 *  Backend: Google Apps Script + Google Sheets
 *  Version: 1.7  (2026-10-13)
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
 *    SEND_EMAILS     (optional) "false" to disable all e-mails (default true)
 *    APP_URL         (optional) link used in e-mails; default = this Web App's /exec URL
 *
 *  First run: select function `setup` → Run (creates all tabs + seed data).
 * ============================================================
 */

const APP = { NAME: 'SRU NetPulse', VERSION: '1.7' };

const SHEETS = {
  SIGNIN:   { name: 'SignInLog',     headers: ['Timestamp', 'Email', 'Name', 'Date', 'Time', 'Role', 'Client', 'Mobile'] },
  USERS:    { name: 'Users',         headers: ['Email', 'Name', 'Role', 'Active', 'Notes', 'Mobile'] },
  LOCS:     { name: 'Locations',     headers: ['Building', 'College', 'Active', 'SortOrder'] },
  NETSTAT:  { name: 'NetworkStatus', headers: ['Building', 'Status', 'Source', 'Note', 'UpdatedAt', 'UpdatedBy'] },
  TESTS:    { name: 'SpeedTests',    headers: ['Timestamp', 'Email', 'Building', 'DownloadMbps', 'UploadMbps', 'PingMs', 'JitterMs', 'Connection', 'Server', 'Client'] },
  TICKETS:  { name: 'Tickets',       headers: ['TicketId', 'CreatedAt', 'Email', 'Name', 'Department', 'Building', 'Spot', 'IssueType', 'Connection', 'OccurredAt', 'Description', 'Status', 'Priority', 'Assignee', 'FirstResponseAt', 'ResolvedAt', 'UpdatedAt', 'Resolution', 'DownloadMbps', 'UploadMbps', 'PingMs', 'Mobile'] },
  LOG:      { name: 'TicketLog',     headers: ['Timestamp', 'TicketId', 'Action', 'Status', 'Note', 'By'] }
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
  return { ok: true, tickets: tickets, tests: tests, buildings: buildingStatus_() };
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
  row[c('UpdatedAt')] = now;
  sh.getRange(rowIdx + 1, 1, 1, row.length).setValues([row]);

  const note = clean_(d.note, 500);
  appendRow_(SHEETS.LOG, { Timestamp: now, TicketId: d.ticketId, Action: 'updated', Status: row[c('Status')], Note: note, By: user.email });

  if (d.status && d.status !== prevStatus) {
    notifyReporter_(row[c('Email')], d.ticketId, row[c('Status')], note || row[c('Resolution')]);
  }
  return { ok: true };
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
  const done = status === 'resolved' || status === 'closed';
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
      btn +
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
