// Canvas renderer for the active spread.
import { store, activeSpread, spreadObjects, layerById } from './store.js';
import { layoutStory } from './textlayout.js';

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
    }
  });
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
    if (sel.length === 1) {
      for (const k of ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w', 'rot']) drawHandle(cc[k], k === 'rot');
    }
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
