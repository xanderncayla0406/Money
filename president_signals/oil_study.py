"""Do oil shocks from war news keep going, or fade? Uses WTI futures (CL=F) and USO.

shock = 1 for supply-threat news (attack, closure), -1 for de-escalation.
day0   = prior close -> reaction-day close (mostly not tradable: it gaps)
open0  = reaction-day open -> close (first tradable price)
next5  = reaction-day close -> 5 trading days later (fading or chasing after the fact)
"""
import sys
from pathlib import Path
import pandas as pd, yfinance as yf

HERE = Path(__file__).resolve().parent
ev = pd.read_csv(HERE / "oil_events.csv", parse_dates=["reaction_day"])
rows = []
for tk in ["CL=F", "USO"]:
    px = yf.download(tk, start="2019-08-01", auto_adjust=True, progress=False, multi_level_index=False)
    px.index = pd.to_datetime(px.index).tz_localize(None).normalize()
    for e in ev.itertuples():
        idx = px.index
        later = idx[idx >= e.reaction_day]
        if not len(later):
            continue
        p = idx.get_loc(later[0])
        if p + 5 >= len(idx):
            continue
        c = px["Close"]
        rows.append({"ticker": tk, "day": later[0].date(), "shock": e.shock,
                     "day0": c.iloc[p] / c.iloc[p - 1] - 1,
                     "open0": c.iloc[p] / px["Open"].iloc[p] - 1,
                     "next5": c.iloc[p + 5] / c.iloc[p] - 1, "event": e.description})
r = pd.DataFrame(rows)
pd.set_option("display.width", 200)
show = r.copy()
for col in ["day0", "open0", "next5"]:
    show[col] = show[col].map(lambda x: f"{x:+.1%}")
print(show[show.ticker == "USO"].to_string(index=False))
for tk in ["CL=F", "USO"]:
    s = r[r.ticker == tk]
    same0 = ((s.day0 * s.shock) > 0).mean()
    fade = ((s.next5 * s.shock) < 0).mean()
    print(f"\n{tk}: n={len(s)}  day-0 moved with the shock {same0:.0%}  |  "
          f"next 5 days reversed {fade:.0%}  (avg 5d move vs shock {(s.next5 * s.shock).mean():+.1%})")
    big = s[(s.day0 * s.shock) > 0.03]
    if len(big):
        print(f"   when day-0 move > 3% with the shock: n={len(big)}, reversed {((big.next5 * big.shock) < 0).mean():.0%}, "
              f"avg 5d {(big.next5 * big.shock).mean():+.1%}")
