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
        return {"done": {}, "own": {}}


state = load_state()


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


def rnd(v, step, floor=False):
    from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP
    st = Decimal(step).normalize()
    n = (Decimal(str(v)) / st).quantize(Decimal(1), rounding=ROUND_DOWN if floor else ROUND_HALF_UP)
    return format((n * st).normalize(), "f")


def position(sym):
    return sum(float(x["positionAmt"]) for x in req("GET", "/fapi/v3/positionRisk", {"symbol": sym}))


def flat(sym):
    for path in ("/fapi/v1/algoOpenOrders", "/fapi/v1/allOpenOrders"):
        try:
            req("DELETE", path, {"symbol": sym})
        except BinanceError:
            pass
    amt = position(sym)
    if amt == 0:
        return False                                   # sàn đã tự đóng (SL/TP trên sàn)
    req("POST", "/fapi/v1/order", {"symbol": sym, "side": "SELL" if amt > 0 else "BUY", "type": "MARKET",
                                         "quantity": format(abs(amt), "f"), "reduceOnly": "true",
                                         "newOrderRespType": "RESULT"})
    return True                                        # vị thế còn → Bookmap đóng bằng lệnh Market


def fill_avg(sym, side, t0):
    """Giá khớp trung bình thật từ lịch sử khớp (demo đôi khi trả avgPrice = 0)."""
    for _ in range(3):
        L = [x for x in req("GET", "/fapi/v1/userTrades", {"symbol": sym, "startTime": t0, "limit": 50}) if x["side"] == side]
        if L:
            return sum(float(x["price"]) * float(x["qty"]) for x in L) / sum(float(x["qty"]) for x in L)
        time.sleep(0.7)
    return None


def do_open(b):
    sym, buy = str(b["sym"]), b["dir"] > 0
    inf = sym_info(sym)
    if position(sym) != 0:
        return {"ok": False, "msg": f"đã có vị thế {sym}, bỏ qua"}
    qty = rnd(float(b["qty"]), inf["step"], floor=True)
    if float(qty) < inf["minQty"] or float(qty) * float(b["entry"]) < inf["minNot"]:
        return {"ok": False, "msg": f"khối lượng {qty} dưới mức tối thiểu của sàn ({inf['minNot']:g}$)"}
    try:
        req("POST", "/fapi/v1/leverage", {"symbol": sym, "leverage": max(1, min(50, round(b.get("lev") or 20)))})
    except BinanceError as e:
        log(f"  (đặt đòn bẩy: {e})")
    t0 = int(time.time() * 1000) - 2000
    od = req("POST", "/fapi/v1/order", {"symbol": sym, "side": "BUY" if buy else "SELL", "type": "MARKET",
                                         "quantity": qty, "newOrderRespType": "RESULT"})
    avg = float(od.get("avgPrice") or 0)
    if not avg:
        try:
            avg = fill_avg(sym, "BUY" if buy else "SELL", t0) or 0
        except BinanceError:
            avg = 0
    back = "SELL" if buy else "BUY"
    try:
        for typ, px in (("STOP_MARKET", b["sl"]), ("TAKE_PROFIT_MARKET", b["tp"])):
            req("POST", "/fapi/v1/algoOrder", {"algoType": "CONDITIONAL", "symbol": sym, "side": back, "type": typ,
                                                "triggerPrice": rnd(float(px), inf["tick"]), "closePosition": "true",
                                                "workingType": "CONTRACT_PRICE"})
    except BinanceError as e:                          # không có SL/TP thì đóng ngay, không để vị thế trần
        try:
            flat(sym)
        except BinanceError:
            pass
        return {"ok": False, "msg": f"không đặt được SL/TP nên đã đóng lại: {e}"}
    state["own"][sym] = {"key": b["key"], "t": t0, "side": "BUY" if buy else "SELL"}
    return {"ok": True, "msg": f"khớp {qty} @ {avg:g}" if avg else f"khớp {qty} (chưa đọc được giá khớp)",
            "avg": avg or None, "qty": float(qty)}


def result(sym, own):
    """Lời/lỗ thật của vị thế từ lịch sử khớp lệnh: giá vào, giá thoát, phí, lời/lỗ ròng (USDT)."""
    tr = req("GET", "/fapi/v1/userTrades", {"symbol": sym, "startTime": own["t"], "limit": 100})
    ent = [x for x in tr if x["side"] == own["side"]]
    ex = [x for x in tr if x["side"] != own["side"]]
    avg = lambda L: sum(float(x["price"]) * float(x["qty"]) for x in L) / sum(float(x["qty"]) for x in L) if L else None
    fee = sum(float(x["commission"]) for x in tr if x.get("commissionAsset") == "USDT")
    gross = sum(float(x["realizedPnl"]) for x in tr)
    return {"entry": avg(ent), "exit": avg(ex), "fee": round(fee, 4), "pnl": round(gross - fee, 4)}


def do_close(b):
    sym = str(b["sym"])
    own = state["own"].get(sym)
    if not isinstance(own, dict) or own.get("key") != b["key"]:
        return {"ok": True, "msg": "không phải vị thế của lệnh này"}
    by_us = flat(sym)
    state["own"].pop(sym, None)
    r = {"ok": True, "by": "bookmap" if by_us else "san", "msg": "Bookmap đóng bằng lệnh Market" if by_us else "vị thế đã đóng bởi SL/TP trên sàn"}
    for _ in range(3):                                 # lệnh vừa khớp có thể chưa kịp vào lịch sử
        try:
            res = result(sym, own)
            if res["exit"] is not None:
                r.update(res)
                r["msg"] += f" · thoát {res['exit']:g} · lời/lỗ {res['pnl']:+.2f} USDT (phí {res['fee']:.2f})"
                break
        except BinanceError as e:
            r["msg"] += f" · (chưa đọc được lời/lỗ: {e})"
            break
        time.sleep(1)
    return r


def handle(b):
    act, key = b.get("act"), str(b.get("key", ""))
    if act == "ping":
        bal = next((x["balance"] for x in req("GET", "/fapi/v3/balance") if x["asset"] == "USDT"), "?")
        if b.get("from"):
            log("Bookmap đã nối tới — sẵn sàng vào lệnh")
        return {"ok": True, "msg": f"Binance demo OK · số dư {float(bal):,.2f} USDT"}
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
    try:
        mode = req("GET", "/fapi/v1/positionSide/dual").get("dualSidePosition")
        if mode:
            req("POST", "/fapi/v1/positionSide/dual", {"dualSidePosition": "false"})
            print("Đã chuyển tài khoản demo sang chế độ vị thế một chiều.")
    except BinanceError as e:
        print("⚠ Không kiểm tra được chế độ vị thế:", e)
    print(f"Đang chờ tín hiệu từ Bookmap ở http://127.0.0.1:{PORT} — để cửa sổ này mở. Ctrl+C để dừng.")
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
