"""Render chosen sheet ranges of a workbook to cropped PNGs via LibreOffice.

render(xlsx, [(sheet, range, out_png), ...], dpi)
"""
import shutil, subprocess, sys, tempfile
from pathlib import Path
from openpyxl import load_workbook
from PIL import Image, ImageChops


def _trim(path, pad=24):
    im = Image.open(path).convert("RGB")
    bg = Image.new("RGB", im.size, (255, 255, 255))
    box = ImageChops.difference(im, bg).getbbox()
    if box:
        l, t, r, b = box
        im = im.crop((max(0, l - pad), max(0, t - pad), min(im.width, r + pad), min(im.height, b + pad)))
    im.save(path)


def render(xlsx, jobs, dpi=200):
    tmp = Path(tempfile.mkdtemp())
    for i, (sheet, rng, out) in enumerate(jobs):
        wb = load_workbook(xlsx)
        for ws in wb.worksheets:
            ws.sheet_state = "visible" if ws.title == sheet else "hidden"
            ws.sheet_view.tabSelected = ws.title == sheet

        ws = wb[sheet]
        wb._sheets.remove(ws)
        wb._sheets.insert(0, ws)  # hidden sheets with print areas still export; make ours page 1
        wb.active = 0
        ws.print_area = rng
        ws.page_setup.orientation = "landscape"
        ws.sheet_properties.pageSetUpPr.fitToPage = True
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 1
        ws.print_options.gridLines = False
        ws.page_margins.left = ws.page_margins.right = 0.2
        ws.page_margins.top = ws.page_margins.bottom = 0.2
        ws.oddHeader.center.text = ""
        ws.oddFooter.center.text = ""
        f = tmp / f"j{i}.xlsx"
        wb.save(f)
        subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", str(tmp), str(f)],
                       check=True, capture_output=True, timeout=180)
        subprocess.run(["pdftoppm", "-r", str(dpi), "-png", "-singlefile", "-f", "1", "-l", "1",
                        str(tmp / f"j{i}.pdf"), str(tmp / f"j{i}")], check=True)
        shutil.move(tmp / f"j{i}.png", out)
        _trim(out)
        print("rendered", out)
    shutil.rmtree(tmp)
