/**
 * Thống kê EA — Apps Script (dán vào Extensions > Apps Script của 1 Google Sheet MỚI).
 * Script Properties (Project Settings > Script properties):
 *   WRITE_KEY = mã ghi, điền giống ô InpKey của EA StatsSync
 *   VIEW_PASS = mật khẩu xem trang thống kê
 * Deploy > New deployment > Web app: Execute as = Me, Who has access = Anyone.
 */
var COLS = ['ticket','time','type','entry','magic','position','symbol','volume','price','profit','swap','commission','fee','reason'];

function doPost(e) {
  var b;
  try { b = JSON.parse(e.postData.contents); } catch (x) { return out_({ok:false, err:'json'}); }
  var P = PropertiesService.getScriptProperties();
  if (b.act === 'push') {
    if (!P.getProperty('WRITE_KEY') || b.key !== P.getProperty('WRITE_KEY')) return out_({ok:false, err:'key'});
    var lock = LockService.getScriptLock(); lock.waitLock(20000);
    try { return out_(push_(b)); } finally { lock.releaseLock(); }
  }
  if (b.act === 'read') {
    if (!P.getProperty('VIEW_PASS') || b.pass !== P.getProperty('VIEW_PASS')) { Utilities.sleep(1500); return out_({ok:false, err:'pass'}); }
    return out_(read_());
  }
  return out_({ok:false, err:'act'});
}

function doGet() { return out_({ok:true, msg:'StatsSync dang chay'}); }

function sh_(name, header) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var s = ss.getSheetByName(name);
  if (!s) { s = ss.insertSheet(name); if (header) s.appendRow(header); }
  return s;
}

function push_(b) {
  var s = sh_('deals', COLS);
  var have = {};
  var n = s.getLastRow();
  if (n > 1) s.getRange(2, 1, n - 1, 1).getValues().forEach(function (r) { have[String(r[0])] = 1; });
  var rows = [];
  (b.deals || []).forEach(function (d) {
    var k = String(d[0]);
    if (have[k]) return;
    have[k] = 1;
    rows.push([k].concat(d.slice(1)));
  });
  if (rows.length) s.getRange(s.getLastRow() + 1, 1, rows.length, COLS.length).setValues(rows);
  if (b.snap) {
    b.snap.rt = Date.now();
    sh_('snap').getRange(1, 1).setValue(JSON.stringify(b.snap));
    var q = sh_('equity', ['t','balance','equity']);
    var last = q.getLastRow() > 1 ? Number(q.getRange(q.getLastRow(), 1).getValue()) : 0;
    if (Date.now() - last > 50 * 60 * 1000) q.appendRow([Date.now(), b.snap.bal, b.snap.eq]);
  }
  return {ok:true, added:rows.length};
}

function read_() {
  var s = sh_('deals', COLS);
  var n = s.getLastRow();
  var deals = n > 1 ? s.getRange(2, 1, n - 1, COLS.length).getValues() : [];
  var snapTxt = sh_('snap').getRange(1, 1).getValue();
  var q = sh_('equity', ['t','balance','equity']);
  var m = q.getLastRow();
  var eq = m > 1 ? q.getRange(Math.max(2, m - 6000), 1, Math.min(m - 1, 6000), 3).getValues() : [];
  return {ok:true, cols:COLS, deals:deals, snap: snapTxt ? JSON.parse(snapTxt) : null, equity:eq};
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
