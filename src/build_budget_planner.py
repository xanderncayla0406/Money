"""Builds the 2027 Budget Planner workbook (blank + sample-filled versions).

Usage: python src/build_budget_planner.py <out_dir>
"""
import datetime as dt
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.chart import BarChart, LineChart, PieChart, Reference
from openpyxl.chart.label import DataLabelList
from openpyxl.formatting.rule import CellIsRule, DataBarRule, FormulaRule
from openpyxl.styles import Alignment, Font
from openpyxl.utils import get_column_letter as L
from openpyxl.worksheet.datavalidation import DataValidation

sys.path.insert(0, str(Path(__file__).parent))
from style import (BOX, CURRENCY, CURRENCY0, DATE, FONT, INPUT, MUTED, PCT, WHITE, Theme,
                   base_sheet, fill, font, header_row, legend, list_validation, note_text,
                   section, style_cell, title, total_style)

T = Theme(dark="134E4A", mid="0F766E", light="DDF3EF", accent="14B8A6")
YEAR = 2027
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]
TABS = [m[:3] for m in MONTHS]

# Setup layout
INC_FIRST, NINC = 7, 6
CAT_FIRST, NCAT = 17, 40
CAT_LAST = CAT_FIRST + NCAT - 1
GROUPS = ["Bills", "Living", "Debt", "Savings", "Fun & Personal", "Other"]
GRP_FIRST = CAT_FIRST
GRP_RANGE = f"Setup!$F${GRP_FIRST}:$F${GRP_FIRST + len(GROUPS) - 1}"
CAT_RANGE = f"Setup!$A${CAT_FIRST}:$A${CAT_LAST}"

# Month sheet layout
M_INC_HDR = 12
M_INC_FIRST = M_INC_HDR + 1
M_INC_TOT = M_INC_FIRST + NINC
M_CAT_HDR = M_INC_TOT + 3
M_CAT_FIRST = M_CAT_HDR + 1
M_CAT_LAST = M_CAT_FIRST + NCAT - 1
M_CAT_TOT = M_CAT_LAST + 1
LOG_HDR, LOG_FIRST, LOG_N = 4, 5, 250
LOG_LAST = LOG_FIRST + LOG_N - 1

CATEGORIES = [  # name, group, sample monthly plan
    ("Rent / Mortgage", "Bills", 1450), ("Electricity", "Bills", 110), ("Water & Trash", "Bills", 55),
    ("Internet", "Bills", 65), ("Phone", "Bills", 80), ("Car Insurance", "Bills", 120),
    ("Subscriptions", "Bills", 35), ("Groceries", "Living", 520), ("Gas / Fuel", "Living", 160),
    ("Household Supplies", "Living", 60), ("Medical", "Living", 40), ("Pets", "Living", 60),
    ("Credit Card", "Debt", 200), ("Car Loan", "Debt", 310), ("Student Loan", "Debt", 180),
    ("Emergency Fund", "Savings", 250), ("Retirement", "Savings", 200), ("Vacation Fund", "Savings", 100),
    ("Dining Out", "Fun & Personal", 150), ("Entertainment", "Fun & Personal", 60),
    ("Clothing", "Fun & Personal", 50), ("Personal Care", "Fun & Personal", 40),
    ("Gifts", "Fun & Personal", 50), ("Miscellaneous", "Other", 40),
]
INCOME = [("Paycheck 1", 2400), ("Paycheck 2", 2400), ("Side Income", 300)]


# ---------------------------------------------------------------- Start Here
def build_start(wb):
    ws = wb.active
    ws.title = "Start Here"
    base_sheet(ws, {"A": 3, "B": 34, "C": 80}, tab_color=T.accent)
    title(ws, "B2", f"{YEAR} Budget Planner", T, size=24)
    note_text(ws, "B3", "Monthly budget  •  Annual dashboard  •  Bill tracker  •  Debt payoff  •  Savings goals",
              size=10, italic=False)
    legend(ws, 5, 2, T)
    ws["B5"].fill = fill(INPUT)
    ws["C5"] = "Type in these. Every other cell calculates by itself."
    ws["C5"].font = font(10, color=MUTED, italic=True)
    ws["B5"].value = "Yellow cells"
    ws["B5"].font = font(10, bold=True)
    ws["B5"].alignment = Alignment(horizontal="center")

    steps = [
        ("1. Setup tab", "Type your budget year, your income sources and your monthly plan for each spending "
                         "category. Rename or add categories freely (up to 40)."),
        ("2. Monthly tabs (Jan–Dec)", "Log each purchase in the yellow Transactions list: date, what it was, "
                                       "category (pick from the drop-down) and amount. Type the income you "
                                       "actually received in the Income table."),
        ("3. Dashboard", "Updates on its own: income vs. spending by month, savings rate, totals by "
                         "category and a spending breakdown chart."),
        ("4. Bills", "List recurring bills once. Each month, set the status to Paid, Due or Late."),
        ("5. Debt Payoff", "Enter each debt. The sheet ranks them smallest-first (the snowball method), puts "
                           "your extra payment on the top one and estimates payoff time and interest."),
        ("6. Savings Goals", "Set a target and date for each goal. Log what you put in each month and see "
                             "your progress and how much you need per month to hit the date."),
    ]
    r = 7
    section(ws, f"B{r}", "How to use it", T)
    r += 1
    for head, body in steps:
        ws[f"B{r}"] = head
        ws[f"B{r}"].font = font(10, bold=True, color=T.dark)
        ws[f"C{r}"] = body
        ws[f"C{r}"].font = font(10)
        ws[f"C{r}"].alignment = Alignment(wrap_text=True, vertical="top")
        ws[f"B{r}"].alignment = Alignment(vertical="top")
        ws.row_dimensions[r].height = 30
        r += 1

    r += 1
    section(ws, f"B{r}", "Opening the file", T)
    r += 1
    opens = [
        ("Microsoft Excel", "Just open the .xlsx file (Excel 2010 or newer, Windows or Mac)."),
        ("Google Sheets (free)", "Go to sheets.google.com → File → Import → Upload → choose this file → "
                                 "Replace spreadsheet. Everything works, including drop-downs and charts."),
        ("Apple Numbers", "Open the .xlsx file in Numbers. Formulas work; chart styling may differ slightly."),
    ]
    for head, body in opens:
        ws[f"B{r}"] = head
        ws[f"B{r}"].font = font(10, bold=True)
        ws[f"C{r}"] = body
        ws[f"C{r}"].font = font(10)
        ws[f"C{r}"].alignment = Alignment(wrap_text=True, vertical="top")
        ws.row_dimensions[r].height = 30
        r += 1

    r += 1
    section(ws, f"B{r}", "Tips", T)
    r += 1
    tips = [
        "Spending in a category above plan turns the Remaining cell red, so you can see it at a glance.",
        "If a transaction's category doesn't match any category, it shows under 'Not in a category' on that "
        "month's summary so nothing is missed.",
        "Savings categories (group = Savings) count as money out of your budget AND as 'Saved' on the Dashboard.",
        "Want a different plan for one month? Just type over the Planned amount on that month's tab.",
    ]
    for t in tips:
        ws[f"B{r}"] = "•"
        ws[f"B{r}"].alignment = Alignment(horizontal="right", vertical="top")
        ws[f"C{r}"] = t
        ws[f"C{r}"].font = font(10)
        ws[f"C{r}"].alignment = Alignment(wrap_text=True, vertical="top")
        ws.row_dimensions[r].height = 28
        r += 1
    return ws


# ---------------------------------------------------------------- Setup
def build_setup(wb, sample):
    ws = wb.create_sheet("Setup")
    base_sheet(ws, {"A": 30, "B": 18, "C": 18, "D": 4, "E": 4, "F": 20}, tab_color=T.dark)
    title(ws, "A1", "Setup", T, sub="Fill in the yellow cells once. Every other tab reads from here.")
    ws["A3"] = "Budget year"
    ws["A3"].font = font(10, bold=True)
    ws["B3"] = YEAR
    style_cell(ws["B3"], fmt="0", input_=True, align="center", bold=True)

    section(ws, "A5", "Income (monthly, after tax)", T)
    header_row(ws, INC_FIRST - 1, 1, ["Income source", "Planned / month"], T)
    for i in range(NINC):
        r = INC_FIRST + i
        name, amt = INCOME[i] if i < len(INCOME) else (None, None)
        ws.cell(r, 1, name)
        ws.cell(r, 2, amt if sample else None)
        style_cell(ws.cell(r, 1), input_=True)
        style_cell(ws.cell(r, 2), fmt=CURRENCY, input_=True)
    tr = INC_FIRST + NINC
    ws.cell(tr, 1, "Total planned income")
    ws.cell(tr, 2, f"=SUM(B{INC_FIRST}:B{tr - 1})")
    total_style(ws.cell(tr, 1), T)
    total_style(ws.cell(tr, 2), T, CURRENCY)

    section(ws, f"A{CAT_FIRST - 2}", "Spending categories (monthly plan)", T)
    header_row(ws, CAT_FIRST - 1, 1, ["Category", "Group", "Planned / month"], T)
    for i in range(NCAT):
        r = CAT_FIRST + i
        if i < len(CATEGORIES):
            n, g, a = CATEGORIES[i]
            ws.cell(r, 1, n)
            ws.cell(r, 2, g)
            ws.cell(r, 3, a if sample else None)
        style_cell(ws.cell(r, 1), input_=True)
        style_cell(ws.cell(r, 2), input_=True)
        style_cell(ws.cell(r, 3), fmt=CURRENCY, input_=True)
    list_validation(ws, GRP_RANGE, f"B{CAT_FIRST}:B{CAT_LAST}")
    tr = CAT_LAST + 1
    ws.cell(tr, 1, "Total planned spending")
    ws.cell(tr, 3, f"=SUM(C{CAT_FIRST}:C{CAT_LAST})")
    for c in range(1, 4):
        total_style(ws.cell(tr, c), T, CURRENCY)
    ws.cell(tr + 1, 1, "Left to assign (income − spending)")
    ws.cell(tr + 1, 3, f"=B{INC_FIRST + NINC}-C{tr}")
    for c in range(1, 4):
        total_style(ws.cell(tr + 1, c), T, CURRENCY)
    note_text(ws, f"A{tr + 2}", "Aim for $0 left to assign: give every dollar a job (spending, debt or savings).")

    # groups list
    header_row(ws, GRP_FIRST - 1, 6, ["Groups (editable)"], T)
    for i, g in enumerate(GROUPS):
        c = ws.cell(GRP_FIRST + i, 6, g)
        style_cell(c, input_=True)
    note_text(ws, f"F{GRP_FIRST + len(GROUPS) + 1}", "Keep 'Savings' spelled exactly")
    note_text(ws, f"F{GRP_FIRST + len(GROUPS) + 2}", "so the Dashboard counts it.")
    ws.freeze_panes = "A2"
    return ws


# ---------------------------------------------------------------- Month
SAMPLE_TX = {  # month index -> list of (day, description, category, amount)
    0: [(1, "January rent", "Rent / Mortgage", 1450), (2, "Costco run", "Groceries", 186.42),
        (3, "Shell", "Gas / Fuel", 48.10), (4, "Netflix + Spotify", "Subscriptions", 33.98),
        (5, "Car payment", "Car Loan", 310), (6, "Trader Joe's", "Groceries", 74.15),
        (8, "Electric bill", "Electricity", 126.37), (9, "Thai takeout", "Dining Out", 38.50),
        (10, "Phone bill", "Phone", 80), (11, "Transfer to emergency fund", "Emergency Fund", 250),
        (12, "Target - cleaning stuff", "Household Supplies", 42.89), (14, "Movie night", "Entertainment", 31),
        (15, "Credit card payment", "Credit Card", 250), (16, "Kroger", "Groceries", 112.60),
        (17, "Internet", "Internet", 65), (18, "Shell", "Gas / Fuel", 51.25),
        (19, "Haircut", "Personal Care", 35), (20, "Student loan", "Student Loan", 180),
        (21, "Dog food", "Pets", 54.99), (22, "Brunch with friends", "Dining Out", 46.80),
        (24, "401k extra contribution", "Retirement", 200), (25, "Car insurance", "Car Insurance", 120),
        (26, "Kroger", "Groceries", 98.33), (27, "Birthday gift - Sam", "Gifts", 40),
        (28, "Water bill", "Water & Trash", 52.40), (29, "Vacation fund", "Vacation Fund", 100),
        (30, "Pharmacy", "Medical", 22.75)],
    1: [(1, "February rent", "Rent / Mortgage", 1450), (2, "Aldi", "Groceries", 91.20),
        (3, "Shell", "Gas / Fuel", 45.60), (4, "Netflix + Spotify", "Subscriptions", 33.98),
        (5, "Car payment", "Car Loan", 310), (7, "Electric bill", "Electricity", 118.02),
        (9, "Valentine's dinner", "Dining Out", 92.00), (10, "Phone bill", "Phone", 80),
        (11, "Emergency fund", "Emergency Fund", 250), (13, "Costco", "Groceries", 204.11),
        (15, "Credit card payment", "Credit Card", 300), (17, "Internet", "Internet", 65),
        (18, "Gas", "Gas / Fuel", 49.90), (20, "Student loan", "Student Loan", 180),
        (22, "Winter jacket", "Clothing", 79.99), (24, "401k extra contribution", "Retirement", 200),
        (25, "Car insurance", "Car Insurance", 120), (26, "Kroger", "Groceries", 121.48),
        (27, "Water bill", "Water & Trash", 52.40), (28, "Vacation fund", "Vacation Fund", 100)],
    2: [(1, "March rent", "Rent / Mortgage", 1450), (2, "Aldi", "Groceries", 88.70),
        (4, "Netflix + Spotify", "Subscriptions", 33.98), (5, "Car payment", "Car Loan", 310),
        (6, "Shell", "Gas / Fuel", 52.30), (8, "Electric bill", "Electricity", 104.55),
        (10, "Phone bill", "Phone", 80), (11, "Emergency fund", "Emergency Fund", 250),
        (12, "Concert tickets", "Entertainment", 85), (14, "Costco", "Groceries", 176.04)],
}
SAMPLE_INCOME_ACTUAL = {0: [2400, 2400, 360], 1: [2400, 2400, 210], 2: [2400, 2400, 0]}


def build_month(wb, mi, sample):
    ws = wb.create_sheet(TABS[mi])
    base_sheet(ws, {"A": 26, "B": 14, "C": 14, "D": 14, "E": 14, "F": 3,
                    "G": 13, "H": 30, "I": 22, "J": 13}, tab_color=T.mid)
    ws["A1"] = f'="{MONTHS[mi]} "&Setup!$B$3'
    ws["A1"].font = Font(name=FONT, size=20, bold=True, color=T.dark)
    ws.row_dimensions[1].height = 32
    note_text(ws, "A2", "Log purchases on the right. Everything on the left fills in by itself.")

    # Summary
    header_row(ws, 4, 1, ["Summary", "Planned", "Actual", "Difference"], T)
    rows = [
        ("Income", f"=B{M_INC_TOT}", f"=C{M_INC_TOT}"),
        ("Spending (incl. savings & debt)", f"=C{M_CAT_TOT}", f"=SUM($J${LOG_FIRST}:$J${LOG_LAST})"),
        ("Left over", "=B5-B6", "=C5-C6"),
        ("Saved this month", f'=SUMIFS(C{M_CAT_FIRST}:C{M_CAT_LAST},B{M_CAT_FIRST}:B{M_CAT_LAST},"Savings")',
         f'=SUMIFS(D{M_CAT_FIRST}:D{M_CAT_LAST},B{M_CAT_FIRST}:B{M_CAT_LAST},"Savings")'),
        ("% of income spent", "=IF(B5=0,0,B6/B5)", "=IF(C5=0,0,C6/C5)"),
        ("Not in a category (check log)", None, f"=C6-D{M_CAT_TOT}"),
    ]
    for i, (lab, p, a) in enumerate(rows):
        r = 5 + i
        ws.cell(r, 1, lab)
        style_cell(ws.cell(r, 1), bold=(i == 2))
        fmt = PCT if i == 4 else CURRENCY
        ws.cell(r, 2, p)
        ws.cell(r, 3, a)
        style_cell(ws.cell(r, 2), fmt=fmt)
        style_cell(ws.cell(r, 3), fmt=fmt, bold=(i == 2))
        if i in (0, 1, 2, 3):
            ws.cell(r, 4, f"=C{r}-B{r}")
        style_cell(ws.cell(r, 4), fmt='"$"#,##0.00;-"$"#,##0.00;"-"')
    for c in range(1, 5):
        ws.cell(7, c).fill = fill(T.light)
    ws.cell(10, 1).font = font(10, color=MUTED, italic=True)

    # Income table
    header_row(ws, M_INC_HDR, 1, ["Income", "Planned", "Actual", "Difference"], T)
    acts = SAMPLE_INCOME_ACTUAL.get(mi, []) if sample else []
    for i in range(NINC):
        r = M_INC_FIRST + i
        sr = INC_FIRST + i
        ws.cell(r, 1, f'=IF(Setup!$A{sr}="","",Setup!$A{sr})')
        ws.cell(r, 2, f'=IF(A{r}="","",Setup!$B{sr})')
        ws.cell(r, 3, acts[i] if i < len(acts) else None)
        ws.cell(r, 4, f'=IF(A{r}="","",N(C{r})-N(B{r}))')
        style_cell(ws.cell(r, 1))
        style_cell(ws.cell(r, 2), fmt=CURRENCY)
        style_cell(ws.cell(r, 3), fmt=CURRENCY, input_=True)
        style_cell(ws.cell(r, 4), fmt=CURRENCY)
    ws.cell(M_INC_TOT, 1, "Total income")
    ws.cell(M_INC_TOT, 2, f"=SUM(B{M_INC_FIRST}:B{M_INC_TOT - 1})")
    ws.cell(M_INC_TOT, 3, f"=SUM(C{M_INC_FIRST}:C{M_INC_TOT - 1})")
    ws.cell(M_INC_TOT, 4, f"=C{M_INC_TOT}-B{M_INC_TOT}")
    for c in range(1, 5):
        total_style(ws.cell(M_INC_TOT, c), T, CURRENCY)

    # Category table
    header_row(ws, M_CAT_HDR, 1, ["Category", "Group", "Planned", "Actual", "Remaining"], T)
    for i in range(NCAT):
        r = M_CAT_FIRST + i
        sr = CAT_FIRST + i
        ws.cell(r, 1, f'=IF(Setup!$A{sr}="","",Setup!$A{sr})')
        ws.cell(r, 2, f'=IF(A{r}="","",Setup!$B{sr})')
        ws.cell(r, 3, f'=IF(A{r}="","",Setup!$C{sr})')
        ws.cell(r, 4, f'=IF(A{r}="","",SUMIFS($J${LOG_FIRST}:$J${LOG_LAST},$I${LOG_FIRST}:$I${LOG_LAST},A{r}))')
        ws.cell(r, 5, f'=IF(A{r}="","",N(C{r})-N(D{r}))')
        style_cell(ws.cell(r, 1))
        style_cell(ws.cell(r, 2), color=MUTED)
        for c in (3, 4, 5):
            style_cell(ws.cell(r, c), fmt=CURRENCY)
    ws.cell(M_CAT_TOT, 1, "Total")
    for c, col in ((3, "C"), (4, "D"), (5, "E")):
        ws.cell(M_CAT_TOT, c, f"=SUM({col}{M_CAT_FIRST}:{col}{M_CAT_LAST})")
    for c in range(1, 6):
        total_style(ws.cell(M_CAT_TOT, c), T, CURRENCY)
    red = font(10, bold=True, color="B91C1C")
    ws.conditional_formatting.add(
        f"E{M_CAT_FIRST}:E{M_CAT_TOT}",
        CellIsRule(operator="lessThan", formula=["0"], font=red, fill=fill("FDE2E2")))
    ws.conditional_formatting.add(
        f"C7:C7", CellIsRule(operator="lessThan", formula=["0"], font=red, fill=fill("FDE2E2")))

    # Transactions log
    ws.merge_cells(start_row=LOG_HDR - 1, start_column=7, end_row=LOG_HDR - 1, end_column=10)
    ws.cell(LOG_HDR - 1, 7, "Transactions (money out)")
    ws.cell(LOG_HDR - 1, 7).font = Font(name=FONT, size=12, bold=True, color=T.dark)
    header_row(ws, LOG_HDR, 7, ["Date", "Description", "Category", "Amount"], T)
    tx = SAMPLE_TX.get(mi, []) if sample else []
    for i in range(LOG_N):
        r = LOG_FIRST + i
        if i < len(tx):
            d, desc, cat, amt = tx[i]
            ws.cell(r, 7, dt.date(YEAR, mi + 1, d))
            ws.cell(r, 8, desc)
            ws.cell(r, 9, cat)
            ws.cell(r, 10, amt)
        style_cell(ws.cell(r, 7), fmt=DATE, input_=True, align="left")
        style_cell(ws.cell(r, 8), input_=True)
        style_cell(ws.cell(r, 9), input_=True)
        style_cell(ws.cell(r, 10), fmt=CURRENCY, input_=True)
    list_validation(ws, CAT_RANGE, f"I{LOG_FIRST}:I{LOG_LAST}")
    ws.freeze_panes = "A4"
    ws.print_area = f"A1:J{M_CAT_TOT}"
    return ws


# ---------------------------------------------------------------- Dashboard
def build_dashboard(wb):
    ws = wb.create_sheet("Dashboard", 1)
    base_sheet(ws, {"A": 22, "B": 16, "C": 16, "D": 16, "E": 16, "F": 3, "G": 20, "H": 16},
               tab_color=T.accent)
    ws["A1"] = '="Dashboard  •  "&Setup!$B$3'
    ws["A1"].font = Font(name=FONT, size=22, bold=True, color=T.dark)
    ws.row_dimensions[1].height = 36
    note_text(ws, "A2", "Everything here updates automatically from your monthly tabs.")

    # KPI tiles row 4-5
    kpis = [("Income so far", "=B22"), ("Spent so far", "=C22"),
            ("Saved so far", "=D22"), ("Savings rate", "=IF(B22=0,0,D22/B22)")]
    cols = [1, 2, 3, 4]
    for (lab, f), c in zip(kpis, cols):
        a = ws.cell(4, c, lab)
        a.font = Font(name=FONT, size=9, bold=True, color=WHITE)
        a.fill = fill(T.mid)
        a.alignment = Alignment(horizontal="center", vertical="center")
        b = ws.cell(5, c, f)
        b.font = Font(name=FONT, size=16, bold=True, color=T.dark)
        b.fill = fill(T.light)
        b.alignment = Alignment(horizontal="center", vertical="center")
        b.number_format = PCT if "rate" in lab else CURRENCY0
    ws.row_dimensions[4].height = 20
    ws.row_dimensions[5].height = 34

    # Monthly table
    header_row(ws, 9, 1, ["Month", "Income", "Spending", "Saved", "Left over"], T)
    for i, m in enumerate(TABS):
        r = 10 + i
        ws.cell(r, 1, m)
        ws.cell(r, 2, f"='{m}'!$C$5")
        ws.cell(r, 3, f"='{m}'!$C$6")
        ws.cell(r, 4, f"='{m}'!$C$8")
        ws.cell(r, 5, f"=B{r}-C{r}")
        style_cell(ws.cell(r, 1))
        for c in range(2, 6):
            style_cell(ws.cell(r, c), fmt=CURRENCY)
    ws.cell(22, 1, "Year total")
    for c, col in ((2, "B"), (3, "C"), (4, "D"), (5, "E")):
        ws.cell(22, c, f"=SUM({col}10:{col}21)")
    for c in range(1, 6):
        total_style(ws.cell(22, c), T, CURRENCY)
    ws.conditional_formatting.add(
        "E10:E22", CellIsRule(operator="lessThan", formula=["0"], font=font(10, True, "B91C1C")))

    # Group totals (G9:H15)
    header_row(ws, 9, 7, ["Group", "Spent this year"], T)
    gfirst = 10
    for i in range(len(GROUPS)):
        r = gfirst + i
        ws.cell(r, 7, f'=IF(Setup!$F{GRP_FIRST + i}="","",Setup!$F{GRP_FIRST + i})')
        ws.cell(r, 8, f'=IF(G{r}="","",SUMIFS($D$27:$D${26 + NCAT},$B$27:$B${26 + NCAT},G{r}))')
        style_cell(ws.cell(r, 7))
        style_cell(ws.cell(r, 8), fmt=CURRENCY)

    # Category table
    header_row(ws, 26, 1, ["Category", "Group", "Planned (year)", "Actual (year)", "Remaining"], T)
    for i in range(NCAT):
        r = 27 + i
        mr = M_CAT_FIRST + i
        ws.cell(r, 1, f"='Jan'!A{mr}")
        ws.cell(r, 2, f"='Jan'!B{mr}")
        plan = ",".join(f"'{m}'!C{mr}" for m in TABS)
        act = ",".join(f"'{m}'!D{mr}" for m in TABS)
        ws.cell(r, 3, f'=IF(A{r}="","",SUM({plan}))')
        ws.cell(r, 4, f'=IF(A{r}="","",SUM({act}))')
        ws.cell(r, 5, f'=IF(A{r}="","",N(C{r})-N(D{r}))')
        style_cell(ws.cell(r, 1))
        style_cell(ws.cell(r, 2), color=MUTED)
        for c in (3, 4, 5):
            style_cell(ws.cell(r, c), fmt=CURRENCY)
    tr = 27 + NCAT
    ws.cell(tr, 1, "Total")
    for c, col in ((3, "C"), (4, "D"), (5, "E")):
        ws.cell(tr, c, f"=SUM({col}27:{col}{tr - 1})")
    for c in range(1, 6):
        total_style(ws.cell(tr, c), T, CURRENCY)
    note_text(ws, f"A{tr + 1}", "Planned (year) adds up each month's plan, so it fills in for the whole year "
                                "from day one; compare it with Actual as the months go by.")

    # Charts
    bar = BarChart()
    bar.type = "col"
    bar.title = "Income vs. spending by month"
    bar.add_data(Reference(ws, min_col=2, max_col=3, min_row=9, max_row=21), titles_from_data=True)
    bar.set_categories(Reference(ws, min_col=1, min_row=10, max_row=21))
    bar.height, bar.width = 7.5, 16
    bar.y_axis.numFmt = '"$"#,##0'
    bar.y_axis.majorGridlines = None
    bar.series[0].graphicalProperties.solidFill = T.accent
    bar.series[0].graphicalProperties.line.solidFill = T.accent
    bar.series[1].graphicalProperties.solidFill = T.dark
    bar.series[1].graphicalProperties.line.solidFill = T.dark
    _chart_fix(bar, axes=True)
    bar.legend.position = "b"
    ws.add_chart(bar, "J4")

    pie = PieChart()
    pie.title = "Where the money went"
    pie.add_data(Reference(ws, min_col=8, min_row=9, max_row=9 + len(GROUPS)), titles_from_data=True)
    pie.set_categories(Reference(ws, min_col=7, min_row=10, max_row=9 + len(GROUPS)))
    pie.height, pie.width = 7.5, 16
    pie.dataLabels = DataLabelList()
    pie.dataLabels.showPercent = True
    pie.dataLabels.showVal = False
    pie.dataLabels.showCatName = False
    pie.dataLabels.showSerName = False
    pie.dataLabels.showLeaderLines = False
    pie.dataLabels.showLegendKey = False
    from openpyxl.chart.series import DataPoint
    colors = [T.dark, T.mid, T.accent, "F59E0B", "94A3B8", "E11D48"]
    for idx, col in enumerate(colors):
        pt = DataPoint(idx=idx)
        pt.graphicalProperties.solidFill = col
        pt.graphicalProperties.line.solidFill = WHITE
        pie.series[0].dPt.append(pt)
    _chart_fix(pie, axes=False)
    pie.legend.position = "r"
    ws.add_chart(pie, "J20")
    ws.freeze_panes = "A3"
    return ws


def _chart_fix(ch, axes):
    ch.roundedCorners = False
    if ch.legend is not None:
        ch.legend.overlay = False
    if ch.title is not None:
        try:
            ch.title.overlay = False
        except AttributeError:
            pass
    if axes:
        ch.x_axis.delete = False
        ch.y_axis.delete = False


# ---------------------------------------------------------------- Bills
SAMPLE_BILLS = [("Rent / Mortgage", 1, 1450, "No"), ("Car Payment", 5, 310, "Yes"),
                ("Electricity", 8, 120, "No"), ("Phone", 10, 80, "Yes"), ("Internet", 17, 65, "Yes"),
                ("Student Loan", 20, 180, "Yes"), ("Car Insurance", 25, 120, "Yes"),
                ("Water & Trash", 28, 55, "No"), ("Streaming", 4, 34, "Yes")]
SAMPLE_BILLS_PAID_MONTHS = 2  # Jan, Feb paid; Mar partially


def build_bills(wb, sample):
    ws = wb.create_sheet("Bills")
    widths = {"A": 24, "B": 9, "C": 13, "D": 10}
    for i in range(12):
        widths[L(5 + i)] = 8.5
    base_sheet(ws, widths, tab_color="F59E0B")
    title(ws, "A1", "Bill Tracker", T, sub="List each recurring bill once. Each month pick Paid, Due or Late.")
    header_row(ws, 4, 1, ["Bill", "Due day", "Amount", "Autopay?"] + TABS, T)
    N = 25
    for i in range(N):
        r = 5 + i
        if sample and i < len(SAMPLE_BILLS):
            n, d, a, ap = SAMPLE_BILLS[i]
            ws.cell(r, 1, n)
            ws.cell(r, 2, d)
            ws.cell(r, 3, a)
            ws.cell(r, 4, ap)
            for m in range(12):
                if m < SAMPLE_BILLS_PAID_MONTHS or (m == 2 and d <= 14):
                    ws.cell(r, 5 + m, "Paid")
                elif m == 2:
                    ws.cell(r, 5 + m, "Due")
        style_cell(ws.cell(r, 1), input_=True)
        style_cell(ws.cell(r, 2), fmt="0", input_=True, align="center")
        style_cell(ws.cell(r, 3), fmt=CURRENCY, input_=True)
        style_cell(ws.cell(r, 4), input_=True, align="center")
        for m in range(12):
            style_cell(ws.cell(r, 5 + m), input_=True, align="center")
    last = 4 + N
    list_validation(ws, '"Yes,No"', f"D5:D{last}")
    list_validation(ws, '"Paid,Due,Late"', f"E5:P{last}")
    green = fill("CDEFD9")
    ws.conditional_formatting.add(f"E5:P{last}", CellIsRule(operator="equal", formula=['"Paid"'],
                                                            fill=green, font=font(10, True, "166534")))
    ws.conditional_formatting.add(f"E5:P{last}", CellIsRule(operator="equal", formula=['"Late"'],
                                                            fill=fill("FDE2E2"), font=font(10, True, "B91C1C")))
    ws.conditional_formatting.add(f"E5:P{last}", CellIsRule(operator="equal", formula=['"Due"'],
                                                            fill=fill("FEF3C7"), font=font(10, True, "92400E")))
    r = last + 1
    ws.cell(r, 1, "Total bills / month")
    ws.cell(r, 3, f"=SUM(C5:C{last})")
    for c in range(1, 17):
        total_style(ws.cell(r, c), T, CURRENCY)
    r2 = r + 1
    ws.cell(r2, 1, "Paid so far")
    for m in range(12):
        col = L(5 + m)
        ws.cell(r2, 5 + m, f'=SUMIFS($C$5:$C${last},{col}5:{col}{last},"Paid")')
    for c in range(1, 17):
        total_style(ws.cell(r2, c), T, CURRENCY0)
    r3 = r2 + 1
    ws.cell(r3, 1, "Still to pay")
    for m in range(12):
        col = L(5 + m)
        ws.cell(r3, 5 + m, f"=$C${r}-{col}{r2}")
    for c in range(1, 17):
        total_style(ws.cell(r3, c), T, CURRENCY0)
    ws.freeze_panes = "B5"
    return ws


# ---------------------------------------------------------------- Debt
SAMPLE_DEBTS = [("Visa card", 4200, 3650, 0.2499, 120), ("Car loan", 14500, 13880, 0.069, 310),
                ("Student loan", 21000, 20640, 0.054, 180), ("Store card", 900, 640, 0.2899, 35)]


def build_debt(wb, sample):
    ws = wb.create_sheet("Debt Payoff")
    base_sheet(ws, {"A": 20, "B": 14, "C": 14, "D": 9, "E": 13, "F": 10, "G": 14, "H": 13,
                    "I": 14, "J": 12, "K": 3}, tab_color="E11D48")
    title(ws, "A1", "Debt Payoff (Snowball)", T,
          sub="Smallest balance first. Pay minimums on everything, throw the extra at #1, then roll it down.")
    ws["A4"] = "Extra paid on top of minimums each month"
    ws["A4"].font = font(10, bold=True)
    ws.merge_cells("A4:D4")
    ws["E4"] = 150 if sample else None
    style_cell(ws["E4"], fmt=CURRENCY, input_=True, bold=True)

    hdr = ["Debt", "Starting balance", "Current balance", "APR", "Minimum payment",
           "Snowball order", "This month pay", "Months left (est.)", "Interest left (est.)", "Paid off"]
    header_row(ws, 6, 1, hdr, T, height=32)
    N = 10
    first, last = 7, 6 + N
    for i in range(N):
        r = first + i
        if sample and i < len(SAMPLE_DEBTS):
            n, s, c, apr, mn = SAMPLE_DEBTS[i]
            for col, v in zip(range(1, 6), (n, s, c, apr, mn)):
                ws.cell(r, col, v)
        style_cell(ws.cell(r, 1), input_=True)
        style_cell(ws.cell(r, 2), fmt=CURRENCY, input_=True)
        style_cell(ws.cell(r, 3), fmt=CURRENCY, input_=True)
        style_cell(ws.cell(r, 4), fmt="0.00%", input_=True)
        style_cell(ws.cell(r, 5), fmt=CURRENCY, input_=True)
        ws.cell(r, 6, f'=IF(A{r}="","",IF(N(C{r})<=0,"Done!",'
                      f'COUNTIFS($C${first}:$C${last},"<"&C{r},$C${first}:$C${last},">0")'
                      f'+COUNTIFS($C${first}:C{r},C{r})))')
        ws.cell(r, 7, f'=IF(OR(A{r}="",N(C{r})<=0),"",N(E{r})+IF(F{r}=1,N($E$4),0))')
        ws.cell(r, 8, f'=IF(G{r}="","",IFERROR(ROUNDUP(NPER(N(D{r})/12,-G{r},C{r}),0),"Pay more"))')
        ws.cell(r, 9, f'=IF(G{r}="","",IFERROR(MAX(0,H{r}*G{r}-C{r}),"-"))')
        ws.cell(r, 10, f'=IF(OR(A{r}="",N(B{r})=0),"",1-N(C{r})/B{r})')
        style_cell(ws.cell(r, 6), align="center", bold=True)
        style_cell(ws.cell(r, 7), fmt=CURRENCY)
        style_cell(ws.cell(r, 8), fmt="0", align="center")
        style_cell(ws.cell(r, 9), fmt=CURRENCY)
        style_cell(ws.cell(r, 10), fmt=PCT, align="center")
    ws.conditional_formatting.add(f"F{first}:F{last}", CellIsRule(
        operator="equal", formula=["1"], fill=fill("FDE2E2"), font=font(10, True, "B91C1C")))
    ws.conditional_formatting.add(f"J{first}:J{last}", DataBarRule(
        start_type="num", start_value=0, end_type="num", end_value=1, color="14B8A6"))
    tr = last + 1
    ws.cell(tr, 1, "Total")
    ws.cell(tr, 2, f"=SUM(B{first}:B{last})")
    ws.cell(tr, 3, f"=SUM(C{first}:C{last})")
    ws.cell(tr, 5, f"=SUM(E{first}:E{last})")
    ws.cell(tr, 7, f"=SUM(G{first}:G{last})")
    ws.cell(tr, 9, f"=SUM(I{first}:I{last})")
    ws.cell(tr, 10, f"=IF(B{tr}=0,\"\",1-C{tr}/B{tr})")
    for c in range(1, 11):
        total_style(ws.cell(tr, c), T, PCT if c == 10 else CURRENCY)
    note_text(ws, f"A{tr + 1}", "#1 (red) gets your extra payment. When it hits $0 it shows Done! and the next "
                                "debt moves up automatically. Estimates assume today's payment stays the same.")
    note_text(ws, f"A{tr + 2}", "Update 'Current balance' when your statement arrives. Enter APR like 24.99%.")

    # balance tracker
    br0 = tr + 5
    section(ws, f"A{br0 - 1}", "Balance tracker (type each debt's balance at month end)", T)
    for i in range(12):
        ws.column_dimensions[L(2 + i)].width = max(ws.column_dimensions[L(2 + i)].width or 0, 11)
    header_row(ws, br0, 1, ["Debt"] + TABS, T)
    for i in range(N):
        r = br0 + 1 + i
        ws.cell(r, 1, f'=IF(A{first + i}="","",A{first + i})')
        style_cell(ws.cell(r, 1))
        for m in range(12):
            c = ws.cell(r, 2 + m)
            if sample and i < len(SAMPLE_DEBTS) and m < 3:
                s, cur = SAMPLE_DEBTS[i][1], SAMPLE_DEBTS[i][2]
                c.value = round(s - (s - cur) * (m + 1) / 3, 2)
            style_cell(c, fmt=CURRENCY0, input_=True)
    tot = br0 + 1 + N
    ws.cell(tot, 1, "Total debt")
    for m in range(12):
        col = L(2 + m)
        ws.cell(tot, 2 + m, f'=IF(COUNT({col}{br0 + 1}:{col}{tot - 1})=0,"",SUM({col}{br0 + 1}:{col}{tot - 1}))')
        # hidden helper row for the chart: #N/A makes empty months a gap instead of a drop to $0
        h = ws.cell(tot + 1, 2 + m, f'=IF({col}{tot}="",NA(),{col}{tot})')
        h.font = font(8, color=WHITE)
    ws.cell(tot + 1, 1, "chart helper").font = font(8, color=WHITE)
    ws.row_dimensions[tot + 1].hidden = True
    for c in range(1, 14):
        total_style(ws.cell(tot, c), T, CURRENCY0)

    line = LineChart()
    line.title = "Total debt over the year"
    line.add_data(Reference(ws, min_col=2, max_col=13, min_row=tot + 1), from_rows=True, titles_from_data=False)
    line.set_categories(Reference(ws, min_col=2, max_col=13, min_row=br0))
    line.height, line.width = 7, 16
    line.legend = None
    line.y_axis.numFmt = '"$"#,##0'
    line.y_axis.majorGridlines = None
    s = line.series[0]
    s.graphicalProperties.line.solidFill = "E11D48"
    s.graphicalProperties.line.width = 28000
    s.smooth = False
    _chart_fix(line, axes=True)
    ws.add_chart(line, f"A{tot + 3}")
    ws.freeze_panes = "A7"
    return ws, (br0, tot)


# ---------------------------------------------------------------- Savings
SAMPLE_GOALS = [("Emergency fund (3 months)", 9000, dt.date(2027, 12, 31), 2500, [250, 250, 250]),
                ("Summer vacation", 2400, dt.date(2027, 7, 1), 300, [100, 100, 100]),
                ("New laptop", 1200, dt.date(2027, 9, 1), 0, [50, 75, 60]),
                ("Holiday gifts 2027", 800, dt.date(2027, 11, 15), 0, [40, 40, 40])]


def build_savings(wb, sample):
    ws = wb.create_sheet("Savings Goals")
    widths = {"A": 26, "B": 12, "C": 12, "D": 12}
    for i in range(12):
        widths[L(5 + i)] = 8.5
    widths.update({"Q": 12, "R": 12, "S": 13, "T": 11})
    base_sheet(ws, widths, tab_color="F59E0B")
    title(ws, "A1", "Savings Goals & Sinking Funds", T,
          sub="Set a target and date. Log what you put in each month. The sheet tells you how much per month you need.")
    header_row(ws, 4, 1, ["Goal", "Target", "Target date", "Already saved"] + TABS +
               ["Total saved", "Still needed", "Needed / month", "Progress"], T, height=32)
    N = 15
    first, last = 5, 4 + N
    for i in range(N):
        r = first + i
        if sample and i < len(SAMPLE_GOALS):
            n, tgt, d, start, contrib = SAMPLE_GOALS[i]
            ws.cell(r, 1, n)
            ws.cell(r, 2, tgt)
            ws.cell(r, 3, d)
            ws.cell(r, 4, start)
            for m, v in enumerate(contrib):
                ws.cell(r, 5 + m, v)
        style_cell(ws.cell(r, 1), input_=True)
        style_cell(ws.cell(r, 2), fmt=CURRENCY0, input_=True)
        style_cell(ws.cell(r, 3), fmt="mmm d, yyyy", input_=True, align="center")
        style_cell(ws.cell(r, 4), fmt=CURRENCY0, input_=True)
        for m in range(12):
            style_cell(ws.cell(r, 5 + m), fmt=CURRENCY0, input_=True)
        ws.cell(r, 17, f'=IF(A{r}="","",N(D{r})+SUM(E{r}:P{r}))')
        ws.cell(r, 18, f'=IF(A{r}="","",MAX(0,N(B{r})-Q{r}))')
        ws.cell(r, 19, f'=IF(OR(A{r}="",C{r}=""),"",IF(R{r}=0,0,R{r}/MAX(1,'
                       f'(YEAR(C{r})-YEAR(TODAY()))*12+MONTH(C{r})-MONTH(TODAY()))))')
        ws.cell(r, 20, f'=IF(OR(A{r}="",N(B{r})=0),"",MIN(1,Q{r}/B{r}))')
        style_cell(ws.cell(r, 17), fmt=CURRENCY0)
        style_cell(ws.cell(r, 18), fmt=CURRENCY0)
        style_cell(ws.cell(r, 19), fmt=CURRENCY0, bold=True)
        style_cell(ws.cell(r, 20), fmt=PCT, align="center")
    ws.conditional_formatting.add(f"T{first}:T{last}", DataBarRule(
        start_type="num", start_value=0, end_type="num", end_value=1, color="14B8A6"))
    tr = last + 1
    ws.cell(tr, 1, "Total")
    for c in [2, 4] + list(range(5, 19)):
        col = L(c)
        ws.cell(tr, c, f"=SUM({col}{first}:{col}{last})")
    ws.cell(tr, 20, f'=IF(B{tr}=0,"",MIN(1,Q{tr}/B{tr}))')
    for c in range(1, 21):
        total_style(ws.cell(tr, c), T, PCT if c == 20 else CURRENCY0)
    note_text(ws, f"A{tr + 1}", "'Needed / month' counts the months from today until the target date.")
    ws.freeze_panes = "B5"
    return ws


def build(out_dir, sample):
    wb = Workbook()
    build_start(wb)
    build_setup(wb, sample)
    for mi in range(12):
        build_month(wb, mi, sample)
    build_dashboard(wb)
    build_bills(wb, sample)
    build_debt(wb, sample)
    build_savings(wb, sample)
    # order: Start Here, Dashboard, Setup, Jan..Dec, Bills, Debt, Savings
    order = ["Start Here", "Dashboard", "Setup"] + TABS + ["Bills", "Debt Payoff", "Savings Goals"]
    wb._sheets = [wb[n] for n in order]
    wb.active = 0
    for ws in wb.worksheets:
        ws.sheet_view.tabSelected = ws.title == "Start Here"
    name = f"{YEAR}-Budget-Planner{'-SAMPLE' if sample else ''}.xlsx"
    path = Path(out_dir) / name
    wb.save(path)
    return path


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "dist"
    Path(out).mkdir(parents=True, exist_ok=True)
    for s in (False, True):
        print(build(out, s))
