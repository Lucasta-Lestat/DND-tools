#!/usr/bin/env python3
"""Turn a text PDF into a listenable MP3 using Microsoft's neural TTS voices.

Extraction is font-aware: it uses the PDF's own typography to tell headings,
subtitles and body copy apart, drops running heads / folios, repairs the
hyphenation and spacing artifacts that fall out of justified multi-column
layout, and re-flows the result into narration-friendly prose.

Synthesis goes through `edge-tts`, which speaks to the same Microsoft neural
voice endpoint that Edge's Read Aloud uses. No API key is needed.

    python3 pdf_to_audiobook.py book.pdf -o book.mp3
    python3 pdf_to_audiobook.py book.pdf --text-only        # inspect the text first
    python3 pdf_to_audiobook.py book.pdf --split-sections   # one MP3 per section

Requires: pdfplumber, edge-tts, ffmpeg.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import re
import ssl
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

# --------------------------------------------------------------------------
# Extraction
# --------------------------------------------------------------------------

# A line is assigned the role of the font most of its characters use.
BODY, HEADING, SUBTITLE, SECTION, DROP = "body", "heading", "subtitle", "section", "drop"


@dataclass
class Line:
    text: str
    role: str
    top: float
    x0: float
    size: float = 0.0


@dataclass
class Block:
    """One lexicon entry, or one run of prose under a section marker."""

    heading: str = ""
    subtitle: str = ""
    paragraphs: list[str] = field(default_factory=list)
    section: str = ""


def classify_font(fontname: str, size: float, body_size: float,
                  section_ratio: float = 1.8) -> str:
    """Map a font/size pair onto a structural role."""
    lowered = fontname.lower()
    if size >= body_size * section_ratio:  # drop caps / chapter openers
        return SECTION
    # Size carries the structure even when the display face has no bold cut.
    if size >= body_size * 1.25:
        return HEADING
    if any(k in lowered for k in ("bold", "black", "heavy", "semibold")):
        return HEADING
    if "italic" in lowered or "oblique" in lowered or lowered.endswith("-it"):
        return SUBTITLE
    return BODY


def detect_gutter(words, lo: float, hi: float, body_size: float = 0.0,
                  min_share: float = 0.06) -> float | None:
    """Find the column gutter: the x that the fewest words cross.

    Returns the x to split on, or None when the page is a single column.

    Looking for an *empty vertical band* is the obvious approach and it fails:
    occupancy is projected over the full page height, so one full-width element
    — a wide table row, a spanning headline — paints over the gutter and hides
    it. A real gutter need not be wide either; where a ragged column edge
    reaches within a point or two of the next column, no band exists at all.
    What actually defines it is that no line of text crosses it.
    """
    if len(words) < 20:
        return None
    # Oversized display letters are set across the gutter and would mask it.
    if body_size:
        words = [w for w in words if w.get("size", body_size) <= body_size * 1.5]
        if len(words) < 20:
            return None

    span = hi - lo
    best: tuple[int, int, float] | None = None  # (crossings, -balance, x)
    for x in range(int(lo + span * 0.3), int(lo + span * 0.7)):
        crossings = sum(1 for w in words if w["x0"] < x < w["x1"])
        left = sum(1 for w in words if w["x1"] <= x)
        right = sum(1 for w in words if w["x0"] >= x)
        candidate = (crossings, -min(left, right), float(x))
        if best is None or candidate < best:
            best = candidate

    crossings, neg_balance, split = best
    balance = -neg_balance
    # Crossings are the load-bearing test. A single column of prose has many
    # words straddling any interior x, so finding an x that none cross is
    # already near-proof of a gutter; the balance check then only has to rule
    # out a stray marginal word, and can stay loose enough to catch a narrow
    # sidebar. If nothing is perfectly clean, a spanning table row can be
    # tolerated, but then insist on a properly balanced split.
    if crossings == 0:
        return split if balance >= max(4, 0.03 * len(words)) else None
    if crossings <= 0.01 * len(words) and balance >= max(4, min_share * len(words)):
        return split
    return None


def column_splits(words, lo: float, hi: float, body_size: float,
                  depth: int = 3) -> list[float]:
    """Find every gutter on the page, splitting each column again in turn.

    A page can carry three or more columns — a pair of text columns beside a
    narrow sidebar — and one split leaves two of them still interleaved.
    """
    if depth <= 0 or len(words) < 20:
        return []
    split = detect_gutter(words, lo, hi, body_size)
    if split is None:
        return []
    left = [w for w in words if w["x0"] < split]
    right = [w for w in words if w["x0"] >= split]
    return (column_splits(left, lo, split, body_size, depth - 1)
            + [split]
            + column_splits(right, split, hi, body_size, depth - 1))


def column_of(x: float, splits: list[float]) -> int:
    """Which column an x coordinate falls in, given the gutter positions."""
    index = 0
    for split in splits:
        if x >= split:
            index += 1
    return index


def detect_word_spacing(pdf, sample_pages: int = 12,
                        default: float = 3.0) -> float:
    """Find the gap width that separates words, from the document's own spacing.

    Some PDFs contain no space characters at all: words are separated purely by
    position. The extractor then has to guess, and its default guess is too
    wide for tightly justified text — whole lines fuse into a single token.

    Letter spacing inside a word and the space between words are two distinct
    populations, so the histogram of horizontal gaps is bimodal with an empty
    band between. Split there.
    """
    gaps: dict[float, int] = {}
    spaces = total = 0
    for page in pdf.pages[:sample_pages]:
        previous = None
        for char in sorted(page.chars, key=lambda c: (round(c["top"] / 3), c["x0"])):
            total += 1
            if char["text"].isspace():
                spaces += 1
            if previous and abs(char["top"] - previous["top"]) < 3:
                gap = round(char["x0"] - previous["x1"], 1)
                if gap >= 0:
                    gaps[gap] = gaps.get(gap, 0) + 1
            previous = char
    if not gaps:
        return default
    # Only measure when the document leaves the extractor no choice. Where real
    # space characters are present they already separate the words, the gap
    # histogram has no second population to find, and whatever the scan returns
    # is noise fitted to an empty range.
    if total and spaces / total > 0.01:
        return default

    step, low, high = 0.1, 0.5, 4.0
    best = run_start = None
    run = 0
    x = low
    while x <= high:
        if gaps.get(round(x, 1), 0) == 0:
            if run == 0:
                run_start = x
            run += 1
            if best is None or run > best[1]:
                best = (run_start, run)
        else:
            run = 0
        x = round(x + step, 1)

    if best is None or best[1] * step < 0.4:
        return default
    return round(best[0] + best[1] * step / 2, 2)


def merge_split_words(line: list, max_gap: float = 1.0) -> list:
    """Rejoin words the extractor split where the font changed mid-word.

    Asking for font attributes makes pdfplumber start a new word whenever they
    change, so a word whose ligature glyphs come from another subset arrives as
    "le" + "ft". Real spaces are a couple of points wide; these splits are flush
    or slightly kerned into each other, so the horizontal gap tells them apart.
    """
    merged: list = []
    for word in line:
        if merged and -0.5 <= word["x0"] - merged[-1]["x1"] < max_gap:
            previous = merged[-1]
            previous["text"] += word["text"]
            previous["x1"] = word["x1"]
        else:
            merged.append(dict(word))
    return merged


def group_into_lines(words, tolerance: float) -> list[list]:
    """Cluster words sharing a baseline, tolerating sub-point vertical jitter."""
    lines: list[list] = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if lines and abs(w["top"] - lines[-1][0]["top"]) <= tolerance:
            lines[-1].append(w)
        else:
            lines.append([w])
    return lines


def make_line(group: list, body_size: float, section_ratio: float) -> Line | None:
    """Turn a run of words sharing a baseline into a classified line."""
    group = merge_split_words(sorted(group, key=lambda w: w["x0"]))
    text = " ".join(w["text"] for w in group).strip()
    if not text:
        return None
    # Role = the role of the widest run of characters on the line.
    weights: dict[str, float] = {}
    for w in group:
        role = classify_font(w["fontname"], w["size"], body_size, section_ratio)
        weights[role] = weights.get(role, 0) + len(w["text"])
    role = max(weights, key=weights.get)
    # A run-in label — a bold or italic lead-in that continues into the
    # sentence on the same line — is not a heading. Demanding the line be
    # almost entirely one face keeps those inside the paragraph, instead of
    # cutting the sentence in two with a spurious full stop.
    if role in (HEADING, SUBTITLE) and weights[role] / sum(weights.values()) < 0.9:
        role = BODY
    return Line(text, role, group[0]["top"], group[0]["x0"],
                max(w["size"] for w in group))


def page_lines(page, body_size: float, column_split: float | None,
               section_ratio: float = 1.8,
               x_tolerance: float = 3.0) -> list[Line]:
    """Extract a page's lines in reading order, column by column.

    Rotated text is dropped: in a designed book it is decoration — a title set
    running up the margin, letter by letter at varying sizes — and interleaves
    into the prose as rubble.
    """
    page = page.filter(lambda obj: obj.get("upright", True))
    words = page.extract_words(extra_attrs=["fontname", "size"],
                               keep_blank_chars=False, x_tolerance=x_tolerance)
    if not words:
        return []

    tolerance = max(2.0, body_size * 0.4)
    # Full-width pages (title pages, opening prose) must not be split.
    splits = ([column_split] if column_split is not None
              else column_splits(words, 0.0, page.width, body_size))
    if not splits:
        return [ln for group in group_into_lines(words, tolerance)
                if (ln := make_line(group, body_size, section_ratio))]

    # A headline set across the columns is not part of any of them. Treat it as
    # a horizontal divider: everything below it, in every column, follows it.
    # Without this a spanning title is torn apart, the words left of the first
    # gutter read at one point and the rest at the top of the next column.
    spanning: list[Line] = []
    banded: list[tuple[int, list]] = []
    for group in group_into_lines(words, tolerance):
        first = column_of(min(w["x0"] for w in group), splits)
        last = column_of(max(w["x1"] for w in group) - 1, splits)
        display = all(w["size"] >= body_size * 1.25 for w in group)
        if last > first and display:
            if line := make_line(group, body_size, section_ratio):
                spanning.append(line)
            continue
        # A baseline runs across the whole page, so every column shares it.
        # Each column's share has to become its own line, or they interleave.
        by_column: dict[int, list] = {}
        for w in group:
            by_column.setdefault(column_of(w["x0"], splits), []).append(w)
        for index, side in sorted(by_column.items()):
            banded.append((index, side))

    lines: list[Line] = []

    def emit_band(low: float, high: float):
        """Read this band one column at a time, left to right."""
        for column in range(len(splits) + 1):
            for index, group in banded:
                if index != column or not (low <= group[0]["top"] < high):
                    continue
                if line := make_line(group, body_size, section_ratio):
                    lines.append(line)

    edges = [-float("inf")] + [ln.top for ln in spanning] + [float("inf")]
    for i, low in enumerate(edges[:-1]):
        if i > 0:
            lines.append(spanning[i - 1])
        emit_band(low, edges[i + 1])

    return lines


def dominant_body_size(pdf, sample_pages: int = 40) -> float:
    """The size most of the book's text is set in.

    Sampled evenly across the whole document, not from the front: a book can
    change body size partway through, and front matter is often set larger, so
    reading only the opening pages misjudges the size everything else is
    measured against.
    """
    pages = pdf.pages
    if len(pages) > sample_pages:
        stride = len(pages) / sample_pages
        pages = [pages[int(i * stride)] for i in range(sample_pages)]
    counts: dict[float, int] = {}
    for page in pages:
        for ch in page.chars:
            key = round(ch["size"], 1)
            counts[key] = counts.get(key, 0) + 1
    return max(counts, key=counts.get) if counts else 10.0


FOLIO_RE = re.compile(r"^[ivxlcdm\d]{1,5}$", re.IGNORECASE)


def is_folio(line: Line) -> bool:
    """Page numbers: a lone numeral, whatever type it is set in."""
    return bool(FOLIO_RE.fullmatch(line.text.strip()))


def merge_drop_caps(lines: list[Line]) -> list[Line]:
    """Fold a decorative initial back into the word it begins.

    A drop cap is set many times body size, so it classifies as a chapter
    opener — which would both invent a chapter named "F" and leave the
    paragraph starting "or the last three years". The giveaway is that the
    text after it continues in lower case; a genuine one-letter section
    divider is followed by a capital.
    """
    merged: list[Line] = []
    skip_next_join = False
    for index, line in enumerate(lines):
        if skip_next_join:
            skip_next_join = False
            continue
        is_initial = line.role == SECTION and len(line.text.strip()) == 1 \
            and line.text.strip().isalpha()
        following = lines[index + 1] if index + 1 < len(lines) else None
        if is_initial and following and following.text[:1].islower():
            merged.append(Line(line.text.strip() + following.text, following.role,
                               line.top, line.x0, following.size))
            skip_next_join = True
            continue
        merged.append(line)
    return merged


def build_blocks(lines: list[Line], line_gap: float,
                 skip_heading: re.Pattern | None = None) -> list[Block]:
    """Fold classified lines into entries, joining wrapped lines into paragraphs."""
    blocks: list[Block] = []
    current: Block | None = None
    buffer: list[str] = []
    prev_bottom: float | None = None
    prev_section_top: float | None = None

    def flush_paragraph():
        nonlocal buffer
        if buffer and current is not None:
            current.paragraphs.append(join_wrapped(buffer))
        buffer = []

    def flush_block():
        nonlocal current
        flush_paragraph()
        if current is not None and (current.heading or current.paragraphs or current.section):
            blocks.append(current)
        current = None

    skipping = False
    for line in lines:
        if line.role == DROP:
            continue

        # A skipped heading takes its whole section with it, up to the next one.
        if skipping and line.role not in (HEADING, SECTION):
            continue

        if line.role == SECTION:
            skipping = False
            # A chapter title set over two lines is still one title.
            if (blocks and blocks[-1].section and current is None and not buffer
                    and prev_section_top is not None
                    and 0 < line.top - prev_section_top < line.size * 1.8):
                blocks[-1].section = join_title(blocks[-1].section, line.text)
            else:
                flush_block()
                blocks.append(Block(section=line.text.strip()))
            prev_section_top = line.top
            prev_bottom = None
            continue
        prev_section_top = None

        if line.role == HEADING:
            if skip_heading and skip_heading.search(line.text):
                flush_block()
                skipping = True
                continue
            skipping = False
            # A headword that wraps onto a second line is still one headword.
            if current is not None and current.heading and not (
                    current.subtitle or current.paragraphs or buffer):
                current.heading = join_wrapped([current.heading, line.text])
            else:
                flush_block()
                current = Block(heading=line.text.strip())
            prev_bottom = line.top
            continue

        if current is None:
            current = Block()

        if line.role == SUBTITLE and not current.paragraphs and not buffer:
            current.subtitle = line.text.strip()
            prev_bottom = line.top
            continue

        # A vertical gap larger than normal leading means a new paragraph.
        if prev_bottom is not None and line.top - prev_bottom > line_gap * 1.4:
            flush_paragraph()
        buffer.append(line.text)
        prev_bottom = line.top

    flush_block()
    return blocks


JOIN = "\x00"  # placeholder for an undecided hyphen


TITLE_JOIN = "\x01"  # placeholder for an undecided title line break


def join_title(first: str, second: str) -> str:
    """Join the lines of a display title, which may break mid-word.

    Big type gets broken wherever it fits and without a hyphen — "Grass" over
    "lands". A lower-case fragment is ambiguous: it can be the tail of a word,
    or an ordinary function word ("Road" over "and the High"). Mark it and let
    the book's own vocabulary decide.
    """
    if second[:1].islower():
        return first + TITLE_JOIN + second
    return first + " " + second


def join_wrapped(lines: list[str]) -> str:
    """Join hard-wrapped lines back into a paragraph, repairing hyphenation."""
    out = ""
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if not out:
            out = line
        elif out.endswith("-") and not out.endswith("--"):
            # A hyphen at a line break may be a split word ("collec-tion") or a
            # real compound ("mind-controlling"). Mark it and decide later, once
            # the whole book's vocabulary is known.
            out = out[:-1] + JOIN + line
        else:
            out += " " + line
    return out


def estimate_leading(lines: list[Line]) -> float:
    gaps = []
    for a, b in zip(lines, lines[1:]):
        gap = b.top - a.top
        if 0 < gap < 40:
            gaps.append(gap)
    if not gaps:
        return 12.0
    gaps.sort()
    return gaps[len(gaps) // 2]


def parse_page_spec(spec: str | None) -> set[int]:
    """Parse "5,9,12-14" into the set of page numbers it names."""
    pages: set[int] = set()
    for part in (spec or "").replace(" ", "").split(","):
        if not part:
            continue
        if "-" in part:
            start, end = part.split("-", 1)
            pages.update(range(int(start), int(end) + 1))
        else:
            pages.add(int(part))
    return pages


def extract_blocks(path: Path, first_page: int, last_page: int | None,
                   column_split: float | None, min_size_ratio: float = 0.0,
                   drop_lines: re.Pattern | None = None,
                   skip_heading: re.Pattern | None = None,
                   section_ratio: float = 1.8,
                   skip_pages: set[int] | None = None,
                   margin_top: float = 0.0,
                   margin_bottom: float = 0.0,
                   x_tolerance: float | None = None) -> list[Block]:
    import pdfplumber

    with pdfplumber.open(path) as pdf:
        body_size = dominant_body_size(pdf)
        spacing = (x_tolerance if x_tolerance is not None
                   else detect_word_spacing(pdf))
        floor = body_size * min_size_ratio
        pages = pdf.pages[first_page - 1: last_page if last_page else None]
        all_lines: list[Line] = []
        for page in pages:
            # Character sheets, forms and maps are scattered labels, not prose.
            if skip_pages and page.page_number in skip_pages:
                continue
            # Running heads and feet sit in the margins and carry the page
            # number plus the section name; read aloud they interrupt every page.
            floor_y = page.height - margin_bottom if margin_bottom else None
            lines = [ln for ln in page_lines(page, body_size, column_split,
                                             section_ratio, spacing)
                     if not is_folio(ln)
                     and ln.size >= floor
                     and ln.top >= margin_top
                     and (floor_y is None or ln.top <= floor_y)
                     and not (drop_lines and drop_lines.search(ln.text))]
            all_lines.extend(lines)
            # Page break: force a paragraph flush only if the page ends mid-entry
            # is *not* wanted, so we deliberately do nothing here — entries wrap
            # across pages and columns in this layout.
        all_lines = merge_drop_caps(all_lines)
        leading = estimate_leading(all_lines)
        return build_blocks(all_lines, leading, skip_heading)


# --------------------------------------------------------------------------
# Text normalisation for speech
# --------------------------------------------------------------------------

# Source sigils like "(UVG)" or "(LotV)": short, parenthesised, at least two
# capitals. Ordinary asides such as "(sometimes human)" are left alone.
CITATION_RE = re.compile(r"\(\s*([A-Za-z]{2,6})\s*\)")


def _is_sigil(token: str) -> bool:
    return sum(1 for c in token if c.isupper()) >= 2

REPLACEMENTS = [
    (r"[†‡•▪●¶⁘⁙◆◊■□▶‣⸪»«]", " "),  # daggers, bullets, ornaments
    (r"[—–]", ", "),                                     # em/en dash -> comma pause
    (r"…", "."),                                         # ellipsis -> a full stop
    (r"&", " and "),
    # Justified letter-spacing also splits words mid-line ("collec- tion").
    # Suspended hyphens ("short- and long-term") are genuine and left alone.
    (r"([a-z]{2,})- (?!and\b|or\b)([A-Za-z]+)", "\\1" + JOIN + "\\2"),
    (r"\s+([,.;:!?%’'”])", r"\1"),                       # "power ." -> "power."
    (r"([‘“(\[])\s+", r"\1"),
    (r"([.!?])[\s,]*,", r"\1"),                          # ". ," -> "."
    (r",\s*([.!?])", r"\1"),
    # Collapse any run of stops, however it arose — a typographic ellipsis, the
    # author's own "..", or dots left by a leader — into a single pause.
    (r"\.\s*(?:\.\s*)+", ". "),
    (r"\s+", " "),
]


def normalise(text: str, keep_citations: bool) -> str:
    if not keep_citations:
        text = CITATION_RE.sub(
            lambda m: "" if _is_sigil(m.group(1)) else m.group(0), text)
    for pattern, repl in REPLACEMENTS:
        text = re.sub(pattern, repl, text)
    return text.strip()


def terminate(text: str) -> str:
    """Give a fragment sentence-final punctuation so the voice pauses after it."""
    text = text.rstrip()
    if text and text[-1] not in ".!?:;":
        text += "."
    return text


def resolve_hyphens(sections: list["Section"]) -> None:
    """Decide the marked hyphens using the vocabulary of the book itself.

    With no dictionary to consult, the document is its own authority: if both
    halves stand alone as words elsewhere in the text, the hyphen was a real
    compound; otherwise the word was merely broken across a line.
    """
    # Split at the markers so the vocabulary is of words the book actually
    # sets on their own, not of the fragments we are trying to judge.
    plain = " ".join(s.text for s in sections)
    plain = plain.replace(JOIN, " ").replace(TITLE_JOIN, " ")
    vocab = {t.lower() for t in re.findall(r"[A-Za-z]{3,}", plain)}

    def decide(match: re.Match) -> str:
        left, right = match.group(1), match.group(2)
        # A number after the hyphen is not the tail of the word: a list marker
        # or table figure has landed between a word and its continuation.
        if not right[:1].isalpha():
            return f"{left} {right}"
        if right[:1].isupper() or (left.lower() in vocab and right.lower() in vocab):
            return f"{left}-{right}"
        return left + right

    def decide_title(match: re.Match) -> str:
        left, right = match.group(1), match.group(2)
        # Only run the halves together when the book uses that word elsewhere,
        # so "Grass"/"lands" becomes Grasslands while "Road"/"and" stays apart.
        if (left + right).lower() in vocab:
            return left + right
        return f"{left} {right}"

    hyphen = re.compile(rf"(\w+){JOIN}(\w+)")
    title = re.compile(rf"(\w+){TITLE_JOIN}(\w+)")
    for section in sections:
        section.text = hyphen.sub(decide, section.text)
        section.text = title.sub(decide_title, section.text)
        section.title = title.sub(decide_title, section.title)


@dataclass
class Section:
    title: str
    text: str


def blocks_to_sections(blocks: list[Block], keep_citations: bool,
                       say_section: str) -> list[Section]:
    """Render blocks as narration text, grouped by section marker."""
    sections: list[Section] = []
    title = "Opening"
    parts: list[str] = []

    def flush():
        if parts:
            sections.append(Section(title, "\n\n".join(parts)))

    for block in blocks:
        if block.section:
            flush()
            parts = []
            # A chapter title needs the same repairs as body copy: it can be
            # broken across lines mid-word or mid-hyphen by the display setting.
            title = normalise(block.section, keep_citations=True)
            # "Section A." for alphabet dividers; a prose title reads as itself.
            spoken = (say_section.format(name=title)
                      if say_section and len(title) <= 2 else title)
            if spoken:
                parts.append(terminate(spoken))
            continue

        chunk: list[str] = []
        if block.heading:
            # Never strip sigils from a headword — some entries are named "(RIN)".
            chunk.append(terminate(normalise(block.heading, keep_citations=True)))
        if block.subtitle:
            tags = normalise(block.subtitle, keep_citations)
            chunk.append(terminate(tags[:1].upper() + tags[1:]))
        for para in block.paragraphs:
            cleaned = normalise(para, keep_citations)
            if cleaned:
                chunk.append(terminate(cleaned))
        body = " ".join(c for c in chunk if c.strip(". "))
        if body.strip():
            parts.append(body)

    flush()
    return sections


SENTENCE_END = re.compile(r"(?<=[.!?’\"])\s+")


def chunk_text(text: str, limit: int) -> list[str]:
    """Split into TTS-sized chunks, never mid-sentence."""
    chunks: list[str] = []
    current = ""
    for para in text.split("\n\n"):
        for sentence in SENTENCE_END.split(para):
            sentence = sentence.strip()
            if not sentence:
                continue
            if len(current) + len(sentence) + 1 > limit and current:
                chunks.append(current.strip())
                current = ""
            current += sentence + " "
        current += "\n"
    if current.strip():
        chunks.append(current.strip())
    return chunks


# --------------------------------------------------------------------------
# Synthesis
# --------------------------------------------------------------------------

def configure_tls():
    """Trust the session's outbound proxy CA if one is configured."""
    bundle = os.environ.get("SSL_CERT_FILE") or "/root/.ccr/ca-bundle.crt"
    if Path(bundle).exists():
        import edge_tts.communicate as communicate
        communicate._SSL_CTX = ssl.create_default_context(cafile=bundle)


async def synth_chunk(index: int, text: str, out: Path, voice: str, rate: str,
                      pitch: str, proxy: str | None, attempts: int = 4):
    import edge_tts

    for attempt in range(attempts):
        try:
            comm = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, proxy=proxy)
            await comm.save(str(out))
            if out.exists() and out.stat().st_size > 1024:
                return
            raise RuntimeError("empty audio returned")
        except Exception as exc:  # noqa: BLE001 - retry any transport hiccup
            if attempt == attempts - 1:
                raise RuntimeError(f"chunk {index} failed: {exc}") from exc
            await asyncio.sleep(2 ** attempt)


async def synth_all(chunks: list[str], workdir: Path, voice: str, rate: str,
                    pitch: str, concurrency: int) -> list[Path]:
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    sem = asyncio.Semaphore(concurrency)
    paths = [workdir / f"part_{i:05d}.mp3" for i in range(len(chunks))]
    done = 0

    async def worker(i: int):
        nonlocal done
        async with sem:
            await synth_chunk(i, chunks[i], paths[i], voice, rate, pitch, proxy)
            done += 1
            print(f"  spoken {done}/{len(chunks)} chunks", end="\r", flush=True)

    await asyncio.gather(*(worker(i) for i in range(len(chunks))))
    print()
    return paths


def group_sections(section_ranges: list[tuple[str, int, int]],
                   durations: list[float], target: float) -> list[list[int]]:
    """Group consecutive sections into parts of roughly `target` seconds.

    Splitting only on a chapter boundary means no part starts mid-sentence.
    """
    groups: list[list[int]] = []
    current: list[int] = []
    running = 0.0
    for index, (_title, lo, hi) in enumerate(section_ranges):
        span = sum(durations[lo:hi])
        if current and running + span > target:
            groups.append(current)
            current, running = [], 0.0
        current.append(index)
        running += span
    if current:
        groups.append(current)
    return groups


def duration_of(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def concat(parts: list[Path], out: Path, chapters: list[tuple[str, float]] | None,
           tags: dict[str, str] | None = None, total: float | None = None):
    listing = out.parent / f".{out.stem}_concat.txt"
    listing.write_text("".join(f"file '{p.resolve()}'\n" for p in parts))
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
           "-i", str(listing)]
    meta_path = None
    if chapters or tags:
        meta_path = out.parent / f".{out.stem}_meta.txt"
        meta_path.write_text(build_chapter_metadata(chapters or [], tags, total))
        # -map_chapters is required: without it ffmpeg keeps the input's own
        # chapters and silently ignores the ones in the metadata file.
        cmd += ["-i", str(meta_path), "-map_metadata", "1", "-map_chapters", "1",
                "-id3v2_version", "3"]
    cmd += ["-c", "copy", str(out)]
    subprocess.run(cmd, check=True)
    listing.unlink(missing_ok=True)
    if meta_path:
        meta_path.unlink(missing_ok=True)


def build_chapter_metadata(chapters: list[tuple[str, float]],
                           tags: dict[str, str] | None = None,
                           total: float | None = None) -> str:
    lines = [";FFMETADATA1"]
    for key, value in (tags or {}).items():
        if value:
            lines.append(f"{key}={value}")
    for i, (title, start) in enumerate(chapters):
        # The last chapter runs to the end of the file, not one second past its
        # own start — otherwise players show it as a one-second blip.
        end = chapters[i + 1][1] if i + 1 < len(chapters) else (total or start + 1)
        lines += ["[CHAPTER]", "TIMEBASE=1/1000",
                  f"START={int(start * 1000)}", f"END={int(end * 1000)}",
                  f"title={title}"]
    return "\n".join(lines) + "\n"


def hhmmss(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


# --------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf", type=Path)
    ap.add_argument("-o", "--output", type=Path, default=None,
                    help="output MP3 (default: <pdf stem>.mp3)")
    ap.add_argument("--voice", default="en-GB-RyanNeural",
                    help="Microsoft neural voice (edge-tts --list-voices)")
    ap.add_argument("--rate", default="+0%", help="speech rate, e.g. +10%%")
    ap.add_argument("--pitch", default="+0Hz")
    ap.add_argument("--first-page", type=int, default=1)
    ap.add_argument("--last-page", type=int, default=None)
    ap.add_argument("--column-split", type=float, default=None,
                    help="x coordinate dividing left/right columns")
    ap.add_argument("--say-section", default="Section {name}.",
                    help="spoken marker for section headers ('' to omit)")
    ap.add_argument("--keep-citations", action="store_true",
                    help="read parenthesised source abbreviations aloud")
    ap.add_argument("--section-size", type=float, default=1.8, metavar="RATIO",
                    help="text at RATIO x body size or larger starts a new "
                         "chapter (default 1.8)")
    ap.add_argument("--min-size", type=float, default=0.0, metavar="RATIO",
                    help="drop text smaller than RATIO x body size, e.g. 0.95 to "
                         "skip stat tables and captions set in small type")
    ap.add_argument("--drop-lines", default=None, metavar="REGEX",
                    help="drop any line matching this regex")
    ap.add_argument("--skip-heading", default=None, metavar="REGEX",
                    help="drop headings matching this regex, and their contents")
    ap.add_argument("--x-tolerance", type=float, default=None, metavar="PT",
                    help="gap width that separates words; by default this is "
                         "measured from the document, which matters for PDFs "
                         "that encode no spaces at all")
    ap.add_argument("--margin-top", type=float, default=0.0, metavar="PT",
                    help="ignore text within PT of the top of the page, where "
                         "running heads live")
    ap.add_argument("--margin-bottom", type=float, default=0.0, metavar="PT",
                    help="ignore text within PT of the bottom of the page, "
                         "where running feet live")
    ap.add_argument("--skip-pages", default=None, metavar="SPEC",
                    help="PDF pages to leave out entirely, e.g. '5,9,12-14' — "
                         "for character sheets, forms and maps, which are "
                         "scattered labels rather than prose")
    ap.add_argument("--chunk-chars", type=int, default=3000)
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--title", default=None, help="ID3 title (default: file name)")
    ap.add_argument("--author", default=None, help="ID3 artist/author")
    ap.add_argument("--text-only", action="store_true",
                    help="write the extracted narration text and stop")
    ap.add_argument("--part-minutes", type=float, default=None, metavar="MIN",
                    help="split the output into parts of about MIN minutes, "
                         "breaking only on chapter boundaries — for a book too "
                         "long to sit in one file")
    ap.add_argument("--split-sections", action="store_true",
                    help="also write one MP3 per section")
    args = ap.parse_args()

    out = args.output or args.pdf.with_suffix(".mp3")
    out.parent.mkdir(parents=True, exist_ok=True)

    print(f"Extracting text from {args.pdf.name} ...")
    blocks = extract_blocks(
        args.pdf, args.first_page, args.last_page, args.column_split,
        min_size_ratio=args.min_size,
        drop_lines=re.compile(args.drop_lines) if args.drop_lines else None,
        skip_heading=re.compile(args.skip_heading) if args.skip_heading else None,
        section_ratio=args.section_size,
        skip_pages=parse_page_spec(args.skip_pages),
        margin_top=args.margin_top, margin_bottom=args.margin_bottom,
        x_tolerance=args.x_tolerance)
    sections = blocks_to_sections(blocks, args.keep_citations, args.say_section)
    resolve_hyphens(sections)
    for section in sections:  # belt and braces: no placeholder may reach the voice
        section.text = section.text.replace(JOIN, "").replace(TITLE_JOIN, " ")
        section.title = section.title.replace(JOIN, "").replace(TITLE_JOIN, " ")
    full_text = "\n\n".join(s.text for s in sections)
    entries = sum(1 for b in blocks if b.heading)
    print(f"  {len(sections)} sections, {entries} entries, {len(full_text):,} characters")

    txt_path = out.with_suffix(".txt")
    txt_path.write_text(full_text + "\n")
    print(f"  narration text -> {txt_path}")
    if args.text_only:
        return 0

    configure_tls()

    # Chunk section by section so chapter boundaries land on chunk boundaries.
    chunks: list[str] = []
    section_ranges: list[tuple[str, int, int]] = []
    for section in sections:
        start = len(chunks)
        chunks.extend(chunk_text(section.text, args.chunk_chars))
        section_ranges.append((section.title, start, len(chunks)))

    print(f"Synthesising {len(chunks)} chunks with {args.voice} ...")
    with tempfile.TemporaryDirectory(prefix="pdf2audio_") as tmp:
        workdir = Path(tmp)
        parts = asyncio.run(synth_all(chunks, workdir, args.voice, args.rate,
                                      args.pitch, args.concurrency))

        durations = [duration_of(p) for p in parts]
        chapters: list[tuple[str, float]] = []
        elapsed = 0.0
        offsets = []
        for d in durations:
            offsets.append(elapsed)
            elapsed += d
        for title, start, _end in section_ranges:
            chapters.append((title, offsets[start] if start < len(offsets) else elapsed))

        book = args.title or out.stem.replace("_", " ")
        tags = {"title": book, "album": book,
                "artist": args.author or "", "genre": "Audiobook"}

        if args.part_minutes:
            groups = group_sections(section_ranges, durations, args.part_minutes * 60)
            print(f"Joining {len(parts)} chunks into {len(groups)} parts "
                  f"({hhmmss(elapsed)} total) ...")
            written = []
            for number, group in enumerate(groups, 1):
                first, last = group[0], group[-1]
                lo, hi = section_ranges[first][1], section_ranges[last][2]
                base = offsets[lo]
                marks = [(section_ranges[i][0], offsets[section_ranges[i][1]] - base)
                         for i in group]
                span = sum(durations[lo:hi])
                name = out.with_name(f"{out.stem}_part{number:02d}.mp3")
                concat(parts[lo:hi], name, marks,
                       {**tags, "title": f"{book}, Part {number}",
                        "track": f"{number}/{len(groups)}"}, total=span)
                written.append((name, span, marks))
                print(f"  part {number}: {hhmmss(span)}, "
                      f"{name.stat().st_size / 1e6:.1f} MB, {len(marks)} chapters")
            chapter_txt = out.with_name(out.stem + "_chapters.txt")
            chapter_txt.write_text("".join(
                f"== {name.name}  ({hhmmss(span)})\n"
                + "".join(f"   {hhmmss(t)}  {title}\n" for title, t in marks)
                for name, span, marks in written))
            print(f"Done: {len(written)} parts, {hhmmss(elapsed)} total")
            print(f"      chapter list -> {chapter_txt}")
            return 0

        print(f"Joining {len(parts)} parts ({hhmmss(elapsed)}) ...")
        concat(parts, out, chapters, tags, total=elapsed)

        if args.split_sections:
            sect_dir = out.with_suffix("")
            sect_dir.mkdir(exist_ok=True)
            for i, (title, start, end) in enumerate(section_ranges, 1):
                if start >= end:
                    continue
                safe = re.sub(r"[^\w-]+", "_", title).strip("_") or f"part{i}"
                concat(parts[start:end], sect_dir / f"{i:02d}_{safe}.mp3", None)
            print(f"  per-section files -> {sect_dir}/")

        chapter_txt = out.with_name(out.stem + "_chapters.txt")
        chapter_txt.write_text(
            "".join(f"{hhmmss(t)}  {name}\n" for name, t in chapters))

    size_mb = out.stat().st_size / 1e6
    print(f"Done: {out} ({size_mb:.1f} MB, {hhmmss(elapsed)})")
    print(f"      chapter list -> {chapter_txt}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
