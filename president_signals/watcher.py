"""Always-on watcher: no AI, polls every minute, writes alerts for Claude to review.

Sources
  every minute     presidential posts (trumpstruth.org archive of Truth Social)
                   price snapshot of oil, the market, volatility and watchlist stocks
  rotating ~1/min  Google News searches (Iran, Hormuz, oil, OPEC, tariffs, Fed, ...)
  every 5 minutes  White House presidential actions

It writes one JSON line per alert to paper/alerts.jsonl and a heartbeat to
paper/watcher.heartbeat. Start it detached:
    nohup python3 president_signals/watcher.py > president_signals/paper/watcher.log 2>&1 &
"""

from __future__ import annotations

import json
import re
import time
import traceback
from datetime import datetime
from pathlib import Path

import requests

import monitor as m

PAPER = m.PAPER
ALERTS = PAPER / "alerts.jsonl"
HEARTBEAT = PAPER / "watcher.heartbeat"
SEEN = PAPER / "watcher_seen.json"

NEWS_QUERIES = ["Trump Truth Social post", "Iran", "Strait of Hormuz", "oil prices", "OPEC", "Trump tariff",
                "Federal Reserve", "sanctions", "Trump announces", "stock market breaking"]

# 15-minute move that counts as a shock, by symbol
PRICE_THRESH = {"CL=F": 0.015, "BZ=F": 0.015, "USO": 0.015, "XLE": 0.012, "SPY": 0.008,
                "QQQ": 0.010, "^VIX": 0.10, "GLD": 0.010, "NVDA": 0.025, "LMT": 0.02}
PRICE_COOLDOWN = 30 * 60
MAX_AGE_HOURS = 3
POST_MAX_AGE_HOURS = 24   # posts read late after an outage still count

STRONG = ["strike", "strikes", "attack", "missile", "drone", "hormuz", "closes", "closure", "closed",
          "blockade", "ceasefire", "cease-fire", "truce", "deal", "agreement", "tariff", "sanction",
          "opec", "cut", "explosion", "seized", "tanker", "invade", "nuclear", "emergency",
          "rate cut", "rate hike", "resign", "fired", "ban", "executive order", "halt", "suspend"]
COMPANY_HINT = re.compile(r"\b([A-Z][a-zA-Z&]+ (?:Inc|Corp|Corporation|Company)|[A-Z]{2,}[a-z]*)\b")


def load_seen() -> dict:
    if SEEN.exists():
        return json.loads(SEEN.read_text())
    return {"ids": [], "titles": [], "price_last": {}}


def save_seen(s: dict) -> None:
    s["ids"] = s["ids"][-5000:]
    s["titles"] = s["titles"][-3000:]
    SEEN.write_text(json.dumps(s))


def norm(title: str) -> str:
    t = re.sub(r"\s+-\s+[^-]+$", "", title.lower())          # drop " - Publisher"
    return " ".join(re.findall(r"[a-z0-9]+", t)[:10])


def score(text: str) -> int:
    t = text.lower()
    return sum(1 for w in STRONG if w in t)


def alert(kind: str, **kw) -> None:
    row = {"time": m.now_et().isoformat(timespec="seconds"), "kind": kind, **kw}
    with ALERTS.open("a") as f:
        f.write(json.dumps(row) + "\n")
    print("ALERT", json.dumps(row)[:300], flush=True)


def check_feed(seen, url, kind, first, min_score):
    for it in m.fetch_feed(url):
        if it["id"] in seen["ids"]:
            continue
        seen["ids"].append(it["id"])
        key = norm(it["title"])
        dup = key in seen["titles"]
        seen["titles"].append(key)
        if first or dup:
            continue
        # search results mix in old stories; only act on fresh ones
        max_age = POST_MAX_AGE_HOURS if kind == "post" else MAX_AGE_HOURS
        if it["when"] is None or (m.now_et() - it["when"]).total_seconds() > max_age * 3600:
            continue
        text = it["text"] if kind == "post" else it["title"]
        s = score(text)
        if kind == "post":
            # skip media-only posts and reposts with no words of his own
            if len(re.sub(r"https?://\S+|RT:", "", text).strip()) < 25:
                continue
            s += 1
        if s >= min_score:
            alert(kind, score=s, text=text[:600], link=it["link"],
                  published=it["when"].isoformat() if it["when"] else None)


def check_prices(seen, first):
    import yfinance as yf
    syms = list(PRICE_THRESH)
    df = yf.download(syms, period="1d", interval="1m", progress=False, auto_adjust=False,
                     prepost=True)
    if df is None or df.empty:
        return
    close = df["Close"]
    now = time.time()
    for s in syms:
        if s not in close:
            continue
        col = close[s].dropna()
        if len(col) < 18:
            continue
        # stock and ETF prints outside regular hours are thin and often bad; futures trade all night
        if not s.endswith("=F") and m.market_session(m.now_et()) != "open":
            continue
        # median of 3 bars at each end, so one bad print can't fake a move
        last, ago = float(col.iloc[-3:].median()), float(col.iloc[-18:-15].median())
        chg = last / ago - 1
        if abs(chg) >= PRICE_THRESH[s] and now - seen["price_last"].get(s, 0) > PRICE_COOLDOWN:
            seen["price_last"][s] = now
            if not first:
                alert("price", symbol=s, move_15m=round(chg, 4), last=round(last, 2),
                      as_of=str(col.index[-1]))


def main():
    PAPER.mkdir(parents=True, exist_ok=True)
    seen = load_seen()
    first = not seen["ids"]
    tick = 0
    while True:
        def guarded(fn, *args):
            try:
                fn(*args)
            except (requests.HTTPError, requests.Timeout, requests.ConnectionError) as e:
                # rate limits, timeouts and outages: skip this source this minute
                print(f"{m.now_et():%H:%M} {type(e).__name__}: {str(e)[:160]}", flush=True)
            except Exception:
                traceback.print_exc()

        guarded(check_feed, seen, m.FEEDS["post"], "post", first, 1)
        queries = NEWS_QUERIES if first else [NEWS_QUERIES[tick % len(NEWS_QUERIES)]]
        for q in queries:
            guarded(check_feed, seen, m.NEWS_QUERY.format(q=requests.utils.quote(q + " when:1d")),
                    f"news:{q}", first, 2)
        if first or tick % 5 == 0:
            guarded(check_feed, seen, m.FEEDS["white_house"], "white_house", first, 1)
        guarded(check_prices, seen, first)
        first = False  # the first pass only marks what already exists as seen
        save_seen(seen)
        HEARTBEAT.write_text(m.now_et().isoformat(timespec="seconds"))
        tick += 1
        time.sleep(60)


if __name__ == "__main__":
    main()
