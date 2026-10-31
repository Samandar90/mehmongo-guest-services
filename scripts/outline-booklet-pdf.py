#!/usr/bin/env python
"""
Turns the booklet's print PDF into one with no fonts left in it, every letter a
curve, for a print shop that opens files in CorelDRAW:

    pip install pymupdf
    npm run booklet
    npm run booklet:curves

Writes MehmonGo-booklet-print-A4-curves.pdf and svg-curves/ beside the print PDF.
No free tool writes CorelDRAW's own .cdr format; Corel imports these and saves it.

Chrome writes Geist as a Type 3 font, which is what such an import tends to
mishandle. The way out is to let MuPDF draw each side as SVG with the text as
paths, then have Chrome print that SVG back to PDF at exactly the same page size,
so the cut marks stay where they are. It keeps colour and vector shapes only
because the booklet uses no transparency: MuPDF drops soft masks on this trip.
"""
import pathlib
import subprocess
import sys
import tempfile

import fitz

BROWSERS = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
]


def print_svg(browser, svg, width_pt, height_pt, html_path, pdf_path):
    html_path.write_text(
        "<!doctype html><meta charset='utf-8'><style>"
        f"@page{{size:{width_pt}pt {height_pt}pt;margin:0}}"
        "html,body{margin:0;padding:0;background:#fff}"
        f"svg{{display:block;width:{width_pt}pt;height:{height_pt}pt}}"
        "</style>" + svg[svg.index("<svg"):],
        encoding="utf-8",
    )
    subprocess.run(
        [
            browser,
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--no-pdf-header-footer",
            "--virtual-time-budget=20000",
            f"--print-to-pdf={pdf_path}",
            html_path.as_uri(),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True,
    )


def main():
    folder = pathlib.Path(sys.argv[1]).resolve()
    browser = next((path for path in BROWSERS if pathlib.Path(path).exists()), None)
    if browser is None:
        raise SystemExit("Neither Chrome nor Edge was found; one of them writes the PDF.")

    source = fitz.open(folder / "MehmonGo-booklet-print-A4.pdf")
    svg_dir = folder / "svg-curves"
    svg_dir.mkdir(exist_ok=True)
    result = fitz.open()

    with tempfile.TemporaryDirectory() as work:
        work = pathlib.Path(work)
        for index, page in enumerate(source, start=1):
            svg = page.get_svg_image(text_as_path=True)
            if "<text" in svg:
                raise SystemExit(f"Side {index} still has live text.")
            if "<mask" in svg:
                raise SystemExit(f"Side {index} has transparency, which this trip would lose.")
            (svg_dir / f"MehmonGo-booklet-side-{index}.svg").write_text(svg, encoding="utf-8")
            pdf_path = work / f"side-{index}.pdf"
            print_svg(browser, svg, page.rect.width, page.rect.height, work / f"side-{index}.html", pdf_path)
            with fitz.open(pdf_path) as side:
                result.insert_pdf(side, from_page=0, to_page=0)

    if len(result) != len(source):
        raise SystemExit(f"Expected {len(source)} sides, wrote {len(result)}.")
    fonts = {font[3] for page in result for font in page.get_fonts()}
    if fonts:
        raise SystemExit(f"Fonts are still embedded: {sorted(fonts)}")

    target = folder / "MehmonGo-booklet-print-A4-curves.pdf"
    result.save(target, garbage=3, deflate=True)
    print(f"{target.name} written, no fonts left")


if __name__ == "__main__":
    main()
