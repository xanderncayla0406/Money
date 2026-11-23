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

None yet.
