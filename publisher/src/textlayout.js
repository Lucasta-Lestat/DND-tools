// Text layout: wrapping, columns, paragraph styles, and threaded text flow.
// Works in each frame's LOCAL coordinate space (origin = frame top-left).
//
// Lightweight inline markup lets one story mix styles (handy for rulebooks):
//   "# Heading"   -> Heading 1 paragraph style
//   "## Heading"  -> Heading 2 paragraph style
//   "### Heading" -> Heading 2 (used as a sub-head)
// Everything else uses the frame's own style (or its assigned paragraph style).

import { hyphenateWord } from './hyphenation.js';

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

// Dictionary-quality hyphenation via Liang's algorithm (TeX en-US patterns).
// Returns allowed break positions (prefix lengths); lmin/rmin = 2/3.
export function hyphenatePoints(word) {
  return hyphenateWord(word, 2, 3);
}

// Tie a value to its unit ("30 ft") and a label to its number ("DC 15", "p. 42")
// with a non-breaking space, so the pair never splits across a line. The nbsp is
// U+00A0 — it renders and measures as a normal space but is not a break candidate.
const NB_UNITS = /(\d[\d,.\/]*)\x20(?=(?:ft|foot|feet|mi|mile|miles|yd|yard|yards|lb|lbs|gp|sp|cp|pp|ep|hp|xp|hr|hrs|hour|hours|min|minute|minutes|round|rounds|turn|turns|day|days|week|weeks|AC|DC|CR|HD)\.?\b)/gi;
const NB_LABELS = /\b(pp?\.|No\.|Nos\.|Fig\.|Figs\.|Ch\.|Vol\.|Sec\.|DC|AC|CR|HD|HP|XP|Lvl?\.?)\x20(?=\d)/gi;
export function applyNonBreaking(s) {
  return s.replace(NB_UNITS, '$1\u00A0').replace(NB_LABELS, '$1\u00A0');
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
  if (doc.settings && doc.settings.nonBreakingUnits !== false) text = applyNonBreaking(text);
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
  const canHyph = (wd) => hyphenate && wd.length >= 5 && /^[A-Za-z]+$/.test(wd);
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

// Split a word into hyphenation fragments (they re-join to the word).
function fragmentsOf(word, hyphenate) {
  if (!(hyphenate && word.length >= 5 && /^[A-Za-z]+$/.test(word))) return [word];
  const pts = hyphenatePoints(word);
  if (!pts.length) return [word];
  const frags = []; let prev = 0;
  for (const p of pts) { frags.push(word.slice(prev, p)); prev = p; }
  frags.push(word.slice(prev));
  return frags;
}

/* ---------- Knuth–Plass optimal line breaking ---------- */
// Minimises total demerits over the whole paragraph (badness³ + penalties +
// double-hyphen and fitness-class demerits) via DP over feasible breakpoints,
// with hyphenation points offered as penalised optional breaks.
const KPC = {
  linePenalty: 10, hyphenPenalty: 50, doubleHyphen: 3000, fitnessDemerit: 100,
  INF: 1e7, INF_BAD: 1e5, stretchRatio: 0.5, shrinkRatio: 1 / 3,
};

function knuthPlass(words, style, Lfun, hyphenate) {
  setMeasureStyle(style);
  const spaceW = mctx.measureText(' ').width;
  const spaceY = spaceW * KPC.stretchRatio;
  const spaceZ = spaceW * KPC.shrinkRatio;
  const hyphenW = mctx.measureText('-').width;
  const measure = (t) => mctx.measureText(t).width;

  // sequence of boxes / glue / penalties
  const seq = [];
  words.forEach((word, j) => {
    if (j > 0) seq.push({ t: 'glue', w: spaceW, y: spaceY, z: spaceZ });
    fragmentsOf(word, hyphenate).forEach((frag, k) => {
      if (k > 0) seq.push({ t: 'pen', w: hyphenW, p: KPC.hyphenPenalty, flag: true });
      seq.push({ t: 'box', w: measure(frag), text: frag });
    });
  });
  seq.push({ t: 'glue', w: 0, y: KPC.INF, z: 0 });   // final glue fills the last line
  seq.push({ t: 'pen', w: 0, p: -KPC.INF, flag: false }); // forced break

  const N = seq.length;
  // prefix sums before item i (penalty width excluded — added only when broken)
  const pW = [0], pY = [0], pZ = [0];
  for (let i = 0; i < N; i++) {
    const it = seq[i];
    pW.push(pW[i] + (it.t === 'pen' ? 0 : it.w));
    pY.push(pY[i] + (it.t === 'glue' ? it.y : 0));
    pZ.push(pZ[i] + (it.t === 'glue' ? it.z : 0));
  }
  const isBreak = (i) => {
    const it = seq[i];
    if (it.t === 'pen') return it.p < KPC.INF;
    if (it.t === 'glue') return i > 0 && seq[i - 1].t === 'box';
    return false;
  };
  const fitnessOf = (r) => (r < -0.5 ? 0 : r < 0.5 ? 1 : r < 1 ? 2 : 3);

  let active = [{ index: -1, line: 0, fitness: 1, demerits: 0, prev: null }];
  let finalNode = null;

  for (let b = 0; b < N; b++) {
    if (!isBreak(b)) continue;
    const it = seq[b];
    const forced = it.t === 'pen' && it.p <= -KPC.INF;
    const best = [null, null, null, null];
    const bestD = [Infinity, Infinity, Infinity, Infinity];
    let emergency = null, emergencyD = Infinity;
    const survivors = [];

    for (const a of active) {
      const start = a.index + 1;
      const endW = pW[b] + (it.t === 'pen' ? it.w : 0);
      const lineW = endW - pW[start];
      const lineY = pY[b] - pY[start];
      const lineZ = pZ[b] - pZ[start];
      const L = Lfun(a.line);
      let r;
      if (lineW < L) r = lineY > 0 ? (L - lineW) / lineY : KPC.INF;
      else if (lineW > L) r = lineZ > 0 ? (L - lineW) / lineZ : -KPC.INF;
      else r = 0;

      if (r < -1 && !forced) {
        // line too long even here — this node dies; remember as emergency
        const base = KPC.linePenalty + KPC.INF_BAD;
        const total = a.demerits + base * base;
        if (total < emergencyD) { emergencyD = total; emergency = { index: b, line: a.line + 1, fitness: 1, demerits: total, prev: a }; }
        continue; // do not keep `a`, do not spawn a normal candidate
      }
      if (!forced) survivors.push(a); // feasible so far — keep for later breakpoints

      const badness = r < -1 ? KPC.INF_BAD : Math.min(KPC.INF_BAD, 100 * Math.abs(r) ** 3);
      const base = KPC.linePenalty + badness;
      const p = it.t === 'pen' ? it.p : 0;
      let d;
      if (forced) d = base * base;
      else if (p >= 0) d = base * base + p * p;
      else d = base * base - p * p;
      if (it.flag && a.index >= 0 && seq[a.index].flag) d += KPC.doubleHyphen;
      const fc = fitnessOf(r);
      if (Math.abs(fc - a.fitness) > 1) d += KPC.fitnessDemerit;
      const total = a.demerits + d;
      if (total < bestD[fc]) { bestD[fc] = total; best[fc] = { index: b, line: a.line + 1, fitness: fc, demerits: total, prev: a }; }
    }

    if (forced) {
      let bn = null;
      for (let fc = 0; fc < 4; fc++) if (best[fc] && (!bn || best[fc].demerits < bn.demerits)) bn = best[fc];
      finalNode = bn || emergency;
      break;
    }
    for (let fc = 0; fc < 4; fc++) if (best[fc]) survivors.push(best[fc]);
    active = survivors.length ? survivors : (emergency ? [emergency] : active);
  }

  // backtrack to breakpoint indices
  const breaks = [];
  for (let node = finalNode; node && node.index >= 0; node = node.prev) breaks.unshift(node.index);

  // build lines
  const lines = [];
  let start = -1, lineNo = 0;
  for (const b of breaks) {
    const items = [];
    let pendingSpace = false;
    for (let i = start + 1; i < b; i++) {
      const it = seq[i];
      if (it.t === 'glue') pendingSpace = true;
      else if (it.t === 'box') {
        if (items.length && !pendingSpace) { const last = items[items.length - 1]; last.text += it.text; last.w += it.w; }
        else items.push({ text: it.text, w: it.w, space: pendingSpace });
        pendingSpace = false;
      }
    }
    if (seq[b].t === 'pen' && seq[b].p > -KPC.INF && items.length) { const last = items[items.length - 1]; last.text += '-'; last.w += hyphenW; }
    // adjustment ratio for this line
    const startIdx = start + 1;
    const endW = pW[b] + (seq[b].t === 'pen' ? seq[b].w : 0);
    const lineW = endW - pW[startIdx];
    const lineY = pY[b] - pY[startIdx], lineZ = pZ[b] - pZ[startIdx];
    const L = Lfun(lineNo);
    let r;
    if (lineW < L) r = lineY > 0 ? (L - lineW) / lineY : 0;
    else if (lineW > L) r = lineZ > 0 ? (L - lineW) / lineZ : 0;
    else r = 0;
    lines.push({ items, r, spaceW, spaceY, spaceZ, isLast: b === breaks[breaks.length - 1] });
    start = b; lineNo++;
  }
  return lines;
}

// Greedy fallback (ragged text and over-long paragraphs), producing the same
// line shape as knuthPlass so downstream positioning is uniform.
function greedyBreak(words, style, Lfun, hyphenate) {
  setMeasureStyle(style);
  const spaceW = mctx.measureText(' ').width;
  const out = [];
  let wIndex = 0, carry = null;
  while (wIndex < words.length || carry != null) {
    const L = Lfun(out.length);
    const line = buildLine(words, wIndex, carry, style, L, hyphenate);
    const items = line.items.map((it, i) => ({ text: it.text, w: it.w, space: i > 0 }));
    carry = line.carry; wIndex = line.nextFrom;
    const isLast = line.endsParagraph;
    out.push({ items, r: null, spaceW, isLast });
    if (isLast) break;
    if (!line.items.length && carry == null) break; // safety
  }
  return out;
}

// Break one paragraph into positioned lines (tokens x relative to the column,
// including first-line indent). colW is the (uniform) column measure.
function breakParagraph(para, colW, indent, hyphenate) {
  const style = para.style;
  // split on breakable whitespace only — U+00A0 stays inside a word (a "tie")
  const words = para.text.length ? para.text.split(/[\x20\t]+/).filter(Boolean) : [];
  const lineH = style.size * style.lineHeight;
  const common = { lineH, size: style.size, font: fontString(style), color: style.color, tracking: style.tracking || 0 };
  if (!words.length) return [{ spacer: true, ...common }];

  const Lfun = (ln) => Math.max(1, colW - (ln === 0 ? indent : 0));
  const justify = style.align === 'justify' && words.length <= 500;
  const lines = justify ? knuthPlass(words, style, Lfun, hyphenate) : greedyBreak(words, style, Lfun, hyphenate);

  setMeasureStyle(style);
  const spaceW = mctx.measureText(' ').width;
  return lines.map((ln, idx) => {
    const off = idx === 0 ? indent : 0;
    const tokens = [];
    if (justify) {
      const r = ln.r || 0;
      let x = off;
      for (const it of ln.items) {
        if (it.space) x += spaceW + (r >= 0 ? r * ln.spaceY : r * ln.spaceZ);
        tokens.push({ text: it.text, x }); x += it.w;
      }
    } else {
      const natural = ln.items.reduce((s, it) => s + it.w + (it.space ? spaceW : 0), 0);
      const L = Lfun(idx);
      let x = off + (style.align === 'center' ? (L - natural) / 2 : style.align === 'right' ? (L - natural) : 0);
      for (const it of ln.items) { if (it.space) x += spaceW; tokens.push({ text: it.text, x }); x += it.w; }
    }
    return { tokens, ...common, isLast: ln.isLast };
  });
}

// Lay out a whole thread chain (head holds the story text). Optimised lines are
// computed once at the head's column measure, then poured across the chain by
// height. Returns { byFrame: { [id]: { lines } }, overflow: bool }.
export function layoutStory(chain, doc) {
  const head = chain[0];
  const base = frameBaseStyle(head, doc);
  const anchorMap = buildAnchorPageMap(doc);
  const raw = resolveRefs(head.text || '', anchorMap).split('\n');
  const paragraphs = raw.map((l) => resolveParagraph(l, base, doc));
  const hyphenate = head.hyphenate !== false;
  const headColW = columnsOf(head)[0].w;

  const byFrame = {};
  for (const frame of chain) byFrame[frame.id] = { lines: [] };

  // pour cursor across frames/columns
  let fi = 0, ci = 0;
  let cols = columnsOf(chain[0]);
  let cursorY = cols.length ? cols[0].y : 0;
  let overflow = false;

  const placeLine = (ln) => {
    while (fi < chain.length) {
      cols = columnsOf(chain[fi]);
      if (ci >= cols.length) { fi++; ci = 0; if (fi < chain.length) cursorY = columnsOf(chain[fi])[0].y; continue; }
      const col = cols[ci];
      if (cursorY + ln.lineH > col.y + col.h) {
        ci++;
        if (ci < cols.length) cursorY = cols[ci].y;
        else { fi++; ci = 0; if (fi < chain.length) cursorY = columnsOf(chain[fi])[0].y; }
        continue;
      }
      if (!ln.spacer) {
        const placed = {
          tokens: ln.tokens, baseline: cursorY + ln.size * 0.82, x: col.x,
          font: ln.font, color: ln.color, tracking: ln.tracking,
        };
        if (ln.heading) placed.heading = ln.heading;
        if (ln.indexTerms) placed.indexTerms = ln.indexTerms;
        byFrame[chain[fi].id].lines.push(placed);
      }
      cursorY += ln.lineH + (ln.spaceAfter || 0);
      return true;
    }
    return false;
  };

  outer:
  for (const para of paragraphs) {
    const plines = breakParagraph(para, headColW, para.style.firstLineIndent || 0, hyphenate);
    if (plines[0]) {
      if (para.level) plines[0].heading = { level: para.level, text: para.text };
      if (para.indexTerms && para.indexTerms.length) plines[0].indexTerms = para.indexTerms;
    }
    const lastLine = plines[plines.length - 1];
    if (lastLine && !lastLine.spacer) lastLine.spaceAfter = para.style.spaceAfter || 0;
    for (const ln of plines) { if (!placeLine(ln)) { overflow = true; break outer; } }
  }
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
