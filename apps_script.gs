/**
 * Lưu lệnh giấy của Bookmap mini vào Google Sheet.
 * Cách cài: mở Google Sheet mới → Tiện ích mở rộng → Apps Script → xoá hết, dán toàn bộ file này → Lưu
 * → Triển khai → Triển khai mới → Loại: Ứng dụng web → Thực thi dưới dạng: Tôi → Ai có quyền truy cập: Bất kỳ ai
 * → Triển khai → cấp quyền → chép "URL ứng dụng web" (…/exec) dán vào Bookmap: ⚙ → Đồng bộ Google Sheet.
 * Không cần mật khẩu hay API key. Ai có URL này đều ghi/đọc được sheet, nên đừng chia sẻ URL.
 *
 * Báo Telegram (tuỳ chọn): Apps Script → ⚙ Cài đặt dự án → Thuộc tính tập lệnh → thêm
 *   TG_TOKEN = token bot (từ @BotFather)   TG_CHAT = chat id của bạn
 * Token chỉ nằm trong Google của bạn, trang Bookmap không bao giờ thấy token.
 * Sau khi thêm, chạy hàm thuTelegram() một lần (nút ▶ Chạy) để cấp quyền và thử gửi.
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

function tg_(text) {
  const p = PropertiesService.getScriptProperties(), tok = p.getProperty('TG_TOKEN'), chat = p.getProperty('TG_CHAT');
  if (!tok || !chat) return 'chưa cài TG_TOKEN / TG_CHAT';
  const r = UrlFetchApp.fetch('https://api.telegram.org/bot' + tok + '/sendMessage', { method: 'post', muteHttpExceptions: true,
    payload: { chat_id: chat, text: String(text).slice(0, 3500), parse_mode: 'HTML', disable_web_page_preview: 'true' } });
  return r.getResponseCode() === 200 ? 'ok' : 'Telegram lỗi ' + r.getResponseCode();
}
function thuTelegram() { Logger.log(tg_('✅ Bookmap mini: đã nối Telegram qua Google Sheet')); }

// Trang Bookmap gửi POST: {trades:[…]} để lưu lệnh, {tg:{key,text}} để báo Telegram (trùng key thì bỏ qua)
function doPost(e) {
  const body0 = JSON.parse(e.postData.contents || '{}');
  if (body0.tg) {
    const c = CacheService.getScriptCache(), k = 'tg_' + String(body0.tg.key || '').slice(0, 200);
    if (body0.tg.key && c.get(k)) return out_({ ok: true, tg: 'trùng, bỏ qua' });
    const res = tg_(body0.tg.text || ''); if (body0.tg.key && res === 'ok') c.put(k, '1', 21600);
    return out_({ ok: res === 'ok', tg: res });
  }
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const body = body0, sh = sheet_(), n = sh.getLastRow() - 1;
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
