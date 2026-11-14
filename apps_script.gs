/**
 * Lưu lệnh giấy của Bookmap mini vào Google Sheet.
 * Cách cài: mở Google Sheet mới → Tiện ích mở rộng → Apps Script → xoá hết, dán toàn bộ file này → Lưu
 * → Triển khai → Triển khai mới → Loại: Ứng dụng web → Thực thi dưới dạng: Tôi → Ai có quyền truy cập: Bất kỳ ai
 * → Triển khai → cấp quyền → chép "URL ứng dụng web" (…/exec) dán vào Bookmap: ⚙ → Đồng bộ Google Sheet.
 * Không cần mật khẩu hay API key. Ai có URL này đều ghi/đọc được sheet, nên đừng chia sẻ URL.
 */
const SHEET_NAME = 'lenh_giay';
const HEAD = ['id', 'json', 'gio_vao', 'ma', 'setup', 'huong', 'vao', 'thoat', 'cach_dong', 'R'];

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) { sh = ss.insertSheet(SHEET_NAME); sh.appendRow(HEAD); sh.setFrozenRows(1); sh.hideColumns(2); }
  return sh;
}
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// Trang Bookmap gọi GET khi mở để lấy lại toàn bộ lệnh cũ
function doGet() {
  const sh = sheet_(), n = sh.getLastRow() - 1, trades = [];
  if (n > 0) for (const [js] of sh.getRange(2, 2, n, 1).getValues()) { try { trades.push(JSON.parse(js)); } catch (e) {} }
  return out_({ ok: true, trades });
}

// Trang Bookmap gửi POST các lệnh mới đóng; lệnh trùng id được bỏ qua
function doPost(e) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const body = JSON.parse(e.postData.contents || '{}'), sh = sheet_(), n = sh.getLastRow() - 1;
    const ids = new Set(n > 0 ? sh.getRange(2, 1, n, 1).getValues().map(r => String(r[0])) : []);
    const rows = [];
    for (const o of body.trades || []) {
      if (!o || o.id == null) continue; const id = String(o.id); if (ids.has(id)) continue; ids.add(id);
      rows.push(["'" + id, JSON.stringify(o), new Date(o.t), o.sym, o.setup, o.dir > 0 ? 'Mua' : 'Ban', o.entry, o.exit, o.how, o.R]);
    }
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEAD.length).setValues(rows);
    return out_({ ok: true, added: rows.length, total: ids.size });
  } finally { lock.releaseLock(); }
}
