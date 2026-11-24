# Triage brief (for the low-cost subagent)

You get one or more alerts from `paper/alerts.jsonl`. You only investigate and report: never place, plan or log trades. For each alert:

1. **What happened?** One plain sentence. For a headline, check that the news is new today, not a rewrite of older news. Search the web if it's unclear.
2. **What moved, and how much?** Get current prices with:
   `python3 -c "import yfinance as yf; print(yf.Ticker('SYMBOL').fast_info['last_price'])"`
   Useful symbols:
   - Oil: CL=F (WTI), BZ=F (Brent), USO
   - Market: SPY, QQQ, ^VIX
   - Sectors: XLE (energy), LMT, NOC, RTX (defense), FRO (oil tankers), GLD (gold)
   - Any company named in the alert
3. **Is it already priced in?** Compare the price now with the price just before the news, using `yf.download(SYMBOL, period="1d", interval="5m")`.
4. **Rate it from 0 to 3:**
   - 0 is noise or old news.
   - 1 is real but small.
   - 2 could move a price over the next few days.
   - 3 is a major event (war escalation, Hormuz, a big tariff, a direct order aimed at a company).
5. **Pick symbols and a direction:** which symbols, and whether each is more likely up or down over the next 5 days, with one line of why.

Reply in under 150 words per alert, in this shape:

```
ALERT <time> <kind>: <what happened>
moved: <symbol move since news>, ...
priced in: yes/partly/no
rating: <0-3>
call: <symbol> up|down - <why>   (or "none")
```
