// Canvas renderer for the active spread.
import { store, activeSpread, spreadObjects, layerById } from './store.js';
import { layoutStory, wrapText } from './textlayout.js';

const scene = document.getElementById('scene');
const ctx = scene.getContext('2d');
const imageCache = new Map();

let view = { zoom: 1, panX: 0, panY: 0, canvasW: 0, canvasH: 0 };
let pagePlacements = []; // [{page, ox, oy, w, h, pageNumber, master}]

export function getView() { return view; }

function dpr() { return window.devicePixelRatio || 1; }

export function resizeCanvas() {
  const wrap = scene.getBoundingClientRect();
  const d = dpr();
  scene.width = Math.max(1, Math.round(wrap.width * d));
  scene.height = Math.max(1, Math.round(wrap.height * d));
  view.canvasW = wrap.width;
  view.canvasH = wrap.height;
}

export function getImage(src) {
  if (!src) return null;
  if (imageCache.has(src)) return imageCache.get(src);
  const img = new Image();
  img.onload = () => drawScene();
  img.src = src;
  imageCache.set(src, img);
  return img;
}

// Spread placement geometry in document space.
export function computePlacements() {
  const sp = activeSpread();
  const s = store.doc.settings;
  pagePlacements = [];
  if (!sp) return { spreadW: 0, spreadH: 0 };
  const two = !sp.master && s.facing && sp.pages.length === 2;
  sp.pages.forEach((page, i) => {
    pagePlacements.push({
      page,
      ox: two ? i * s.pageWidth : 0,
      oy: 0,
      w: s.pageWidth,
      h: s.pageHeight,
      master: !!sp.master,
      pageNumber: sp.master ? null : store.doc.pages.indexOf(page) + 1,
    });
  });
  return { spreadW: two ? s.pageWidth * 2 : s.pageWidth, spreadH: s.pageHeight };
}

export function placementForPage(page) {
  return pagePlacements.find((p) => p.page === page);
}
export function getPlacements() { return pagePlacements; }

export function fitView() {
  const { spreadW, spreadH } = computePlacements();
  const pad = 60;
  const zx = (view.canvasW - pad) / spreadW;
  const zy = (view.canvasH - pad) / spreadH;
  const z = Math.max(0.05, Math.min(zx, zy, 4));
  store.ui.zoom = z;
  store.ui.pan = {
    x: (view.canvasW - spreadW * z) / 2,
    y: (view.canvasH - spreadH * z) / 2,
  };
}

export function docToScreen(x, y) {
  return { x: store.ui.pan.x + x * store.ui.zoom, y: store.ui.pan.y + y * store.ui.zoom };
}
export function screenToDoc(x, y) {
  return { x: (x - store.ui.pan.x) / store.ui.zoom, y: (y - store.ui.pan.y) / store.ui.zoom };
}

// Document-space center/size/rotation for an object placed on a page.
export function objectDocRect(obj, placement) {
  return {
    cx: placement.ox + obj.x + obj.w / 2,
    cy: placement.oy + obj.y + obj.h / 2,
    w: obj.w, h: obj.h, rot: (obj.rotation || 0) * Math.PI / 180,
  };
}

// Hit test a screen point against an object. Returns true if inside.
export function hitTest(obj, placement, sx, sy) {
  const r = objectDocRect(obj, placement);
  const p = screenToDoc(sx, sy);
  const dx = p.x - r.cx, dy = p.y - r.cy;
  const cos = Math.cos(-r.rot), sin = Math.sin(-r.rot);
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  return Math.abs(lx) <= r.w / 2 + 1 && Math.abs(ly) <= r.h / 2 + 1;
}

/* ---------- thread helpers ---------- */
function threadChain(headOrAny) {
  // walk to head
  let head = headOrAny;
  const all = [...store.doc.pages, ...store.doc.masters].flatMap((c) => c.objects);
  const byId = new Map(all.map((o) => [o.id, o]));
  while (head.threadPrev && byId.get(head.threadPrev)) head = byId.get(head.threadPrev);
  const chain = [head];
  let cur = head;
  while (cur.threadNext && byId.get(cur.threadNext)) {
    cur = byId.get(cur.threadNext);
    if (chain.includes(cur)) break;
    chain.push(cur);
  }
  return chain;
}

let layoutCache = new Map(); // headId -> layout result, rebuilt each drawScene
export function getFrameLayout(obj) {
  const chain = threadChain(obj);
  const head = chain[0];
  if (!layoutCache.has(head.id)) layoutCache.set(head.id, { chain, layout: layoutStory(chain, store.doc) });
  return layoutCache.get(head.id);
}

/* ---------- drawing ---------- */

export function drawScene() {
  if (!store.doc) return;
  layoutCache = new Map();
  const d = dpr();
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.clearRect(0, 0, view.canvasW, view.canvasH);
  computePlacements();

  // page shadows + paper
  for (const pl of pagePlacements) drawPage(pl);

  // objects in layer order (bottom-up). Build draw list from spread objects.
  const items = spreadObjects();
  const layerOrder = store.doc.layers;
  const ordered = items.slice().sort((a, b) => {
    const la = layerOrder.findIndex((l) => l.id === a.obj.layerId);
    const lb = layerOrder.findIndex((l) => l.id === b.obj.layerId);
    if (la !== lb) return la - lb;
    return 0;
  });
  for (const it of ordered) {
    const layer = layerById(it.obj.layerId);
    if (layer && !layer.visible) continue;
    const pl = placementForPage(it.page);
    if (pl) drawObject(it.obj, pl, it.fromMaster);
  }

  // margins / guides overlay
  for (const pl of pagePlacements) drawGuides(pl);

  // selection
  drawSelection();
}

function drawPage(pl) {
  const tl = docToScreen(pl.ox, pl.oy);
  const w = pl.w * store.ui.zoom, h = pl.h * store.ui.zoom;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.5)';
  ctx.shadowBlur = 16; ctx.shadowOffsetY = 6;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(tl.x, tl.y, w, h);
  ctx.restore();
}

function drawGuides(pl) {
  const s = store.doc.settings;
  const z = store.ui.zoom;
  const tl = docToScreen(pl.ox, pl.oy);
  ctx.save();
  // bleed
  if (s.bleed > 0) {
    ctx.strokeStyle = 'rgba(224,101,74,.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(tl.x - s.bleed * z, tl.y - s.bleed * z, (pl.w + s.bleed * 2) * z, (pl.h + s.bleed * 2) * z);
  }
  if (store.ui.showMargins) {
    const m = s.margins;
    // inside/outside depend on left/right page for facing docs
    const isLeft = s.facing && pl.ox > 0 ? false : (s.facing ? true : true);
    // For a 2-up spread: left page (ox=0) has inside on its right edge.
    let left = m.outside, right = m.outside;
    if (s.facing) {
      if (pl.ox === 0 && getPlacements().length === 2) { left = m.outside; right = m.inside; }
      else if (pl.ox > 0) { left = m.inside; right = m.outside; }
      else { left = m.inside; right = m.outside; }
    } else { left = m.inside; right = m.outside; }
    ctx.strokeStyle = 'rgba(126,90,255,.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(tl.x + left * z, tl.y + m.top * z, (pl.w - left - right) * z, (pl.h - m.top - m.bottom) * z);
    // columns
    if (s.columns > 1) {
      const innerW = pl.w - left - right;
      const colW = (innerW - s.gutter * (s.columns - 1)) / s.columns;
      ctx.strokeStyle = 'rgba(126,90,255,.28)';
      for (let c = 1; c < s.columns; c++) {
        const gx = left + c * colW + (c - 1) * s.gutter;
        ctx.beginPath();
        ctx.moveTo(tl.x + gx * z, tl.y + m.top * z);
        ctx.lineTo(tl.x + gx * z, tl.y + (pl.h - m.bottom) * z);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(tl.x + (gx + s.gutter) * z, tl.y + m.top * z);
        ctx.lineTo(tl.x + (gx + s.gutter) * z, tl.y + (pl.h - m.bottom) * z);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function withObjectTransform(obj, pl, fn) {
  const r = objectDocRect(obj, pl);
  const c = docToScreen(r.cx, r.cy);
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(r.rot);
  ctx.scale(store.ui.zoom, store.ui.zoom);
  ctx.globalAlpha = obj.opacity ?? 1;
  ctx.translate(-r.w / 2, -r.h / 2); // now origin = object top-left in doc units
  fn(r);
  ctx.restore();
}

function pathRoundRect(x, y, w, h, radius) {
  const rr = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawObject(obj, pl, fromMaster) {
  withObjectTransform(obj, pl, (r) => {
    if (obj.type === 'rect' || obj.type === 'image') {
      if (obj.fill) { ctx.fillStyle = obj.fill; pathRoundRect(0, 0, r.w, r.h, obj.radius || 0); ctx.fill(); }
      if (obj.type === 'image' && obj.src) drawImageInside(obj, r);
      if (obj.stroke && obj.strokeWidth > 0) { ctx.lineWidth = obj.strokeWidth; ctx.strokeStyle = obj.stroke; pathRoundRect(0, 0, r.w, r.h, obj.radius || 0); ctx.stroke(); }
      else if (obj.type === 'image' && !obj.src) drawPlaceholder(r);
    } else if (obj.type === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(r.w / 2, r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      if (obj.fill) { ctx.fillStyle = obj.fill; ctx.fill(); }
      if (obj.stroke && obj.strokeWidth > 0) { ctx.lineWidth = obj.strokeWidth; ctx.strokeStyle = obj.stroke; ctx.stroke(); }
    } else if (obj.type === 'line') {
      ctx.beginPath();
      ctx.moveTo(0, r.h);
      ctx.lineTo(r.w, 0);
      ctx.lineWidth = obj.strokeWidth || 2;
      ctx.strokeStyle = obj.stroke || '#000';
      ctx.lineCap = 'round';
      ctx.stroke();
    } else if (obj.type === 'text') {
      if (obj.fill) { ctx.fillStyle = obj.fill; pathRoundRect(0, 0, r.w, r.h, obj.radius || 0); ctx.fill(); }
      if (obj.stroke && obj.strokeWidth > 0) { ctx.lineWidth = obj.strokeWidth; ctx.strokeStyle = obj.stroke; ctx.strokeRect(0, 0, r.w, r.h); }
      drawText(obj, r, pl);
    } else if (obj.type === 'table') {
      drawTable(obj);
    } else if (obj.type === 'toc') {
      if (obj.fill) { ctx.fillStyle = obj.fill; ctx.fillRect(0, 0, r.w, r.h); }
      if (obj.stroke && obj.strokeWidth > 0) { ctx.lineWidth = obj.strokeWidth; ctx.strokeStyle = obj.stroke; ctx.strokeRect(0, 0, r.w, r.h); }
      drawToc(obj);
    } else if (obj.type === 'index') {
      if (obj.fill) { ctx.fillStyle = obj.fill; ctx.fillRect(0, 0, r.w, r.h); }
      if (obj.stroke && obj.strokeWidth > 0) { ctx.lineWidth = obj.strokeWidth; ctx.strokeStyle = obj.stroke; ctx.strokeRect(0, 0, r.w, r.h); }
      drawIndex(obj);
    } else if (obj.type === 'hexmap') {
      drawHexMap(obj);
    }
  });
}

/* ---------- tables ---------- */

// Pure geometry for a table: column x/width and row y/height (object-local pts).
export function computeTableLayout(obj) {
  const pad = obj.padding ?? 5;
  const rows = obj.rows || [];
  const ncols = Math.max(1, ...rows.map((r) => r.length));
  const weights = (obj.colWeights && obj.colWeights.length === ncols)
    ? obj.colWeights : Array.from({ length: ncols }, () => 1);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const colW = weights.map((wt) => (obj.w * wt) / total);
  const colX = []; let cx = 0;
  for (let c = 0; c < ncols; c++) { colX.push(cx); cx += colW[c]; }
  const lineH = obj.size * (obj.lineHeight || 1.2);
  const rowH = [], rowY = []; let y = 0;
  for (let r = 0; r < rows.length; r++) {
    const isHeader = r === 0 && obj.headerRow;
    const style = { fontFamily: obj.fontFamily, size: obj.size, bold: isHeader, italic: false, tracking: 0 };
    let maxLines = 1;
    for (let c = 0; c < ncols; c++) {
      const txt = rows[r][c] != null ? rows[r][c] : '';
      maxLines = Math.max(maxLines, wrapText(txt, style, Math.max(8, colW[c] - pad * 2)).length);
    }
    const h = maxLines * lineH + pad * 2;
    rowY.push(y); rowH.push(h); y += h;
  }
  return { pad, ncols, colW, colX, rowH, rowY, totalH: y, lineH };
}

// Natural content height — used to keep obj.h in sync with the table.
export function tableContentHeight(obj) { return computeTableLayout(obj).totalH; }

/* Table threading: rows live on the head; linked frames show later rows with a
   repeated header, so a long table flows across pages. */

export function tableChainOf(obj) {
  const all = [...store.doc.pages, ...store.doc.masters].flatMap((c) => c.objects);
  const byId = new Map(all.map((o) => [o.id, o]));
  let head = obj;
  while (head.threadPrev && byId.get(head.threadPrev)) head = byId.get(head.threadPrev);
  const chain = [head]; let cur = head;
  while (cur.threadNext && byId.get(cur.threadNext) && !chain.includes(byId.get(cur.threadNext))) {
    cur = byId.get(cur.threadNext); chain.push(cur);
  }
  return chain;
}

function tableColumns(width, head) {
  const ncols = Math.max(1, ...head.rows.map((r) => r.length));
  const weights = (head.colWeights && head.colWeights.length === ncols) ? head.colWeights : Array.from({ length: ncols }, () => 1);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const colW = weights.map((w) => (width * w) / total);
  const colX = []; let x = 0; for (const w of colW) { colX.push(x); x += w; }
  return { ncols, colW, colX };
}

function tableRowHeight(cells, colW, head, isHeader) {
  const pad = head.padding ?? 5;
  const lineH = head.size * (head.lineHeight || 1.2);
  const style = { fontFamily: head.fontFamily, size: head.size, bold: isHeader, italic: false, tracking: 0 };
  let maxLines = 1;
  for (let c = 0; c < colW.length; c++) {
    const t = cells && cells[c] != null ? cells[c] : '';
    maxLines = Math.max(maxLines, wrapText(t, style, Math.max(8, colW[c] - pad * 2)).length);
  }
  return maxLines * lineH + pad * 2;
}

// Distribute data rows across the chain by each frame's height.
function paginateChain(chain, head) {
  const dataRows = head.headerRow ? head.rows.slice(1) : head.rows;
  const perFrame = chain.map(() => []);
  let cursor = 0;
  for (let j = 0; j < chain.length; j++) {
    const frame = chain[j];
    const { colW } = tableColumns(frame.w, head);
    let y = 0;
    if (head.headerRow) y += tableRowHeight(head.rows[0], colW, head, true);
    while (cursor < dataRows.length) {
      const h = tableRowHeight(dataRows[cursor], colW, head, false);
      if (perFrame[j].length > 0 && y + h > frame.h) break;
      perFrame[j].push(cursor); y += h; cursor++;
    }
  }
  return { perFrame, overflow: cursor < dataRows.length };
}

// Visual rows for THIS frame: a (repeated) header plus its slice of data rows.
export function tableFrameLayout(obj) {
  const chain = tableChainOf(obj);
  const head = chain[0];
  const { ncols, colW, colX } = tableColumns(obj.w, head);
  const pad = head.padding ?? 5;
  const lineH = head.size * (head.lineHeight || 1.2);
  const dataOffset = head.headerRow ? 1 : 0;

  let dataIndices;
  if (chain.length === 1) {
    dataIndices = head.rows.slice(dataOffset).map((_, i) => i); // lone table: all rows
  } else {
    const { perFrame } = paginateChain(chain, head);
    dataIndices = perFrame[chain.indexOf(obj)] || [];
  }

  const visualRows = []; let y = 0;
  if (head.headerRow) {
    const h = tableRowHeight(head.rows[0], colW, head, true);
    visualRows.push({ kind: 'header', globalIndex: 0, cells: head.rows[0], y, h }); y += h;
  }
  for (const di of dataIndices) {
    const globalIndex = di + dataOffset;
    const cells = head.rows[globalIndex] || [];
    const h = tableRowHeight(cells, colW, head, false);
    visualRows.push({ kind: 'data', globalIndex, dataIndex: di, cells, y, h }); y += h;
  }
  return { head, ncols, colW, colX, pad, lineH, visualRows, totalH: y };
}

// Which cell sits under an object-local point. r is the GLOBAL row index on the head.
export function tableCellAt(obj, lx, ly) {
  const L = tableFrameLayout(obj);
  if (lx < 0 || lx > obj.w || ly < 0 || ly > L.totalH) return null;
  let c = 0; while (c < L.ncols - 1 && lx > L.colX[c + 1]) c++;
  const vr = L.visualRows.find((v) => ly >= v.y && ly <= v.y + v.h);
  if (!vr) return null;
  return { r: vr.globalIndex, c, x: L.colX[c], y: vr.y, w: L.colW[c], h: vr.h, headId: L.head.id };
}

function drawTable(obj) {
  const L = tableFrameLayout(obj);
  const head = L.head;
  // backgrounds
  for (const vr of L.visualRows) {
    let bg = null;
    if (vr.kind === 'header') bg = head.headerFill;
    else if (head.zebra && (vr.dataIndex % 2 === 1)) bg = head.zebra;
    else if (head.fill) bg = head.fill;
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, vr.y, obj.w, vr.h); }
  }
  // roll highlight (roll.row is a global head-row index)
  const roll = store.ui.tableRoll;
  if (roll && roll.tableId === head.id) {
    const vr = L.visualRows.find((v) => v.kind === 'data' && v.globalIndex === roll.row);
    if (vr) { ctx.fillStyle = 'rgba(47,129,247,.28)'; ctx.fillRect(0, vr.y, obj.w, vr.h); }
  }
  // borders
  if (head.borderWidth > 0) {
    ctx.strokeStyle = head.borderColor || '#000';
    ctx.lineWidth = head.borderWidth;
    ctx.strokeRect(0, 0, obj.w, L.totalH);
    ctx.beginPath();
    for (let i = 1; i < L.visualRows.length; i++) { ctx.moveTo(0, L.visualRows[i].y); ctx.lineTo(obj.w, L.visualRows[i].y); }
    for (let c = 1; c < L.ncols; c++) { ctx.moveTo(L.colX[c], 0); ctx.lineTo(L.colX[c], L.totalH); }
    ctx.stroke();
  }
  // text
  ctx.textBaseline = 'alphabetic';
  for (const vr of L.visualRows) {
    const isHeader = vr.kind === 'header';
    ctx.font = `${isHeader ? '700 ' : '400 '}${head.size}px ${head.fontFamily}`;
    ctx.fillStyle = isHeader ? (head.headerColor || '#fff') : (head.color || '#222');
    const style = { fontFamily: head.fontFamily, size: head.size, bold: isHeader, italic: false, tracking: 0 };
    for (let c = 0; c < L.ncols; c++) {
      const txt = vr.cells[c] != null ? vr.cells[c] : '';
      const lines = wrapText(txt, style, Math.max(8, L.colW[c] - L.pad * 2));
      const align = head.align || 'left';
      ctx.textAlign = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';
      const tx = L.colX[c] + (align === 'center' ? L.colW[c] / 2 : align === 'right' ? L.colW[c] - L.pad : L.pad);
      lines.forEach((ln, i) => ctx.fillText(ln, tx, vr.y + L.pad + head.size * 0.82 + i * L.lineH));
    }
  }
  ctx.textAlign = 'left';
}

/* ---------- table of contents ---------- */

// Resolve a TOC entry's effective style for its heading level, with fallbacks.
export function tocLevelStyle(obj, level) {
  const ls = (obj.levelStyles && obj.levelStyles[level]) || {};
  return {
    size: ls.size ?? obj.size,
    color: ls.color ?? obj.color,
    bold: ls.bold ?? (level === 1),
    italic: ls.italic ?? false,
    indent: ls.indent ?? (level - 1) * obj.indent,
    showPage: ls.showPage ?? true,
    leader: ls.leader ?? true,
  };
}

// Pure vertical layout for a TOC (object-local pts). Row heights follow the
// per-level font size, so levels can differ in size.
export function computeTocLayout(obj) {
  const pad = obj.padding ?? 6;
  const titleH = obj.title ? obj.titleSize * obj.lineHeight : 0;
  const rows = [];
  let y = pad + titleH;
  for (const entry of obj.entries || []) {
    const st = tocLevelStyle(obj, entry.level);
    const h = st.size * obj.lineHeight;
    rows.push({ y, h, entry, style: st });
    y += h;
  }
  return { pad, titleH, rows, totalH: y + pad };
}

export function tocContentHeight(obj) { return computeTocLayout(obj).totalH; }

// Which TOC entry sits under an object-local point (or null).
export function tocEntryAt(obj, lx, ly) {
  if (lx < 0 || lx > obj.w) return null;
  const L = computeTocLayout(obj);
  for (let i = 0; i < L.rows.length; i++) {
    const r = L.rows[i];
    if (ly >= r.y && ly <= r.y + r.h) return { index: i, entry: r.entry };
  }
  return null;
}

function drawToc(obj) {
  const L = computeTocLayout(obj);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, obj.w, obj.h); ctx.clip();
  ctx.textBaseline = 'alphabetic';
  const pad = L.pad;
  if (obj.title) {
    ctx.font = `700 ${obj.titleSize}px ${obj.fontFamily}`;
    ctx.fillStyle = obj.titleColor || obj.color;
    ctx.textAlign = 'left';
    ctx.fillText(obj.title, pad, pad + obj.titleSize * 0.82);
  }
  for (const row of L.rows) {
    const e = row.entry;
    const st = row.style;
    ctx.font = `${st.italic ? 'italic ' : ''}${st.bold ? '700 ' : '400 '}${st.size}px ${obj.fontFamily}`;
    ctx.fillStyle = st.color;
    const baseline = row.y + st.size * 0.82;
    const x0 = pad + st.indent;
    ctx.textAlign = 'left';
    ctx.fillText(e.text, x0, baseline);
    if (!st.showPage) continue;
    const textW = ctx.measureText(e.text).width;
    const pageStr = String(e.page);
    ctx.textAlign = 'right';
    ctx.fillText(pageStr, obj.w - pad, baseline);
    const pageW = ctx.measureText(pageStr).width;
    // dot leaders between the entry text and the page number
    if (obj.leader && st.leader) {
      ctx.textAlign = 'left';
      const start = x0 + textW + 4;
      const end = obj.w - pad - pageW - 4;
      const dotW = ctx.measureText(obj.leader + ' ').width || 4;
      if (end > start && dotW > 0) {
        const n = Math.floor((end - start) / dotW);
        if (n > 0) {
          ctx.fillStyle = '#999';
          ctx.fillText((obj.leader + ' ').repeat(n), start, baseline);
        }
      }
    }
  }
  ctx.textAlign = 'left';
  ctx.restore();
}

/* ---------- index ---------- */

// Build the multi-column, letter-grouped layout for an index (object-local pts).
export function computeIndexLayout(obj) {
  const pad = obj.padding ?? 6;
  const cols = Math.max(1, obj.columns || 1);
  const gap = obj.columnGap ?? 16;
  const colW = (obj.w - pad * 2 - gap * (cols - 1)) / cols;
  const titleH = obj.title ? obj.titleSize * obj.lineHeight : 0;
  const lineH = obj.size * obj.lineHeight;
  const colTop = pad + titleH;

  const flat = [];
  let cur = null;
  for (const e of obj.entries || []) {
    if (obj.groupByLetter) {
      const L = (e.term[0] || '#').toUpperCase();
      if (L !== cur) { cur = L; flat.push({ kind: 'letter', letter: L }); }
    }
    flat.push({ kind: 'entry', entry: e });
  }

  // Deterministic, balanced split: equal row counts per column (last may be short).
  const perCol = Math.max(1, Math.ceil(flat.length / cols));
  const rows = flat.map((row, i) => {
    const colIndex = Math.floor(i / perCol);
    const within = i % perCol;
    return { ...row, x: pad + colIndex * (colW + gap), y: colTop + within * lineH, h: lineH, colW, colIndex };
  });
  return { pad, cols, gap, colW, titleH, lineH, colTop, rows };
}

export function indexContentHeight(obj) {
  const cols = Math.max(1, obj.columns || 1);
  const lineH = obj.size * obj.lineHeight;
  const titleH = obj.title ? obj.titleSize * obj.lineHeight : 0;
  const pad = obj.padding ?? 6;
  let n = 0, cur = null;
  for (const e of obj.entries || []) {
    if (obj.groupByLetter) { const L = (e.term[0] || '#').toUpperCase(); if (L !== cur) { cur = L; n++; } }
    n++;
  }
  const perCol = Math.ceil(n / cols) || 1;
  return pad + titleH + perCol * lineH + pad;
}

export function indexEntryAt(obj, lx, ly) {
  const L = computeIndexLayout(obj);
  for (const row of L.rows) {
    if (row.kind === 'entry' && lx >= row.x && lx <= row.x + row.colW && ly >= row.y && ly <= row.y + row.h) return { entry: row.entry };
  }
  return null;
}

function clipToWidth(text, width) {
  if (ctx.measureText(text).width <= width) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > width) t = t.slice(0, -1);
  return t + '…';
}

function drawIndex(obj) {
  const L = computeIndexLayout(obj);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, obj.w, obj.h); ctx.clip();
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  if (obj.title) {
    ctx.font = `700 ${obj.titleSize}px ${obj.fontFamily}`;
    ctx.fillStyle = obj.titleColor || obj.color;
    ctx.fillText(obj.title, L.pad, L.pad + obj.titleSize * 0.82);
  }
  for (const row of L.rows) {
    const baseline = row.y + obj.size * 0.82;
    if (row.kind === 'letter') {
      ctx.font = `700 ${obj.size}px ${obj.fontFamily}`;
      ctx.fillStyle = obj.letterColor || obj.color;
      ctx.fillText(row.letter, row.x, baseline);
    } else {
      ctx.font = `400 ${obj.size}px ${obj.fontFamily}`;
      ctx.fillStyle = obj.color;
      const e = row.entry;
      ctx.fillText(clipToWidth(`${e.term}, ${e.pages.join(', ')}`, row.colW), row.x, baseline);
    }
  }
  ctx.restore();
}

/* ---------- hex map ---------- */

// Grid geometry that fits the hex grid inside the object bounds.
export function hexGeometry(obj) {
  const pointy = obj.orientation === 'pointy';
  const cols = Math.max(1, obj.cols), rows = Math.max(1, obj.rows);
  const S3 = Math.sqrt(3);
  const sizeW = pointy ? obj.w / (S3 * (cols + 0.5)) : obj.w / (1.5 * cols + 0.5);
  const sizeH = pointy ? obj.h / (1.5 * rows + 0.5) : obj.h / (S3 * (rows + 0.5));
  const size = Math.max(1, Math.min(sizeW, sizeH));
  const gridW = pointy ? size * S3 * (cols + 0.5) : size * (1.5 * cols + 0.5);
  const gridH = pointy ? size * (1.5 * rows + 0.5) : size * S3 * (rows + 0.5);
  return { pointy, size, cols, rows, offsetX: (obj.w - gridW) / 2, offsetY: (obj.h - gridH) / 2 };
}

export function hexCenter(geo, c, r) {
  const { size, offsetX, offsetY, pointy } = geo, S3 = Math.sqrt(3);
  if (!pointy) return { x: offsetX + size + c * 1.5 * size, y: offsetY + S3 * size * 0.5 + r * S3 * size + (c % 2 ? S3 * size * 0.5 : 0) };
  return { x: offsetX + S3 * size * 0.5 + c * S3 * size + (r % 2 ? S3 * size * 0.5 : 0), y: offsetY + size + r * 1.5 * size };
}

export function hexPoly(cx, cy, size, pointy) {
  const pts = []; const base = pointy ? 30 : 0;
  for (let k = 0; k < 6; k++) { const a = (base + 60 * k) * Math.PI / 180; pts.push({ x: cx + size * Math.cos(a), y: cy + size * Math.sin(a) }); }
  return pts;
}

export function hexCoordLabel(obj, c, r) {
  return `${String(c + 1).padStart(2, '0')}${String(r + 1).padStart(2, '0')}`;
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// Which hex is under an object-local point (or null).
export function hexAt(obj, lx, ly) {
  const geo = hexGeometry(obj);
  for (let c = 0; c < geo.cols; c++) for (let r = 0; r < geo.rows; r++) {
    const cn = hexCenter(geo, c, r);
    if (pointInPoly(lx, ly, hexPoly(cn.x, cn.y, geo.size, geo.pointy))) return { c, r, key: `${c},${r}` };
  }
  return null;
}

function tracePoly(g, poly) { g.beginPath(); poly.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); }

function drawHexMap(obj) {
  if (obj.fill) { ctx.fillStyle = obj.fill; ctx.fillRect(0, 0, obj.w, obj.h); }
  if (obj.src) {
    const img = getImage(obj.src);
    if (img && img.complete && img.naturalWidth) {
      ctx.save(); ctx.globalAlpha *= (obj.imageOpacity ?? 1);
      ctx.beginPath(); ctx.rect(0, 0, obj.w, obj.h); ctx.clip();
      const s = Math.max(obj.w / img.naturalWidth, obj.h / img.naturalHeight);
      ctx.drawImage(img, (obj.w - img.naturalWidth * s) / 2, (obj.h - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
      ctx.restore();
    }
  }
  const geo = hexGeometry(obj);
  ctx.lineWidth = obj.gridWidth || 1; ctx.strokeStyle = obj.gridColor || '#000';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let c = 0; c < geo.cols; c++) for (let r = 0; r < geo.rows; r++) {
    const data = obj.hexes[`${c},${r}`];
    const cn = hexCenter(geo, c, r);
    tracePoly(ctx, hexPoly(cn.x, cn.y, geo.size, geo.pointy));
    if (data && data.fill) { ctx.fillStyle = data.fill; ctx.fill(); }
    ctx.stroke();
    if (obj.labelMode !== 'none' && geo.size > 8) {
      const label = (data && data.label) || hexCoordLabel(obj, c, r);
      if (label) { ctx.fillStyle = obj.labelColor || '#333'; ctx.font = `${obj.labelSize || 7}px system-ui`; ctx.fillText(label, cn.x, cn.y - geo.size * 0.45); }
    }
    if (data && data.link) { ctx.beginPath(); ctx.arc(cn.x, cn.y + geo.size * 0.32, Math.max(1.2, geo.size * 0.09), 0, Math.PI * 2); ctx.fillStyle = '#2f81f7'; ctx.fill(); }
  }
  const sel = store.ui.selectedHex;
  if (sel && sel.mapId === obj.id && sel.c < geo.cols && sel.r < geo.rows) {
    const cn = hexCenter(geo, sel.c, sel.r);
    tracePoly(ctx, hexPoly(cn.x, cn.y, geo.size, geo.pointy));
    ctx.strokeStyle = '#2f81f7'; ctx.lineWidth = 2.5; ctx.stroke();
  }
}

function drawPlaceholder(r) {
  ctx.strokeStyle = '#b9bcc2';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, r.w - 1, r.h - 1);
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(r.w, r.h);
  ctx.moveTo(r.w, 0); ctx.lineTo(0, r.h);
  ctx.stroke();
}

function drawImageInside(obj, r) {
  const img = getImage(obj.src);
  if (!img || !img.complete || !img.naturalWidth) return;
  ctx.save();
  pathRoundRect(0, 0, r.w, r.h, obj.radius || 0);
  ctx.clip();
  const iw = img.naturalWidth, ih = img.naturalHeight;
  let dw = r.w, dh = r.h, dx = 0, dy = 0;
  if (obj.fit === 'contain') {
    const s = Math.min(r.w / iw, r.h / ih); dw = iw * s; dh = ih * s; dx = (r.w - dw) / 2; dy = (r.h - dh) / 2;
  } else if (obj.fit === 'cover') {
    const s = Math.max(r.w / iw, r.h / ih); dw = iw * s; dh = ih * s; dx = (r.w - dw) / 2; dy = (r.h - dh) / 2;
  }
  if (obj.adjust) applyAdjust(obj.adjust);
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

function applyAdjust(a) {
  const parts = [];
  if (a.brightness != null) parts.push(`brightness(${a.brightness})`);
  if (a.contrast != null) parts.push(`contrast(${a.contrast})`);
  if (a.saturate != null) parts.push(`saturate(${a.saturate})`);
  if (a.grayscale) parts.push(`grayscale(${a.grayscale})`);
  if (parts.length) ctx.filter = parts.join(' ');
}

function drawText(obj, r, pl) {
  ctx.save();
  // clip to frame
  ctx.beginPath();
  ctx.rect(0, 0, r.w, r.h);
  ctx.clip();
  ctx.textBaseline = 'alphabetic';

  if (obj.field === 'pageNumber') {
    const num = pl.pageNumber != null ? String(pl.pageNumber) : '#';
    const style = { fontFamily: obj.fontFamily, size: obj.size, bold: obj.bold, italic: obj.italic };
    ctx.font = `${obj.italic ? 'italic ' : ''}${obj.bold ? '700 ' : '400 '}${obj.size}px ${obj.fontFamily}`;
    ctx.fillStyle = obj.color || '#444';
    ctx.textAlign = obj.align === 'center' ? 'center' : obj.align === 'right' ? 'right' : 'left';
    const tx = obj.align === 'center' ? r.w / 2 : obj.align === 'right' ? r.w - 4 : 4;
    ctx.fillText(num, tx, r.h / 2 + obj.size * 0.35);
    ctx.restore();
    return;
  }

  const { layout } = getFrameLayout(obj);
  const fl = layout.byFrame[obj.id];
  if (fl) {
    ctx.textAlign = 'left';
    for (const line of fl.lines) {
      ctx.font = line.font;
      ctx.fillStyle = line.color;
      try { ctx.letterSpacing = `${line.tracking}px`; } catch (_) {}
      for (const tk of line.tokens) ctx.fillText(tk.text, line.x + tk.x, line.baseline);
    }
    try { ctx.letterSpacing = '0px'; } catch (_) {}
  }
  ctx.restore();
}

/* ---------- selection chrome ---------- */

export function objectScreenCorners(obj, pl) {
  const r = objectDocRect(obj, pl);
  const c = docToScreen(r.cx, r.cy);
  const hw = r.w / 2 * store.ui.zoom, hh = r.h / 2 * store.ui.zoom;
  const cos = Math.cos(r.rot), sin = Math.sin(r.rot);
  const pt = (lx, ly) => ({ x: c.x + lx * cos - ly * sin, y: c.y + lx * sin + ly * cos });
  return {
    nw: pt(-hw, -hh), ne: pt(hw, -hh), se: pt(hw, hh), sw: pt(-hw, hh),
    n: pt(0, -hh), e: pt(hw, 0), s: pt(0, hh), w: pt(-hw, 0),
    rot: pt(0, -hh - 24), center: c,
  };
}

function drawSelection() {
  const sel = store.ui.selection;
  if (!sel.length) return;
  ctx.save();
  for (const id of sel) {
    const found = findOnSpread(id);
    if (!found) continue;
    const { obj, pl } = found;
    const cc = objectScreenCorners(obj, pl);
    ctx.strokeStyle = '#2f81f7';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cc.nw.x, cc.nw.y); ctx.lineTo(cc.ne.x, cc.ne.y);
    ctx.lineTo(cc.se.x, cc.se.y); ctx.lineTo(cc.sw.x, cc.sw.y); ctx.closePath();
    ctx.stroke();
    // rotation stalk
    ctx.beginPath(); ctx.moveTo(cc.n.x, cc.n.y); ctx.lineTo(cc.rot.x, cc.rot.y); ctx.stroke();
    if (obj.type === 'text') drawThreadMarkers(obj, cc);
    drawLinkBadge(obj, cc);
    if (sel.length === 1) {
      for (const k of ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w', 'rot']) drawHandle(cc[k], k === 'rot');
    }
  }
  ctx.restore();
}

// Small glyphs marking objects that are a hyperlink source and/or anchor target.
function drawLinkBadge(obj, cc) {
  const tags = [];
  if (obj.link) tags.push({ t: '🔗', c: '#2f81f7' });
  if (obj.anchorName) tags.push({ t: '⚓', c: '#7a2d1f' });
  if (!tags.length) return;
  ctx.save();
  ctx.font = '11px system-ui';
  ctx.textBaseline = 'middle';
  let x = cc.ne.x + 6;
  for (const tag of tags) {
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = tag.c;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x + 7, cc.ne.y, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillText(tag.t, x, cc.ne.y);
    x += 20;
  }
  ctx.restore();
}

function drawThreadMarkers(obj, cc) {
  // small in/out flow tabs at bottom-right
  const inFull = !!obj.threadPrev;
  const outFull = !!obj.threadNext;
  ctx.fillStyle = outFull ? '#2f81f7' : '#fff';
  ctx.strokeStyle = '#2f81f7';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.rect(cc.se.x - 6, cc.se.y - 6, 7, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = inFull ? '#2f81f7' : '#fff';
  ctx.beginPath(); ctx.rect(cc.nw.x - 1, cc.nw.y - 1, 7, 7); ctx.fill(); ctx.stroke();
}

function drawHandle(p, isRot) {
  ctx.beginPath();
  if (isRot) { ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); }
  else { ctx.rect(p.x - 4, p.y - 4, 8, 8); }
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#2f81f7';
  ctx.lineWidth = 1.5;
  ctx.fill(); ctx.stroke();
}

export function findOnSpread(id) {
  const items = spreadObjects();
  const it = items.find((x) => x.obj.id === id);
  if (!it) return null;
  return { obj: it.obj, pl: placementForPage(it.page), fromMaster: it.fromMaster };
}
