"""Live monitor + $1,000 paper-trading account for presidential-post signals.

Nothing here touches real money. Fills use live Yahoo Finance option quotes:
buys fill at the ask, sells at the bid, plus $0.65 per contract, so results
are not flattered. Yahoo quotes can lag the market by up to ~15 minutes.

Commands
  scan                       new presidential posts, White House actions, headlines
  quote TICKER call|put      affordable contracts that pass the liquidity rules
  buy SYMBOL QTY --reason .. open a paper position (checks the risk rules)
  sell SYMBOL --reason ..    close a paper position at the bid
  decide --source .. --action .. --reason ..   log a decision, including "no trade"
  score                      grade direction calls after 1 and 5 trading days
  mark                       value open positions, flag exits; --auto-exit closes them
  status                     cash, positions, P&L
  dashboard                  write paper/dashboard.html
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

HERE = Path(__file__).resolve().parent
PAPER = HERE / "paper"
STATE = PAPER / "state.json"
TRADES = PAPER / "trades.jsonl"
DECISIONS = PAPER / "decisions.jsonl"
ET_TZ = ZoneInfo("America/New_York")
UA = {"User-Agent": "Mozilla/5.0 (paper-trading research monitor)"}

# ---- risk rules (also written out in RULES.md) ----
START_CASH = 1000.00
# Limits as changed Wed Nov 25, 2026 for the Christmas target (see RULES.md Changes); old values in comments
MAX_PER_TRADE = 350.00        # was 250
MAX_OPEN = 3
FEE = 0.65                    # per contract, each side
MIN_DAYS, MAX_DAYS = 14, 60   # days to expiry when opening
MIN_OI = 100
MAX_SPREAD = 0.15             # (ask - bid) / mid
MAX_IV = 1.00                 # no new trade above 100% implied volatility
TAKE_PROFIT = 1.00            # +100% on premium (was +60%)
STOP_LOSS = -0.50             # -50% on premium
MAX_HOLD_DAYS = 30            # calendar days (was 7); everything closes by HARD_EXIT anyway
HARD_EXIT = datetime(2026, 12, 23).date()
QUICK_MAX = 200.00
INDEX_ETFS = {"SPY", "QQQ", "IWM", "DIA"}   # index call debit spreads may skip the premium stop   # close all positions from this day: the Christmas target
EXIT_BEFORE_EXPIRY = 5        # close when this few days remain

FEEDS = {
    "post": "https://www.trumpstruth.org/feed",
    "white_house": "https://www.whitehouse.gov/presidential-actions/feed/",
}
NEWS_QUERY = "https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"


# ---------- storage ----------

def now_et() -> datetime:
    return datetime.now(ET_TZ)


def load_state() -> dict:
    if STATE.exists():
        return json.loads(STATE.read_text())
    return {"cash": START_CASH, "positions": {}, "seen": [], "realized": 0.0,
            "started": now_et().isoformat(timespec="seconds")}


def save_state(s: dict) -> None:
    PAPER.mkdir(parents=True, exist_ok=True)
    s["seen"] = s["seen"][-3000:]
    STATE.write_text(json.dumps(s, indent=2))


def append(path: Path, row: dict) -> None:
    PAPER.mkdir(parents=True, exist_ok=True)
    with path.open("a") as f:
        f.write(json.dumps(row) + "\n")


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


# ---------- feeds ----------

def strip_html(s: str) -> str:
    s = re.sub(r"<br\s*/?>", " ", s or "")
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


def fetch_feed(url: str) -> list[dict]:
    r = requests.get(url, headers=UA, timeout=15)
    r.raise_for_status()
    root = ET.fromstring(r.content)
    items = []
    for it in root.iter("item"):
        get = lambda tag: (it.findtext(tag) or "").strip()
        pub = get("pubDate")
        try:
            # RFC 2822 dates; Google News writes "GMT", which strptime's %z rejects
            when = parsedate_to_datetime(pub).astimezone(ET_TZ)
        except (TypeError, ValueError):
            when = None
        text = strip_html(get("description")) or get("title")
        items.append({"id": get("guid") or get("link"), "title": get("title"),
                      "text": text, "link": get("link"), "when": when})
    return items


def cmd_scan(a):
    s = load_state()
    seen = set(s["seen"])
    found = []
    for kind, url in FEEDS.items():
        try:
            items = fetch_feed(url)
        except Exception as e:  # keep going if one source is down
            print(f"! {kind} feed failed: {e}")
            continue
        for it in items:
            if it["id"] in seen:
                continue
            seen.add(it["id"])
            s["seen"].append(it["id"])
            if a.first_run:
                continue
            found.append((kind, it))
    for q in a.news:
        try:
            for it in fetch_feed(NEWS_QUERY.format(q=requests.utils.quote(q)))[:15]:
                if it["id"] in seen:
                    continue
                seen.add(it["id"])
                s["seen"].append(it["id"])
                if not a.first_run:
                    found.append((f"news:{q}", it))
        except Exception as e:
            print(f"! news '{q}' failed: {e}")
    save_state(s)
    if a.first_run:
        print("Marked current items as seen. Next scan shows only new ones.")
        return
    found.sort(key=lambda x: x[1]["when"] or now_et())
    print(f"{len(found)} new item(s) as of {now_et():%Y-%m-%d %H:%M %Z}")
    for kind, it in found:
        when = it["when"].strftime("%a %m-%d %H:%M ET") if it["when"] else "?"
        body = it["text"] if kind == "post" else it["title"]
        if kind == "post" and not body.strip():
            body = it["title"]
        print(f"\n[{kind}] {when}  {it['link']}\n  {body[:700]}")


# ---------- quotes ----------

def market_session(t: datetime) -> str:
    if t.weekday() >= 5:
        return "closed"
    m = t.hour * 60 + t.minute
    return "open" if 9 * 60 + 30 <= m < 16 * 60 else "closed"


def chain(ticker: str):
    import yfinance as yf
    return yf.Ticker(ticker)


def contract_quote(symbol: str) -> dict:
    """Look up one contract by OCC symbol, e.g. NVDA261218C00170000, or a debit spread written
    LONG/SHORT (same ticker, type and expiry). A spread is priced at what it would really fill at:
    bought at long ask minus short bid, sold at long bid minus short ask."""
    if "/" in symbol:
        lo, sh = (contract_quote(x) for x in symbol.split("/"))
        if (lo["ticker"], lo["type"], lo["expiry"]) != (sh["ticker"], sh["type"], sh["expiry"]):
            raise SystemExit("Spread legs must share ticker, type and expiry")
        leg_ok = all(q["bid"] > 0 and (q["ask"] - q["bid"]) / ((q["ask"] + q["bid"]) / 2) <= MAX_SPREAD
                     for q in (lo, sh))
        return {"symbol": symbol, "ticker": lo["ticker"], "type": lo["type"] + " spread",
                "strike": lo["strike"], "short_strike": sh["strike"], "expiry": lo["expiry"],
                "bid": round(max(lo["bid"] - sh["ask"], 0), 2), "ask": round(lo["ask"] - sh["bid"], 2),
                "last": lo["last"] - sh["last"], "oi": min(lo["oi"], sh["oi"]), "iv": lo["iv"],
                "spot": lo["spot"], "legs": 2, "legs_liquid": leg_ok,
                "max_value": abs(sh["strike"] - lo["strike"])}
    m = re.match(r"^([A-Z.]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$", symbol)
    if not m:
        raise SystemExit(f"Not an option symbol: {symbol}")
    tk, yy, mm, dd, cp, k = m.groups()
    expiry = f"20{yy}-{mm}-{dd}"
    import time
    for attempt in range(4):
        t = chain(tk)
        try:
            ch = t.option_chain(expiry)
            break
        except ValueError:
            # a rate-limited Yahoo response comes back with no expiries at all; wait and ask again
            if attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))
    df = ch.calls if cp == "C" else ch.puts
    row = df[df["contractSymbol"] == symbol]
    if row.empty:
        raise SystemExit(f"{symbol} not found in chain")
    r = row.iloc[0]
    spot = float(t.fast_info["last_price"])
    return {"symbol": symbol, "ticker": tk, "type": "call" if cp == "C" else "put",
            "strike": float(r.strike), "expiry": expiry, "bid": float(r.bid or 0),
            "ask": float(r.ask or 0), "last": float(r.lastPrice or 0),
            "oi": int(r.openInterest or 0), "iv": float(r.impliedVolatility or 0), "spot": spot, "legs": 1}


def cmd_quote(a):
    t = chain(a.ticker.upper())
    spot = float(t.fast_info["last_price"])
    today = now_et().date()
    print(f"{a.ticker.upper()} spot ${spot:.2f}. Contracts costing <= ${MAX_PER_TRADE:.0f} "
          f"that pass liquidity rules ({MIN_DAYS}-{MAX_DAYS} days):")
    shown = 0
    for exp in t.options:
        days = (datetime.strptime(exp, "%Y-%m-%d").date() - today).days
        if not MIN_DAYS <= days <= MAX_DAYS:
            continue
        ch = t.option_chain(exp)
        df = ch.calls if a.kind == "call" else ch.puts
        for r in df.itertuples():
            bid, ask = float(r.bid or 0), float(r.ask or 0)
            if ask <= 0 or bid <= 0:
                continue
            mid = (bid + ask) / 2
            cost = ask * 100 + FEE
            moneyness = (r.strike / spot - 1) * (1 if a.kind == "call" else -1)
            if (cost > MAX_PER_TRADE or (r.openInterest or 0) < MIN_OI
                    or (ask - bid) / mid > MAX_SPREAD or not -0.05 <= moneyness <= 0.25):
                continue
            print(f"  {r.contractSymbol}  exp {exp} ({days}d)  strike {r.strike:>8.2f} "
                  f"({moneyness:+.0%} OTM)  bid {bid:.2f} ask {ask:.2f}  "
                  f"cost ${cost:.2f}  OI {int(r.openInterest)}  IV {r.impliedVolatility:.0%}")
            shown += 1
    if not shown:
        print("  none: every liquid contract costs more than the per-trade limit.")


# ---------- trading ----------

def cmd_buy(a):
    s = load_state()
    if a.symbol in s["positions"]:
        raise SystemExit("Already holding this contract.")
    if sum(not p.get("quick") for p in s["positions"].values()) >= MAX_OPEN and not getattr(a, "quick", False):
        raise SystemExit(f"Rule: max {MAX_OPEN} open positions.")
    if market_session(now_et()) != "open" and not a.force:
        raise SystemExit("Market is closed; option quotes are stale. Wait for the open.")
    q = contract_quote(a.symbol)
    days = (datetime.strptime(q["expiry"], "%Y-%m-%d").date() - now_et().date()).days
    mid = (q["bid"] + q["ask"]) / 2
    problems = []
    quick = getattr(a, "quick", False)
    if quick:
        # H5 quick trades (RULES.md Nov 25 12:50): SPY/QQQ, 1-7 calendar days, $200 cap, one at a time
        if q["ticker"] not in {"SPY", "QQQ"} or not 1 <= days <= 7:
            problems.append("quick trades: SPY/QQQ expiring in 1-7 days only")
        if a.qty * (q["ask"] * 100 + FEE * q["legs"]) > QUICK_MAX:
            problems.append(f"quick trade cost over ${QUICK_MAX:.0f}")
        if any(p.get("quick") for p in s["positions"].values()):
            problems.append("a quick trade is already open")
    elif not MIN_DAYS <= days <= MAX_DAYS:
        problems.append(f"expiry {days}d outside {MIN_DAYS}-{MAX_DAYS}")
    if q["oi"] < MIN_OI:
        problems.append(f"open interest {q['oi']} < {MIN_OI}")
    if q["legs"] == 2:
        if not q["legs_liquid"]:
            problems.append("a spread leg's bid/ask spread is too wide")
    elif q["bid"] <= 0 or (q["ask"] - q["bid"]) / mid > MAX_SPREAD:
        problems.append("bid/ask spread too wide")
    if q["iv"] > MAX_IV:
        problems.append(f"implied volatility {q['iv']:.0%} > {MAX_IV:.0%}")
    cost = a.qty * (q["ask"] * 100 + FEE * q["legs"])
    if cost > MAX_PER_TRADE:
        problems.append(f"cost ${cost:.2f} > ${MAX_PER_TRADE:.0f} limit")
    if cost > s["cash"]:
        problems.append(f"cost ${cost:.2f} > cash ${s['cash']:.2f}")
    if getattr(a, "no_stop", False) and not (q["legs"] == 2 and q["type"] == "call spread" and q["ticker"] in INDEX_ETFS):
        problems.append("--no-stop is allowed only on index call debit spreads")
    if problems:
        raise SystemExit("Rejected by risk rules: " + "; ".join(problems))
    s["cash"] -= cost
    s["positions"][a.symbol] = {**q, "qty": a.qty, "entry": q["ask"], "cost": cost,
                                "stop": None if (getattr(a, "no_stop", False) or getattr(a, "quick", False)) else STOP_LOSS,
                                "quick": getattr(a, "quick", False),
                                "opened": now_et().isoformat(timespec="seconds"),
                                "reason": a.reason}
    save_state(s)
    append(TRADES, {"time": now_et().isoformat(timespec="seconds"), "side": "BUY",
                    "symbol": a.symbol, "qty": a.qty, "price": q["ask"], "cash_flow": -cost,
                    "spot": q["spot"], "iv": q["iv"], "reason": a.reason})
    print(f"BOUGHT {a.qty} {a.symbol} @ {q['ask']:.2f} (spot {q['spot']:.2f}, IV {q['iv']:.0%}). "
          f"Cost ${cost:.2f}. Cash left ${s['cash']:.2f}")


def close(s, symbol, reason, quote=None):
    p = s["positions"][symbol]
    q = quote or contract_quote(symbol)
    proceeds = p["qty"] * (q["bid"] * 100 - FEE * p.get("legs", 1))
    pnl = proceeds - p["cost"]
    s["cash"] += proceeds
    s["realized"] += pnl
    del s["positions"][symbol]
    append(TRADES, {"time": now_et().isoformat(timespec="seconds"), "side": "SELL",
                    "symbol": symbol, "qty": p["qty"], "price": q["bid"], "cash_flow": proceeds,
                    "pnl": pnl, "pnl_pct": pnl / p["cost"], "spot": q["spot"], "reason": reason})
    print(f"SOLD {p['qty']} {symbol} @ {q['bid']:.2f}. P&L ${pnl:+.2f} ({pnl / p['cost']:+.0%})")


def cmd_sell(a):
    s = load_state()
    if a.symbol not in s["positions"]:
        raise SystemExit("Not holding that contract.")
    close(s, a.symbol, a.reason)
    save_state(s)


def spot_price(sym: str) -> float:
    return float(chain(sym).fast_info["last_price"])


def cmd_decide(a):
    row = {"time": now_et().isoformat(timespec="seconds"), "source": a.source,
           "action": a.action, "ticker": a.ticker, "reason": a.reason}
    if a.predict:
        sym = a.predict_symbol or a.ticker
        row.update({"predict": a.predict, "predict_symbol": sym, "spot": spot_price(sym)})
    append(DECISIONS, row)
    print("Logged:", row)


def cmd_score(a):
    """Score direction calls 1 and 5 trading days after they were made, using daily closes."""
    import yfinance as yf
    rows = read_jsonl(DECISIONS)
    changed = False
    for r in rows:
        if not r.get("predict") or ("ret_5d" in r):
            continue
        made = datetime.fromisoformat(r["time"])
        df = yf.download(r["predict_symbol"], start=made.date().isoformat(), progress=False,
                         auto_adjust=False, multi_level_index=False)
        if df is None or df.empty:
            continue
        closes = df["Close"].dropna()
        # only finished days count: today's bar is still moving until the 4pm close (futures trade on past it,
        # so 5pm gives settlement time); grading on it marked Brent's 1-day call early at 2am
        now = now_et()
        closes = closes[[d.date() < now.date() or (d.date() == now.date() and now.hour >= 17) for d in closes.index]]
        # first close strictly after the call (a call made after 4pm counts from the next day)
        after = closes[[d.date() > made.date() or (d.date() == made.date() and made.hour < 16)
                        for d in closes.index]]
        sign = 1 if r["predict"] == "up" else -1
        for n, key in [(1, "ret_1d"), (5, "ret_5d")]:
            if key not in r and len(after) >= n + (1 if made.hour < 16 and made.weekday() < 5 else 0):
                px = float(after.iloc[n - 1 + (1 if made.hour < 16 and made.weekday() < 5 else 0)])
                ret = px / r["spot"] - 1
                r[key], r[key.replace("ret", "hit")] = ret, bool(ret * sign > 0)
                changed = True
    if changed:
        DECISIONS.write_text("".join(json.dumps(r) + "\n" for r in rows))
    calls = [r for r in rows if r.get("predict")]
    for key in ["hit_1d", "hit_5d"]:
        done = [r[key] for r in calls if key in r]
        if done:
            print(f"{key}: {sum(done)}/{len(done)} correct ({sum(done) / len(done):.0%})")
    print(f"{len(calls)} direction calls logged, {sum('ret_5d' not in r for r in calls)} still open")


def cmd_mark(a):
    s = load_state()
    today = now_et().date()
    total = s["cash"]
    print(f"Marks as of {now_et():%Y-%m-%d %H:%M %Z} (market {market_session(now_et())})")
    for sym in list(s["positions"]):
        p = s["positions"][sym]
        q = contract_quote(sym)
        value = p["qty"] * q["bid"] * 100
        ret = (value - p["qty"] * FEE * p.get("legs", 1)) / p["cost"] - 1
        held = (today - datetime.fromisoformat(p["opened"]).date()).days
        left = (datetime.strptime(p["expiry"], "%Y-%m-%d").date() - today).days
        why = []
        if ret >= TAKE_PROFIT:
            why.append(f"take profit ({ret:+.0%})")
        elif p.get("max_value") and q["bid"] >= 0.8 * p["max_value"]:
            # a spread can't gain more than its width, so take it once 80% of that is in hand
            why.append(f"spread at {q['bid'] / p['max_value']:.0%} of max value")
        stop = p.get("stop", STOP_LOSS)
        if stop is not None and ret <= stop:
            why.append(f"stop loss ({ret:+.0%})")
        if held >= MAX_HOLD_DAYS:
            why.append(f"held {held}d")
        if today >= HARD_EXIT:
            why.append(f"target date {HARD_EXIT}")
        if (left <= 0 and now_et().hour >= 15) if p.get("quick") else left <= EXIT_BEFORE_EXPIRY:
            why.append(f"{left}d to expiry")
        print(f"  {sym}: bid {q['bid']:.2f} (paid {p['entry']:.2f}), spot {q['spot']:.2f}, "
              f"value ${value:.2f}, {ret:+.0%}" + (f"  -> EXIT: {', '.join(why)}" if why else ""))
        if why and a.auto_exit and market_session(now_et()) == "open":
            close(s, sym, "rule exit: " + ", ".join(why), q)
        else:
            total += value
            p["last_bid"], p["last_mark"] = q["bid"], now_et().isoformat(timespec="seconds")
    s["equity"] = total
    save_state(s)
    print(f"Equity ${total:.2f} (start ${START_CASH:.2f}, {total / START_CASH - 1:+.1%})")


def cmd_status(a):
    s = load_state()
    eq = s.get("equity", s["cash"])
    print(f"Cash ${s['cash']:.2f}  Equity (last mark) ${eq:.2f}  Realized P&L ${s['realized']:+.2f}  "
          f"Return {eq / START_CASH - 1:+.1%}")
    for sym, p in s["positions"].items():
        print(f"  {sym} x{p['qty']} paid {p['entry']:.2f} on {p['opened'][:16]} - {p['reason']}")
    closed = [t for t in read_jsonl(TRADES) if t["side"] == "SELL"]
    if closed:
        wins = sum(t["pnl"] > 0 for t in closed)
        print(f"Closed trades: {len(closed)}, winners {wins} ({wins / len(closed):.0%})")


# ---------- dashboard ----------

def cmd_dashboard(a):
    s = load_state()
    data = {"state": {k: v for k, v in s.items() if k != "seen"},
            "trades": read_jsonl(TRADES), "decisions": read_jsonl(DECISIONS)[-200:],
            "updated": now_et().strftime("%a %b %d, %Y %I:%M %p ET"),
            "heartbeat": (PAPER / "watcher.heartbeat").read_text().strip() if (PAPER / "watcher.heartbeat").exists() else None,
            "alerts_today": sum(1 for r in read_jsonl(PAPER / "alerts.jsonl") if r["time"][:10] == now_et().date().isoformat()),
            "rules": {"start": START_CASH, "max_trade": MAX_PER_TRADE, "max_open": MAX_OPEN,
                      "tp": TAKE_PROFIT, "sl": STOP_LOSS, "hold": MAX_HOLD_DAYS}}
    tpl = (HERE / "dashboard_template.html").read_text()
    out = PAPER / "dashboard.html"
    out.write_text(tpl.replace("__DATA__", json.dumps(data)))
    print(f"Wrote {out}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("scan"); p.add_argument("--first-run", action="store_true")
    p.add_argument("--news", nargs="*", default=["Trump stocks", "Trump tariff", "Trump company CEO"])
    p.set_defaults(f=cmd_scan)
    p = sub.add_parser("quote"); p.add_argument("ticker"); p.add_argument("kind", choices=["call", "put"])
    p.set_defaults(f=cmd_quote)
    p = sub.add_parser("buy"); p.add_argument("symbol"); p.add_argument("qty", type=int)
    p.add_argument("--quick", action="store_true", help="H5 quick trade: SPY/QQQ, 1-7 days, $200 cap")
    p.add_argument("--no-stop", action="store_true",
                   help="index call debit spreads only (RULES.md, Nov 25 12:00): no premium stop, the debit is the max loss")
    p.add_argument("--reason", required=True); p.add_argument("--force", action="store_true")
    p.set_defaults(f=cmd_buy)
    p = sub.add_parser("sell"); p.add_argument("symbol"); p.add_argument("--reason", required=True)
    p.set_defaults(f=cmd_sell)
    p = sub.add_parser("decide"); p.add_argument("--source", required=True)
    p.add_argument("--action", required=True); p.add_argument("--ticker", default="")
    p.add_argument("--reason", required=True)
    p.add_argument("--predict", choices=["up", "down"], help="log a direction call to be scored later")
    p.add_argument("--predict-symbol", default="", help="symbol to score, if not --ticker (e.g. CL=F)")
    p.set_defaults(f=cmd_decide)
    sub.add_parser("score").set_defaults(f=cmd_score)
    p = sub.add_parser("mark"); p.add_argument("--auto-exit", action="store_true"); p.set_defaults(f=cmd_mark)
    sub.add_parser("status").set_defaults(f=cmd_status)
    sub.add_parser("dashboard").set_defaults(f=cmd_dashboard)
    a = ap.parse_args()
    a.f(a)


if __name__ == "__main__":
    main()
