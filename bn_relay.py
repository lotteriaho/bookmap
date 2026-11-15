"""
Cầu nối Bookmap mini -> Binance Futures DEMO (tiền ảo), chạy trên máy của bạn.

Vì sao cần: trình duyệt không được phép gửi lệnh có API key thẳng tới Binance, còn Google Apps Script
chạy từ máy chủ ở Mỹ nên bị Binance chặn. Chương trình nhỏ này chạy trên máy bạn (IP Việt Nam),
nhận tín hiệu từ trang Bookmap qua http://127.0.0.1:8787 và đặt lệnh lên demo-fapi.binance.com.

Cách dùng (Windows):
  1. Cài Python 3 (python.org, tick "Add python.exe to PATH").
  2. Để file này và bn_config.json cùng một thư mục. Mở bn_config.json bằng Notepad, dán API key / Secret DEMO, lưu.
  3. Bấm đúp chay_bn_relay.bat (hoặc: python bn_relay.py). Để cửa sổ đen mở trong lúc test.
  4. Trên Bookmap: ⚙ → tick "🔗 Vào lệnh Binance demo". Lần đầu Chrome có thể hỏi cho phép truy cập mạng cục bộ → Cho phép.

An toàn:
  - Địa chỉ sàn được cố định là DEMO bên dưới; chương trình này không thể đặt lệnh trên tài khoản thật.
  - Key chỉ nằm trong bn_config.json trên máy bạn; trang web không bao giờ thấy key.
  - Chỉ nhận kết nối từ chính máy này (127.0.0.1) và chỉ từ trang lotteriaho.github.io.
"""
import hashlib, hmac, json, os, sys, threading, time, urllib.error, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE = "https://demo-fapi.binance.com"          # DEMO — không đổi
PORT = 8787
ALLOW_ORIGINS = {"https://lotteriaho.github.io", "null"}   # "null": khi mở file Bookmap trực tiếp trên máy
HERE = os.path.dirname(os.path.abspath(__file__))
CFG_PATH = os.path.join(HERE, "bn_config.json")
STATE_PATH = os.path.join(HERE, "bn_state.json")
LOG_PATH = os.path.join(HERE, "bn_log.txt")

lock = threading.Lock()
info_cache = {}


def log(msg):
    line = time.strftime("%H:%M:%S ") + msg
    print(line, flush=True)
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%d ") + line + "\n")
    except OSError:
        pass


def load_cfg():
    try:
        with open(CFG_PATH, encoding="utf-8") as f:
            c = json.load(f)
    except (OSError, ValueError) as e:
        sys.exit(f"Không đọc được {CFG_PATH}: {e}")
    key, sec = str(c.get("api_key", "")).strip(), str(c.get("secret_key", "")).strip()
    if not key or not sec or "DAN_" in key or "DAN_" in sec:
        sys.exit("Hãy mở bn_config.json, dán API key và Secret key DEMO rồi lưu lại.")
    return key, sec


API_KEY, SECRET = load_cfg()


def load_state():
    try:
        with open(STATE_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"done": {}, "lots": {}}


state = load_state()
state.setdefault("lots", {})
state.pop("own", None)                                 # dạng cũ (1 vị thế/mã) không dùng nữa


def save_state():
    cut = time.time() - 86400                          # chỉ nhớ 1 ngày
    state["done"] = {k: v for k, v in state["done"].items() if v > cut}
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(state, f)


class BinanceError(Exception):
    pass


def req(method, path, params=None, signed=True):
    p = dict(params or {})
    if signed:
        p.update(recvWindow=10000, timestamp=int(time.time() * 1000))
    q = urllib.parse.urlencode(p)
    if signed:
        q += "&signature=" + hmac.new(SECRET.encode(), q.encode(), hashlib.sha256).hexdigest()
    r = urllib.request.Request(BASE + path + ("?" + q if q else ""), method=method.upper(),
                               headers={"X-MBX-APIKEY": API_KEY} if signed else {})
    try:
        with urllib.request.urlopen(r, timeout=15) as resp:
            return json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            j = json.loads(e.read())
        except ValueError:
            j = {}
        raise BinanceError(f"Binance {j.get('code', e.code)} {j.get('msg', '')}".strip())


def sym_info(sym):
    if sym not in info_cache:
        j = req("GET", "/fapi/v1/exchangeInfo", {"symbol": sym}, signed=False)
        s = next((x for x in j.get("symbols", []) if x["symbol"] == sym), None)
        if not s:
            raise BinanceError(f"không có mã {sym} trên Binance demo")
        f = {x["filterType"]: x for x in s["filters"]}
        info_cache[sym] = {"tick": f["PRICE_FILTER"]["tickSize"], "step": f["LOT_SIZE"]["stepSize"],
                           "minQty": float(f["LOT_SIZE"]["minQty"]),
                           "minNot": float(f.get("MIN_NOTIONAL", {}).get("notional", 5))}
    return info_cache[sym]


fee_cache = {}


def taker_rate(sym):
    """Phí taker thật của tài khoản cho mã này (Binance trả dạng 0.0005 = 0,05%)."""
    if sym not in fee_cache:
        try:
            fee_cache[sym] = float(req("GET", "/fapi/v1/commissionRate", {"symbol": sym})["takerCommissionRate"])
        except (BinanceError, KeyError, ValueError):
            return None
    return fee_cache[sym]


def rnd(v, step, floor=False):
    from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP
    st = Decimal(step).normalize()
    n = (Decimal(str(v)) / st).quantize(Decimal(1), rounding=ROUND_DOWN if floor else ROUND_HALF_UP)
    return format((n * st).normalize(), "f")


# ===== Chế độ HEDGE: mỗi lệnh Bookmap là một "lô" riêng với SL/TP riêng (theo khối lượng), nên vào được
# nhiều lệnh cùng mã, cả mua lẫn bán, không lệnh nào đóng nhầm lệnh khác. =====
def pos_amt(sym, ps):
    """Khối lượng (dương) đang mở của phía LONG hoặc SHORT."""
    return sum(abs(float(x["positionAmt"])) for x in req("GET", "/fapi/v3/positionRisk", {"symbol": sym}) if x.get("positionSide") == ps)


def fill_avg(sym, side, t0):
    """Giá khớp trung bình thật từ lịch sử khớp (demo đôi khi trả avgPrice = 0)."""
    for _ in range(3):
        L = [x for x in req("GET", "/fapi/v1/userTrades", {"symbol": sym, "startTime": t0, "limit": 50}) if x["side"] == side]
        if L:
            return sum(float(x["price"]) * float(x["qty"]) for x in L) / sum(float(x["qty"]) for x in L)
        time.sleep(0.7)
    return None


def market(sym, side, ps, qty):
    od = req("POST", "/fapi/v1/order", {"symbol": sym, "side": side, "positionSide": ps, "type": "MARKET",
                                         "quantity": qty, "newOrderRespType": "RESULT"})
    return float(od.get("avgPrice") or 0)


def cancel_algo(aid):
    try:
        req("DELETE", "/fapi/v1/algoOrder", {"algoId": aid})
    except BinanceError:
        pass                                           # đã khớp / đã huỷ thì thôi


def do_open(b):
    sym, buy = str(b["sym"]), b["dir"] > 0
    inf = sym_info(sym)
    qty = rnd(float(b["qty"]), inf["step"], floor=True)
    if float(qty) < inf["minQty"] or float(qty) * float(b["entry"]) < inf["minNot"]:
        return {"ok": False, "msg": f"khối lượng {qty} dưới mức tối thiểu của sàn ({inf['minNot']:g}$)"}
    try:
        req("POST", "/fapi/v1/leverage", {"symbol": sym, "leverage": max(1, min(50, round(b.get("lev") or 20)))})
    except BinanceError as e:
        log(f"  (đặt đòn bẩy: {e})")
    ps, side, back = ("LONG", "BUY", "SELL") if buy else ("SHORT", "SELL", "BUY")
    t0 = int(time.time() * 1000) - 2000
    avg = market(sym, side, ps, qty)
    if not avg:
        try:
            avg = fill_avg(sym, side, t0) or 0
        except BinanceError:
            avg = 0
    # Giá sàn demo lệch giá thật nên SL/TP đặt theo giá khớp demo, giữ đúng khoảng cách như lệnh giấy.
    ref = avg or float(b["entry"])
    d = 1 if buy else -1
    sl_px = ref - d * abs(float(b["entry"]) - float(b["sl"]))
    tp_px = ref + d * abs(float(b["tp"]) - float(b["entry"]))
    ids = []
    try:
        for typ, px in (("STOP_MARKET", sl_px), ("TAKE_PROFIT_MARKET", tp_px)):
            r = req("POST", "/fapi/v1/algoOrder", {"algoType": "CONDITIONAL", "symbol": sym, "side": back, "positionSide": ps,
                                                   "type": typ, "quantity": qty, "triggerPrice": rnd(float(px), inf["tick"]),
                                                   "workingType": "CONTRACT_PRICE"})
            ids.append(r.get("algoId"))
    except BinanceError as e:                          # không có SL/TP thì đóng ngay lô này, không để vị thế trần
        for aid in ids:
            cancel_algo(aid)
        try:
            market(sym, back, ps, qty)
        except BinanceError:
            pass
        return {"ok": False, "msg": f"không đặt được SL/TP nên đã đóng lại: {e}"}
    state["lots"][b["key"]] = {"sym": sym, "ps": ps, "back": back, "dir": d, "qty": qty, "entry": ref,
                               "sl_id": ids[0], "tp_id": ids[1], "t": t0}
    return {"ok": True, "msg": f"khớp {qty} @ {avg:g}" if avg else f"khớp {qty} (chưa đọc được giá khớp)",
            "avg": avg or None, "qty": float(qty), "rate": taker_rate(sym)}


def algo_state(aid):
    j = req("GET", "/fapi/v1/algoOrder", {"algoId": aid})
    hit = bool(j.get("actualOrderId")) or j.get("algoStatus") in ("TRIGGERED", "FINISHED")
    return hit, float(j.get("actualPrice") or 0)


def check_lot(key, lot):
    """Nếu SL hoặc TP của lô đã chạy trên sàn: huỷ lệnh còn lại và ghi giá thoát."""
    if lot.get("closed"):
        return
    for name, aid, other in (("SL", lot["sl_id"], lot["tp_id"]), ("TP", lot["tp_id"], lot["sl_id"])):
        hit, px = algo_state(aid)
        if hit:
            cancel_algo(other)
            lot["closed"] = {"how": name, "exit": px or None}
            log(f"SÀN   {lot['sym']} {lot['ps']} chạm {name}" + (f" @ {px:g}" if px else ""))
            return


def pnl_of(lot, exit_px):
    q = float(lot["qty"]); rate = taker_rate(lot["sym"]) or 0.0005
    fee = rate * q * (lot["entry"] + exit_px)
    return round(lot["dir"] * (exit_px - lot["entry"]) * q - fee, 4), round(fee, 4)


def do_close(b):
    key = b["key"]
    lot = state["lots"].get(key)
    if not lot:
        return {"ok": True, "msg": "không phải vị thế của lệnh này"}
    check_lot(key, lot)
    if lot.get("closed"):                              # sàn đã tự đóng lô này
        c = lot["closed"]; by = "san"
        exit_px = c["exit"]
        if not exit_px:
            hit, exit_px = algo_state(lot["sl_id"] if c["how"] == "SL" else lot["tp_id"])
        msg = f"sàn chạm {c['how']}"
    else:                                              # Bookmap đóng: huỷ SL/TP của lô, đóng đúng khối lượng lô
        cancel_algo(lot["sl_id"]); cancel_algo(lot["tp_id"])
        q = min(float(lot["qty"]), pos_amt(lot["sym"], lot["ps"]))
        exit_px = market(lot["sym"], lot["back"], lot["ps"], rnd(q, sym_info(lot["sym"])["step"], floor=True)) if q > 0 else 0
        by, msg = "bookmap", "Bookmap đóng bằng lệnh Market"
    state["lots"].pop(key, None)
    r = {"ok": True, "by": by, "msg": msg}
    if exit_px:
        pnl, fee = pnl_of(lot, exit_px)
        r.update(exit=exit_px, pnl=pnl, fee=fee)
        r["msg"] += f" · thoát {exit_px:g} · lời/lỗ {pnl:+.2f} USDT (phí {fee:.2f})"
    return r


def handle(b):
    act, key = b.get("act"), str(b.get("key", ""))
    if act == "ping":
        bal = next((x["balance"] for x in req("GET", "/fapi/v3/balance") if x["asset"] == "USDT"), "?")
        if b.get("from"):
            log("Bookmap đã nối tới — sẵn sàng vào lệnh")
        return {"ok": True, "msg": f"Binance demo OK · số dư {float(bal):,.2f} USDT · {len(state['lots'])} lệnh đang mở", "rate": taker_rate("BTCUSDT")}
    if act not in ("open", "close") or not key:
        return {"ok": False, "msg": "yêu cầu sai"}
    dk = act + ":" + key
    with lock:
        if dk in state["done"]:
            return {"ok": True, "msg": "trùng, bỏ qua", "dup": True}
        state["done"][dk] = time.time()
        try:
            r = do_open(b) if act == "open" else do_close(b)
        except BinanceError as e:
            r = {"ok": False, "msg": str(e)}
        save_state()
    side = ("MUA " if b.get("dir", 0) > 0 else "BÁN ") if act == "open" else ""
    log(f"{act.upper():5} {b.get('sym')} {side}→ {r['msg']}")
    return r


def watcher():
    """Mỗi 5 giây: lô nào đã chạm SL/TP trên sàn thì huỷ ngay lệnh còn lại, để nó không đóng nhầm lô khác."""
    while True:
        time.sleep(5)
        with lock:
            for key, lot in list(state["lots"].items()):
                try:
                    check_lot(key, lot)
                except BinanceError:
                    pass
            save_state()


class H(BaseHTTPRequestHandler):
    def _cors(self):
        o = self.headers.get("Origin", "")
        if o in ALLOW_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if self.headers.get("Origin", "") not in ALLOW_ORIGINS:
            self.send_response(403)
            self.end_headers()
            return
        try:
            b = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0)) or 0) or b"{}")
            r = handle(b)
        except Exception as e:                         # không để chương trình dừng vì một lỗi
            r = {"ok": False, "msg": f"lỗi: {e}"}
        out = json.dumps(r, ensure_ascii=False).encode()
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    try:
        print(handle({"act": "ping"})["msg"])
    except Exception as e:
        print("⚠ Chưa nối được Binance demo:", e)
    try:                                               # cần chế độ HEDGE để giữ nhiều lệnh độc lập
        if not req("GET", "/fapi/v1/positionSide/dual").get("dualSidePosition"):
            req("POST", "/fapi/v1/positionSide/dual", {"dualSidePosition": "true"})
            print("Đã chuyển tài khoản demo sang chế độ Hedge (giữ được nhiều lệnh cùng lúc).")
    except BinanceError as e:
        print("⚠ Chưa chuyển được sang chế độ Hedge:", e, "— hãy đóng hết vị thế trên demo.binance.com rồi chạy lại.")
    threading.Thread(target=watcher, daemon=True).start()
    print(f"Đang chờ tín hiệu từ Bookmap ở http://127.0.0.1:{PORT} — để cửa sổ này mở. Ctrl+C để dừng.")
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
