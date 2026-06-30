// Text layout: wrapping, columns, paragraph styles, and threaded text flow.
// Works in each frame's LOCAL coordinate space (origin = frame top-left).
//
// Lightweight inline markup lets one story mix styles (handy for rulebooks):
//   "# Heading"   -> Heading 1 paragraph style
//   "## Heading"  -> Heading 2 paragraph style
//   "### Heading" -> Heading 2 (used as a sub-head)
// Everything else uses the frame's own style (or its assigned paragraph style).

const measureCanvas = document.createElement('canvas');
const mctx = measureCanvas.getContext('2d');

function fontString(s) {
  const style = s.italic ? 'italic ' : '';
  const weight = s.bold ? '700 ' : '400 ';
  return `${style}${weight}${s.size}px ${s.fontFamily}`;
}

function setMeasureStyle(s) {
  mctx.font = fontString(s);
  try { mctx.letterSpacing = `${s.tracking || 0}px`; } catch (_) { /* older engines */ }
}

// The effective base style of a frame: an assigned paragraph style, else its own attrs.
export function frameBaseStyle(frame, doc) {
  if (frame.paraStyleId) {
    const ps = doc.paragraphStyles.find((p) => p.id === frame.paraStyleId);
    if (ps) return ps;
  }
  return {
    fontFamily: frame.fontFamily, size: frame.size, color: frame.color,
    bold: frame.bold, italic: frame.italic, align: frame.align,
    lineHeight: frame.lineHeight, tracking: frame.tracking || 0, spaceAfter: 4,
  };
}

function resolveParagraph(rawLine, base, doc) {
  let text = rawLine, name = null;
  if (rawLine.startsWith('### ')) { name = 'Heading 2'; text = rawLine.slice(4); }
  else if (rawLine.startsWith('## ')) { name = 'Heading 2'; text = rawLine.slice(3); }
  else if (rawLine.startsWith('# ')) { name = 'Heading 1'; text = rawLine.slice(2); }
  let style = base;
  if (name) {
    const ps = doc.paragraphStyles.find((p) => p.name === name);
    if (ps) style = ps;
  }
  return { text, style };
}

// Column rectangles inside a frame (local coords).
function columnsOf(frame) {
  const pad = frame.padding ?? 4;
  const cols = Math.max(1, frame.columns || 1);
  const gap = frame.columnGap ?? 14;
  const innerW = frame.w - pad * 2;
  const innerH = frame.h - pad * 2;
  const colW = (innerW - gap * (cols - 1)) / cols;
  const rects = [];
  for (let c = 0; c < cols; c++) {
    rects.push({ x: pad + c * (colW + gap), y: pad, w: colW, h: innerH });
  }
  return rects;
}

// Build one wrapped line from a paragraph starting at word index `from`.
function buildLine(words, from, style, colW) {
  setMeasureStyle(style);
  const spaceW = mctx.measureText(' ').width;
  let i = from;
  const widths = [];
  let lineWords = [];
  let natural = 0;
  while (i < words.length) {
    const wWidth = mctx.measureText(words[i]).width;
    const add = (lineWords.length ? spaceW : 0) + wWidth;
    if (lineWords.length && natural + add > colW) break;
    lineWords.push(words[i]);
    widths.push(wWidth);
    natural += add;
    i++;
  }
  if (lineWords.length === 0 && from < words.length) {
    // single word longer than column — force it
    lineWords.push(words[from]); widths.push(mctx.measureText(words[from]).width); i = from + 1;
    natural = widths[0];
  }
  return { lineWords, widths, spaceW, natural, nextFrom: i, endsParagraph: i >= words.length };
}

function positionLine(line, style, colW, isLast) {
  const { lineWords, widths, spaceW, natural } = line;
  const n = lineWords.length;
  let startX = 0, gap = spaceW;
  if (style.align === 'center') startX = (colW - natural) / 2;
  else if (style.align === 'right') startX = colW - natural;
  else if (style.align === 'justify' && !isLast && n > 1) gap = spaceW + (colW - natural) / (n - 1);
  const tokens = [];
  let x = startX;
  for (let k = 0; k < n; k++) {
    tokens.push({ text: lineWords[k], x });
    x += widths[k] + gap;
  }
  return tokens;
}

// Lay out a whole thread chain (head holds the story text). Returns
// { byFrame: { [id]: { lines } }, overflow: bool }.
export function layoutStory(chain, doc) {
  const head = chain[0];
  const base = frameBaseStyle(head, doc);
  const raw = (head.text || '').split('\n');
  const paragraphs = raw.map((l) => resolveParagraph(l, base, doc));

  const byFrame = {};
  let pIndex = 0, wIndex = 0;
  let overflow = false;

  for (let f = 0; f < chain.length; f++) {
    const frame = chain[f];
    const cols = columnsOf(frame);
    const lines = [];
    byFrame[frame.id] = { lines };

    for (let c = 0; c < cols.length && pIndex < paragraphs.length; c++) {
      const col = cols[c];
      let cursorY = col.y;
      while (pIndex < paragraphs.length) {
        const para = paragraphs[pIndex];
        const style = para.style;
        const words = para.text.length ? para.text.split(/\s+/).filter(Boolean) : [];
        const lineH = style.size * style.lineHeight;

        if (words.length === 0) { // blank line
          if (cursorY + lineH > col.y + col.h) break;
          cursorY += lineH;
          pIndex++; wIndex = 0;
          continue;
        }

        const line = buildLine(words, wIndex, style, col.w);
        if (cursorY + lineH > col.y + col.h) break; // column full
        const tokens = positionLine(line, style, col.w, line.endsParagraph);
        const baseline = cursorY + style.size * 0.82;
        lines.push({
          tokens, baseline, x: col.x, font: fontString(style),
          color: style.color, tracking: style.tracking || 0,
        });
        cursorY += lineH;

        if (line.endsParagraph) {
          cursorY += style.spaceAfter || 0;
          pIndex++; wIndex = 0;
        } else {
          wIndex = line.nextFrom;
        }
      }
      if (pIndex < paragraphs.length && cursorY === col.y) {
        // nothing fit in this column at all (degenerate); avoid infinite loop
      }
    }
  }
  if (pIndex < paragraphs.length) overflow = true;
  return { byFrame, overflow };
}
