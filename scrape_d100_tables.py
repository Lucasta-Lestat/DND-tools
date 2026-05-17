"""Scrape d100 tables from Elf Maids and Octopi into an Excel workbook.

Pulls every post tagged with a given Blogger label (default: ``d100``) from
``https://elfmaidsandoctopi.blogspot.com``, parses the numbered entries out of
the post body, and writes one sheet per post into a single .xlsx.

Usage:
    pip install openpyxl requests beautifulsoup4
    python3 scrape_d100_tables.py
    python3 scrape_d100_tables.py --label d100 --out d100_tables.xlsx
    python3 scrape_d100_tables.py --cache-dir .d100_cache --limit 50

The Blogger JSON feed is paginated 25 entries at a time by default; this
script pages until the feed reports no more results.  Fetched feed pages are
cached on disk so re-runs do not re-hit the network.
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


BLOG_HOST = "https://elfmaidsandoctopi.blogspot.com"
FEED_PATH = "/feeds/posts/default"
PAGE_SIZE = 25  # Blogger's default; the API accepts up to 500 via max-results
USER_AGENT = (
    "Mozilla/5.0 (compatible; d100-scraper/1.0; "
    "+https://github.com/lucasta-lestat/dnd-tools)"
)

NUMBERED_LINE_RE = re.compile(r"^\s*(\d{1,3})\s*[.)\-:\]]\s+(.+?)\s*$")
INVALID_SHEET_CHARS = re.compile(r"[\[\]:*?/\\]")


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass
class Post:
    title: str
    url: str
    published: str
    labels: list[str]
    html: str
    entries: list[tuple[int, str]] = field(default_factory=list)
    raw_text: str = ""

    @property
    def parsed_ok(self) -> bool:
        return len(self.entries) >= 10


# ---------------------------------------------------------------------------
# Feed fetching
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
        # Blogger reports openSearch$totalResults; stop when we've fetched it all.
        total_str = feed.get("openSearch$totalResults", {}).get("$t")
        try:
            total = int(total_str) if total_str is not None else None
        except ValueError:
            total = None
        start += len(entries)
        if total is not None and start > total:
            return
        # Defensive: if we got fewer than asked-for, assume we're done.
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
    return Post(
        title=title,
        url=url,
        published=published,
        labels=labels,
        html=html,
    )


# ---------------------------------------------------------------------------
# Table extraction
# ---------------------------------------------------------------------------


def extract_entries(html: str) -> tuple[list[tuple[int, str]], str]:
    """Return (numbered_entries, plain_text_fallback).

    Tries ordered lists first (concatenating consecutive <ol>s, honouring the
    ``start`` attribute so split 1-25 / 26-50 / 51-75 / 76-100 lists join up
    correctly), then falls back to a regex over newline-split text.
    """
    soup = BeautifulSoup(html, "html.parser")

    # Drop scripts/styles before any text extraction.
    for junk in soup(["script", "style"]):
        junk.decompose()

    entries = _extract_from_ols(soup)
    if len(entries) < 10:
        entries = _extract_from_text(soup)

    plain_text = _html_to_text(soup)
    return entries, plain_text


def _extract_from_ols(soup: BeautifulSoup) -> list[tuple[int, str]]:
    collected: list[tuple[int, str]] = []
    used_numbers: set[int] = set()
    for ol in soup.find_all("ol"):
        try:
            start = int(ol.get("start", "1"))
        except (TypeError, ValueError):
            start = 1
        n = start
        for li in ol.find_all("li", recursive=False):
            text = _clean_text(li.get_text(" ", strip=True))
            if not text:
                n += 1
                continue
            # If this number is already used (the <ol> didn't set start=),
            # bump to one past the highest seen so we don't clobber entries.
            if n in used_numbers:
                n = max(used_numbers) + 1
            collected.append((n, text))
            used_numbers.add(n)
            n += 1
    collected.sort(key=lambda pair: pair[0])
    return collected


def _extract_from_text(soup: BeautifulSoup) -> list[tuple[int, str]]:
    text = _html_to_text(soup)
    entries: list[tuple[int, str]] = []
    current_num: int | None = None
    current_buf: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            if current_num is not None and current_buf:
                # Blank line ends the current entry.
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

    # Deduplicate by number (keep first occurrence) and only keep plausible rows.
    seen: set[int] = set()
    unique: list[tuple[int, str]] = []
    for num, body in entries:
        if num in seen or not (1 <= num <= 200):
            continue
        seen.add(num)
        unique.append((num, body))
    unique.sort(key=lambda pair: pair[0])
    return unique


def _html_to_text(soup: BeautifulSoup) -> str:
    # Insert newlines for block-level tags so the text version preserves
    # line boundaries that the regex parser depends on.
    for br in soup.find_all("br"):
        br.replace_with(NavigableString("\n"))
    block_tags = ("p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6")
    for tag in soup.find_all(block_tags):
        tag.append(NavigableString("\n"))
    return _clean_text(soup.get_text("\n"))


def _clean_text(text: str) -> str:
    # Collapse non-breaking spaces and runs of whitespace within a line, but
    # keep line breaks so the regex parser can still see them.
    text = text.replace("\xa0", " ").replace("\r\n", "\n").replace("\r", "\n")
    cleaned_lines = []
    for line in text.split("\n"):
        cleaned_lines.append(re.sub(r"[ \t]+", " ", line).strip())
    # Drop runs of blank lines down to a single blank.
    out: list[str] = []
    blank = False
    for line in cleaned_lines:
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
HEADER_FONT = Font(bold=True)
WRAP = Alignment(wrap_text=True, vertical="top")


def sanitize_sheet_name(title: str, used: set[str]) -> str:
    name = INVALID_SHEET_CHARS.sub(" ", title).strip() or "Untitled"
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
    index_ws.append(["Title", "Published", "Entries parsed", "Labels", "URL"])
    for cell in index_ws[1]:
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
    index_ws.freeze_panes = "A2"

    used_names: set[str] = {"index"}
    for post in posts:
        sheet_name = sanitize_sheet_name(post.title, used_names)
        ws = wb.create_sheet(sheet_name)
        _write_post_sheet(ws, post)
        index_ws.append([
            post.title,
            post.published[:10] if post.published else "",
            len(post.entries),
            ", ".join(post.labels),
            post.url,
        ])

    _autosize(index_ws, [60, 12, 16, 30, 60])
    out_path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out_path)


def _write_post_sheet(ws, post: Post) -> None:
    ws["A1"] = post.title
    ws["A1"].font = Font(bold=True, size=14)
    ws.merge_cells("A1:B1")

    ws["A2"] = "URL"
    ws["B2"] = post.url
    ws["A3"] = "Published"
    ws["B3"] = post.published[:10] if post.published else ""
    ws["A4"] = "Labels"
    ws["B4"] = ", ".join(post.labels)
    for row in (2, 3, 4):
        ws[f"A{row}"].font = HEADER_FONT

    header_row = 6
    ws.cell(row=header_row, column=1, value="#").font = HEADER_FONT
    ws.cell(row=header_row, column=1).fill = HEADER_FILL
    ws.cell(row=header_row, column=2, value="Entry").font = HEADER_FONT
    ws.cell(row=header_row, column=2).fill = HEADER_FILL
    ws.freeze_panes = f"A{header_row + 1}"

    if post.entries:
        for num, body in post.entries:
            ws.append([num, body])
        # Apply wrap to entry column for the rows we just wrote.
        last_row = header_row + len(post.entries)
        for row in ws.iter_rows(min_row=header_row + 1, max_row=last_row,
                                min_col=2, max_col=2):
            for cell in row:
                cell.alignment = WRAP
    else:
        ws.cell(row=header_row + 1, column=1, value="—")
        ws.cell(row=header_row + 1, column=2,
                value="(could not parse numbered table; raw text follows)")
        for i, paragraph in enumerate(post.raw_text.split("\n\n"), start=header_row + 2):
            cell = ws.cell(row=i, column=2, value=paragraph)
            cell.alignment = WRAP

    _autosize(ws, [6, 90])


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
        default="d100",
        help="Blogger label to filter on (default: d100). Use '' for no filter.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("EMO_d100_tables.xlsx"),
        help="Output workbook path.",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path(".d100_cache"),
        help="Directory for cached feed JSON (set to '' to disable).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Stop after this many posts (useful for testing).",
    )
    args = parser.parse_args(argv)

    cache_dir: Path | None = args.cache_dir if str(args.cache_dir) else None
    if cache_dir is not None:
        cache_dir.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    label = args.label or None
    print(f"Fetching posts from {BLOG_HOST} "
          f"(label={label or '<all>'}, limit={args.limit or 'none'})")

    posts: list[Post] = []
    for post in iter_posts(label, cache_dir, session, args.limit):
        entries, raw_text = extract_entries(post.html)
        post.entries = entries
        post.raw_text = raw_text
        status = f"{len(entries):3d} entries" if entries else "no table parsed"
        print(f"  [{len(posts) + 1:3d}] {post.title[:70]:<70} {status}")
        posts.append(post)

    if not posts:
        print("No posts found. Check the --label value or your network.",
              file=sys.stderr)
        return 1

    # Stable order: newest first (feed default) is fine; if you'd rather have
    # alphabetical, uncomment below.
    # posts.sort(key=lambda p: p.title.lower())

    write_workbook(posts, args.out)
    parsed = sum(1 for p in posts if p.parsed_ok)
    print(f"Wrote {args.out} ({len(posts)} sheets, {parsed} with parsed tables)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
