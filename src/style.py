"""Shared styling helpers for the spreadsheet products."""
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.datavalidation import DataValidation

FONT = "Arial"

# Palette
INK = "1F2937"        # body text
MUTED = "6B7280"      # secondary text
WHITE = "FFFFFF"
INPUT = "FFF7D6"      # soft yellow = "type here"
LINE = "E5E7EB"

CURRENCY = '"$"#,##0.00;[Red]-"$"#,##0.00;"-"'
CURRENCY0 = '"$"#,##0;[Red]-"$"#,##0;"-"'
PCT = '0%;[Red]-0%;"-"'
DATE = "mmm d, yyyy"

thin = Side(style="thin", color=LINE)
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)


def fill(hex_):
    return PatternFill("solid", start_color=hex_, end_color=hex_)


def font(size=10, bold=False, color=INK, italic=False):
    return Font(name=FONT, size=size, bold=bold, color=color, italic=italic)


class Theme:
    def __init__(self, dark, mid, light, accent):
        self.dark, self.mid, self.light, self.accent = dark, mid, light, accent


def base_sheet(ws, widths, tab_color=None, zoom=100):
    ws.sheet_view.showGridLines = False
    ws.sheet_view.zoomScale = zoom
    for col, w in widths.items():
        ws.column_dimensions[col].width = w
    if tab_color:
        ws.sheet_properties.tabColor = tab_color
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True


def title(ws, cell, text, theme, size=20, sub=None, sub_cell=None):
    ws[cell] = text
    ws[cell].font = Font(name=FONT, size=size, bold=True, color=theme.dark)
    ws.row_dimensions[ws[cell].row].height = size * 1.6
    if sub:
        sc = sub_cell or f"{ws[cell].column_letter}{ws[cell].row + 1}"
        ws[sc] = sub
        ws[sc].font = font(10, color=MUTED, italic=True)


def header_row(ws, row, col_start, labels, theme, height=22):
    for i, lab in enumerate(labels):
        c = ws.cell(row=row, column=col_start + i, value=lab)
        c.font = Font(name=FONT, size=10, bold=True, color=WHITE)
        c.fill = fill(theme.dark)
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = BOX
    ws.row_dimensions[row].height = height


def section(ws, cell, text, theme):
    ws[cell] = text
    ws[cell].font = Font(name=FONT, size=12, bold=True, color=theme.dark)


def style_cell(c, fmt=None, input_=False, bold=False, align=None, color=INK, bg=None):
    c.font = font(10, bold=bold, color=color)
    c.border = BOX
    if fmt:
        c.number_format = fmt
    if input_:
        c.fill = fill(INPUT)
    elif bg:
        c.fill = fill(bg)
    if align:
        c.alignment = Alignment(horizontal=align, vertical="center")


def total_style(c, theme, fmt=None):
    c.font = Font(name=FONT, size=10, bold=True, color=theme.dark)
    c.fill = fill(theme.light)
    c.border = BOX
    if fmt:
        c.number_format = fmt


def list_validation(ws, formula, rng, allow_blank=True, prompt=None):
    dv = DataValidation(type="list", formula1=formula, allow_blank=allow_blank)
    dv.error = "Pick an option from the list (you can edit the list on the Setup tab)."
    dv.errorTitle = "Not in list"
    dv.showErrorMessage = False  # warn-free: lets people type new values too
    if prompt:
        dv.prompt = prompt
        dv.showInputMessage = True
    ws.add_data_validation(dv)
    dv.add(rng)
    return dv


def note_text(ws, cell, text, size=9, color=MUTED, italic=True):
    ws[cell] = text
    ws[cell].font = font(size, color=color, italic=italic)
    ws[cell].alignment = Alignment(wrap_text=False, vertical="top")


def legend(ws, row, col, theme):
    a = ws.cell(row=row, column=col, value="")
    a.fill = fill(INPUT)
    a.border = BOX
    b = ws.cell(row=row, column=col + 1, value="← type in these. Every other cell calculates by itself.")
    b.font = font(9, color=MUTED, italic=True)
