"""Scrape tables from Skerples' *Coins and Scrolls* into an Excel workbook.

Pulls posts from ``coinsandscrolls.blogspot.com`` via the Blogger JSON feed,
finds every ``<table>`` in each post, parses Skerples' two recurring layouts —

  * **d100-style:** a leading ``1d100 | <title>`` row, then numbered rows
    with bolded section subheaders interleaved between batches (every 10
    or so) where column 1 is blank and column 2 is the new heading.

  * **lookup-style:** plain 2-column tables (name to concept, etc.) with no
    numbering.

— and writes one sheet per table.  Posts without ``<table>`` markup fall back
to the same numbered-line regex used by ``scrape_d100_tables.py`` so list-
format d100s aren't missed.

Usage:
    pip install openpyxl requests beautifulsoup4
    python3 scrape_coinsandscrolls_tables.py
    python3 scrape_coinsandscrolls_tables.py --label GLOG --min-rows 10
    python3 scrape_coinsandscrolls_tables.py --limit 25 --out test.xlsx
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Iterator
from urllib.parse import quote

try:
    import requests
except ImportError:
    sys.exit("requests is required: pip install requests")

try:
    from bs4 import BeautifulSoup, NavigableString
except ImportError:
    sys.exit("beautifulsoup4 is required: pip install beautifulsoup4")

try:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
except ImportError:
    sys.exit("openpyxl is required: pip install openpyxl")


BLOG_HOST = "https://coinsandscrolls.blogspot.com"
FEED_PATH = "/feeds/posts/default"
PAGE_SIZE = 25
USER_AGENT = (
    "Mozilla/5.0 (compatible; coinsandscrolls-scraper/1.0; "
    "+https://github.com/lucasta-lestat/dnd-tools)"
)

# A column-1 value that means "this row is numbered N". Accepts plain ints
# and ranges like "1-2" / "1–2" (en-dash).
NUM_CELL_RE = re.compile(r"^\s*(\d{1,3})(?:\s*[-–]\s*\d{1,3})?\s*$")
# A column-1 value that looks like a die notation header ("1d100", "d20",
# "Roll"). Used to detect a title row at the top of a table.
DIE_HEADER_RE = re.compile(r"^\s*(\d*\s*d\s*\d+|roll|result)\s*$", re.IGNORECASE)
NUMBERED_LINE_RE = re.compile(r"^\s*(\d{1,3})\s*[.)\-:\]]\s+(.+?)\s*$")
INVALID_SHEET_CHARS = re.compile(r"[\[\]:*?/\\]")


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass
class TableRow:
    kind: str            # "data" or "section"
    number: int | None   # roll number for data rows (None for non-numeric)
    cells: list[str]     # data cells *after* the number column (or all cells
                         # for section rows / non-numeric data)


@dataclass
class ParsedTable:
    title: str
    rows: list[TableRow] = field(default_factory=list)
    column_count: int = 2

    @property
    def is_d100(self) -> bool:
        numbered = [r for r in self.rows if r.kind == "data" and r.number is not None]
        if len(numbered) < 10:
            return False
        return max(r.number for r in numbered) >= 20

    @property
    def data_row_count(self) -> int:
        return sum(1 for r in self.rows if r.kind == "data")


@dataclass
class Post:
    title: str
    url: str
    published: str
    labels: list[str]
    html: str
    tables: list[ParsedTable] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Feed fetching (same shape as scrape_d100_tables.py)
# ---------------------------------------------------------------------------


def feed_url(label: str | None, start_index: int, max_results: int) -> str:
    path = FEED_PATH
    if label:
        path = f"{FEED_PATH}/-/{quote(label)}"
    return (
        f"{BLOG_HOST}{path}"
        f"?alt=json&start-index={start_index}&max-results={max_results}"
    )


def fetch_feed_page(
    label: str | None,
    start_index: int,
    max_results: int,
    cache_dir: Path | None,
    session: requests.Session,
) -> dict:
    url = feed_url(label, start_index, max_results)
    cache_file = None
    if cache_dir is not None:
        safe_label = (label or "all").replace("/", "_")
        cache_file = cache_dir / f"feed_{safe_label}_{start_index}_{max_results}.json"
        if cache_file.exists():
            return json.loads(cache_file.read_text(encoding="utf-8"))

    for attempt in range(4):
        try:
            response = session.get(url, timeout=30)
            response.raise_for_status()
            data = response.json()
            break
        except requests.RequestException as exc:
            wait = 2 ** attempt
            print(f"  feed request failed ({exc}); retrying in {wait}s",
                  file=sys.stderr)
            time.sleep(wait)
    else:
        raise RuntimeError(f"giving up on feed page {url}")

    if cache_file is not None:
        cache_file.write_text(json.dumps(data), encoding="utf-8")
    return data


def iter_posts(
    label: str | None,
    cache_dir: Path | None,
    session: requests.Session,
    limit: int | None = None,
) -> Iterator[Post]:
    start = 1
    seen = 0
    while True:
        data = fetch_feed_page(label, start, PAGE_SIZE, cache_dir, session)
        feed = data.get("feed", {})
        entries = feed.get("entry", []) or []
        if not entries:
            return
        for entry in entries:
            post = post_from_entry(entry)
            if post is None:
                continue
            yield post
            seen += 1
            if limit is not None and seen >= limit:
                return
        total_str = feed.get("openSearch$totalResults", {}).get("$t")
        try:
            total = int(total_str) if total_str is not None else None
        except ValueError:
            total = None
        start += len(entries)
        if total is not None and start > total:
            return
        if len(entries) < PAGE_SIZE:
            return


def post_from_entry(entry: dict) -> Post | None:
    title = (entry.get("title") or {}).get("$t", "").strip()
    if not title:
        return None
    html = (entry.get("content") or {}).get("$t", "") or ""
    published = (entry.get("published") or {}).get("$t", "")
    labels = [c.get("term", "") for c in entry.get("category", []) if c.get("term")]
    url = ""
    for link in entry.get("link", []):
        if link.get("rel") == "alternate" and link.get("type") == "text/html":
            url = link.get("href", "")
            break
    return Post(title=title, url=url, published=published, labels=labels, html=html)


# ---------------------------------------------------------------------------
# Table extraction
# ---------------------------------------------------------------------------


def extract_tables(html: str, post_title: str) -> list[ParsedTable]:
    """Find every parseable table in the post body, in document order.

    Walks the body once, tracking the most recent heading text so we can
    use it as the table title when the table itself doesn't carry one.
    Falls back to the numbered-line regex when there are no ``<table>`` tags
    so we still capture list-format d100s.
    """
    soup = BeautifulSoup(html, "html.parser")
    for junk in soup(["script", "style"]):
        junk.decompose()

    current_heading = ""
    tables: list[ParsedTable] = []
    for el in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "table"]):
        if el.name == "table":
            parsed = _parse_html_table(el, title_hint=current_heading)
            if parsed is not None:
                tables.append(parsed)
        else:
            text = _clean_text(el.get_text(" ", strip=True))
            if text:
                current_heading = text

    if not tables:
        list_table = _parse_from_numbered_text(soup, fallback_title=post_title)
        if list_table is not None:
            tables.append(list_table)

    return tables


def _parse_html_table(tbl, title_hint: str) -> ParsedTable | None:
    raw_rows: list[list[str]] = []
    for tr in tbl.find_all("tr"):
        cells = [_clean_text(td.get_text(" ", strip=True))
                 for td in tr.find_all(["td", "th"])]
        if any(c for c in cells):
            raw_rows.append(cells)

    if not raw_rows:
        return None

    title = title_hint
    body_start = 0
    first = raw_rows[0]
    # Skerples often opens with "1d100 | Table Title" — promote the title.
    if len(first) >= 2 and DIE_HEADER_RE.match(first[0]):
        candidate = first[1].strip()
        # Skip generic header text like "Result" so we keep title_hint instead.
        if candidate and candidate.lower() not in {"result", "results", "entry"}:
            title = candidate
        body_start = 1
    elif (
        len(first) == 1
        and not NUM_CELL_RE.match(first[0])
        and len(first[0]) < 120
        and not title
    ):
        title = first[0]
        body_start = 1

    rows: list[TableRow] = []
    max_cols = 0
    for cells in raw_rows[body_start:]:
        max_cols = max(max_cols, len(cells))
        col1 = cells[0] if cells else ""
        rest = cells[1:] if len(cells) > 1 else []
        num_match = NUM_CELL_RE.match(col1)
        if num_match:
            rows.append(TableRow(kind="data",
                                 number=int(num_match.group(1)),
                                 cells=rest))
        elif not col1.strip() and any(c.strip() for c in rest):
            # Blank col 1 + content in col 2+: this is a section subheader.
            rows.append(TableRow(kind="section", number=None, cells=rest))
        elif len(cells) == 1:
            # Single-cell row that spans the table — treat as a section header.
            rows.append(TableRow(kind="section", number=None, cells=cells))
        else:
            # Non-numeric data row (lookup-table style: "Haiah" | "judicious retreat").
            rows.append(TableRow(kind="data", number=None, cells=cells))

    return ParsedTable(title=title or "", rows=rows, column_count=max_cols)


def _parse_from_numbered_text(soup: BeautifulSoup, fallback_title: str) -> ParsedTable | None:
    text = _html_to_text(soup)
    entries: list[tuple[int, str]] = []
    current_num: int | None = None
    current_buf: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            if current_num is not None and current_buf:
                entries.append((current_num, " ".join(current_buf).strip()))
                current_num, current_buf = None, []
            continue
        match = NUMBERED_LINE_RE.match(line)
        if match:
            if current_num is not None and current_buf:
                entries.append((current_num, " ".join(current_buf).strip()))
            current_num = int(match.group(1))
            current_buf = [match.group(2)]
        elif current_num is not None:
            current_buf.append(line)
    if current_num is not None and current_buf:
        entries.append((current_num, " ".join(current_buf).strip()))

    seen: set[int] = set()
    unique = []
    for num, body in entries:
        if num in seen or not (1 <= num <= 200):
            continue
        seen.add(num)
        unique.append((num, body))
    if len(unique) < 10:
        return None
    unique.sort()
    rows = [TableRow(kind="data", number=n, cells=[t]) for n, t in unique]
    return ParsedTable(title=fallback_title, rows=rows, column_count=2)


def _html_to_text(soup: BeautifulSoup) -> str:
    for br in soup.find_all("br"):
        br.replace_with(NavigableString("\n"))
    block_tags = ("p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6")
    for tag in soup.find_all(block_tags):
        tag.append(NavigableString("\n"))
    return _clean_text(soup.get_text("\n"))


def _clean_text(text: str) -> str:
    text = text.replace("\xa0", " ").replace("\r\n", "\n").replace("\r", "\n")
    cleaned = []
    for line in text.split("\n"):
        cleaned.append(re.sub(r"[ \t]+", " ", line).strip())
    out: list[str] = []
    blank = False
    for line in cleaned:
        if line:
            out.append(line)
            blank = False
        elif not blank:
            out.append("")
            blank = True
    return "\n".join(out).strip()


# ---------------------------------------------------------------------------
# Workbook writing
# ---------------------------------------------------------------------------


HEADER_FILL = PatternFill("solid", fgColor="FFD9D9D9")
SECTION_FILL = PatternFill("solid", fgColor="FFEFEFEF")
HEADER_FONT = Font(bold=True)
SECTION_FONT = Font(bold=True, italic=True)
TITLE_FONT = Font(bold=True, size=14)
WRAP = Alignment(wrap_text=True, vertical="top")


def sanitize_sheet_name(name: str, used: set[str]) -> str:
    name = INVALID_SHEET_CHARS.sub(" ", name).strip() or "Untitled"
    name = re.sub(r"\s+", " ", name)
    base = name[:31]
    candidate = base
    i = 2
    while candidate.lower() in used:
        suffix = f" ({i})"
        candidate = (base[: 31 - len(suffix)]).rstrip() + suffix
        i += 1
    used.add(candidate.lower())
    return candidate


def write_workbook(posts: list[Post], out_path: Path) -> None:
    wb = Workbook()
    index_ws = wb.active
    index_ws.title = "Index"
    index_ws.append(["Sheet", "Post", "Table title", "Kind", "Rows",
                     "Published", "URL"])
    for cell in index_ws[1]:
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
    index_ws.freeze_panes = "A2"

    used_names: set[str] = {"index"}
    for post in posts:
        for i, tbl in enumerate(post.tables, start=1):
            sheet_name = _pick_sheet_name(post, tbl, i, used_names)
            ws = wb.create_sheet(sheet_name)
            _write_table_sheet(ws, post, tbl)
            index_ws.append([
                sheet_name,
                post.title,
                tbl.title,
                "d100" if tbl.is_d100 else "lookup",
                tbl.data_row_count,
                post.published[:10] if post.published else "",
                post.url,
            ])

    _autosize(index_ws, [32, 50, 40, 8, 8, 12, 60])
    out_path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out_path)


def _pick_sheet_name(post: Post, tbl: ParsedTable, idx: int,
                     used: set[str]) -> str:
    if tbl.title:
        base = tbl.title
    elif idx == 1:
        base = post.title
    else:
        base = f"{post.title} ({idx})"
    return sanitize_sheet_name(base, used)


def _write_table_sheet(ws, post: Post, tbl: ParsedTable) -> None:
    ws["A1"] = tbl.title or post.title
    ws["A1"].font = TITLE_FONT
    ws.merge_cells(start_row=1, start_column=1,
                   end_row=1, end_column=max(2, tbl.column_count))

    ws["A2"] = "Post"
    ws["B2"] = post.title
    ws["A3"] = "URL"
    ws["B3"] = post.url
    ws["A4"] = "Published"
    ws["B4"] = post.published[:10] if post.published else ""
    ws["A5"] = "Labels"
    ws["B5"] = ", ".join(post.labels)
    for row in (2, 3, 4, 5):
        ws[f"A{row}"].font = HEADER_FONT

    header_row = 7
    if tbl.is_d100:
        headers = ["#", "Entry"] + [f"Col {i}" for i in range(3, tbl.column_count + 1)]
    else:
        headers = [f"Col {i}" for i in range(1, max(2, tbl.column_count) + 1)]
    for col_idx, label in enumerate(headers, start=1):
        cell = ws.cell(row=header_row, column=col_idx, value=label)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
    ws.freeze_panes = f"A{header_row + 1}"

    row = header_row + 1
    for tr in tbl.rows:
        if tr.kind == "section":
            text = " ".join(c for c in tr.cells if c).strip()
            section_cell = ws.cell(row=row, column=1, value=text)
            section_cell.font = SECTION_FONT
            section_cell.fill = SECTION_FILL
            section_cell.alignment = WRAP
            end_col = max(2, tbl.column_count)
            ws.merge_cells(start_row=row, start_column=1,
                           end_row=row, end_column=end_col)
        elif tbl.is_d100:
            ws.cell(row=row, column=1, value=tr.number if tr.number is not None else "")
            for j, val in enumerate(tr.cells, start=2):
                cell = ws.cell(row=row, column=j, value=val)
                cell.alignment = WRAP
        else:
            # Lookup-style: dump cells as-is
            cells = [tr.number] + tr.cells if tr.number is not None else tr.cells
            for j, val in enumerate(cells, start=1):
                cell = ws.cell(row=row, column=j, value=val)
                cell.alignment = WRAP
        row += 1

    widths = [6, 70] if tbl.is_d100 else [35, 60]
    widths += [40] * max(0, tbl.column_count - len(widths))
    _autosize(ws, widths)


def _autosize(ws, widths: Iterable[int]) -> None:
    for i, width in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = width


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--label",
        default=None,
        help="Optional Blogger label to filter on. Default: pull every post.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("CoinsAndScrolls_tables.xlsx"),
        help="Output workbook path.",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path(".coinsandscrolls_cache"),
        help="Directory for cached feed JSON (set to '' to disable).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Stop after this many posts (useful for testing).",
    )
    parser.add_argument(
        "--min-rows",
        type=int,
        default=5,
        help="Skip tables with fewer than this many data rows (default 5). "
             "Filters out tiny layout/nav tables.",
    )
    parser.add_argument(
        "--d100-only",
        action="store_true",
        help="Skip lookup-style tables; only export ones detected as d100.",
    )
    args = parser.parse_args(argv)

    cache_dir: Path | None = args.cache_dir if str(args.cache_dir) else None
    if cache_dir is not None:
        cache_dir.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    print(f"Fetching posts from {BLOG_HOST} "
          f"(label={args.label or '<all>'}, limit={args.limit or 'none'})")

    posts_out: list[Post] = []
    scanned = 0
    for post in iter_posts(args.label, cache_dir, session, args.limit):
        scanned += 1
        tables = extract_tables(post.html, post.title)
        keep = []
        for tbl in tables:
            if tbl.data_row_count < args.min_rows:
                continue
            if args.d100_only and not tbl.is_d100:
                continue
            keep.append(tbl)
        if not keep:
            continue
        post.tables = keep
        posts_out.append(post)
        kinds = ", ".join(
            "d100" if t.is_d100 else "lookup" for t in keep
        )
        print(f"  [{len(posts_out):3d}] {post.title[:60]:<60} "
              f"{len(keep)} table(s): {kinds}")

    if not posts_out:
        print(f"Scanned {scanned} posts; no tables matched the filters.",
              file=sys.stderr)
        return 1

    write_workbook(posts_out, args.out)
    total_tables = sum(len(p.tables) for p in posts_out)
    print(f"Wrote {args.out} ({len(posts_out)} posts, {total_tables} tables, "
          f"scanned {scanned} posts)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
