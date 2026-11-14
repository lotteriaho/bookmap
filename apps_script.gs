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
const SHEET_ID = '';   // để trống nếu tạo Apps Script từ menu của Sheet; nếu tạo dự án riêng thì dán ID của Sheet vào đây
const HEAD = ['id', 'json', 'gio_vao', 'gio_ra', 'giu_phut', 'ma', 'setup', 'huong', 'ly_do', 'vao', 'sl', 'tp', 'thoat', 'cach_dong',
  'R', 'R_phi_0.08%', 'do_lon_usd', 'tuong_dung_usd', 'tuong_dung_giay', 'mfe_R', 'mae_R',
  'dk_thuan_xu_huong', 'dk_cvd_cung_chieu', 'dk_so_nghieng', 'dk_kl_tang', 'dk_phien_au_my', 'keo_A_chuan',
  'xh10_pct', 'cvd60_usd', 'so_lech', 'kl_x', 'bien_dong5_pct', 'spread_bps'];
const SETUP_NAME = { A: 'A · Bật tường', B: 'B · Phá tường', C: 'C · Rút tường', D: 'D · Sau thanh lý', E: 'E · Bẫy phá tường', F: 'F · Bẫy rút tường' };

// một lệnh (JSON từ trang Bookmap) -> một dòng đầy đủ cột để đọc / lọc / vẽ trên Sheet
function row_(o) {
  const f = o.f || null, raw = o.raw || {}, v = x => (x === undefined || x === null || x === '') ? '' : x;
  const b = k => f ? (f[k] ? 1 : 0) : '';
  const r8 = (o.R != null && o.risk) ? Math.round((o.R - (0.0008 - (o.fee || 0.0005)) * o.entry / o.risk) * 1000) / 1000 : '';
  const keo = (o.setup === 'A' && (o.sym === 'BTCUSDT' || o.sym === 'ETHUSDT') && f && f.book && !f.trend) ? 1 : 0;
  return ["'" + String(o.id), JSON.stringify(o), new Date(o.t), o.tx ? new Date(o.tx) : '', o.tx ? Math.round((o.tx - o.t) / 6000) / 10 : '',
    o.sym, SETUP_NAME[o.setup] || o.setup, o.dir > 0 ? 'Mua' : 'Bán', v(o.why), o.entry, o.sl, o.tp, o.exit, v(o.how),
    o.R, r8, v(o.sz && Math.round(o.sz)), v(o.rest != null ? Math.round(o.rest) : ''), v(o.age), v(o.mfe), v(o.mae),
    b('trend'), b('cvd'), b('book'), b('vol'), b('sess'), keo,
    v(raw.xh10_pct), v(raw.cvd60_usd), v(raw.so_lech), v(raw.kl_x), v(raw.bien_dong5_pct), v(raw.spread_bps)];
}
// chạy 1 lần (nút ▶ Chạy) để viết lại toàn bộ bảng theo đủ cột từ dữ liệu đã lưu
function lamMoiBang() {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
  const sh = sheet_(), n = sh.getLastRow() - 1, list = [];
  if (n > 0) for (const [js] of sh.getRange(2, 2, n, 1).getValues()) { try { list.push(JSON.parse(js)); } catch (e) {} }
  list.sort((a, b) => a.t - b.t);
  sh.clear(); sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold'); sh.setFrozenRows(1);
  if (list.length) sh.getRange(2, 1, list.length, HEAD.length).setValues(list.map(row_));
  sh.getRange('C:D').setNumberFormat('dd/MM HH:mm:ss'); sh.hideColumns(2);
  Logger.log('Đã viết lại ' + list.length + ' lệnh');
  } finally { lock.releaseLock(); }
}
function sheet_() {
  const ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) { sh = ss.insertSheet(SHEET_NAME); sh.appendRow(HEAD); sh.setFrozenRows(1); sh.hideColumns(2); sh.getRange('C:D').setNumberFormat('dd/MM HH:mm:ss'); }
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
      rows.push(row_(o));
    }
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEAD.length).setValues(rows);
    return out_({ ok: true, added: rows.length, total: ids.size });
  } finally { lock.releaseLock(); }
}
