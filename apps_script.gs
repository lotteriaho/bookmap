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
 *
 * Lệnh /history trên Telegram: sau khi triển khai phiên bản mới, chạy hàm caiHistory() một lần.
 */
const SHEET_NAME = 'lenh_giay';
const SHEET_ID = '';   // để trống nếu tạo Apps Script từ menu của Sheet; nếu tạo dự án riêng thì dán ID của Sheet vào đây
const HEAD = ['id', 'json', 'gio_vao', 'gio_ra', 'giu_phut', 'ma', 'setup', 'huong', 'ly_do', 'vao', 'sl', 'tp', 'thoat', 'cach_dong',
  'R', 'R_phi_0.08%', 'do_lon_usd', 'tuong_dung_usd', 'tuong_dung_giay', 'mfe_R', 'mae_R',
  'dk_thuan_xu_huong', 'dk_cvd_cung_chieu', 'dk_so_nghieng', 'dk_kl_tang', 'dk_phien_au_my', 'keo_A_chuan',
  'xh10_pct', 'cvd60_usd', 'so_lech', 'kl_x', 'bien_dong5_pct', 'spread_bps'];
const SETUP_NAME = { A: 'A · Bật tường', B: 'B · Phá tường', C: 'C · Rút tường', D: 'D · Sau thanh lý', E: 'E · Bẫy phá tường', F: 'F · Bẫy rút tường', G: 'G · Chạm tường dày' };

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

// gửi tin; replyTo = message_id của tin cần trả lời (tin báo vào lệnh) → tin đóng lệnh hiện dạng trả lời
function tg_(text, replyTo) {
  const p = PropertiesService.getScriptProperties(), tok = p.getProperty('TG_TOKEN'), chat = p.getProperty('TG_CHAT');
  if (!tok || !chat) return { res: 'chưa cài TG_TOKEN / TG_CHAT' };
  const payload = { chat_id: chat, text: String(text).slice(0, 3500), parse_mode: 'HTML', disable_web_page_preview: 'true' };
  if (replyTo) payload.reply_parameters = JSON.stringify({ message_id: Number(replyTo), allow_sending_without_reply: true });
  const r = UrlFetchApp.fetch('https://api.telegram.org/bot' + tok + '/sendMessage', { method: 'post', muteHttpExceptions: true, payload });
  if (r.getResponseCode() !== 200) return { res: 'Telegram lỗi ' + r.getResponseCode() };
  let mid = null; try { mid = JSON.parse(r.getContentText()).result.message_id; } catch (e) {}
  return { res: 'ok', mid };
}
function thuTelegram() { Logger.log(tg_('✅ Bookmap mini: đã nối Telegram qua Google Sheet').res); }

// ===== /history trên Telegram =====
const HIST_FROM = Date.parse('2026-11-15T12:51:00+07:00');   // thống kê tính từ lúc này (đổi bằng thuộc tính HIST_T0 nếu muốn)
const HIST_KEO = ['E/F', 'G', 'D', 'A'];
function money_(v) { return (v >= 0 ? '+' : '−') + '$' + Math.abs(v).toFixed(2); }
function history_(args) {
  const p = PropertiesService.getScriptProperties(), t0 = +(p.getProperty('HIST_T0') || HIST_FROM);
  let from = t0, sym = null, lab = 'từ ' + Utilities.formatDate(new Date(t0), 'Asia/Ho_Chi_Minh', 'dd/MM HH:mm');
  for (const a of args) {
    const m = /^(\d+)(h|d)$/i.exec(a);
    if (m) { from = Math.max(t0, Date.now() - (+m[1]) * (m[2].toLowerCase() === 'h' ? 3600e3 : 864e5)); lab = m[1] + (m[2].toLowerCase() === 'h' ? ' giờ' : ' ngày') + ' qua'; }
    else if (/^[a-z0-9]{2,15}$/i.test(a)) { sym = a.toUpperCase().replace(/USDT$/, '') + 'USDT'; lab += ' · ' + sym.replace(/USDT$/, ''); }
  }
  const sh = sheet_(), n = sh.getLastRow() - 1, L = [];
  if (n > 0) for (const [js] of sh.getRange(2, 2, n, 1).getValues()) {
    let o; try { o = JSON.parse(js); } catch (e) { continue; }
    if (!o.keo || o.status !== 'closed' || o.t < from || (sym && o.sym !== sym)) continue; L.push(o);
  }
  L.sort((a, b) => (a.tx || a.t) - (b.tx || b.t));
  if (!L.length) return '📊 Lịch sử ' + lab + '\nChưa có lệnh nào đã đóng.';
  const pnl = o => o.pnl != null ? o.pnl : 0, win = o => o.pnl != null ? o.pnl > 0 : o.R > 0;
  const Rr = o => o.acct && o.acct.riskUsd && o.pnl != null ? o.pnl / o.acct.riskUsd : (o.R || 0);
  const out = ['📊 <b>Lịch sử ' + lab + '</b> · ' + L.length + ' lệnh'];
  const keos = HIST_KEO.concat([...new Set(L.map(o => o.keo))].filter(k => HIST_KEO.indexOf(k) < 0));
  for (const k of keos) {
    const G = L.filter(o => o.keo === k); if (!G.length) continue;
    const w = G.filter(win).length, sR = G.reduce((a, o) => a + Rr(o), 0), sU = G.reduce((a, o) => a + pnl(o), 0);
    const D = G.filter(o => o.bn && o.bn.ok && o.bn.avg && o.risk);
    let demo = '';
    if (D.length) {
      const ent = D.reduce((a, o) => a + o.dir * (o.bn.avg - o.entry) / o.risk, 0) / D.length;
      const X = D.filter(o => o.bn.exit != null), ex = X.length ? X.reduce((a, o) => a + o.dir * (o.exit - o.bn.exit) / o.risk, 0) / X.length : null;
      const dU = X.reduce((a, o) => a + (o.bn.pnl || 0), 0);
      demo = '\n Demo ' + D.length + ' lệnh · lệch TB vào ' + ent.toFixed(2) + 'R' + (ex != null ? ', thoát ' + ex.toFixed(2) + 'R · demo ' + money_(dU) : '') + ' (dương = demo kém hơn)';
    }
    out.push('\n<b>Kèo ' + k + '</b> · ' + G.length + ' lệnh\n Thắng ' + w + ' · Thua ' + (G.length - w) + ' · ' + Math.round(100 * w / G.length) + '%\n ' +
      (sR >= 0 ? '+' : '−') + Math.abs(sR).toFixed(2) + 'R · ' + money_(sU) + demo);
  }
  let streak = 0, worst = 0, cum = 0, peak = 0, dd = 0;
  for (const o of L) { streak = win(o) ? 0 : streak + 1; worst = Math.max(worst, streak); cum += pnl(o); peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak); }
  const w = L.filter(win).length, last = L[L.length - 1];
  out.push('\nTổng: ' + Math.round(100 * w / L.length) + '% · ' + money_(cum) + (last.bal != null ? ' · TK $' + (+last.bal).toFixed(2) : ''));
  out.push('Chuỗi thua dài nhất: ' + worst + ' · Sụt vốn lớn nhất: ' + money_(dd));
  return out.join('\n');
}
function telegram_(u) {
  const c = CacheService.getScriptCache(), k = 'upd_' + u.update_id;
  if (c.get(k)) return; c.put(k, '1', 21600);                       // Telegram có thể gửi lại cùng một tin
  const m = u.message || u.edited_message; if (!m || !m.text) return;
  if (String(m.chat.id) !== String(PropertiesService.getScriptProperties().getProperty('TG_CHAT'))) return;   // chỉ trả lời đúng chat của bạn
  const parts = m.text.trim().split(/\s+/), cmd = parts[0].toLowerCase().replace(/@.*$/, '');
  if (cmd === '/history') tg_(history_(parts.slice(1)));
  else if (cmd === '/start' || cmd === '/help') tg_('Lệnh: /history · /history 24h · /history 7d · /history BTC');
}
// chạy 1 lần sau khi triển khai phiên bản mới: trỏ bot Telegram về ứng dụng web này để nhận lệnh /history
// ⚠ CHỈ dùng với bot riêng cho Bookmap. Nếu bot này cũng do EA/MT5 đọc lệnh (getUpdates) thì EA sẽ mất /signal, /report — khi đó chạy xoaWebhook().
function caiHistory() {
  const p = PropertiesService.getScriptProperties(), tok = p.getProperty('TG_TOKEN');
  if (!tok) throw new Error('chưa cài TG_TOKEN');
  const url = ScriptApp.getService().getUrl().replace(/\/dev$/, '/exec');
  const r1 = UrlFetchApp.fetch('https://api.telegram.org/bot' + tok + '/setWebhook', { method: 'post', muteHttpExceptions: true,
    payload: { url: url, allowed_updates: JSON.stringify(['message']), drop_pending_updates: 'true' } });
  const r2 = UrlFetchApp.fetch('https://api.telegram.org/bot' + tok + '/setMyCommands', { method: 'post', muteHttpExceptions: true,
    payload: { commands: JSON.stringify([{ command: 'history', description: 'Thống kê kèo đang test (thêm 24h / 7d / BTC)' }]) } });
  Logger.log('setWebhook: ' + r1.getContentText() + ' · setMyCommands: ' + r2.getContentText());
}

// Trang Bookmap gửi POST: {trades:[…]} để lưu lệnh, {tg:{key,text}} để báo Telegram (trùng key thì bỏ qua)
function doPost(e) {
  const body0 = JSON.parse(e.postData.contents || '{}');
  if (body0.update_id != null) { try { telegram_(body0); } catch (err) { console.error(err); } return out_({ ok: true }); }
  if (body0.tg) {
    const c = CacheService.getScriptCache(), key = String(body0.tg.key || '').slice(0, 200), k = 'tg_' + key;
    if (key && c.get(k)) return out_({ ok: true, tg: 'trùng, bỏ qua' });
    const replyTo = body0.tg.reply ? c.get('mid_' + String(body0.tg.reply).slice(0, 200)) : null;
    const r = tg_(body0.tg.text || '', replyTo);
    if (key && r.res === 'ok') { c.put(k, '1', 21600); if (r.mid) c.put('mid_' + key, String(r.mid), 21600); }   // nhớ message_id 6 giờ để tin đóng lệnh trả lời vào
    return out_({ ok: r.res === 'ok', tg: r.res });
  }
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const body = body0, sh = sheet_(), n = sh.getLastRow() - 1;
    const idv = n > 0 ? sh.getRange(2, 1, n, 2).getValues() : [], at = new Map();
    idv.forEach((r, i) => at.set(String(r[0]).replace(/^'/, ''), i));
    const rows = []; let upd = 0;
    for (const o of body.trades || []) {
      if (!o || o.id == null) continue; const id = String(o.id);
      if (at.has(id)) {   // đã có: cập nhật nếu lệnh có thêm dữ liệu (lời/lỗ thật, số liệu demo)
        const i = at.get(id), js = JSON.stringify(o);
        if (i >= 0 && idv[i][1] !== js) { sh.getRange(i + 2, 1, 1, HEAD.length).setValues([row_(o)]); upd++; }
        continue;
      }
      at.set(id, -1); rows.push(row_(o));
    }
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEAD.length).setValues(rows);
    return out_({ ok: true, added: rows.length, updated: upd, total: at.size });
  } finally { lock.releaseLock(); }
}

// gỡ webhook: trả bot về chế độ getUpdates để EA trên MT5 nhận lại /signal, /report…
function xoaWebhook() {
  const tok = PropertiesService.getScriptProperties().getProperty('TG_TOKEN');
  const r = UrlFetchApp.fetch('https://api.telegram.org/bot' + tok + '/deleteWebhook', { method: 'post', muteHttpExceptions: true, payload: { drop_pending_updates: 'false' } });
  // đặt lại allowed_updates = mọi loại tin (không truyền offset nên không lấy mất tin của EA)
  UrlFetchApp.fetch('https://api.telegram.org/bot' + tok + '/getUpdates?limit=1&timeout=0&allowed_updates=' + encodeURIComponent('[]'), { muteHttpExceptions: true });
  const i = UrlFetchApp.fetch('https://api.telegram.org/bot' + tok + '/getWebhookInfo', { muteHttpExceptions: true });
  Logger.log('deleteWebhook: ' + r.getContentText() + ' · info: ' + i.getContentText());
}
