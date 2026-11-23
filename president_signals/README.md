# President signals: do posts predict stock moves?

`event_study.py` takes a list of presidential posts and statements (`events.csv`), pulls daily prices from Yahoo Finance and measures what each stock did. Single stocks are measured against SPY, so a stock that falls on a day the whole market fell doesn't count as a hit.

```bash
pip install yfinance pandas numpy
python3 president_signals/event_study.py          # writes results/event_results.csv and results/summary.csv
```

To add an event, append a row to `events.csv`:

- **`session`**: `premarket`, `intraday`, `afterhours` or `weekend`, based on when the post went out (Eastern time).
- **`direction`**: `1` if the post should push the stock up, `-1` if down.

## Results (run 2026-11-23, 26 events, 2016 to 2026)

| How you traded | Hit rate | 95% range | Avg move your way |
|---|---|---|---|
| **Knew before the post** (prior close to close) | **96%** | 81–99% | +3.8% |
| Traded at the first public price (next open to close) | 42% | 23–64% | 0.0% |
| Bought after the move, held 5 days | 36% | 20–55% | −1.8% |
| 30-day ATM option bought before the post | 85% won | 66–94% | +61% |
| 30-day ATM option bought at the first public price, held 5 days | 32% won | 17–52% | −8% |

### What this means

1. **The move happens before ordinary traders can act.** Almost every post moved its stock the expected way, but that move came between the last close and the next open, before you could trade. From the first price you could actually get, the hit rate is a coin flip or worse.
2. **Buying after the move tends to lose.** Company-specific moves reverted more often than they continued (27% hit rate over 5 days). The Intel attack in Aug 2025 is an example: the stock dropped, then rallied 19% within a week once the government took a stake.
3. **Options make it worse for late buyers.** With premium and time decay, calls or puts bought after the news lost money on average. The model uses pre-event volatility, so if anything it understates the loss: real implied volatility spikes right after big news.
4. **The 96% is inflated.** These events were picked because they're famous, and they're famous because they moved markets. Posts that moved nothing aren't in the list. A real "insider" hit rate would be lower.
5. **Market-wide tariff posts are the only group near 50% after the fact**, and the sample is tiny (10 events, 95% range 24–76%).

### The Nvidia case (Nov 20–23, 2026)

- **Fri Nov 20:** NVDA closed at $125.53, down 14%. About $19.9M in calls were bought that day, the biggest block being Jan 2029 $240 strikes ([report](https://www.techflowpost.com/en-US/newsletter/146383)).
- **Sun Nov 22, evening:** Trump posted urging the board to reinstate Jensen Huang.
- **Mon Nov 23:** The board reinstated Huang that morning. NVDA traded around $166, up about 33% (+27% vs SPY), almost all of it before the open.

This fits the pattern exactly: the person who bought on Friday got the whole move, and someone who bought at Monday's open got roughly nothing extra. Who bought those calls is **unconfirmed**. The Trump link is speculation (raised by Peter Schiff), not a finding.

## Limits

- Daily bars only, so posts made during market hours have no "first public price" measurement. Yahoo keeps hourly data for about 2 years and 1-minute data for 7 days.
- Some post times are from memory (`timing_confidence = medium`). Check them before relying on a specific row.
- Nordstrom (JWN) was taken private in 2025, so Yahoo has no data and that event is skipped.
- Single-day post-to-move studies like this one say nothing about long-run policy effects (tariffs, subsidies, government stakes).
