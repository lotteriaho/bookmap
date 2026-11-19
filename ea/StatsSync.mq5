//+------------------------------------------------------------------+
//| StatsSync.mq5                                                    |
//| Gửi lịch sử lệnh + số dư lên Google Sheet (Apps Script) để trang  |
//| thống kê đọc. KHÔNG vào lệnh, không sửa lệnh nào.                 |
//|                                                                  |
//| Cài: gắn lên 1 chart bất kỳ (vd XAUUSDc M15), điền InpUrl, InpKey.|
//| Tools > Options > Expert Advisors > Allow WebRequest, thêm:       |
//|   https://script.google.com                                       |
//|   https://script.googleusercontent.com                            |
//| Gửi toàn bộ deal của tài khoản (cả nạp/rút) để tính số dư đúng;   |
//| trang web chỉ thống kê các magic của 3 bot.                       |
//| v1.00 (17/11/2026)                                                |
//| v1.01: InpAccount - nhieu tai khoan dung chung 1 Apps Script      |
//|        (Exness de "exness", FTMO de "ftmo").                      |
//| v1.02: gui kem so tai khoan; doi sang tai khoan moi (vd FTMO moi) |
//|        thi Sheet tu cat lich su cu sang tab rieng, khong tron.    |
//+------------------------------------------------------------------+
#property copyright "StatsSync"
#property version   "1.02"
#property description "Dong bo lich su lenh 3 bot len Google Sheet cho trang thong ke"

input string InpUrl      = "";   // Link Apps Script (.../exec)
input string InpKey      = "";   // Ma ghi (giong WRITE_KEY trong Script Properties)
input string InpAccount  = "exness"; // Ten tai khoan tren trang thong ke: exness / ftmo
input int    InpEverySec = 300;  // Gui moi N giay
input int    InpChunk    = 150;  // So deal moi lan gui

string GV = "StatsSync_last";   // + "_" + so tai khoan (dat trong Sync)
bool   g_warned = false;
bool   g_first = true;

string J(string s)
  {
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   return "\"" + s + "\"";
  }

int GmtOff()
  {
   long d = (long)(TimeTradeServer() - TimeGMT());
   return (int)(MathRound(d / 3600.0) * 3600);
  }

bool Post(string body)
  {
   char data[], res[];
   string hdr;
   int len = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8) - 1;
   ArrayResize(data, len);
   ResetLastError();
   int code = WebRequest("POST", InpUrl, "Content-Type: text/plain;charset=utf-8\r\n", 15000, data, res, hdr);
   if(code == -1)
     {
      int e = GetLastError();
      if(!g_warned)
        {
         Print("StatsSync: khong gui duoc, ma loi ", e,
               e == 4014 ? " -> them https://script.google.com va https://script.googleusercontent.com vao Tools > Options > Expert Advisors > WebRequest" : "");
         g_warned = true;
        }
      return false;
     }
   string txt = CharArrayToString(res, 0, WHOLE_ARRAY, CP_UTF8);
   if(code == 200 && StringFind(txt, "\"ok\":false") >= 0) { Print("StatsSync: Apps Script tu choi: ", txt); return false; }
   if(code != 200 && code != 302) { Print("StatsSync: HTTP ", code, " ", StringSubstr(txt, 0, 200)); return false; }
   return true;
  }

string DealJson(ulong d)
  {
   return StringFormat("[%I64u,%I64d,%d,%d,%I64d,%I64d,%s,%.2f,%s,%.2f,%.2f,%.2f,%.2f,%d]",
                       d,
                       (long)HistoryDealGetInteger(d, DEAL_TIME),
                       (int)HistoryDealGetInteger(d, DEAL_TYPE),
                       (int)HistoryDealGetInteger(d, DEAL_ENTRY),
                       (long)HistoryDealGetInteger(d, DEAL_MAGIC),
                       (long)HistoryDealGetInteger(d, DEAL_POSITION_ID),
                       J(HistoryDealGetString(d, DEAL_SYMBOL)),
                       HistoryDealGetDouble(d, DEAL_VOLUME),
                       DoubleToString(HistoryDealGetDouble(d, DEAL_PRICE), 5),
                       HistoryDealGetDouble(d, DEAL_PROFIT),
                       HistoryDealGetDouble(d, DEAL_SWAP),
                       HistoryDealGetDouble(d, DEAL_COMMISSION),
                       HistoryDealGetDouble(d, DEAL_FEE),
                       (int)HistoryDealGetInteger(d, DEAL_REASON));
  }

string SnapJson()
  {
   string pos = "";
   for(int i = 0; i < PositionsTotal(); i++)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if(pos != "") pos += ",";
      pos += StringFormat("[%I64u,%I64d,%s,%d,%.2f,%s,%s,%.2f,%I64d]",
                          t, PositionGetInteger(POSITION_MAGIC), J(PositionGetString(POSITION_SYMBOL)),
                          (int)PositionGetInteger(POSITION_TYPE), PositionGetDouble(POSITION_VOLUME),
                          DoubleToString(PositionGetDouble(POSITION_PRICE_OPEN), 5), DoubleToString(PositionGetDouble(POSITION_SL), 5),
                          PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP),
                          (long)PositionGetInteger(POSITION_TIME));
     }
   return StringFormat("{\"bal\":%.2f,\"eq\":%.2f,\"cur\":%s,\"off\":%d,\"real\":%s,\"st\":%I64d,\"pos\":[%s]}",
                       AccountInfoDouble(ACCOUNT_BALANCE), AccountInfoDouble(ACCOUNT_EQUITY),
                       J(AccountInfoString(ACCOUNT_CURRENCY)), GmtOff(),
                       (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_REAL ? "true" : "false",
                       (long)TimeTradeServer(), pos);
  }

void Sync()
  {
   if(InpUrl == "" || InpKey == "") { if(!g_warned) { Print("StatsSync: chua dien InpUrl / InpKey"); g_warned = true; } return; }
   if(MQLInfoInteger(MQL_TESTER)) return;
   GV = "StatsSync_last_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
   datetime last = GlobalVariableCheck(GV) ? (datetime)GlobalVariableGet(GV) : 0;
   datetime from = last > 0 ? last - 3 * 86400 : 0;   // gui lai 3 ngay gan nhat cho chac, server tu bo trung
   datetime now = TimeCurrent();
   if(!HistorySelect(from, now + 86400)) return;
   int n = HistoryDealsTotal();
   string arr = "";
   int cnt = 0;
   bool ok = true;
   for(int i = 0; i < n; i++)
     {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0) continue;
      if(arr != "") arr += ",";
      arr += DealJson(d);
      cnt++;
      if(cnt >= InpChunk)
        {
         ok = ok && Post("{\"act\":\"push\",\"acc\":" + J(InpAccount) + ",\"login\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ",\"key\":" + J(InpKey) + ",\"deals\":[" + arr + "]}");
         arr = ""; cnt = 0;
         if(!ok) break;
        }
     }
   if(ok)
      ok = Post("{\"act\":\"push\",\"acc\":" + J(InpAccount) + ",\"login\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ",\"key\":" + J(InpKey) + ",\"deals\":[" + arr + "],\"snap\":" + SnapJson() + "}");
   if(ok)
     {
      GlobalVariableSet(GV, (double)now);
      if(g_first) Print("StatsSync: da gui ", n, " deal tu ", from == 0 ? "dau tai khoan" : TimeToString(from));
      g_first = false;
      g_warned = false;
     }
  }

int OnInit()
  {
   Print("StatsSync v1.02 [", InpAccount, "]: gui moi ", InpEverySec, " giay. Khong vao lenh.");
   EventSetTimer(5);   // lan dau gui sau 5 giay
   return INIT_SUCCEEDED;
  }

void OnTimer()
  {
   Sync();
   EventKillTimer();
   EventSetTimer(MathMax(60, InpEverySec));
  }

void OnDeinit(const int reason) { EventKillTimer(); }
void OnTick() {}
//+------------------------------------------------------------------+
