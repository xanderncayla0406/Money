"""Event study: how do stocks move after a president's posts or statements?

For each event in events.csv it measures three things:

  insider   close BEFORE the post -> close of the reaction day.
            Only someone who knew in advance could capture this.
  public    first price a regular trader could get -> close of that day.
            Posts outside market hours: the reaction day's open.
            Posts during market hours: not measurable from daily bars.
  follow    reaction-day close -> 5 trading days later.
            "I saw the news, I buy after it, does the move keep going?"

Single stocks are measured against SPY (abnormal return = stock - SPY), so a
stock falling on a day the whole market fell does not count as a hit.

It also prices a 30-day at-the-money option in the predicted direction with
Black-Scholes, using the prior 20-day realized volatility x1.15 as a stand-in
for implied volatility. That is a rough proxy: real IV usually jumps right
after news, which makes the public trade worse than shown here.

Usage:
    pip install yfinance pandas numpy
    python3 president_signals/event_study.py
    python3 president_signals/event_study.py --events my_events.csv
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
OPTION_DAYS = 30          # calendar days to expiry of the simulated option
IV_MARKUP = 1.15          # implied vol is usually above realized vol
RATE = 0.04
FOLLOW_DAYS = 5


# ---------- data ----------

def load_prices(tickers: list[str], start: str) -> dict[str, pd.DataFrame]:
    import yfinance as yf

    out = {}
    for t in tickers:
        df = yf.download(t, start=start, interval="1d", auto_adjust=True,
                         progress=False, multi_level_index=False)
        if df is None or df.empty:
            print(f"  ! no price data for {t} (delisted or renamed?) - skipped")
            continue
        df.index = pd.to_datetime(df.index).tz_localize(None).normalize()
        out[t] = df[["Open", "High", "Low", "Close"]].dropna()
    return out


# ---------- maths ----------

def bs_price(spot, strike, years, vol, kind):
    if years <= 0 or vol <= 0:
        return max(0.0, spot - strike) if kind == "call" else max(0.0, strike - spot)
    d1 = (math.log(spot / strike) + (RATE + vol * vol / 2) * years) / (vol * math.sqrt(years))
    d2 = d1 - vol * math.sqrt(years)
    n = lambda x: 0.5 * (1 + math.erf(x / math.sqrt(2)))
    if kind == "call":
        return spot * n(d1) - strike * math.exp(-RATE * years) * n(d2)
    return strike * math.exp(-RATE * years) * n(-d2) - spot * n(-d1)


def option_return(entry_px, exit_px, entry_day, exit_day, vol, direction):
    """Buy a 30-day ATM option at entry, sell it at exit. Returns % gain."""
    kind = "call" if direction > 0 else "put"
    t0 = OPTION_DAYS / 365
    t1 = max(0.0, (OPTION_DAYS - (exit_day - entry_day).days) / 365)
    cost = bs_price(entry_px, entry_px, t0, vol, kind)
    value = bs_price(exit_px, entry_px, t1, vol, kind)
    return value / cost - 1 if cost > 0 else np.nan


def wilson(hits: int, n: int, z: float = 1.96):
    if n == 0:
        return (np.nan, np.nan)
    p = hits / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return centre - half, centre + half


# ---------- event study ----------

def reaction_day(idx: pd.DatetimeIndex, post_date: pd.Timestamp, session: str):
    """First trading day on which the market could react to the post."""
    if session in ("premarket", "intraday") and post_date in idx:
        return post_date
    later = idx[idx > post_date]
    return later[0] if len(later) else None


def study(events: pd.DataFrame, px: dict[str, pd.DataFrame]) -> pd.DataFrame:
    spy = px["SPY"]
    rows = []
    for ev in events.itertuples(index=False):
        if ev.ticker not in px:
            continue
        df = px[ev.ticker]
        idx = df.index
        rday = reaction_day(idx, pd.Timestamp(ev.date), ev.session)
        if rday is None or rday not in spy.index:
            continue
        pos = idx.get_loc(rday)
        if pos < 21:
            continue
        prev = idx[pos - 1]
        d = int(ev.direction)
        is_mkt = ev.ticker == "SPY"

        def rel(a_day, a_col, b_day, b_col):
            """Return from (a_day, a_col) to (b_day, b_col), minus SPY's unless SPY."""
            r = df.at[b_day, b_col] / df.at[a_day, a_col] - 1
            if not is_mkt:
                r -= spy.at[b_day, b_col] / spy.at[a_day, a_col] - 1
            return r

        insider = rel(prev, "Close", rday, "Close")

        public = np.nan
        if ev.session != "intraday":
            public = rel(rday, "Open", rday, "Close")

        follow = np.nan
        fday = None
        if pos + FOLLOW_DAYS < len(idx):
            fday = idx[pos + FOLLOW_DAYS]
            if fday in spy.index:
                follow = rel(rday, "Close", fday, "Close")

        logret = np.log(df["Close"].iloc[pos - 21:pos]).diff().dropna()
        vol = float(logret.std() * math.sqrt(252) * IV_MARKUP)

        opt_insider = option_return(df.at[prev, "Close"], df.at[rday, "Close"],
                                    prev, rday, vol, d)
        if ev.session != "intraday":
            entry_px, entry_day = df.at[rday, "Open"], rday
        else:
            entry_px, entry_day = df.at[rday, "Close"], rday
        opt_public = (option_return(entry_px, df.at[fday, "Close"], entry_day, fday, vol, d)
                      if fday is not None else np.nan)

        rows.append({
            "date": ev.date, "ticker": ev.ticker, "dir": d, "session": ev.session,
            "category": ev.category, "kind": ev.kind,
            "reaction_day": rday.date(),
            "insider_ret": insider, "public_ret": public, "follow_5d": follow,
            "opt_insider": opt_insider, "opt_public_5d": opt_public,
            "description": ev.description,
        })
    return pd.DataFrame(rows)


def summarise(res: pd.DataFrame, label: str) -> pd.DataFrame:
    out = []
    for col, name in [("insider_ret", "Knew in advance (prior close -> close)"),
                      ("public_ret", "Traded at first public price (open -> close)"),
                      ("follow_5d", "Bought after the move (close -> +5 days)")]:
        s = res[[col, "dir"]].dropna()
        n = len(s)
        hits = int((np.sign(s[col]) == s["dir"]).sum())
        lo, hi = wilson(hits, n)
        signed = (s[col] * s["dir"]).mean() if n else np.nan
        out.append({"group": label, "window": name, "n": n,
                    "hit_rate": hits / n if n else np.nan,
                    "ci95_low": lo, "ci95_high": hi,
                    "avg_move_in_predicted_dir": signed})
    for col, name in [("opt_insider", "Option bought before post, sold reaction close"),
                      ("opt_public_5d", "Option bought at first public price, held 5d")]:
        s = res[col].dropna()
        n = len(s)
        wins = int((s > 0).sum())
        lo, hi = wilson(wins, n)
        out.append({"group": label, "window": name, "n": n,
                    "hit_rate": wins / n if n else np.nan,
                    "ci95_low": lo, "ci95_high": hi,
                    "avg_move_in_predicted_dir": s.mean() if n else np.nan})
    return pd.DataFrame(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--events", default=str(HERE / "events.csv"))
    ap.add_argument("--out", default=str(HERE / "results"))
    args = ap.parse_args()

    events = pd.read_csv(args.events)
    tickers = sorted(set(events["ticker"]) | {"SPY"})
    start = (pd.to_datetime(events["date"]).min() - pd.Timedelta(days=60)).strftime("%Y-%m-%d")
    print(f"Loading prices for {len(tickers)} tickers from {start}...")
    px = load_prices(tickers, start)

    res = study(events, px)
    summary = pd.concat([
        summarise(res, "all"),
        summarise(res[res.category == "company"], "company-specific"),
        summarise(res[res.category == "macro"], "market-wide (SPY)"),
    ])

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    res.to_csv(out / "event_results.csv", index=False)
    summary.to_csv(out / "summary.csv", index=False)

    pd.set_option("display.width", 200, "display.max_colwidth", 60)
    pct = lambda x: "" if pd.isna(x) else f"{x:+.1%}"
    show = res.copy()
    for c in ["insider_ret", "public_ret", "follow_5d", "opt_insider", "opt_public_5d"]:
        show[c] = show[c].map(pct)
    print("\nPer event (stock returns are vs SPY; option columns are % gain on premium)")
    print(show[["date", "ticker", "dir", "session", "insider_ret", "public_ret",
                "follow_5d", "opt_insider", "opt_public_5d"]].to_string(index=False))

    s = summary.copy()
    for c in ["hit_rate", "ci95_low", "ci95_high", "avg_move_in_predicted_dir"]:
        s[c] = s[c].map(lambda x: "" if pd.isna(x) else f"{x:.0%}" if c != "avg_move_in_predicted_dir" else f"{x:+.1%}")
    print("\nSummary (hit rate = moved the way the post implied; 95% CI shows how unsure that is)")
    print(s.to_string(index=False))
    print(f"\nWrote {out/'event_results.csv'} and {out/'summary.csv'}")


if __name__ == "__main__":
    main()
