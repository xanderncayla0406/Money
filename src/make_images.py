"""Compose Etsy listing images (2000x1500, 4:3) from real spreadsheet renders.

Usage: python src/make_images.py
Reads images/raw/*.png, writes images/<product>/NN-name.jpg
"""
import base64
from pathlib import Path

import json
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "images" / "raw"
W, H = 2000, 1500


def img(name):
    data = base64.b64encode((RAW / name).read_bytes()).decode()
    return f"data:image/png;base64,{data}"


BASE_CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{width:%dpx;height:%dpx;font-family:'Inter',Arial,sans-serif;overflow:hidden;background:var(--bg);color:var(--ink)}
.wrap{position:absolute;inset:0;padding:90px 100px;display:flex;flex-direction:column}
h1{font-size:104px;line-height:1.02;font-weight:800;letter-spacing:-2px;color:var(--dark)}
h2{font-size:64px;line-height:1.08;font-weight:800;letter-spacing:-1px;color:var(--dark)}
.kicker{font-size:30px;font-weight:700;letter-spacing:4px;text-transform:uppercase;color:var(--accent);margin-bottom:22px}
.sub{font-size:36px;color:var(--muted);margin-top:22px;line-height:1.35}
.shot{background:#fff;border-radius:22px;box-shadow:0 30px 80px rgba(0,0,0,.18),0 4px 14px rgba(0,0,0,.08);
      padding:18px;overflow:hidden}
.shot img{display:block;width:100%%;height:auto}
.pill{display:inline-block;background:var(--dark);color:#fff;font-weight:700;font-size:30px;padding:16px 30px;
      border-radius:999px;margin:0 14px 14px 0}
.pill.l{background:var(--light);color:var(--dark)}
ul.checks{list-style:none;margin-top:30px}
ul.checks li{font-size:40px;line-height:1.25;margin:0 0 22px 0;padding-left:64px;position:relative}
ul.checks li:before{content:'✓';position:absolute;left:0;top:-2px;width:46px;height:46px;border-radius:50%%;
      background:var(--accent);color:#fff;font-size:30px;font-weight:800;display:flex;align-items:center;
      justify-content:center}
.callout{position:absolute;background:var(--dark);color:#fff;font-size:30px;font-weight:700;padding:18px 26px;
      border-radius:16px;box-shadow:0 12px 30px rgba(0,0,0,.25);max-width:520px;line-height:1.25}
.grid{display:grid;gap:26px}
.tile{background:#fff;border-radius:20px;padding:28px 30px;box-shadow:0 10px 30px rgba(0,0,0,.08)}
.tile b{display:block;font-size:34px;color:var(--dark);margin-bottom:8px}
.tile span{font-size:26px;color:var(--muted);line-height:1.3}
""" % (W, H)

THEMES = {
    "budget": ":root{--bg:#F3F7F5;--ink:#1F2937;--dark:#134E4A;--accent:#0F9488;--light:#D5F0EA;--muted:#4B5563}",
    "xmas": ":root{--bg:#FBF5F0;--ink:#1F2937;--dark:#7F1D1D;--accent:#166534;--light:#F8E1E1;--muted:#57534E}",
}


def page(theme, body):
    return f"<html><head><meta charset='utf-8'><style>{THEMES[theme]}{BASE_CSS}</style></head><body>{body}</body></html>"


# ---------------------------------------------------------------- budget planner
def budget_pages():
    P = []
    P.append(("01-cover", page("budget", f"""
<div class=wrap style="padding-right:0">
  <div style="display:flex;gap:60px;height:100%">
    <div style="width:760px;display:flex;flex-direction:column;justify-content:center">
      <div class=kicker>Excel + Google Sheets</div>
      <h1>2027 Budget Planner</h1>
      <div class=sub>Monthly budget, annual dashboard, bill tracker, debt snowball &amp; savings goals in one spreadsheet.</div>
      <div style="margin-top:44px"><span class=pill>18 tabs</span><span class=pill>Auto charts</span>
      <span class="pill l">Instant download</span><span class="pill l">Beginner friendly</span></div>
    </div>
    <div style="flex:1;position:relative">
      <div class=shot style="position:absolute;left:0;top:40px;width:1300px;transform:rotate(-2deg)"><img src="{img('bp-dashboard.png')}"></div>
    </div>
  </div>
</div>""")))
    P.append(("02-monthly", page("budget", f"""
<div class=wrap>
  <div class=kicker>12 monthly tabs</div>
  <h2>Log a purchase, and the budget updates itself</h2>
  <div class=shot style="margin-top:44px;width:1800px"><img src="{img('bp-month.png')}" style="height:1010px;width:auto;max-width:100%;object-fit:cover;object-position:top left"></div>
  <div class=callout style="right:110px;top:640px;max-width:330px">Pick the category from a drop-down</div>
  <div class=callout style="left:640px;bottom:300px;background:#B91C1C">Over plan? It turns red</div>
</div>""")))
    P.append(("03-dashboard", page("budget", f"""
<div class=wrap>
  <div class=kicker>Annual dashboard</div>
  <h2>Your whole year at a glance</h2>
  <div class=sub style="margin-top:12px">Income vs. spending, savings rate and where every dollar went, all calculated for you.</div>
  <div class=shot style="margin-top:40px"><img src="{img('bp-dashboard.png')}" style="height:960px;width:auto;max-width:100%;object-fit:cover;object-position:top left"></div>
</div>""")))
    P.append(("04-debt", page("budget", f"""
<div class=wrap>
  <div class=kicker>Debt payoff snowball</div>
  <h2>Know exactly which debt to attack next</h2>
  <div class=sub style="margin-top:12px">Ranks debts smallest-first, puts your extra payment on #1 and estimates months &amp; interest left.</div>
  <div class=shot style="margin-top:50px"><img src="{img('bp-debt.png')}"></div>
</div>""")))
    P.append(("05-savings-bills", page("budget", f"""
<div class=wrap>
  <div class=kicker>Savings goals + bill tracker</div>
  <h2>Hit your goals. Never miss a bill.</h2>
  <div class=shot style="margin-top:46px"><img src="{img('bp-savings.png')}"></div>
  <div class=shot style="margin-top:36px;width:1500px"><img src="{img('bp-bills.png')}"></div>
</div>""")))
    tiles = [("Start Here", "Step-by-step instructions"), ("Setup", "Income + 40 custom categories"),
             ("Dashboard", "Charts & yearly totals"), ("12 Monthly tabs", "Budget vs. actual + 250-row log"),
             ("Bill Tracker", "Paid / Due / Late each month"), ("Debt Payoff", "Snowball order & payoff estimates"),
             ("Savings Goals", "15 goals, monthly amount needed"), ("Sample file", "A filled-in example to learn from")]
    tiles_html = "".join(f"<div class=tile><b>{a}</b><span>{b}</span></div>" for a, b in tiles)
    P.append(("06-included", page("budget", f"""
<div class=wrap>
  <div class=kicker>What's included</div>
  <h2>Everything you need to run your money in 2027</h2>
  <div class=grid style="grid-template-columns:repeat(4,1fr);margin-top:60px">{tiles_html}</div>
  <ul class=checks style="margin-top:60px">
    <li>2 files: a blank planner + a filled-in sample</li>
    <li>Works in Microsoft Excel, Google Sheets (free) and Apple Numbers</li>
    <li>Instant digital download, nothing shipped</li>
  </ul>
</div>""")))
    P.append(("07-how-it-works", page("budget", """
<div class=wrap style="justify-content:center">
  <div class=kicker>How it works</div>
  <h2>Ready in 5 minutes</h2>
  <div class=grid style="grid-template-columns:repeat(4,1fr);margin-top:70px">
    <div class=tile style="padding:44px"><b style="font-size:80px;color:var(--accent)">1</b><b>Download</b><span>Get the files right after purchase from your Etsy account.</span></div>
    <div class=tile style="padding:44px"><b style="font-size:80px;color:var(--accent)">2</b><b>Open</b><span>In Excel, or import into Google Sheets for free on any device.</span></div>
    <div class=tile style="padding:44px"><b style="font-size:80px;color:var(--accent)">3</b><b>Set up</b><span>Type your income and monthly plan once on the Setup tab.</span></div>
    <div class=tile style="padding:44px"><b style="font-size:80px;color:var(--accent)">4</b><b>Track</b><span>Log purchases. Totals, colors and charts update themselves.</span></div>
  </div>
  <div class=sub style="margin-top:70px">Digital product. No physical item will be shipped.</div>
</div>""")))
    return P


# ---------------------------------------------------------------- christmas
def xmas_pages():
    P = []
    P.append(("01-cover", page("xmas", f"""
<div class=wrap style="padding-right:0">
  <div style="display:flex;gap:60px;height:100%">
    <div style="width:780px;display:flex;flex-direction:column;justify-content:center">
      <div class=kicker>Excel + Google Sheets</div>
      <h1>Christmas Gift &amp; Budget Tracker</h1>
      <div class=sub>Plan every gift, stay on budget and see the countdown to Christmas.</div>
      <div style="margin-top:44px"><span class=pill>Gift list</span><span class=pill>Budget dashboard</span>
      <span class="pill l">Card list</span><span class="pill l">Instant download</span></div>
    </div>
    <div style="flex:1;position:relative">
      <div class=shot style="position:absolute;left:0;top:60px;width:1280px;transform:rotate(-2deg)"><img src="{img('xm-dashboard.png')}"></div>
    </div>
  </div>
</div>""")))
    P.append(("02-gift-list", page("xmas", f"""
<div class=wrap>
  <div class=kicker>Gift list</div>
  <h2>Every person, every gift, every dollar</h2>
  <div class=sub style="margin-top:12px">Track budget vs. cost and move each gift from Idea → Ordered → Bought → Wrapped → Given.</div>
  <div class=shot style="margin-top:46px"><img src="{img('xm-gifts.png')}"></div>
</div>""")))
    P.append(("03-dashboard", page("xmas", f"""
<div class=wrap>
  <div class=kicker>Dashboard</div>
  <h2>Know where you stand in one glance</h2>
  <div class=shot style="margin-top:46px"><img src="{img('xm-dashboard.png')}"></div>
</div>""")))
    P.append(("04-expenses-cards", page("xmas", f"""
<div class=wrap>
  <div class=kicker>Holiday expenses + card list</div>
  <h2>Food, decor, travel, cards: all in the budget</h2>
  <div style="display:flex;gap:36px;margin-top:50px;align-items:flex-start">
    <div class=shot style="width:1060px"><img src="{img('xm-expenses.png')}"></div>
    <div class=shot style="flex:1"><img src="{img('xm-cards.png')}"></div>
  </div>
</div>""")))
    P.append(("05-included", page("xmas", """
<div class=wrap style="justify-content:center">
  <div class=kicker>What's included</div>
  <h2>Ready in 5 minutes</h2>
  <ul class=checks style="margin-top:50px">
    <li>Gift List: 80 rows with budget, cost, status &amp; links</li>
    <li>Holiday Expenses: plan vs. actual by type</li>
    <li>Card List: 100 names &amp; addresses, sent / received</li>
    <li>Dashboard: countdown, totals, progress &amp; chart</li>
    <li>Blank file + a filled-in sample to learn from</li>
    <li>Works in Excel, Google Sheets (free) and Apple Numbers</li>
    <li>Reusable every year</li>
  </ul>
  <div class=sub style="margin-top:40px">Digital product. No physical item will be shipped.</div>
</div>""")))
    return P


def bundle_pages():
    return [("01-cover", page("budget", f"""
<div class=wrap>
  <div class=kicker>Bundle and save</div>
  <h1 style="font-size:96px">Holiday + 2027 Money Bundle</h1>
  <div class=sub>Christmas Gift &amp; Budget Tracker + the full 2027 Budget Planner. Excel &amp; Google Sheets.</div>
  <div style="position:relative;flex:1;margin-top:40px">
    <div class=shot style="position:absolute;left:0;top:30px;width:1080px;transform:rotate(-3deg)"><img src="{img('xm-dashboard.png')}"></div>
    <div class=shot style="position:absolute;right:0;top:60px;width:1080px;transform:rotate(2deg)"><img src="{img('bp-dashboard.png')}"></div>
  </div>
</div>"""))]


def main():
    jobs = {"budget-planner": budget_pages(), "christmas-tracker": xmas_pages(), "bundle": bundle_pages()}
    tmp = Path(tempfile.mkdtemp())
    manifest = []
    for folder, pages in jobs.items():
        out = ROOT / "images" / folder
        out.mkdir(parents=True, exist_ok=True)
        for name, html in pages:
            h = tmp / f"{folder}-{name}.html"
            h.write_text(html, encoding="utf-8")
            manifest.append({"html": str(h), "out": str(out / f"{name}.jpg")})
    (tmp / "manifest.json").write_text(json.dumps(manifest))
    subprocess.run(["node", str(ROOT / "src" / "shoot.js"), str(tmp / "manifest.json"), str(W), str(H)], check=True)


if __name__ == "__main__":
    main()
