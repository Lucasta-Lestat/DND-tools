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
    firstLineIndent: frame.firstLineIndent || 0,
  };
}

/* ---------- typographic niceties ---------- */

// Straight quotes → curly, -- → en dash, --- → em dash, ... → ellipsis.
export function smartTypography(s) {
  s = s.replace(/---/g, '—').replace(/--/g, '–').replace(/\.\.\./g, '…');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const prev = out[out.length - 1] || ' ';
    if (c === '"') out += /[\s([{—–\-]/.test(prev) ? '“' : '”';
    else if (c === "'") out += /[\s([{—–\-]/.test(prev) ? '‘' : '’';
    else out += c;
  }
  return out;
}

// Conservative English hyphenation: returns break positions (prefix lengths).
// Errs toward fewer, safer hyphens rather than aggressive splitting.
const VOWELS = 'aeiouy';
const isVowel = (ch) => VOWELS.indexOf(ch) !== -1;
const HYPH_PREFIXES = ['inter', 'under', 'super', 'trans', 'multi', 'semi', 'anti', 'over', 'fore', 'counter', 're', 'un', 'in', 'im', 'dis', 'mis', 'non', 'pre', 'pro', 'con', 'com', 'sub', 'out', 'de', 'en', 'ex'];
const HYPH_SUFFIXES = ['ations', 'ation', 'tions', 'tion', 'sions', 'sion', 'ings', 'ing', 'ments', 'ment', 'ness', 'able', 'ible', 'ful', 'less', 'ous', 'ive', 'ize', 'ise', 'ity', 'ent', 'ant', 'ence', 'ance', 'age', 'ward', 'ly', 'ers', 'est', 'ed', 'al', 'ic'];
const HYPH_DIGRAPHS = new Set(['ch', 'sh', 'th', 'ph', 'wh', 'gh', 'ck', 'ng', 'qu', 'rh']);

export function hyphenatePoints(word) {
  const w = word.toLowerCase();
  const len = w.length;
  const LMIN = 2, RMIN = 3;
  if (len < 6) return [];
  const pts = new Set();
  // doubled consonant between vowels: run-ning, let-ter
  for (let i = 1; i < len - 1; i++) {
    if (w[i] === w[i + 1] && !isVowel(w[i]) && isVowel(w[i - 1]) && (i + 2 >= len || isVowel(w[i + 2]))) pts.add(i + 1);
  }
  // VCCV with differing consonants (not a digraph): win-dow, mon-ster
  for (let i = 1; i < len - 2; i++) {
    if (isVowel(w[i - 1]) && !isVowel(w[i]) && !isVowel(w[i + 1]) && isVowel(w[i + 2]) && w[i] !== w[i + 1] && !HYPH_DIGRAPHS.has(w[i] + w[i + 1])) pts.add(i + 1);
  }
  for (const p of HYPH_PREFIXES) if (w.startsWith(p) && len - p.length >= RMIN) pts.add(p.length);
  for (const s of HYPH_SUFFIXES) if (w.endsWith(s) && len - s.length >= LMIN) pts.add(len - s.length);
  return [...pts].filter((p) => p >= LMIN && len - p >= RMIN).sort((a, b) => a - b);
}

// Pull {index:Term} marks out of a line; they record an index entry but render
// nothing. Returns the cleaned text plus the list of terms found.
function extractIndexTerms(line) {
  const terms = [];
  const cleaned = line.replace(/\{index:\s*([^}]+?)\s*\}/g, (_, t) => { terms.push(t.trim()); return ''; });
  return { cleaned, terms };
}

function resolveParagraph(rawLine, base, doc) {
  const { cleaned, terms } = extractIndexTerms(rawLine);
  let text = cleaned, name = null, level = 0;
  if (text.startsWith('### ')) { name = 'Heading 2'; text = text.slice(4); level = 3; }
  else if (text.startsWith('## ')) { name = 'Heading 2'; text = text.slice(3); level = 2; }
  else if (text.startsWith('# ')) { name = 'Heading 1'; text = text.slice(2); level = 1; }
  let style = base;
  if (name) {
    const ps = doc.paragraphStyles.find((p) => p.name === name);
    if (ps) style = ps;
  }
  if (doc.settings && doc.settings.smartTypography !== false) text = smartTypography(text);
  return { text, style, level, indexTerms: terms };
}

// Map every named anchor to the page number it lives on (real pages only).
export function buildAnchorPageMap(doc) {
  const map = new Map();
  doc.pages.forEach((page, i) => {
    for (const o of page.objects) if (o.anchorName) map.set(o.anchorName, i + 1);
  });
  return map;
}

// Replace inline cross-reference tokens with the live page number:
//   {page:Anchor}  {ref:Anchor}  ->  "12"  (or "?" if the anchor is missing)
export function resolveRefs(text, anchorMap) {
  if (!text || text.indexOf('{') === -1) return text;
  return text.replace(/\{(?:page|ref):\s*([^}]+?)\s*\}/g, (_, name) => {
    const n = anchorMap.get(name.trim());
    return n != null ? String(n) : '?';
  });
}

// Wrap plain text to a width; returns an array of line strings. Used by tables.
export function wrapText(text, style, width) {
  setMeasureStyle(style);
  const spaceW = mctx.measureText(' ').width;
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = '', lineW = 0;
    for (const w of words) {
      const ww = mctx.measureText(w).width;
      if (line && lineW + spaceW + ww > width) { out.push(line); line = w; lineW = ww; }
      else { lineW += (line ? spaceW : 0) + ww; line += (line ? ' ' : '') + w; }
    }
    if (line) out.push(line);
  }
  return out;
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

// Build one wrapped line starting at word index `from`, optionally continuing a
// `carry` fragment left over from a hyphenated word on the previous line.
// Returns items (each { text, w }), and a new `carry` if this line ends mid-word.
function buildLine(words, from, carry, style, colW, hyphenate) {
  setMeasureStyle(style);
  const spaceW = mctx.measureText(' ').width;
  const hyphenW = mctx.measureText('-').width;
  const measure = (t) => mctx.measureText(t).width;
  const canHyph = (wd) => hyphenate && wd.length >= 6 && /^[A-Za-z]+$/.test(wd);
  // Largest hyphen prefix of `wd` whose text width fits `avail`, or null.
  const splitToFit = (wd, avail) => {
    if (!canHyph(wd) || avail <= 0) return null;
    const pts = hyphenatePoints(wd);
    let best = -1;
    for (const p of pts) { if (measure(wd.slice(0, p)) <= avail) best = p; else break; }
    return best > 0 ? { prefix: wd.slice(0, best), rest: wd.slice(best) } : null;
  };

  const items = [];
  let natural = 0;
  let i = from;
  let newCarry = null;

  if (carry != null) {
    const cw = measure(carry);
    if (cw <= colW) { items.push({ text: carry, w: cw }); natural = cw; }
    else {
      const sp = splitToFit(carry, colW - hyphenW);
      if (sp) { items.push({ text: sp.prefix + '-', w: measure(sp.prefix) + hyphenW }); natural = measure(sp.prefix) + hyphenW; newCarry = sp.rest; }
      else { items.push({ text: carry, w: cw }); natural = cw; }
      return { items, natural, spaceW, nextFrom: i, carry: newCarry, endsParagraph: i >= words.length && !newCarry };
    }
  }

  while (i < words.length) {
    const word = words[i];
    const wWidth = measure(word);
    const gap = items.length ? spaceW : 0;
    if (items.length && natural + gap + wWidth > colW) {
      const sp = splitToFit(word, colW - natural - gap - hyphenW);
      if (sp) { items.push({ text: sp.prefix + '-', w: measure(sp.prefix) + hyphenW }); natural += gap + measure(sp.prefix) + hyphenW; newCarry = sp.rest; i++; }
      break;
    }
    if (!items.length && wWidth > colW) {
      const sp = splitToFit(word, colW - hyphenW);
      if (sp) { items.push({ text: sp.prefix + '-', w: measure(sp.prefix) + hyphenW }); natural = measure(sp.prefix) + hyphenW; newCarry = sp.rest; i++; }
      else { items.push({ text: word, w: wWidth }); natural = wWidth; i++; }
      break;
    }
    items.push({ text: word, w: wWidth }); natural += gap + wWidth; i++;
  }
  return { items, natural, spaceW, nextFrom: i, carry: newCarry, endsParagraph: i >= words.length && !newCarry };
}

// Cap on how far a justified space may stretch (× the natural space width),
// so long thin columns don't develop rivers.
const JUSTIFY_MAX_SPACE = 3.6;

function positionLine(line, style, colW, isLast) {
  const { items, natural, spaceW } = line;
  const n = items.length;
  let startX = 0, gap = spaceW;
  if (style.align === 'center') startX = (colW - natural) / 2;
  else if (style.align === 'right') startX = colW - natural;
  else if (style.align === 'justify' && !isLast && n > 1) {
    gap = spaceW + (colW - natural) / (n - 1);
    if (gap > spaceW * JUSTIFY_MAX_SPACE) gap = spaceW * JUSTIFY_MAX_SPACE; // leave slightly short rather than gappy
  }
  const tokens = [];
  let x = startX;
  for (let k = 0; k < n; k++) { tokens.push({ text: items[k].text, x }); x += items[k].w + gap; }
  return tokens;
}

// Lay out a whole thread chain (head holds the story text). Returns
// { byFrame: { [id]: { lines } }, overflow: bool }.
export function layoutStory(chain, doc) {
  const head = chain[0];
  const base = frameBaseStyle(head, doc);
  const anchorMap = buildAnchorPageMap(doc);
  const raw = resolveRefs(head.text || '', anchorMap).split('\n');
  const paragraphs = raw.map((l) => resolveParagraph(l, base, doc));

  const byFrame = {};
  const hyphenate = head.hyphenate !== false;
  let pIndex = 0, wIndex = 0, carry = null;
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
          pIndex++; wIndex = 0; carry = null;
          continue;
        }

        const isParaStart = wIndex === 0 && carry == null;
        const indent = isParaStart ? (style.firstLineIndent || 0) : 0;
        const lineColW = Math.max(1, col.w - indent);
        const line = buildLine(words, wIndex, carry, style, lineColW, hyphenate);
        if (cursorY + lineH > col.y + col.h) break; // column full; carry/wIndex preserved for next column
        let tokens = positionLine(line, style, lineColW, line.endsParagraph);
        if (indent) tokens = tokens.map((t) => ({ text: t.text, x: t.x + indent }));
        const baseline = cursorY + style.size * 0.82;
        const placed = {
          tokens, baseline, x: col.x, font: fontString(style),
          color: style.color, tracking: style.tracking || 0,
        };
        // Tag the first line of a heading paragraph so the TOC can find it.
        if (isParaStart && para.level) placed.heading = { level: para.level, text: para.text };
        // Tag index marks to the first line so the index can find their page.
        if (isParaStart && para.indexTerms && para.indexTerms.length) placed.indexTerms = para.indexTerms;
        lines.push(placed);
        cursorY += lineH;
        carry = line.carry;

        if (line.endsParagraph) {
          cursorY += style.spaceAfter || 0;
          pIndex++; wIndex = 0; carry = null;
        } else {
          wIndex = line.nextFrom;
        }
      }
    }
  }
  if (pIndex < paragraphs.length) overflow = true;
  return { byFrame, overflow };
}

// Resolve the ordered thread chain a frame belongs to (head → … → tail).
function storyChain(head, doc) {
  const all = [...doc.pages, ...doc.masters].flatMap((c) => c.objects);
  const byId = new Map(all.map((o) => [o.id, o]));
  const chain = [head];
  let cur = head;
  while (cur.threadNext && byId.get(cur.threadNext) && !chain.includes(byId.get(cur.threadNext))) {
    cur = byId.get(cur.threadNext); chain.push(cur);
  }
  return chain;
}

// Scan every text story and return its headings in reading order, each with the
// page it actually lands on after layout (threading aware).
// Returns [{ text, level, page, y }].
export function collectHeadings(doc) {
  const framePage = new Map();
  doc.pages.forEach((p, i) => p.objects.forEach((o) => framePage.set(o.id, i + 1)));

  const heads = [];
  for (const p of doc.pages) {
    for (const o of p.objects) {
      if (o.type === 'text' && !o.threadPrev && !o.field) heads.push(o);
    }
  }

  const out = [];
  let seq = 0;
  for (const head of heads) {
    const chain = storyChain(head, doc);
    const layout = layoutStory(chain, doc);
    for (const frame of chain) {
      const page = framePage.get(frame.id);
      if (page == null) continue; // frame on a master — skip
      const fl = layout.byFrame[frame.id];
      if (!fl) continue;
      // Lines are already in reading order (column-by-column, top-to-bottom),
      // so a monotonic seq preserves order even for multi-column frames.
      for (const line of fl.lines) {
        if (line.heading) out.push({ text: line.heading.text, level: line.heading.level, page, seq: seq++ });
      }
    }
  }
  out.sort((a, b) => a.page - b.page || a.seq - b.seq);
  return out;
}

// Collect index marks — inline {index:Term} tokens and object-level indexTerms —
// merged and alphabetised. Returns [{ term, pages:[…ascending, unique] }].
export function collectIndex(doc) {
  const framePage = new Map();
  doc.pages.forEach((p, i) => p.objects.forEach((o) => framePage.set(o.id, i + 1)));

  const marks = []; // { term, page }
  const heads = [];
  for (const p of doc.pages) {
    for (const o of p.objects) if (o.type === 'text' && !o.threadPrev && !o.field) heads.push(o);
  }
  for (const head of heads) {
    const chain = storyChain(head, doc);
    const layout = layoutStory(chain, doc);
    for (const frame of chain) {
      const page = framePage.get(frame.id);
      if (page == null) continue;
      const fl = layout.byFrame[frame.id];
      if (!fl) continue;
      for (const line of fl.lines) if (line.indexTerms) for (const t of line.indexTerms) marks.push({ term: t, page });
    }
  }
  // object-level index terms (any object tagged in the Index panel)
  doc.pages.forEach((p, i) => {
    const page = i + 1;
    for (const o of p.objects) if (Array.isArray(o.indexTerms)) for (const t of o.indexTerms) if (t) marks.push({ term: String(t).trim(), page });
  });

  const map = new Map();
  for (const { term, page } of marks) {
    if (!term) continue;
    if (!map.has(term)) map.set(term, new Set());
    map.get(term).add(page);
  }
  const entries = [...map.entries()].map(([term, pages]) => ({ term, pages: [...pages].sort((a, b) => a - b) }));
  entries.sort((a, b) => a.term.toLowerCase().localeCompare(b.term.toLowerCase()));
  return entries;
}
