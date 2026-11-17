"""Builds the Christmas Gift & Holiday Budget Tracker (blank + sample versions).

Usage: python src/build_christmas_tracker.py <out_dir>
"""
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.formatting.rule import CellIsRule, DataBarRule, FormulaRule
from openpyxl.styles import Alignment, Font

sys.path.insert(0, str(Path(__file__).parent))
from style import (BOX, CURRENCY, CURRENCY0, FONT, INPUT, MUTED, PCT, WHITE, Theme, base_sheet,
                   fill, font, header_row, list_validation, note_text, section, style_cell, title,
                   total_style)

T = Theme(dark="7F1D1D", mid="166534", light="FCEFEF", accent="B91C1C")
GREEN_LIGHT = "E3F4E8"
YEAR = 2026
GROUPS = ["Family", "Kids", "Friends", "Work", "Teachers & Helpers", "Other"]
STATUSES = ["Idea", "Ordered", "Bought", "Wrapped", "Given"]
EXP_CATS = ["Food & Drinks", "Decorations", "Cards & Wrapping", "Travel", "Events & Parties",
            "Charity", "Other"]
GIFT_FIRST, GIFT_N = 6, 80
GIFT_LAST = GIFT_FIRST + GIFT_N - 1
EXP_FIRST, EXP_N = 6, 40
EXP_LAST = EXP_FIRST + EXP_N - 1

SAMPLE_GIFTS = [
    ("Mom", "Family", 80, "Cozy robe + slippers", "Nordstrom", 74.50, "Wrapped"),
    ("Dad", "Family", 80, "Grill tool set", "Home Depot", 86.99, "Bought"),
    ("Jess (sister)", "Family", 60, "Candle making kit", "Etsy", 42.00, "Ordered"),
    ("Grandma", "Family", 40, "Photo calendar", "Shutterfly", 34.99, "Ordered"),
    ("Liam", "Kids", 50, "LEGO set", "Target", 49.99, "Wrapped"),
    ("Emma", "Kids", 50, "Art supply box", "Michaels", 38.75, "Bought"),
    ("Noah (nephew)", "Kids", 30, "Board game", "Amazon", None, "Idea"),
    ("Sarah", "Friends", 30, "Coffee sampler", "Local roaster", 28.00, "Bought"),
    ("Mike & Ana", "Friends", 40, "Wine + cheese board", "Trader Joe's", None, "Idea"),
    ("Secret Santa", "Work", 25, "Desk plant", "Lowe's", 22.48, "Given"),
    ("Boss", "Work", 20, "Gourmet chocolates", "See's", None, "Idea"),
    ("Ms. Lopez (teacher)", "Teachers & Helpers", 20, "Gift card + card", "Starbucks", 20.00, "Wrapped"),
    ("Mail carrier", "Teachers & Helpers", 15, "Cookies + gift card", "Homemade", 15.00, "Bought"),
]
SAMPLE_EXP = [
    ("Christmas dinner groceries", "Food & Drinks", 180, 0), ("Baking supplies", "Food & Drinks", 40, 36.20),
    ("Tree", "Decorations", 75, 69.99), ("New lights", "Decorations", 30, 24.50),
    ("Wrapping paper & tape", "Cards & Wrapping", 25, 31.40), ("Photo cards + stamps", "Cards & Wrapping", 60, 58.75),
    ("Gas to Grandma's", "Travel", 60, 0), ("Office party outfit", "Events & Parties", 50, 0),
    ("Toy drive donation", "Charity", 40, 40),
]
SAMPLE_CARDS = [("The Johnsons", "12 Oak St, Springfield", "Yes", "Yes"),
                ("Aunt Carol", "88 Pine Ave, Riverton", "Yes", ""),
                ("Grandma", "5 Elm Ct, Lakeside", "Yes", "Yes"),
                ("The Parks", "301 Main St, Apt 4", "", "Yes"),
                ("Coach Dan", "77 Field Rd, Springfield", "", "")]


def build_start(wb):
    ws = wb.active
    ws.title = "Start Here"
    base_sheet(ws, {"A": 3, "B": 30, "C": 84}, tab_color=T.mid)
    title(ws, "B2", "Christmas Gift & Holiday Budget Tracker", T, size=22)
    note_text(ws, "B3", "Gift list  •  Holiday spending  •  Card list  •  Dashboard with countdown", size=10,
              italic=False)
    ws["B5"] = "Yellow cells"
    style_cell(ws["B5"], input_=True, bold=True, align="center")
    ws["C5"] = "Type in these. Every other cell calculates by itself."
    ws["C5"].font = font(10, color=MUTED, italic=True)
    steps = [
        ("1. Lists tab", "Set the holiday year and your total budget. Rename the groups or expense types "
                         "if you like."),
        ("2. Gift List", "One row per person: who, which group, how much you want to spend, the gift idea, "
                         "where to get it, what it actually cost and its status (Idea → Ordered → Bought → "
                         "Wrapped → Given)."),
        ("3. Holiday Expenses", "Everything that isn't a gift: food, decorations, cards, travel, parties, "
                                "donations. Plan vs. actual."),
        ("4. Card List", "Names and addresses, plus whether you've sent and received a card. Reuse it next year."),
        ("5. Dashboard", "Countdown to Christmas, total budget vs. spent, how many gifts are done, and spending "
                         "by group. Fills in automatically."),
    ]
    r = 7
    section(ws, f"B{r}", "How to use it", T)
    r += 1
    for h, b in steps:
        ws[f"B{r}"] = h
        ws[f"B{r}"].font = font(10, bold=True, color=T.dark)
        ws[f"B{r}"].alignment = Alignment(vertical="top")
        ws[f"C{r}"] = b
        ws[f"C{r}"].font = font(10)
        ws[f"C{r}"].alignment = Alignment(wrap_text=True, vertical="top")
        ws.row_dimensions[r].height = 30
        r += 1
    r += 1
    section(ws, f"B{r}", "Opening the file", T)
    r += 1
    for h, b in [("Microsoft Excel", "Open the .xlsx file (Excel 2010 or newer, Windows or Mac)."),
                 ("Google Sheets (free)", "sheets.google.com → File → Import → Upload → choose this file → "
                                          "Replace spreadsheet. Drop-downs, colors and charts all carry over."),
                 ("Apple Numbers", "Open the .xlsx in Numbers. Formulas work; chart styling may differ.")]:
        ws[f"B{r}"] = h
        ws[f"B{r}"].font = font(10, bold=True)
        ws[f"C{r}"] = b
        ws[f"C{r}"].font = font(10)
        ws[f"C{r}"].alignment = Alignment(wrap_text=True, vertical="top")
        ws.row_dimensions[r].height = 30
        r += 1
    r += 1
    section(ws, f"B{r}", "Tips", T)
    r += 1
    for t in ["If a gift costs more than you planned, its cost turns red.",
              "Leave 'Actual cost' empty until you buy it; the Dashboard counts only real spending.",
              "Next year: clear the Actual cost and Status columns and keep your names, groups and card list."]:
        ws[f"B{r}"] = "•"
        ws[f"B{r}"].alignment = Alignment(horizontal="right", vertical="top")
        ws[f"C{r}"] = t
        ws[f"C{r}"].font = font(10)
        ws[f"C{r}"].alignment = Alignment(wrap_text=True, vertical="top")
        r += 1


def build_lists(wb, sample):
    ws = wb.create_sheet("Lists")
    base_sheet(ws, {"A": 30, "B": 16, "C": 3, "D": 22, "E": 3, "F": 16, "G": 3, "H": 22}, tab_color="94A3B8")
    title(ws, "A1", "Lists & Settings", T, sub="Edit the yellow cells. Drop-downs across the file use these lists.")
    ws["A4"] = "Holiday year"
    ws["A4"].font = font(10, bold=True)
    ws["B4"] = YEAR
    style_cell(ws["B4"], fmt="0", input_=True, bold=True, align="center")
    ws["A5"] = "Total holiday budget (gifts + everything else)"
    ws["A5"].font = font(10, bold=True)
    ws["B5"] = 1200 if sample else None
    style_cell(ws["B5"], fmt=CURRENCY0, input_=True, bold=True)
    note_text(ws, "A6", "Leave the total budget empty to use the sum of your gift + expense plans.")
    for col, head, items in (("D", "Gift groups", GROUPS), ("F", "Gift status", STATUSES),
                             ("H", "Expense types", EXP_CATS)):
        c = ws[f"{col}8"]
        header_row(ws, 8, c.column, [head], T)
        for i, it in enumerate(items):
            cell = ws[f"{col}{9 + i}"]
            cell.value = it
            style_cell(cell, input_=True)
        # spare slots for custom entries
        for i in range(len(items), 10):
            style_cell(ws[f"{col}{9 + i}"], input_=True)
    note_text(ws, "F20", "Keep these 5 status names: the Dashboard counts them.")


def build_gifts(wb, sample):
    ws = wb.create_sheet("Gift List")
    base_sheet(ws, {"A": 22, "B": 18, "C": 11, "D": 28, "E": 18, "F": 12, "G": 11, "H": 11, "I": 26},
               tab_color=T.accent)
    title(ws, "A1", "Gift List", T, sub="One row per person. Pick a group and a status from the drop-downs.")
    ws["A3"] = '="Gifts done: "&COUNTIFS(G6:G85,"Wrapped")+COUNTIFS(G6:G85,"Given")&" of "&COUNTA(A6:A85)'
    ws["A3"].font = font(11, bold=True, color=T.mid)
    header_row(ws, 5, 1, ["Recipient", "Group", "Budget", "Gift idea", "Where to buy", "Actual cost",
                          "Status", "Over / under", "Notes / link"], T)
    for i in range(GIFT_N):
        r = GIFT_FIRST + i
        if sample and i < len(SAMPLE_GIFTS):
            for c, v in enumerate(SAMPLE_GIFTS[i], start=1):
                col = c if c <= 5 else c  # name, group, budget, idea, where, cost, status
                ws.cell(r, col, v)
        style_cell(ws.cell(r, 1), input_=True)
        style_cell(ws.cell(r, 2), input_=True)
        style_cell(ws.cell(r, 3), fmt=CURRENCY, input_=True)
        style_cell(ws.cell(r, 4), input_=True)
        style_cell(ws.cell(r, 5), input_=True)
        style_cell(ws.cell(r, 6), fmt=CURRENCY, input_=True)
        style_cell(ws.cell(r, 7), input_=True, align="center")
        ws.cell(r, 8, f'=IF(F{r}="","",N(C{r})-F{r})')
        style_cell(ws.cell(r, 8), fmt=CURRENCY)
        style_cell(ws.cell(r, 9), input_=True)
    list_validation(ws, "Lists!$D$9:$D$18", f"B{GIFT_FIRST}:B{GIFT_LAST}")
    list_validation(ws, "Lists!$F$9:$F$18", f"G{GIFT_FIRST}:G{GIFT_LAST}")
    red = font(10, True, "B91C1C")
    ws.conditional_formatting.add(f"F{GIFT_FIRST}:F{GIFT_LAST}", FormulaRule(
        formula=[f'AND(F{GIFT_FIRST}<>"",C{GIFT_FIRST}<>"",F{GIFT_FIRST}>C{GIFT_FIRST})'],
        font=red, fill=fill("FDE2E2")))
    ws.conditional_formatting.add(f"H{GIFT_FIRST}:H{GIFT_LAST}", CellIsRule(
        operator="lessThan", formula=["0"], font=red))
    status_colors = {"Idea": ("F1F5F9", "475569"), "Ordered": ("FEF3C7", "92400E"),
                     "Bought": ("DBEAFE", "1E40AF"), "Wrapped": ("FCE7F3", "9D174D"),
                     "Given": ("DCFCE7", "166534")}
    for s, (bg, fg) in status_colors.items():
        ws.conditional_formatting.add(f"G{GIFT_FIRST}:G{GIFT_LAST}", CellIsRule(
            operator="equal", formula=[f'"{s}"'], fill=fill(bg), font=font(10, True, fg)))
    tr = GIFT_LAST + 1
    ws.cell(tr, 1, "Total")
    ws.cell(tr, 3, f"=SUM(C{GIFT_FIRST}:C{GIFT_LAST})")
    ws.cell(tr, 6, f"=SUM(F{GIFT_FIRST}:F{GIFT_LAST})")
    ws.cell(tr, 8, f"=SUM(H{GIFT_FIRST}:H{GIFT_LAST})")
    for c in range(1, 10):
        total_style(ws.cell(tr, c), T, CURRENCY)
    ws.freeze_panes = "B6"
    ws.auto_filter.ref = f"A5:I{GIFT_LAST}"


def build_expenses(wb, sample):
    ws = wb.create_sheet("Holiday Expenses")
    base_sheet(ws, {"A": 30, "B": 20, "C": 13, "D": 13, "E": 13, "F": 3, "G": 20, "H": 13, "I": 13},
               tab_color=T.mid)
    title(ws, "A1", "Holiday Expenses", T, sub="Everything that isn't a gift: food, decor, cards, travel, parties.")
    header_row(ws, 5, 1, ["Item", "Type", "Planned", "Actual", "Remaining"], T)
    for i in range(EXP_N):
        r = EXP_FIRST + i
        if sample and i < len(SAMPLE_EXP):
            n, t, p, a = SAMPLE_EXP[i]
            ws.cell(r, 1, n)
            ws.cell(r, 2, t)
            ws.cell(r, 3, p)
            ws.cell(r, 4, a if a else None)
        style_cell(ws.cell(r, 1), input_=True)
        style_cell(ws.cell(r, 2), input_=True)
        style_cell(ws.cell(r, 3), fmt=CURRENCY, input_=True)
        style_cell(ws.cell(r, 4), fmt=CURRENCY, input_=True)
        ws.cell(r, 5, f'=IF(AND(A{r}="",C{r}="",D{r}=""),"",N(C{r})-N(D{r}))')
        style_cell(ws.cell(r, 5), fmt=CURRENCY)
    list_validation(ws, "Lists!$H$9:$H$18", f"B{EXP_FIRST}:B{EXP_LAST}")
    ws.conditional_formatting.add(f"E{EXP_FIRST}:E{EXP_LAST + 1}", CellIsRule(
        operator="lessThan", formula=["0"], font=font(10, True, "B91C1C"), fill=fill("FDE2E2")))
    tr = EXP_LAST + 1
    ws.cell(tr, 1, "Total")
    for c, col in ((3, "C"), (4, "D"), (5, "E")):
        ws.cell(tr, c, f"=SUM({col}{EXP_FIRST}:{col}{EXP_LAST})")
    for c in range(1, 6):
        total_style(ws.cell(tr, c), T, CURRENCY)
    header_row(ws, 5, 7, ["By type", "Planned", "Actual"], T)
    for i in range(10):
        r = 6 + i
        ws.cell(r, 7, f'=IF(Lists!$H${9 + i}="","",Lists!$H${9 + i})')
        ws.cell(r, 8, f'=IF(G{r}="","",SUMIFS($C${EXP_FIRST}:$C${EXP_LAST},$B${EXP_FIRST}:$B${EXP_LAST},G{r}))')
        ws.cell(r, 9, f'=IF(G{r}="","",SUMIFS($D${EXP_FIRST}:$D${EXP_LAST},$B${EXP_FIRST}:$B${EXP_LAST},G{r}))')
        style_cell(ws.cell(r, 7))
        style_cell(ws.cell(r, 8), fmt=CURRENCY)
        style_cell(ws.cell(r, 9), fmt=CURRENCY)
    ws.freeze_panes = "A6"


def build_cards(wb, sample):
    ws = wb.create_sheet("Card List")
    base_sheet(ws, {"A": 26, "B": 46, "C": 11, "D": 11, "E": 26}, tab_color="F59E0B")
    title(ws, "A1", "Holiday Card List", T, sub="Keep it year to year. Mark who you've sent to and heard from.")
    ws["A3"] = '="Cards sent: "&COUNTIF(C6:C105,"Yes")&" of "&COUNTA(A6:A105)'
    ws["A3"].font = font(11, bold=True, color=T.mid)
    header_row(ws, 5, 1, ["Name", "Address", "Sent?", "Received?", "Notes"], T)
    for i in range(100):
        r = 6 + i
        if sample and i < len(SAMPLE_CARDS):
            for c, v in enumerate(SAMPLE_CARDS[i], start=1):
                ws.cell(r, c, v or None)
        for c in range(1, 6):
            style_cell(ws.cell(r, c), input_=True, align="center" if c in (3, 4) else None)
    list_validation(ws, '"Yes,No"', "C6:D105")
    ws.conditional_formatting.add("C6:D105", CellIsRule(operator="equal", formula=['"Yes"'],
                                                        fill=fill(GREEN_LIGHT), font=font(10, True, "166534")))
    ws.freeze_panes = "A6"


def build_dashboard(wb):
    ws = wb.create_sheet("Dashboard", 1)
    base_sheet(ws, {"A": 22, "B": 15, "C": 15, "D": 15, "E": 15, "F": 3, "G": 16, "H": 12}, tab_color=T.accent)
    ws["A1"] = '="Christmas "&Lists!$B$4&"  •  Dashboard"'
    ws["A1"].font = Font(name=FONT, size=22, bold=True, color=T.dark)
    ws.row_dimensions[1].height = 36
    note_text(ws, "A2", "Updates automatically from the Gift List and Holiday Expenses tabs.")

    gl = f"'Gift List'"
    he = f"'Holiday Expenses'"
    budget_f = f"=IF(N(Lists!$B$5)>0,Lists!$B$5,D9)"
    done_f = (f'=IF(COUNTA({gl}!A{GIFT_FIRST}:A{GIFT_LAST})=0,0,'
              f'(COUNTIFS({gl}!G{GIFT_FIRST}:G{GIFT_LAST},"Wrapped")+COUNTIFS({gl}!G{GIFT_FIRST}:G{GIFT_LAST},"Given"))'
              f'/COUNTA({gl}!A{GIFT_FIRST}:A{GIFT_LAST}))')
    tiles = [
        ("Days until Christmas", "=MAX(0,DATE(Lists!$B$4,12,25)-TODAY())", "0"),
        ("Total budget", budget_f, CURRENCY0),
        ("Spent so far", "=D10", CURRENCY0),
        ("Left to spend", "=B5-C5", CURRENCY0),
        ("Gifts done", done_f, PCT),
    ]
    for i, (lab, f, fmt) in enumerate(tiles):
        col = 1 + i
        a = ws.cell(4, col, lab)
        a.font = Font(name=FONT, size=9, bold=True, color=WHITE)
        a.fill = fill(T.dark if i else T.mid)
        a.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        b = ws.cell(5, col, f)
        b.font = Font(name=FONT, size=18, bold=True, color=T.dark if i else T.mid)
        b.fill = fill(T.light if i else GREEN_LIGHT)
        b.alignment = Alignment(horizontal="center", vertical="center")
        b.number_format = fmt
    ws.row_dimensions[4].height = 24
    ws.row_dimensions[5].height = 40
    ws.conditional_formatting.add("D5", CellIsRule(operator="lessThan", formula=["0"],
                                                   font=Font(name=FONT, size=18, bold=True, color="B91C1C")))

    header_row(ws, 8, 1, ["", "Gifts", "Other expenses", "Total"], T)
    rows = [("Planned", f"={gl}!C{GIFT_LAST + 1}", f"={he}!C{EXP_LAST + 1}", "=B9+C9"),
            ("Spent", f"={gl}!F{GIFT_LAST + 1}", f"={he}!D{EXP_LAST + 1}", "=B10+C10"),
            ("Remaining", "=B9-B10", "=C9-C10", "=D9-D10")]
    for k, row in enumerate(rows):
        r = 9 + k
        for c, v in enumerate(row, start=1):
            ws.cell(r, c, v)
            if c == 1:
                style_cell(ws.cell(r, c), bold=(k == 2))
            else:
                style_cell(ws.cell(r, c), fmt=CURRENCY, bold=(k == 2))
    ws.conditional_formatting.add("B11:D11", CellIsRule(operator="lessThan", formula=["0"],
                                                        font=font(10, True, "B91C1C")))

    # by group
    header_row(ws, 14, 1, ["Group", "Budget", "Spent", "People", "Done"], T)
    for i in range(10):
        r = 15 + i
        ws.cell(r, 1, f'=IF(Lists!$D${9 + i}="","",Lists!$D${9 + i})')
        rng_g = f"{gl}!$B${GIFT_FIRST}:$B${GIFT_LAST}"
        ws.cell(r, 2, f'=IF(A{r}="","",SUMIFS({gl}!$C${GIFT_FIRST}:$C${GIFT_LAST},{rng_g},A{r}))')
        ws.cell(r, 3, f'=IF(A{r}="","",SUMIFS({gl}!$F${GIFT_FIRST}:$F${GIFT_LAST},{rng_g},A{r}))')
        ws.cell(r, 4, f'=IF(A{r}="","",COUNTIFS({rng_g},A{r}))')
        ws.cell(r, 5, f'=IF(A{r}="","",COUNTIFS({rng_g},A{r},{gl}!$G${GIFT_FIRST}:$G${GIFT_LAST},"Wrapped")'
                      f'+COUNTIFS({rng_g},A{r},{gl}!$G${GIFT_FIRST}:$G${GIFT_LAST},"Given"))')
        style_cell(ws.cell(r, 1))
        style_cell(ws.cell(r, 2), fmt=CURRENCY)
        style_cell(ws.cell(r, 3), fmt=CURRENCY)
        style_cell(ws.cell(r, 4), fmt="0", align="center")
        style_cell(ws.cell(r, 5), fmt="0", align="center")

    # status
    header_row(ws, 8, 7, ["Gift status", "Count"], T)
    for i, s in enumerate(STATUSES):
        r = 9 + i
        ws.cell(r, 7, s)
        ws.cell(r, 8, f'=COUNTIFS({gl}!$G${GIFT_FIRST}:$G${GIFT_LAST},G{r})')
        style_cell(ws.cell(r, 7))
        style_cell(ws.cell(r, 8), fmt="0", align="center")
    ws.conditional_formatting.add("H9:H13", DataBarRule(start_type="num", start_value=0, end_type="max",
                                                        color="B91C1C"))

    bar = BarChart()
    bar.type = "bar"
    bar.title = "Gift budget vs. spent by group"
    bar.add_data(Reference(ws, min_col=2, max_col=3, min_row=14, max_row=14 + len(GROUPS)), titles_from_data=True)
    bar.set_categories(Reference(ws, min_col=1, min_row=15, max_row=14 + len(GROUPS)))
    bar.height, bar.width = 8, 15
    bar.x_axis.scaling.orientation = "maxMin"
    bar.y_axis.numFmt = '"$"#,##0'
    bar.y_axis.majorGridlines = None
    bar.series[0].graphicalProperties.solidFill = "FCA5A5"
    bar.series[0].graphicalProperties.line.solidFill = "FCA5A5"
    bar.series[1].graphicalProperties.solidFill = T.dark
    bar.series[1].graphicalProperties.line.solidFill = T.dark
    bar.roundedCorners = False
    bar.legend.position = "b"
    bar.legend.overlay = False
    bar.x_axis.delete = False
    bar.y_axis.delete = False
    ws.add_chart(bar, "G15")


def build(out_dir, sample):
    wb = Workbook()
    build_start(wb)
    build_lists(wb, sample)
    build_gifts(wb, sample)
    build_expenses(wb, sample)
    build_cards(wb, sample)
    build_dashboard(wb)
    order = ["Start Here", "Dashboard", "Gift List", "Holiday Expenses", "Card List", "Lists"]
    wb._sheets = [wb[n] for n in order]
    wb.active = 0
    for ws in wb.worksheets:
        ws.sheet_view.tabSelected = ws.title == "Start Here"
    path = Path(out_dir) / f"Christmas-Gift-Budget-Tracker{'-SAMPLE' if sample else ''}.xlsx"
    wb.save(path)
    return path


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "dist"
    Path(out).mkdir(parents=True, exist_ok=True)
    for s in (False, True):
        print(build(out, s))
