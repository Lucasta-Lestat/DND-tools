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


@dataclass
class Block:
    """One lexicon entry, or one run of prose under a section marker."""

    heading: str = ""
    subtitle: str = ""
    paragraphs: list[str] = field(default_factory=list)
    section: str = ""


def classify_font(fontname: str, size: float, body_size: float) -> str:
    """Map a font/size pair onto a structural role."""
    lowered = fontname.lower()
    if size >= body_size * 2:  # drop caps / big section letters
        return SECTION
    if "bold" in lowered or "black" in lowered or "heavy" in lowered:
        return HEADING
    if "italic" in lowered or "oblique" in lowered:
        return SUBTITLE
    return BODY


def detect_gutter(words, page_width: float, body_size: float = 0.0,
                  min_width: float = 5.0) -> float | None:
    """Find the column gutter: the widest empty vertical band near the centre.

    Returns the x to split on, or None when the page is a single column. Guessing
    a fixed midpoint is not safe — a column can overhang it by a few points, and
    splitting there interleaves the two columns into nonsense.
    """
    low, high = page_width * 0.3, page_width * 0.7
    occupied = [False] * (int(page_width) + 2)
    # Oversized display letters (drop caps, section dividers) are set across the
    # gutter and would mask it, so they do not count as occupying it.
    if body_size:
        words = [w for w in words if w.get("size", body_size) <= body_size * 1.5]
    for w in words:
        for x in range(max(0, int(w["x0"])), min(len(occupied) - 1, int(w["x1"]) + 1)):
            occupied[x] = True

    best = run_start = None
    run = 0
    for x in range(int(low), int(high)):
        if not occupied[x]:
            if run == 0:
                run_start = x
            run += 1
            if best is None or run > best[1] - best[0]:
                best = (run_start, x + 1)
        else:
            run = 0

    # A sparse page can have an empty middle by accident; a real gutter needs
    # enough text on the page for the band to mean something.
    if best is None or best[1] - best[0] < min_width or len(words) < 20:
        return None

    split = (best[0] + best[1]) / 2
    left = sum(1 for w in words if w["x1"] <= split)
    right = sum(1 for w in words if w["x0"] >= split)
    # Both sides must carry real text. The right column may be small — a pull
    # quote beside a full column still needs splitting — so only require a few
    # words, not a share of the page.
    if left < 3 or right < 3:
        return None
    return split


def group_into_lines(words, tolerance: float) -> list[list]:
    """Cluster words sharing a baseline, tolerating sub-point vertical jitter."""
    lines: list[list] = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if lines and abs(w["top"] - lines[-1][0]["top"]) <= tolerance:
            lines[-1].append(w)
        else:
            lines.append([w])
    return lines


def page_lines(page, body_size: float, column_split: float | None) -> list[Line]:
    """Extract lines from a page, reading down each column in turn."""
    words = page.extract_words(extra_attrs=["fontname", "size"], keep_blank_chars=False)
    if not words:
        return []

    # Full-width pages (title pages, opening prose) must not be split.
    split = (column_split if column_split is not None
             else detect_gutter(words, page.width, body_size))
    columns = ([[w for w in words if w["x0"] < split],
                [w for w in words if w["x0"] >= split]]
               if split is not None else [words])

    tolerance = max(2.0, body_size * 0.4)
    lines: list[Line] = []
    for column in columns:
        for group in group_into_lines(column, tolerance):
            group.sort(key=lambda w: w["x0"])
            text = " ".join(w["text"] for w in group).strip()
            if not text:
                continue
            # Role = the role of the widest run of characters on the line.
            weights: dict[str, float] = {}
            for w in group:
                role = classify_font(w["fontname"], w["size"], body_size)
                weights[role] = weights.get(role, 0) + len(w["text"])
            role = max(weights, key=weights.get)
            lines.append(Line(text, role, group[0]["top"], group[0]["x0"]))

    return lines


def dominant_body_size(pdf, sample_pages: int = 20) -> float:
    counts: dict[float, int] = {}
    for page in pdf.pages[:sample_pages]:
        for ch in page.chars:
            key = round(ch["size"], 1)
            counts[key] = counts.get(key, 0) + 1
    return max(counts, key=counts.get) if counts else 10.0


FOLIO_RE = re.compile(r"^[ivxlcdm\d]{1,5}$", re.IGNORECASE)


def is_folio(line: Line) -> bool:
    """Page numbers: a lone numeral, in body type."""
    return line.role == BODY and bool(FOLIO_RE.fullmatch(line.text.strip()))


def build_blocks(lines: list[Line], line_gap: float) -> list[Block]:
    """Fold classified lines into entries, joining wrapped lines into paragraphs."""
    blocks: list[Block] = []
    current: Block | None = None
    buffer: list[str] = []
    prev_bottom: float | None = None

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

    for line in lines:
        if line.role == DROP:
            continue

        if line.role == SECTION:
            flush_block()
            blocks.append(Block(section=line.text.strip()))
            prev_bottom = None
            continue

        if line.role == HEADING:
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


def extract_blocks(path: Path, first_page: int, last_page: int | None,
                   column_split: float | None) -> list[Block]:
    import pdfplumber

    with pdfplumber.open(path) as pdf:
        body_size = dominant_body_size(pdf)
        pages = pdf.pages[first_page - 1: last_page if last_page else None]
        all_lines: list[Line] = []
        for page in pages:
            lines = [ln for ln in page_lines(page, body_size, column_split) if not is_folio(ln)]
            all_lines.extend(lines)
            # Page break: force a paragraph flush only if the page ends mid-entry
            # is *not* wanted, so we deliberately do nothing here — entries wrap
            # across pages and columns in this layout.
        leading = estimate_leading(all_lines)
        return build_blocks(all_lines, leading)


# --------------------------------------------------------------------------
# Text normalisation for speech
# --------------------------------------------------------------------------

# Source sigils like "(UVG)" or "(LotV)": short, parenthesised, at least two
# capitals. Ordinary asides such as "(sometimes human)" are left alone.
CITATION_RE = re.compile(r"\(\s*([A-Za-z]{2,6})\s*\)")


def _is_sigil(token: str) -> bool:
    return sum(1 for c in token if c.isupper()) >= 2

REPLACEMENTS = [
    (r"[†‡•▪●¶]", " "),        # daggers, bullets
    (r"[—–]", ", "),                                     # em/en dash -> comma pause
    (r"&", " and "),
    # Justified letter-spacing also splits words mid-line ("collec- tion").
    # Suspended hyphens ("short- and long-term") are genuine and left alone.
    (r"([a-z]{2,})- (?!and\b|or\b)([A-Za-z]+)", "\\1" + JOIN + "\\2"),
    (r"\s+([,.;:!?%’'])", r"\1"),                        # "power ." -> "power."
    (r"([‘“(\[])\s+", r"\1"),
    (r"([.!?])[\s,]*,", r"\1"),                          # ". ," -> "."
    (r",\s*([.!?])", r"\1"),
    (r"\s+", " "),
]


def normalise(text: str, keep_citations: bool) -> str:
    if not keep_citations:
        text = CITATION_RE.sub(
            lambda m: "" if _is_sigil(m.group(1)) else m.group(0), text)
    for pattern, repl in REPLACEMENTS:
        text = re.sub(pattern, repl, text)
    text = text.replace("..", ".").strip()
    return text


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
    plain = " ".join(s.text for s in sections).replace(JOIN, "")
    vocab = {t.lower() for t in re.findall(r"[A-Za-z]{3,}", plain)}

    def decide(match: re.Match) -> str:
        left, right = match.group(1), match.group(2)
        if right[:1].isupper() or (left.lower() in vocab and right.lower() in vocab):
            return f"{left}-{right}"
        return left + right

    pattern = re.compile(rf"(\w+){JOIN}(\w+)")
    for section in sections:
        section.text = pattern.sub(decide, section.text)


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
            title = block.section
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
    ap.add_argument("--chunk-chars", type=int, default=3000)
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--title", default=None, help="ID3 title (default: file name)")
    ap.add_argument("--author", default=None, help="ID3 artist/author")
    ap.add_argument("--text-only", action="store_true",
                    help="write the extracted narration text and stop")
    ap.add_argument("--split-sections", action="store_true",
                    help="also write one MP3 per section")
    args = ap.parse_args()

    out = args.output or args.pdf.with_suffix(".mp3")
    out.parent.mkdir(parents=True, exist_ok=True)

    print(f"Extracting text from {args.pdf.name} ...")
    blocks = extract_blocks(args.pdf, args.first_page, args.last_page, args.column_split)
    sections = blocks_to_sections(blocks, args.keep_citations, args.say_section)
    resolve_hyphens(sections)
    for section in sections:  # belt and braces: no placeholder may reach the voice
        section.text = section.text.replace(JOIN, "")
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

        tags = {"title": args.title or out.stem.replace("_", " "),
                "album": args.title or out.stem.replace("_", " "),
                "artist": args.author or "",
                "genre": "Audiobook"}
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
