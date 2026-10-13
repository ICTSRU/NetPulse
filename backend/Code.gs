/**
 * ============================================================
 *  نبض الشبكة — SRU NetPulse (منصة جودة الإنترنت)
 *  Backend: Google Apps Script + Google Sheets
 *  Version: 1.2  (2026-10-13)
 *  Owner:   ICTD — IT Operations Center (ITOC)
 * ============================================================
 *  Script Properties (Project Settings → Script properties):
 *    CLIENT_ID       (required) Google OAuth Web Client ID used by the frontend
 *    ALLOWED_DOMAIN  (optional) default: sr.edu.sa
 *    ADMIN_EMAILS    (optional) comma-separated bootstrap admins
 *    NOTIFY_EMAIL    (optional) NOC/helpdesk mailbox notified on every new ticket
 *    MONITOR_KEY     (optional) shared secret for the monitoring push endpoint
 *    STALE_HOURS     (optional) hours before a monitoring status is considered stale (default 6)
 *    SEND_EMAILS     (optional) "false" to disable all e-mails (default true)
 *
 *  First run: select function `setup` → Run (creates all tabs + seed data).
 * ============================================================
 */

const APP = { NAME: 'SRU NetPulse', VERSION: '1.2' };

const SHEETS = {
  SIGNIN:   { name: 'SignInLog',     headers: ['Timestamp', 'Email', 'Name', 'Date', 'Time', 'Role', 'Client'] },
  USERS:    { name: 'Users',         headers: ['Email', 'Name', 'Role', 'Active', 'Notes'] },
  LOCS:     { name: 'Locations',     headers: ['Building', 'College', 'Active', 'SortOrder'] },
  NETSTAT:  { name: 'NetworkStatus', headers: ['Building', 'Status', 'Source', 'Note', 'UpdatedAt', 'UpdatedBy'] },
  TESTS:    { name: 'SpeedTests',    headers: ['Timestamp', 'Email', 'Building', 'DownloadMbps', 'UploadMbps', 'PingMs', 'JitterMs', 'Connection', 'Server', 'Client'] },
  TICKETS:  { name: 'Tickets',       headers: ['TicketId', 'CreatedAt', 'Email', 'Name', 'Department', 'Building', 'Spot', 'IssueType', 'Connection', 'OccurredAt', 'Description', 'Status', 'Priority', 'Assignee', 'FirstResponseAt', 'ResolvedAt', 'UpdatedAt', 'Resolution', 'DownloadMbps', 'UploadMbps', 'PingMs'] },
  LOG:      { name: 'TicketLog',     headers: ['Timestamp', 'TicketId', 'Action', 'Status', 'Note', 'By'] }
};

const TICKET_STATUS = ['open', 'review', 'progress', 'resolved', 'closed'];
const NET_STATUS    = ['ok', 'warn', 'slow', 'down', 'maintenance', 'unknown'];
const PRIORITIES    = ['low', 'medium', 'high', 'critical'];
const ROLES         = ['user', 'tech', 'admin'];

const STATUS_AR = { open: 'مفتوح', review: 'قيد المراجعة', progress: 'قيد المعالجة', resolved: 'تم الحل', closed: 'مغلق' };

/* ---------------- Entry points ---------------- */

function doGet() {
  return json_({ ok: true, app: APP.NAME, version: APP.VERSION, time: new Date().toISOString() });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = String(body.action || '');

    // Machine-to-machine endpoint for monitoring tools (n8n / Zabbix / PRTG / Meraki webhooks)
    if (action === 'pushStatus') return json_(pushStatus_(body));

    const user = authenticate_(body.idToken);
    switch (action) {
      case 'login':          return json_(login_(user, body));
      case 'getStatus':      return json_({ ok: true, buildings: buildingStatus_() });
      case 'saveSpeedTest':  return json_(saveSpeedTest_(user, body.data || {}));
      case 'createTicket':   return json_(createTicket_(user, body.data || {}));
      case 'myTickets':      return json_({ ok: true, tickets: myTickets_(user) });
      case 'getTicket':      return json_(getTicket_(user, body.ticketId));
      case 'teamData':       requireRole_(user, ['tech', 'admin']); return json_(teamData_());
      case 'updateTicket':   requireRole_(user, ['tech', 'admin']); return json_(updateTicket_(user, body.data || {}));
      case 'setBuildingStatus': requireRole_(user, ['tech', 'admin']); return json_(setBuildingStatus_(user, body.data || {}));
      default: return json_({ ok: false, error: 'UNKNOWN_ACTION' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
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
  const domain = (prop_('ALLOWED_DOMAIN') || 'sr.edu.sa').toLowerCase();
  const email = String(info.email || '').toLowerCase();

  if (!clientId || info.aud !== clientId) throw new Error('AUTH_AUDIENCE');
  if (String(info.email_verified) !== 'true') throw new Error('AUTH_UNVERIFIED');
  if (!email.endsWith('@' + domain) || String(info.hd || '').toLowerCase() !== domain) throw new Error('AUTH_DOMAIN');

  const user = { email: email, name: info.name || email, picture: info.picture || '', role: roleOf_(email) };
  const ttl = Math.max(60, Math.min(600, Number(info.exp) - Math.floor(Date.now() / 1000)));
  cache.put(key, JSON.stringify(user), ttl);
  return user;
}

function roleOf_(email) {
  const admins = (prop_('ADMIN_EMAILS') || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (admins.indexOf(email) > -1) return 'admin';
  const u = readAll_(SHEETS.USERS).find(r => String(r.Email).toLowerCase() === email);
  if (u && String(u.Active).toLowerCase() !== 'false' && ROLES.indexOf(String(u.Role)) > -1) return String(u.Role);
  return 'user';
}

function requireRole_(user, roles) {
  if (roles.indexOf(user.role) === -1) throw new Error('FORBIDDEN');
}

/* ---------------- Actions ---------------- */

function login_(user, body) {
  const now = new Date();
  const tz = Session.getScriptTimeZone();
  appendRow_(SHEETS.SIGNIN, {
    Timestamp: now, Email: user.email, Name: user.name,
    Date: Utilities.formatDate(now, tz, 'yyyy-MM-dd'),
    Time: Utilities.formatDate(now, tz, 'HH:mm:ss'),
    Role: user.role, Client: clean_(body.client, 200)
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
      PingMs: d.test ? num_(d.test.ping) : ''
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

/* ---------------- Notifications ---------------- */

function notifyNewTicket_(id, user, d, desc) {
  if (prop_('SEND_EMAILS') === 'false') return;
  try {
    MailApp.sendEmail({
      to: user.email,
      subject: 'تم استلام بلاغك ' + id + ' — نبض الشبكة',
      htmlBody: mailShell_('تم استلام بلاغك',
        '<p>شكرًا لك، تم استلام بلاغك وتحويله إلى الفريق الفني.</p>' +
        '<p><b>رقم البلاغ:</b> ' + id + '<br><b>الموقع:</b> ' + esc_(d.building) + '<br><b>نوع المشكلة:</b> ' + esc_(d.issueType) + '</p>' +
        '<p>يمكنك متابعة حالة البلاغ من صفحة «متابعة البلاغات» في المنصة.</p>')
    });
    const noc = prop_('NOTIFY_EMAIL');
    if (noc) MailApp.sendEmail({
      to: noc,
      subject: '[NetPulse] بلاغ جديد ' + id + ' — ' + d.building + ' — ' + d.issueType,
      htmlBody: mailShell_('بلاغ جديد ' + id,
        '<p><b>المُبلِّغ:</b> ' + esc_(user.name) + ' (' + esc_(user.email) + ')<br><b>الموقع:</b> ' + esc_(d.building) + ' — ' + esc_(d.spot || '') +
        '<br><b>نوع المشكلة:</b> ' + esc_(d.issueType) + '<br><b>الوصف:</b> ' + esc_(desc) +
        (d.test ? '<br><b>آخر قياس:</b> ' + num_(d.test.download) + ' / ' + num_(d.test.upload) + ' Mbps — ' + num_(d.test.ping) + ' ms' : '') + '</p>')
    });
  } catch (e) { console.warn('mail failed', e); }
}

function notifyReporter_(email, id, status, note) {
  if (prop_('SEND_EMAILS') === 'false' || !email) return;
  try {
    MailApp.sendEmail({
      to: email,
      subject: 'تحديث على بلاغك ' + id + ': ' + (STATUS_AR[status] || status),
      htmlBody: mailShell_('تحديث على بلاغك ' + id,
        '<p>تم تحديث حالة بلاغك إلى: <b>' + (STATUS_AR[status] || status) + '</b></p>' +
        (note ? '<p><b>ملاحظة الفريق الفني:</b> ' + esc_(note) + '</p>' : ''))
    });
  } catch (e) { console.warn('mail failed', e); }
}

function mailShell_(title, inner) {
  return '<div dir="rtl" style="font-family:Tahoma,Arial;color:#241436;max-width:560px">' +
    '<div style="background:#501e8c;color:#fff;padding:14px 18px;font-weight:bold">نبض الشبكة — SRU NetPulse</div>' +
    '<div style="padding:18px;border:1px solid #e5dcf3;border-top:0"><h3 style="margin-top:0">' + esc_(title) + '</h3>' + inner +
    '<p style="color:#6b5a80;font-size:12px;margin-top:24px">الإدارة التنفيذية للاتصالات وتقنية المعلومات — مركز عمليات تقنية المعلومات (ITOC)</p></div></div>';
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
  SpreadsheetApp.getActive().toast('SRU NetPulse: setup complete (v' + APP.VERSION + ')');
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
