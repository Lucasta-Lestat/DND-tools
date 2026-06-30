// Pointer interaction: select, move, resize, rotate, create objects,
// thread text frames, edit text, and zoom/pan.
import { store, begin, commit, emit, spreadObjects } from './store.js';
import { TOOLS } from './personas.js';
import { baseText, makeShape, makeImage } from './model.js';
import {
  screenToDoc, getPlacements, placementForPage, objectScreenCorners,
  hitTest, findOnSpread, drawScene, getView,
} from './renderer.js';

const scene = document.getElementById('scene');
const editor = document.getElementById('text-editor');

let drag = null;        // active gesture
let threadPending = null; // frame id awaiting a thread target
let onChange = () => {};

const HPOS = { nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] };
const MIN = 8;

export function initInteraction(changeCb) {
  onChange = changeCb || (() => {});
  scene.addEventListener('pointerdown', onPointerDown);
  scene.addEventListener('pointermove', onPointerHover);
  scene.addEventListener('dblclick', onDblClick);
  scene.addEventListener('wheel', onWheel, { passive: false });
  editor.addEventListener('blur', commitTextEdit);
  editor.addEventListener('keydown', onEditorKey);
  editor.addEventListener('input', onEditorInput);
}

function localPoint(e) {
  const rect = scene.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function pageLocal(docPt, pl) { return { x: docPt.x - pl.ox, y: docPt.y - pl.oy }; }

function activeLayer() {
  const visibleUnlocked = store.doc.layers.find((l) => l.visible && !l.locked);
  return (visibleUnlocked || store.doc.layers[0]).id;
}

function topmostAt(sx, sy) {
  const items = spreadObjects().slice().reverse(); // topmost first within paint order
  // respect layer order: build same order as renderer then reverse
  const layers = store.doc.layers;
  const ordered = spreadObjects().slice().sort((a, b) =>
    layers.findIndex((l) => l.id === a.obj.layerId) - layers.findIndex((l) => l.id === b.obj.layerId));
  for (let i = ordered.length - 1; i >= 0; i--) {
    const it = ordered[i];
    const layer = layers.find((l) => l.id === it.obj.layerId);
    if (!layer || !layer.visible || layer.locked) continue;
    if (it.fromMaster && !store.ui.masterEdit) continue; // master objects not selectable on normal pages
    const pl = placementForPage(it.page);
    if (pl && hitTest(it.obj, pl, sx, sy)) return { obj: it.obj, pl };
  }
  return null;
}

function handleAt(sx, sy) {
  if (store.ui.selection.length !== 1) return null;
  const found = findOnSpread(store.ui.selection[0]);
  if (!found) return null;
  const cc = objectScreenCorners(found.obj, found.pl);
  for (const k of ['rot', 'nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w']) {
    const p = cc[k];
    if (Math.hypot(p.x - sx, p.y - sy) <= 8) return { type: k, obj: found.obj, pl: found.pl };
  }
  return null;
}

function onPointerDown(e) {
  if (store.ui.editingTextId) { commitTextEdit(); }
  scene.setPointerCapture(e.pointerId);
  const p = localPoint(e);

  // pan: middle mouse or space held
  if (e.button === 1 || spaceDown) {
    drag = { mode: 'pan', startPan: { ...store.ui.pan }, start: p };
    scene.addEventListener('pointermove', onPointerDrag);
    scene.addEventListener('pointerup', onPointerUp, { once: true });
    return;
  }
  if (e.button !== 0) return;

  const toolId = store.ui.tool;
  const tool = TOOLS[toolId];

  // Threading tool
  if (toolId === 'thread') {
    const hit = topmostAt(p.x, p.y);
    if (hit && hit.obj.type === 'text') {
      if (!threadPending) { threadPending = hit.obj.id; store.ui.selection = [hit.obj.id]; }
      else if (threadPending !== hit.obj.id) { linkFrames(threadPending, hit.obj.id); threadPending = null; }
      drawScene();
    } else { threadPending = null; }
    return;
  }

  // Create tools
  if (tool && tool.create) {
    const docPt = screenToDoc(p.x, p.y);
    const pl = getPlacements().find((pp) => insidePage(docPt, pp)) || getPlacements()[0];
    if (!pl) return;
    const loc = pageLocal(docPt, pl);
    begin('create');
    const layerId = activeLayer();
    let obj;
    if (tool.create === 'text') obj = baseText(layerId);
    else if (tool.create === 'image') obj = makeImage(layerId, null, 0, 0);
    else obj = makeShape(tool.create, layerId, defaultFill(tool.create));
    obj.x = loc.x; obj.y = loc.y; obj.w = 1; obj.h = 1;
    pl.page.objects.push(obj);
    store.ui.selection = [obj.id];
    drag = { mode: 'create', obj, pl, origin: loc, tool: tool.create };
    scene.addEventListener('pointermove', onPointerDrag);
    scene.addEventListener('pointerup', onPointerUp, { once: true });
    return;
  }

  // Move / select / transform
  const h = handleAt(p.x, p.y);
  if (h) {
    begin('transform');
    const o = h.obj;
    drag = {
      mode: h.type === 'rot' ? 'rotate' : 'resize',
      handle: h.type, obj: o, pl: h.pl,
      snap: { x: o.x, y: o.y, w: o.w, h: o.h, rot: o.rotation || 0 },
    };
    scene.addEventListener('pointermove', onPointerDrag);
    scene.addEventListener('pointerup', onPointerUp, { once: true });
    return;
  }

  const hit = topmostAt(p.x, p.y);
  if (hit) {
    if (e.shiftKey) {
      if (store.ui.selection.includes(hit.obj.id)) store.ui.selection = store.ui.selection.filter((id) => id !== hit.obj.id);
      else store.ui.selection = [...store.ui.selection, hit.obj.id];
    } else if (!store.ui.selection.includes(hit.obj.id)) {
      store.ui.selection = [hit.obj.id];
    }
    begin('move');
    const docPt = screenToDoc(p.x, p.y);
    drag = {
      mode: 'move', start: docPt,
      items: store.ui.selection.map((id) => {
        const f = findOnSpread(id); return f ? { obj: f.obj, x0: f.obj.x, y0: f.obj.y } : null;
      }).filter(Boolean),
      moved: false,
    };
    scene.addEventListener('pointermove', onPointerDrag);
    scene.addEventListener('pointerup', onPointerUp, { once: true });
    onChange();
  } else {
    // marquee / deselect
    if (!e.shiftKey) store.ui.selection = [];
    drag = { mode: 'marquee', start: screenToDoc(p.x, p.y), startScreen: p, add: e.shiftKey };
    scene.addEventListener('pointermove', onPointerDrag);
    scene.addEventListener('pointerup', onPointerUp, { once: true });
    onChange();
  }
}

function onPointerDrag(e) {
  if (!drag) return;
  const p = localPoint(e);
  const docPt = screenToDoc(p.x, p.y);

  if (drag.mode === 'pan') {
    store.ui.pan = { x: drag.startPan.x + (p.x - drag.start.x), y: drag.startPan.y + (p.y - drag.start.y) };
    drawScene();
    return;
  }
  if (drag.mode === 'create') {
    const loc = pageLocal(docPt, drag.pl);
    const o = drag.obj;
    let x = Math.min(loc.x, drag.origin.x), y = Math.min(loc.y, drag.origin.y);
    let w = Math.abs(loc.x - drag.origin.x), h = Math.abs(loc.y - drag.origin.y);
    if (e.shiftKey && drag.tool !== 'line') { const s = Math.max(w, h); w = s; h = s; }
    o.x = x; o.y = y; o.w = Math.max(w, 1); o.h = Math.max(h, 1);
    drawScene();
    return;
  }
  if (drag.mode === 'move') {
    let dx = docPt.x - drag.start.x, dy = docPt.y - drag.start.y;
    drag.moved = true;
    for (const it of drag.items) { it.obj.x = it.x0 + dx; it.obj.y = it.y0 + dy; }
    if (store.ui.snap && drag.items.length) applySnap(drag.items[0].obj, drag.items);
    drawScene();
    return;
  }
  if (drag.mode === 'resize') { doResize(drag, docPt, e.shiftKey); drawScene(); return; }
  if (drag.mode === 'rotate') { doRotate(drag, docPt, e.shiftKey); drawScene(); return; }
  if (drag.mode === 'marquee') {
    drag.current = docPt; drawScene(); drawMarquee(drag.startScreen, p); return;
  }
}

function onPointerUp(e) {
  scene.removeEventListener('pointermove', onPointerDrag);
  if (!drag) return;
  if (drag.mode === 'create') {
    const o = drag.obj;
    if (o.w < 4 && o.h < 4) { // click without drag -> default size
      if (drag.tool === 'text') { o.w = 200; o.h = 80; }
      else if (drag.tool === 'line') { o.w = 120; o.h = 0.5; }
      else { o.w = 120; o.h = 120; }
    }
    commit('create');
    if (drag.tool === 'text') startTextEdit(o.id);
    if (drag.tool === 'image') document.getElementById('file-image').click();
  } else if (drag.mode === 'move') {
    if (drag.moved) commit('move'); else emit();
  } else if (drag.mode === 'resize') { commit('resize'); }
  else if (drag.mode === 'rotate') { commit('rotate'); }
  else if (drag.mode === 'marquee') {
    selectInMarquee(drag.start, drag.current || drag.start, drag.add);
    emit();
  } else { emit(); }
  drag = null;
  onChange();
}

function insidePage(docPt, pl) {
  return docPt.x >= pl.ox - 40 && docPt.x <= pl.ox + pl.w + 40 && docPt.y >= pl.oy - 40 && docPt.y <= pl.oy + pl.h + 40;
}

function defaultFill(type) {
  if (type === 'line') return null;
  return '#2f81f7';
}

/* ---------- resize / rotate math ---------- */

function rot(vx, vy, a) { const c = Math.cos(a), s = Math.sin(a); return { x: vx * c - vy * s, y: vx * s + vy * c }; }

function doResize(d, docPt, shift) {
  const s = d.snap;
  const a = (s.rot || 0) * Math.PI / 180;
  const [hx, hy] = HPOS[d.handle];
  const center0 = { x: s.x + s.w / 2, y: s.y + s.h / 2 };
  // fixed point = opposite side, in doc space (page-local; placement offset cancels)
  const fLocal = { x: -hx * s.w / 2, y: -hy * s.h / 2 };
  const fWorld = { x: center0.x + rot(fLocal.x, fLocal.y, a).x, y: center0.y + rot(fLocal.x, fLocal.y, a).y };
  const loc = pageLocal(docPt, d.pl);
  const rel = rot(loc.x - fWorld.x, loc.y - fWorld.y, -a);
  let newW = hx !== 0 ? rel.x * hx : s.w;
  let newH = hy !== 0 ? rel.y * hy : s.h;
  newW = Math.max(newW, MIN); newH = Math.max(newH, MIN);
  if (shift && hx !== 0 && hy !== 0) { const ratio = s.w / s.h; if (newW / newH > ratio) newW = newH * ratio; else newH = newW / ratio; }
  const center = {
    x: fWorld.x + rot(hx * newW / 2, hy * newH / 2, a).x,
    y: fWorld.y + rot(hx * newW / 2, hy * newH / 2, a).y,
  };
  d.obj.w = newW; d.obj.h = newH;
  d.obj.x = center.x - newW / 2; d.obj.y = center.y - newH / 2;
}

function doRotate(d, docPt, shift) {
  const s = d.snap;
  const center = { x: s.x + s.w / 2, y: s.y + s.h / 2 };
  const loc = pageLocal(docPt, d.pl);
  let deg = Math.atan2(loc.y - center.y, loc.x - center.x) * 180 / Math.PI + 90;
  if (shift) deg = Math.round(deg / 15) * 15;
  d.obj.rotation = ((deg % 360) + 360) % 360;
}

/* ---------- snapping ---------- */
function applySnap(lead, items) {
  const s = store.doc.settings;
  const m = s.margins;
  const xs = [0, m.inside, s.pageWidth - m.outside, s.pageWidth, s.pageWidth / 2];
  const ys = [0, m.top, s.pageHeight - m.bottom, s.pageHeight, s.pageHeight / 2];
  const T = 6 / store.ui.zoom;
  let snapDX = null, snapDY = null;
  const edgesX = [lead.x, lead.x + lead.w, lead.x + lead.w / 2];
  const edgesY = [lead.y, lead.y + lead.h, lead.y + lead.h / 2];
  for (const ex of edgesX) for (const gx of xs) if (Math.abs(ex - gx) < T) { snapDX = gx - ex; break; }
  for (const ey of edgesY) for (const gy of ys) if (Math.abs(ey - gy) < T) { snapDY = gy - ey; break; }
  if (snapDX != null) for (const it of items) it.obj.x += snapDX;
  if (snapDY != null) for (const it of items) it.obj.y += snapDY;
}

/* ---------- marquee ---------- */
let marqueeEl = null;
function drawMarquee(a, b) {
  if (!marqueeEl) {
    marqueeEl = document.createElement('div');
    Object.assign(marqueeEl.style, { position: 'absolute', border: '1px solid #2f81f7', background: 'rgba(47,129,247,.12)', pointerEvents: 'none', zIndex: 5 });
    document.getElementById('canvas-wrap').appendChild(marqueeEl);
  }
  const rect = scene.getBoundingClientRect();
  const wrap = document.getElementById('canvas-wrap').getBoundingClientRect();
  const offX = rect.left - wrap.left, offY = rect.top - wrap.top;
  marqueeEl.style.left = offX + Math.min(a.x, b.x) + 'px';
  marqueeEl.style.top = offY + Math.min(a.y, b.y) + 'px';
  marqueeEl.style.width = Math.abs(a.x - b.x) + 'px';
  marqueeEl.style.height = Math.abs(a.y - b.y) + 'px';
}
function selectInMarquee(a, b, add) {
  if (marqueeEl) { marqueeEl.remove(); marqueeEl = null; }
  const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
  if (Math.abs(x2 - x1) < 3 && Math.abs(y2 - y1) < 3) return;
  const hits = [];
  for (const it of spreadObjects()) {
    if (it.fromMaster && !store.ui.masterEdit) continue;
    const pl = placementForPage(it.page);
    const cx = pl.ox + it.obj.x + it.obj.w / 2, cy = pl.oy + it.obj.y + it.obj.h / 2;
    if (cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2) hits.push(it.obj.id);
  }
  store.ui.selection = add ? [...new Set([...store.ui.selection, ...hits])] : hits;
}

/* ---------- threading ---------- */
function linkFrames(aId, bId) {
  begin('thread');
  const all = [...store.doc.pages, ...store.doc.masters].flatMap((c) => c.objects);
  const a = all.find((o) => o.id === aId), b = all.find((o) => o.id === bId);
  if (!a || !b || a.type !== 'text' || b.type !== 'text') { commit('thread'); return; }
  // detach b from any previous chain
  if (b.threadPrev) { const pv = all.find((o) => o.id === b.threadPrev); if (pv) pv.threadNext = null; }
  if (a.threadNext) { const nx = all.find((o) => o.id === a.threadNext); if (nx) nx.threadPrev = null; }
  a.threadNext = b.id; b.threadPrev = a.id;
  // merge: b's own text appended to head story is ignored (head holds story)
  commit('thread');
}

/* ---------- text editing ---------- */
export function startTextEdit(id) {
  const found = findOnSpread(id);
  if (!found || found.obj.type !== 'text' || found.obj.field) return;
  const { obj, pl } = found;
  store.ui.editingTextId = id;
  store.ui.selection = [id];
  positionEditor(obj, pl);
  editor.value = obj.threadPrev ? '(continued story — edit from the first frame)' : (obj.text || '');
  editor.readOnly = !!obj.threadPrev;
  editor.style.display = 'block';
  editor.focus();
  if (!obj.threadPrev) editor.select();
  drawScene();
  onChange();
}

function positionEditor(obj, pl) {
  const view = getView();
  const z = store.ui.zoom;
  const sx = store.ui.pan.x + (pl.ox + obj.x) * z;
  const sy = store.ui.pan.y + (pl.oy + obj.y) * z;
  editor.style.left = sx + 'px';
  editor.style.top = sy + 'px';
  editor.style.width = obj.w * z + 'px';
  editor.style.height = obj.h * z + 'px';
  editor.style.padding = (obj.padding || 4) * z + 'px';
  editor.style.font = `${obj.italic ? 'italic ' : ''}${obj.bold ? '700 ' : '400 '}${obj.size * z}px ${obj.fontFamily}`;
  editor.style.lineHeight = obj.lineHeight;
  editor.style.color = obj.color;
  editor.style.transform = `rotate(${obj.rotation || 0}deg)`;
  editor.style.transformOrigin = '0 0';
  editor.style.textAlign = obj.align === 'justify' ? 'left' : obj.align;
}

function onEditorInput() {
  const id = store.ui.editingTextId; if (!id) return;
  const f = findOnSpread(id); if (!f || editor.readOnly) return;
  f.obj.text = editor.value;
}

function onEditorKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); commitTextEdit(); }
  e.stopPropagation(); // don't trigger global shortcuts while typing
}

export function commitTextEdit() {
  const id = store.ui.editingTextId;
  if (!id) return;
  const f = findOnSpread(id);
  store.ui.editingTextId = null;
  editor.style.display = 'none';
  if (f && !editor.readOnly) { begin('edit text'); f.obj.text = editor.value; commit('edit text'); }
  else { drawScene(); onChange(); }
}

function onDblClick(e) {
  const p = localPoint(e);
  const hit = topmostAt(p.x, p.y);
  if (hit && hit.obj.type === 'text' && !hit.obj.field) startTextEdit(hit.obj.id);
  else if (hit && hit.obj.type === 'image') document.getElementById('file-image').click();
}

/* ---------- hover cursor ---------- */
function onPointerHover(e) {
  if (drag) return;
  const p = localPoint(e);
  const h = handleAt(p.x, p.y);
  let cur = TOOLS[store.ui.tool]?.cursor || 'default';
  if (h) cur = h.type === 'rot' ? 'grab' : (/n|s/.test(h.type) && /e|w/.test(h.type) ? 'nwse-resize' : (/e|w/.test(h.type) ? 'ew-resize' : 'ns-resize'));
  else if (store.ui.tool === 'move' && topmostAt(p.x, p.y)) cur = 'move';
  scene.style.cursor = cur;
  // status coords
  const docPt = screenToDoc(p.x, p.y);
  const ev = new CustomEvent('cursor-move', { detail: docPt });
  window.dispatchEvent(ev);
}

/* ---------- zoom / pan via wheel ---------- */
function onWheel(e) {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const p = localPoint(e);
    const before = screenToDoc(p.x, p.y);
    const factor = Math.exp(-e.deltaY * 0.0015);
    store.ui.zoom = Math.max(0.05, Math.min(8, store.ui.zoom * factor));
    const after = screenToDoc(p.x, p.y);
    store.ui.pan.x += (after.x - before.x) * store.ui.zoom;
    store.ui.pan.y += (after.y - before.y) * store.ui.zoom;
  } else {
    store.ui.pan.x -= e.deltaX;
    store.ui.pan.y -= e.deltaY;
  }
  drawScene();
  onChange();
}

/* ---------- space-to-pan tracking ---------- */
let spaceDown = false;
window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !isTyping(e)) spaceDown = true; });
window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });
function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

export function repositionEditorIfOpen() {
  const id = store.ui.editingTextId;
  if (!id) return;
  const f = findOnSpread(id);
  if (f) positionEditor(f.obj, f.pl);
}
