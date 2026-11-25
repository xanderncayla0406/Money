# Paper-trading rules

Written on Mon Nov 23, 2026, before the first trade. These rules don't change mid-test. Any change gets its own dated entry at the bottom, so the record shows what was decided before the outcome was known.

## Account

- **Starting balance:** $1,000 of paper money. No real orders are placed.
- **Fill prices:** buys fill at the live ask and sells at the live bid. Each contract costs $0.65 to open and $0.65 to close. Yahoo quotes can lag the market by up to 15 minutes.
- **Instruments:** only buying calls or puts. The most any trade can lose is what was paid for it.

## Risk limits

| Rule | Limit |
|---|---|
| Spend per trade | $250 at most (25% of the starting balance) |
| Open positions | 3 at most |
| Expiry when opening | 14 to 60 days out |
| Liquidity | Open interest of at least 100, and a bid/ask spread no wider than 15% of the midpoint |
| Take profit | +60% on the premium paid |
| Stop loss | −50% on the premium paid |
| Time limit | Close after 7 calendar days, or when 5 days remain to expiry |
| Volatility | No new trade when implied volatility is above 100%. Options are too expensive then, and the price tends to collapse once the news passes. |

## What gets traded

The study in `README.md` found no edge in chasing a post once it's public. Most checks should therefore end in **no trade**. A trade needs one of these two setups.

**H1. Fade a company-specific overreaction.** This is the main hypothesis, and it's weak: in the study, 11 of 15 company moves reversed over the next 5 days.
- **Trigger:** a post names a single listed company, and the stock has already moved more than 5% against the S&P 500 in the direction the post implied.
- **Trade:** buy the opposite option (a put after a pop, a call after a drop), 14 to 45 days out, near the money.
- **Skip if:** the post comes with a hard fact rather than words alone, such as a signed order, a contract, a government stake or a board decision. Those moves don't revert the same way.

**H2. Act early on a market-wide policy post.** This is a secondary hypothesis, and weaker still (3 of 5 in the study).
- **Trigger:** a tariff or trade post outside market hours, where SPY hasn't yet moved 0.5% or more in the implied direction by the open.
- **Trade:** SPY options in the implied direction, 14 to 30 days out.

**Never trade on:**
- Rumors about who traded ahead of a post.
- Anything that looks like non-public information.
- A stock that has already moved more than 15% since the post.

## Every check

1. Run `python3 president_signals/monitor.py scan` to pick up new posts, White House actions and headlines.
2. Log a decision for each item that could move a stock, with `monitor.py decide`. "No trade" counts and gets a reason.
3. If H1 or H2 triggers, run `monitor.py quote TICKER call|put`, pick a contract that passes the rules, then `monitor.py buy`.
4. Run `monitor.py mark --auto-exit` to close anything that hit an exit rule.
5. Run `monitor.py dashboard`, then commit and push `president_signals/paper/`.

## Changes

### Mon Nov 23, 2026, 12:20 ET: wider coverage, alerts, direction calls

**Coverage.** Monitoring now covers oil, the Iran war, the Fed, sanctions and any breaking market news, not just presidential posts. `watcher.py` checks every minute, with no AI cost, and writes alerts. A low-cost subagent triages each alert, and the final decision follows these rules.

**H3. Oil and war shocks: direction calls only, no money.** `oil_study.py` tested 14 oil shocks from 2019 to 2026. The first day moved with the news 86% of the time in USO (71% in crude futures), but mostly before the first tradable price. Over the next 5 days, moves reversed exactly 50% of the time.
- **Before 2026,** spikes faded.
- **In this war,** with Hormuz actually closed, they kept going.

That isn't an edge, so oil and war alerts get a logged direction call (`decide --predict up|down`), not a trade. `monitor.py score` grades each call after 1 and 5 trading days. If live calls reach 15 or more and beat 65%, a dated entry here may turn H3 into a trading rule.

**When an alert wakes Claude** (`wait_alerts.sh` exits):
1. If the output says WATCHER DOWN, restart the watcher: `cd president_signals && nohup python3 watcher.py > paper/watcher.log 2>&1 &`.
2. Otherwise, hand the new alerts to a low-cost subagent (Agent tool, model `haiku`) with the instructions in `TRIAGE.md`.
3. For every alert the subagent rates 2 or 3:
   - Log a decision with a direction call.
   - Trade only if H1 or H2 triggers and the market is open.
   - Outside market hours, log the decision as "Plan for open".
4. Alerts rated 0 or 1 get no decision row. The alert file keeps them.
5. Mark the alerts handled: `wc -l < paper/alerts.jsonl > paper/alerts.triaged`. Alerts past that line number are untriaged.
6. Re-arm `wait_alerts.sh` with Bash `run_in_background` (timeout 7200000).
7. If anything changed, rebuild and republish the dashboard, then commit and push `paper/`.

**Direction calls on everything.** Any alert judged likely to move a price also gets a direction call, even when no trade is placed. That measures accuracy across far more events than $1,000 can trade.

### Tue Nov 24, 2026, 13:40 ET: news bug fixed, wider oil and war coverage

**Bug.** Google News dates end in "GMT", which the feed parser rejected, so every headline had no date and the freshness filter dropped it. Since the first day, no oil, Iran or Hormuz headline could raise an alert. The parser now reads RFC 2822 dates properly.

**Coverage added** (no change to H1, H2 or H3, or to any risk limit):
- **Searches:** Iran tanker attack, Israel Iran, Iran talks, Houthi Red Sea, strategic petroleum reserve.
- **Symbols:** NOC and RTX (defense) and FRO (oil tankers).
- **War and supply keywords:** mines, escorts, navy, talks, pipelines, refineries, output, reserves, surplus, Houthis, Israel.
- **Day moves:** every 5 minutes the watcher compares today's price with the previous close: 3% for oil, defense and USO; 2.5% for XLE; 5% for FRO; 2% for gold and QQQ; 1.5% for SPY. That catches slow grinds that never jump 1.5% in 15 minutes, like oil's 20% slide this month.

### Tue Nov 24, 2026, 17:45 ET: one alert per story

The same war headline arrives from a dozen outlets over several hours, each one waking triage. The watcher now skips a headline when it shares at least 3 content words, and half of the shorter headline's words, with one alerted in the last 12 hours. On today's 85 headline alerts that keeps 58. Posts and price alerts aren't filtered. The 3-word minimum keeps a short new headline such as "US strikes Iran" from being swallowed by older strike talk. No rule or limit changes.

### Tue Nov 24, 2026, 20:10 ET: false day-move alerts fixed

At 20:05 the day-move check fired on SPY +4.7%, QQQ +7%, GLD +3.1% and USO −4.5%. All four were false: after hours the price feed had dropped today's daily bar, so the check compared Monday's close with Friday's. Stocks and ETFs are now checked for day moves only while the market is open, and futures only when the latest bar is today's. The four alerts stay in the file, marked here as false; none led to a decision.

### Wed Nov 25, 2026, 00:20 ET: false Brent day-move alert fixed

At 00:14 the day-move check fired on Brent −4.3% (87.46 against a prior close of 91.40). It was false: the daily price series gave Tuesday's close as 91.40, while the hourly bars show Brent ended Tuesday near 88.5, so the real move was about −1.2%. A day move now has to be confirmed against the last hourly bar of the previous session before it alerts. The alert stays in the file, marked here as false; it led to no decision.

### Wed Nov 25, 2026, 02:15 ET: calls graded only on finished days

At 02:10 the scorer graded the Brent call's 1-day result on Wednesday's price bar, which was only a few hours old (futures trade overnight). That grade was undone. Calls are now graded only on daily closes from finished days: today's bar counts after 5pm ET.

### Wed Nov 25, 2026, 11:15 ET: Christmas target, research trades and spreads

**Why:** the owner asked to stop only watching and start trading, with a target of doubling the $1,000 by Christmas, using research on any stock, not only Trump posts. This entry is written before any of these trades, so the record shows the rules came first.

**Honest odds.** Doubling in four weeks needs about +100%, which only concentrated option bets can reach, and most of those paths lose instead. My estimate is that doubling is unlikely (around 1 in 10), a loss of a third or more is about as likely, and the most likely result is somewhere between −40% and +50%. The rules below keep any single bad call from ending the test.

**H4. Research trades (new).** Any listed stock or ETF, when there is a written thesis backed by one of:
- a base rate measured from price history (for example, what an index did after past drops of the same size), or
- a dated catalyst (earnings, a Fed decision, a hearing, an OPEC+ meeting) with a stated reason the market has it wrong.

Each trade's reason must state the thesis, the evidence and what would prove it wrong.

**Instruments:** buying calls or puts, as before, or a **debit spread** (buy one option, sell a further-out one of the same type and expiry). A spread is still defined-risk: the most it can lose is what was paid. Spreads are priced at real fills (long ask minus short bid to open, long bid minus short ask to close) and pay the per-contract fee on both legs.

**Limits changed** (H1, H2 and H3 unchanged):

| Rule | Was | Now |
|---|---|---|
| Spend per trade | $250 | $350 |
| Take profit | +60% | +100%, or a spread worth 80% of its width |
| Time limit | 7 days | 30 days, and everything closes on Wed Dec 23 |
| Open positions, expiry, liquidity, stop loss, IV cap | | unchanged (3, 14 to 60 days, OI 100 and 15% spread per leg, −50%, 100%) |

Direction calls (H3) keep being logged and graded alongside, so the record shows both the predictions and the trades.
