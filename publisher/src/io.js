// Save / load projects and export to PNG, SVG, and print-to-PDF.
import { store, emit, begin, commit as storeCommit, resetHistory, getSpreads } from './store.js';
import { makeImage } from './model.js';
import { fitView, computeTocLayout, computeIndexLayout, tableFrameLayout, tocLevelStyle, hexGeometry, hexCenter, hexPoly, hexCoordLabel, fittedRect, traceHexUnion, computeNavbarLayout } from './renderer.js';
import { layoutStory, wrapText } from './textlayout.js';

/* ---------- save / open ---------- */
export function saveProject() {
  const data = JSON.stringify(store.doc, null, 0);
  download(new Blob([data], { type: 'application/json' }), `${slug(store.doc.meta.title)}.apub`);
}

export function openProjectFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const doc = JSON.parse(reader.result);
      if (!doc.pages || !doc.settings) throw new Error('Not an Aperture project');
      store.doc = doc;
      store.ui.selection = [];
      store.ui.spreadIndex = 0;
      store.ui.masterEdit = null;
      resetHistory();
      fitView();
      emit();
    } catch (err) {
      alert('Could not open project: ' + err.message);
    }
  };
  reader.readAsText(file);
}

/* ---------- image placement ---------- */
export function placeImageFile(file) {
  begin('place image');
  const reader = new FileReader();
  reader.onload = () => {
    const src = reader.result;
    const img = new Image();
    img.onload = () => {
      const target = store.ui._replaceTarget;
      store.ui._replaceTarget = null;
      if (target) {
        const o = findAny(target);
        if (o) { o.src = src; o.naturalW = img.naturalWidth; o.naturalH = img.naturalHeight; }
        storeCommit('place image');
        return;
      }
      // place into the most recently selected empty image frame, else create one
      const sel = store.ui.selection.map(findAny).find((o) => o && o.type === 'image');
      if (sel) { sel.src = src; sel.naturalW = img.naturalWidth; sel.naturalH = img.naturalHeight; storeCommit('place image'); return; }
      const spread = getSpreads()[store.ui.spreadIndex];
      const page = spread.pages[0];
      const layerId = (store.doc.layers.find((l) => l.visible && !l.locked) || store.doc.layers[0]).id;
      const o = makeImage(layerId, src, img.naturalWidth, img.naturalHeight);
      const ar = img.naturalWidth / img.naturalHeight;
      o.w = Math.min(260, store.doc.settings.pageWidth * 0.6);
      o.h = o.w / ar;
      o.x = (store.doc.settings.pageWidth - o.w) / 2;
      o.y = (store.doc.settings.pageHeight - o.h) / 2;
      page.objects.push(o);
      store.ui.selection = [o.id];
      storeCommit('place image');
    };
    img.src = src;
  };
  reader.readAsDataURL(file);
}

function findAny(id) {
  for (const c of [...store.doc.pages, ...store.doc.masters]) {
    const o = c.objects.find((x) => x.id === id);
    if (o) return o;
  }
  return null;
}

/* ---------- export geometry (standalone, mirrors renderer) ---------- */
function placementsFor(spread) {
  const s = store.doc.settings;
  const two = !spread.master && s.facing && spread.pages.length === 2;
  return spread.pages.map((page, i) => ({
    page,
    ox: two ? i * s.pageWidth : 0,
    oy: 0, w: s.pageWidth, h: s.pageHeight,
    pageNumber: spread.master ? null : store.doc.pages.indexOf(page) + 1,
  }));
}
function spreadWidth(spread) {
  const s = store.doc.settings;
  return (!spread.master && s.facing && spread.pages.length === 2) ? s.pageWidth * 2 : s.pageWidth;
}

function objectsForSpread(spread) {
  const out = [];
  for (const page of spread.pages) {
    const master = page.masterId ? store.doc.masters.find((m) => m.id === page.masterId) : null;
    if (master && page.showMaster !== false) for (const o of master.objects) out.push({ obj: o, page });
    for (const o of page.objects) out.push({ obj: o, page });
  }
  const layers = store.doc.layers;
  return out.sort((a, b) => layers.findIndex((l) => l.id === a.obj.layerId) - layers.findIndex((l) => l.id === b.obj.layerId));
}

function threadChainFor(obj) {
  const all = [...store.doc.pages, ...store.doc.masters].flatMap((c) => c.objects);
  const byId = new Map(all.map((o) => [o.id, o]));
  let head = obj;
  while (head.threadPrev && byId.get(head.threadPrev)) head = byId.get(head.threadPrev);
  const chain = [head];
  let cur = head;
  while (cur.threadNext && byId.get(cur.threadNext) && !chain.includes(byId.get(cur.threadNext))) {
    cur = byId.get(cur.threadNext); chain.push(cur);
  }
  return chain;
}

/* ---------- raster export (PNG) ---------- */
function renderSpreadToCanvas(spread, scale, withBleed, imageMap) {
  const s = store.doc.settings;
  const bleed = withBleed ? s.bleed : 0;
  const sw = spreadWidth(spread) + bleed * 2;
  const sh = s.pageHeight + bleed * 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const g = canvas.getContext('2d');
  g.scale(scale, scale);
  g.translate(bleed, bleed);
  g.fillStyle = '#ffffff';
  g.fillRect(-bleed, -bleed, sw, sh);

  for (const { obj, page } of objectsForSpread(spread)) {
    const layer = store.doc.layers.find((l) => l.id === obj.layerId);
    if (layer && !layer.visible) continue;
    const pl = placementsFor(spread).find((p) => p.page === page);
    drawObjExport(g, obj, pl, imageMap);
  }
  return canvas;
}

function drawObjExport(g, obj, pl, imageMap) {
  const cx = pl.ox + obj.x + obj.w / 2, cy = pl.oy + obj.y + obj.h / 2;
  g.save();
  g.translate(cx, cy);
  g.rotate((obj.rotation || 0) * Math.PI / 180);
  g.globalAlpha = obj.opacity ?? 1;
  g.translate(-obj.w / 2, -obj.h / 2);
  const w = obj.w, h = obj.h;
  if (obj.type === 'rect' || obj.type === 'image' || obj.type === 'text') {
    if (obj.fill) { g.fillStyle = obj.fill; roundRect(g, 0, 0, w, h, obj.radius || 0); g.fill(); }
  }
  if (obj.type === 'image' && obj.src && imageMap.get(obj.src)) {
    const img = imageMap.get(obj.src);
    g.save(); roundRect(g, 0, 0, w, h, obj.radius || 0); g.clip();
    const iw = img.naturalWidth, ih = img.naturalHeight;
    let dw = w, dh = h, dx = 0, dy = 0;
    if (obj.fit === 'contain') { const sc = Math.min(w / iw, h / ih); dw = iw * sc; dh = ih * sc; dx = (w - dw) / 2; dy = (h - dh) / 2; }
    else if (obj.fit === 'cover') { const sc = Math.max(w / iw, h / ih); dw = iw * sc; dh = ih * sc; dx = (w - dw) / 2; dy = (h - dh) / 2; }
    if (obj.adjust) g.filter = filterString(obj.adjust);
    g.drawImage(img, dx, dy, dw, dh); g.filter = 'none'; g.restore();
  } else if (obj.type === 'image' && !obj.src) {
    g.strokeStyle = '#b9bcc2'; g.strokeRect(0, 0, w, h);
  }
  if (obj.type === 'ellipse') {
    g.beginPath(); g.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    if (obj.fill) { g.fillStyle = obj.fill; g.fill(); }
    if (obj.stroke && obj.strokeWidth) { g.lineWidth = obj.strokeWidth; g.strokeStyle = obj.stroke; g.stroke(); }
  } else if (obj.type === 'line') {
    g.beginPath(); g.moveTo(0, h); g.lineTo(w, 0); g.lineWidth = obj.strokeWidth || 2; g.strokeStyle = obj.stroke || '#000'; g.lineCap = 'round'; g.stroke();
  } else if ((obj.type === 'rect' || obj.type === 'image') && obj.stroke && obj.strokeWidth) {
    g.lineWidth = obj.strokeWidth; g.strokeStyle = obj.stroke; roundRect(g, 0, 0, w, h, obj.radius || 0); g.stroke();
  }
  if (obj.type === 'text') drawTextExport(g, obj, pl);
  if (obj.type === 'table') drawTableExport(g, obj);
  if (obj.type === 'toc') drawTocExport(g, obj);
  if (obj.type === 'index') drawIndexExport(g, obj);
  if (obj.type === 'hexmap') drawHexMapExport(g, obj, imageMap);
  if (obj.type === 'navbar') drawNavbarExport(g, obj, pl);
  g.restore();
}

function drawHexMapExport(g, obj, imageMap) {
  const geo = hexGeometry(obj);
  if (obj.fill) { g.fillStyle = obj.fill; g.fillRect(0, 0, obj.w, obj.h); }
  if (obj.src && imageMap.get(obj.src)) {
    const img = imageMap.get(obj.src);
    g.save(); g.globalAlpha = obj.imageOpacity ?? 1;
    if (obj.clipToHexes) traceHexUnion(g, obj, geo); else { g.beginPath(); g.rect(geo.offsetX, geo.offsetY, geo.gridW, geo.gridH); }
    g.clip();
    const f = fittedRect(img.naturalWidth, img.naturalHeight, geo.offsetX, geo.offsetY, geo.gridW, geo.gridH, obj.imageFit || 'cover');
    g.drawImage(img, f.dx, f.dy, f.dw, f.dh);
    g.restore();
  }
  g.lineWidth = obj.gridWidth || 1; g.strokeStyle = obj.gridColor || '#000';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let c = 0; c < geo.cols; c++) for (let r = 0; r < geo.rows; r++) {
    const data = obj.hexes[`${c},${r}`];
    const cn = hexCenter(geo, c, r);
    const poly = hexPoly(cn.x, cn.y, geo.size, geo.pointy);
    g.beginPath(); poly.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath();
    if (data && data.fill) { g.fillStyle = data.fill; g.fill(); }
    g.stroke();
    if (obj.labelMode !== 'none' && geo.size > 8) {
      const label = (data && data.label) || hexCoordLabel(obj, c, r);
      if (label) { g.fillStyle = obj.labelColor || '#333'; g.font = `${obj.labelSize || 7}px system-ui`; g.fillText(label, cn.x, cn.y - geo.size * 0.45); }
    }
  }
}

// 1-based page number an export placement sits on (0 if unknown).
function navCurrentPage(pl) {
  const i = store.doc.pages.findIndex((p) => p === pl.page);
  return i >= 0 ? i + 1 : 0;
}

function drawNavbarExport(g, obj, pl) {
  if (obj.fill) { g.fillStyle = obj.fill; g.fillRect(0, 0, obj.w, obj.h); }
  if (obj.stroke && obj.strokeWidth > 0) { g.lineWidth = obj.strokeWidth; g.strokeStyle = obj.stroke; g.strokeRect(0, 0, obj.w, obj.h); }
  const L = computeNavbarLayout(obj, navCurrentPage(pl));
  g.save();
  g.beginPath(); g.rect(0, 0, obj.w, obj.h); g.clip();
  g.textBaseline = 'alphabetic';
  for (const it of L.items) {
    const base = it.y + (L.lineH - obj.size) / 2 + obj.size * 0.82;
    if (it.current && obj.currentFill) { g.fillStyle = obj.currentFill; g.fillRect(it.x - 3, it.y + 1, it.w + 6, L.lineH - 2); }
    if (!L.vertical && it.sepBefore && obj.separator) {
      g.font = `400 ${obj.size}px ${obj.fontFamily}`; g.fillStyle = obj.sepColor || obj.color; g.textAlign = 'center';
      g.fillText(obj.separator, it.sepX, base);
    }
    g.font = `${it.current ? '700 ' : '400 '}${obj.size}px ${obj.fontFamily}`;
    g.fillStyle = it.current ? (obj.currentColor || '#000') : (obj.color || '#333');
    g.textAlign = 'left';
    g.fillText(it.label, it.x, base);
    if (!it.current && obj.underline && it.link) { g.strokeStyle = obj.color; g.lineWidth = 0.6; g.beginPath(); g.moveTo(it.x, base + 1.5); g.lineTo(it.x + it.w, base + 1.5); g.stroke(); }
  }
  g.textAlign = 'left';
  g.restore();
}

function clipTextTo(g, text, width) {
  if (g.measureText(text).width <= width) return text;
  let t = text;
  while (t.length > 1 && g.measureText(t + '…').width > width) t = t.slice(0, -1);
  return t + '…';
}

function drawIndexExport(g, obj) {
  if (obj.fill) { g.fillStyle = obj.fill; g.fillRect(0, 0, obj.w, obj.h); }
  const L = computeIndexLayout(obj);
  g.save();
  g.beginPath(); g.rect(0, 0, obj.w, obj.h); g.clip();
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  if (obj.title) {
    g.font = `700 ${obj.titleSize}px ${obj.fontFamily}`; g.fillStyle = obj.titleColor || obj.color;
    g.fillText(obj.title, L.pad, L.pad + obj.titleSize * 0.82);
  }
  for (const row of L.rows) {
    const baseline = row.y + obj.size * 0.82;
    if (row.kind === 'letter') {
      g.font = `700 ${obj.size}px ${obj.fontFamily}`; g.fillStyle = obj.letterColor || obj.color;
      g.fillText(row.letter, row.x, baseline);
    } else {
      g.font = `400 ${obj.size}px ${obj.fontFamily}`; g.fillStyle = obj.color;
      g.fillText(clipTextTo(g, `${row.entry.term}, ${row.entry.pages.join(', ')}`, row.colW), row.x, baseline);
    }
  }
  g.restore();
}

function drawTocExport(g, obj) {
  const L = computeTocLayout(obj);
  if (obj.fill) { g.fillStyle = obj.fill; g.fillRect(0, 0, obj.w, obj.h); }
  g.save();
  g.beginPath(); g.rect(0, 0, obj.w, obj.h); g.clip();
  g.textBaseline = 'alphabetic';
  if (obj.title) {
    g.font = `700 ${obj.titleSize}px ${obj.fontFamily}`;
    g.fillStyle = obj.titleColor || obj.color; g.textAlign = 'left';
    g.fillText(obj.title, L.pad, L.pad + obj.titleSize * 0.82);
  }
  for (const row of L.rows) {
    const e = row.entry;
    const st = row.style;
    g.font = `${st.italic ? 'italic ' : ''}${st.bold ? '700 ' : '400 '}${st.size}px ${obj.fontFamily}`;
    g.fillStyle = st.color;
    const baseline = row.y + st.size * 0.82;
    const x0 = L.pad + st.indent;
    g.textAlign = 'left'; g.fillText(e.text, x0, baseline);
    if (!st.showPage) continue;
    const textW = g.measureText(e.text).width;
    const pageStr = String(e.page);
    g.textAlign = 'right'; g.fillText(pageStr, obj.w - L.pad, baseline);
    const pageW = g.measureText(pageStr).width;
    if (obj.leader && st.leader) {
      g.textAlign = 'left';
      const start = x0 + textW + 4, end = obj.w - L.pad - pageW - 4;
      const dotW = g.measureText(obj.leader + ' ').width || 4;
      const n = Math.floor((end - start) / dotW);
      if (n > 0) { g.fillStyle = '#999'; g.fillText((obj.leader + ' ').repeat(n), start, baseline); }
    }
  }
  g.textAlign = 'left';
  g.restore();
}

function drawTableExport(g, obj) {
  const L = tableFrameLayout(obj);
  const head = L.head;
  for (const vr of L.visualRows) {
    let bg = null;
    if (vr.kind === 'header') bg = head.headerFill;
    else if (head.zebra && (vr.dataIndex % 2 === 1)) bg = head.zebra;
    else if (head.fill) bg = head.fill;
    if (bg) { g.fillStyle = bg; g.fillRect(0, vr.y, obj.w, vr.h); }
  }
  if (head.borderWidth > 0) {
    g.strokeStyle = head.borderColor || '#000'; g.lineWidth = head.borderWidth;
    g.strokeRect(0, 0, obj.w, L.totalH);
    g.beginPath();
    for (let i = 1; i < L.visualRows.length; i++) { g.moveTo(0, L.visualRows[i].y); g.lineTo(obj.w, L.visualRows[i].y); }
    for (let c = 1; c < L.ncols; c++) { g.moveTo(L.colX[c], 0); g.lineTo(L.colX[c], L.totalH); }
    g.stroke();
  }
  g.textBaseline = 'alphabetic';
  for (const vr of L.visualRows) {
    const isHeader = vr.kind === 'header';
    const style = { fontFamily: head.fontFamily, size: head.size, bold: isHeader, italic: false, tracking: 0 };
    g.font = `${isHeader ? '700 ' : '400 '}${head.size}px ${head.fontFamily}`;
    g.fillStyle = isHeader ? (head.headerColor || '#fff') : (head.color || '#222');
    for (let c = 0; c < L.ncols; c++) {
      const txt = vr.cells[c] != null ? vr.cells[c] : '';
      const lines = wrapText(txt, style, Math.max(8, L.colW[c] - L.pad * 2));
      const align = head.align || 'left';
      g.textAlign = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';
      const tx = L.colX[c] + (align === 'center' ? L.colW[c] / 2 : align === 'right' ? L.colW[c] - L.pad : L.pad);
      lines.forEach((ln, i) => g.fillText(ln, tx, vr.y + L.pad + head.size * 0.82 + i * L.lineH));
    }
  }
  g.textAlign = 'left';
}

function drawTextExport(g, obj, pl) {
  g.save();
  g.beginPath(); g.rect(0, 0, obj.w, obj.h); g.clip();
  g.textBaseline = 'alphabetic';
  if (obj.field === 'pageNumber') {
    g.font = `${obj.italic ? 'italic ' : ''}${obj.bold ? '700 ' : '400 '}${obj.size}px ${obj.fontFamily}`;
    g.fillStyle = obj.color || '#444';
    g.textAlign = obj.align === 'center' ? 'center' : obj.align === 'right' ? 'right' : 'left';
    const tx = obj.align === 'center' ? obj.w / 2 : obj.align === 'right' ? obj.w - 4 : 4;
    g.fillText(pl.pageNumber != null ? String(pl.pageNumber) : '#', tx, obj.h / 2 + obj.size * 0.35);
    g.restore(); return;
  }
  const chain = threadChainFor(obj);
  const layout = layoutStory(chain, store.doc);
  const fl = layout.byFrame[obj.id];
  if (fl) {
    g.textAlign = 'left';
    for (const line of fl.lines) {
      g.font = line.font; g.fillStyle = line.color;
      try { g.letterSpacing = `${line.tracking}px`; } catch (_) {}
      for (const tk of line.tokens) g.fillText(tk.text, line.x + tk.x, line.baseline);
    }
    try { g.letterSpacing = '0px'; } catch (_) {}
  }
  g.restore();
}

function roundRect(g, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}
function filterString(a) {
  const p = [];
  if (a.brightness != null) p.push(`brightness(${a.brightness})`);
  if (a.contrast != null) p.push(`contrast(${a.contrast})`);
  if (a.saturate != null) p.push(`saturate(${a.saturate})`);
  if (a.grayscale) p.push(`grayscale(${a.grayscale})`);
  return p.join(' ') || 'none';
}

// Preload all images used anywhere, then call cb(map).
function preloadImages(cb) {
  const srcs = new Set();
  for (const c of [...store.doc.pages, ...store.doc.masters]) for (const o of c.objects) if ((o.type === 'image' || o.type === 'hexmap') && o.src) srcs.add(o.src);
  const map = new Map();
  let pending = srcs.size;
  if (!pending) return cb(map);
  for (const src of srcs) {
    const img = new Image();
    img.onload = img.onerror = () => { map.set(src, img); if (--pending === 0) cb(map); };
    img.src = src;
  }
}

export function exportPNG(scale = 3) {
  preloadImages((map) => {
    const spread = getSpreads()[store.ui.spreadIndex];
    const canvas = renderSpreadToCanvas(spread, scale, false, map);
    canvas.toBlob((blob) => download(blob, `${slug(store.doc.meta.title)}-spread${store.ui.spreadIndex + 1}.png`));
  });
}

/* ---------- SVG export (vector shapes + text) ---------- */
export function exportSVG() {
  const spread = getSpreads()[store.ui.spreadIndex];
  const s = store.doc.settings;
  const sw = spreadWidth(spread), sh = s.pageHeight;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${sw}" height="${sh}" viewBox="0 0 ${sw} ${sh}">`,
    `<rect width="${sw}" height="${sh}" fill="#ffffff"/>`];
  for (const { obj, page } of objectsForSpread(spread)) {
    const layer = store.doc.layers.find((l) => l.id === obj.layerId);
    if (layer && !layer.visible) continue;
    const pl = placementsFor(spread).find((p) => p.page === page);
    let markup = svgForObject(obj, pl);
    if (obj.link && obj.link.type === 'url') markup = `<a xlink:href="${esc(obj.link.target)}" target="_blank">${markup}</a>`;
    parts.push(markup);
  }
  parts.push('</svg>');
  download(new Blob([parts.join('\n')], { type: 'image/svg+xml' }), `${slug(store.doc.meta.title)}-spread${store.ui.spreadIndex + 1}.svg`);
}

function svgForObject(obj, pl) {
  const x = pl.ox + obj.x, y = pl.oy + obj.y, w = obj.w, h = obj.h;
  const cx = x + w / 2, cy = y + h / 2;
  const rot = obj.rotation ? ` transform="rotate(${obj.rotation} ${cx} ${cy})"` : '';
  const op = obj.opacity != null && obj.opacity < 1 ? ` opacity="${obj.opacity}"` : '';
  const fill = obj.fill ? obj.fill : 'none';
  const stroke = obj.stroke && obj.strokeWidth ? ` stroke="${obj.stroke}" stroke-width="${obj.strokeWidth}"` : '';
  if (obj.type === 'rect' || obj.type === 'image') {
    const r = obj.radius ? ` rx="${obj.radius}"` : '';
    let out = `<rect x="${x}" y="${y}" width="${w}" height="${h}"${r} fill="${fill}"${stroke}${op}${rot}/>`;
    if (obj.type === 'image' && obj.src) out += `<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="${obj.fit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice'}" href="${obj.src}"${op}${rot}/>`;
    return out;
  }
  if (obj.type === 'ellipse') return `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" fill="${fill}"${stroke}${op}${rot}/>`;
  if (obj.type === 'line') return `<line x1="${x}" y1="${y + h}" x2="${x + w}" y2="${y}" stroke="${obj.stroke || '#000'}" stroke-width="${obj.strokeWidth || 2}" stroke-linecap="round"${op}${rot}/>`;
  if (obj.type === 'text') {
    const chain = threadChainFor(obj);
    const layout = layoutStory(chain, store.doc);
    const fl = layout.byFrame[obj.id];
    let inner = '';
    if (obj.field === 'pageNumber') {
      inner = `<text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" font-family="${esc(obj.fontFamily)}" font-size="${obj.size}" fill="${obj.color}">${pl.pageNumber ?? ''}</text>`;
    } else if (fl) {
      for (const line of fl.lines) for (const tk of line.tokens) {
        inner += `<text x="${x + line.x + tk.x}" y="${y + line.baseline}" font="${esc(line.font)}" fill="${line.color}" style="font:${esc(line.font)}">${esc(tk.text)}</text>`;
      }
    }
    let out = '';
    if (obj.fill) out += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${obj.fill}"/>`;
    return `<g${rot}${op}>${out}${inner}</g>`;
  }
  if (obj.type === 'table') return `<g${rot}${op}>${svgForTable(obj, x, y)}</g>`;
  if (obj.type === 'toc') return `<g${rot}${op}>${svgForToc(obj, x, y)}</g>`;
  if (obj.type === 'index') return `<g${rot}${op}>${svgForIndex(obj, x, y)}</g>`;
  if (obj.type === 'hexmap') return `<g${rot}${op}>${svgForHexMap(obj, x, y)}</g>`;
  if (obj.type === 'navbar') return `<g${rot}${op}>${svgForNavbar(obj, x, y, pl)}</g>`;
  return '';
}

function svgForNavbar(obj, x, y, pl) {
  const L = computeNavbarLayout(obj, navCurrentPage(pl));
  let out = '';
  if (obj.fill) out += `<rect x="${x}" y="${y}" width="${obj.w}" height="${obj.h}" fill="${obj.fill}"/>`;
  if (obj.stroke && obj.strokeWidth > 0) out += `<rect x="${x}" y="${y}" width="${obj.w}" height="${obj.h}" fill="none" stroke="${obj.stroke}" stroke-width="${obj.strokeWidth}"/>`;
  for (const it of L.items) {
    const base = y + it.y + (L.lineH - obj.size) / 2 + obj.size * 0.82;
    if (it.current && obj.currentFill) out += `<rect x="${(x + it.x - 3).toFixed(2)}" y="${(y + it.y + 1).toFixed(2)}" width="${(it.w + 6).toFixed(2)}" height="${(L.lineH - 2).toFixed(2)}" fill="${obj.currentFill}"/>`;
    if (!L.vertical && it.sepBefore && obj.separator) {
      out += `<text x="${(x + it.sepX).toFixed(2)}" y="${base.toFixed(2)}" text-anchor="middle" font-family="${esc(obj.fontFamily)}" font-size="${obj.size}" fill="${obj.sepColor || obj.color}">${esc(obj.separator)}</text>`;
    }
    const weight = it.current ? ' font-weight="700"' : '';
    const deco = (!it.current && obj.underline && it.link) ? ' text-decoration="underline"' : '';
    const fill = it.current ? (obj.currentColor || '#000') : (obj.color || '#333');
    let t = `<text x="${(x + it.x).toFixed(2)}" y="${base.toFixed(2)}" font-family="${esc(obj.fontFamily)}" font-size="${obj.size}"${weight}${deco} fill="${fill}">${esc(it.label)}</text>`;
    if (!it.current && it.link) { const href = linkHref(it.link); if (href) { const tgt = it.link.type === 'url' ? ' target="_blank"' : ''; t = `<a xlink:href="${esc(href)}"${tgt}>${t}</a>`; } }
    out += t;
  }
  return out;
}

function svgForHexMap(obj, x, y) {
  const geo = hexGeometry(obj);
  let out = '';
  if (obj.fill) out += `<rect x="${x}" y="${y}" width="${obj.w}" height="${obj.h}" fill="${obj.fill}"/>`;
  if (obj.src) {
    const par = obj.imageFit === 'stretch' ? 'none' : obj.imageFit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice';
    const ix = x + geo.offsetX, iy = y + geo.offsetY;
    let clipAttr = '';
    if (obj.clipToHexes) {
      const cid = `hexclip-${obj.id}`;
      let cp = `<clipPath id="${cid}">`;
      for (let c = 0; c < geo.cols; c++) for (let r = 0; r < geo.rows; r++) {
        const cn = hexCenter(geo, c, r);
        cp += `<polygon points="${hexPoly(cn.x, cn.y, geo.size, geo.pointy).map((p) => `${(x + p.x).toFixed(2)},${(y + p.y).toFixed(2)}`).join(' ')}"/>`;
      }
      out += cp + '</clipPath>';
      clipAttr = ` clip-path="url(#${cid})"`;
    }
    out += `<image x="${ix}" y="${iy}" width="${geo.gridW}" height="${geo.gridH}" preserveAspectRatio="${par}" href="${obj.src}" opacity="${obj.imageOpacity ?? 1}"${clipAttr}/>`;
  }
  for (let c = 0; c < geo.cols; c++) for (let r = 0; r < geo.rows; r++) {
    const data = obj.hexes[`${c},${r}`];
    const cn = hexCenter(geo, c, r);
    const pts = hexPoly(cn.x, cn.y, geo.size, geo.pointy).map((p) => `${(x + p.x).toFixed(2)},${(y + p.y).toFixed(2)}`).join(' ');
    let cell = `<polygon points="${pts}" fill="${data && data.fill ? data.fill : 'none'}" stroke="${obj.gridColor || '#000'}" stroke-width="${obj.gridWidth || 1}"/>`;
    if (obj.labelMode !== 'none' && geo.size > 8) {
      const label = (data && data.label) || hexCoordLabel(obj, c, r);
      cell += `<text x="${(x + cn.x).toFixed(2)}" y="${(y + cn.y - geo.size * 0.3).toFixed(2)}" text-anchor="middle" font-family="system-ui" font-size="${obj.labelSize || 7}" fill="${obj.labelColor || '#333'}">${esc(label)}</text>`;
    }
    if (data && data.link && data.link.type === 'url') cell = `<a xlink:href="${esc(data.link.target)}" target="_blank">${cell}</a>`;
    out += cell;
  }
  return out;
}

function svgForIndex(obj, x, y) {
  const L = computeIndexLayout(obj);
  let out = '';
  if (obj.fill) out += `<rect x="${x}" y="${y}" width="${obj.w}" height="${obj.h}" fill="${obj.fill}"/>`;
  if (obj.title) {
    out += `<text x="${x + L.pad}" y="${y + L.pad + obj.titleSize * 0.82}" font-family="${esc(obj.fontFamily)}" font-size="${obj.titleSize}" font-weight="700" fill="${obj.titleColor || obj.color}">${esc(obj.title)}</text>`;
  }
  for (const row of L.rows) {
    const baseline = y + row.y + obj.size * 0.82;
    if (row.kind === 'letter') {
      out += `<text x="${x + row.x}" y="${baseline}" font-family="${esc(obj.fontFamily)}" font-size="${obj.size}" font-weight="700" fill="${obj.letterColor || obj.color}">${esc(row.letter)}</text>`;
    } else {
      out += `<text x="${x + row.x}" y="${baseline}" font-family="${esc(obj.fontFamily)}" font-size="${obj.size}" fill="${obj.color}">${esc(row.entry.term)}, ${row.entry.pages.join(', ')}</text>`;
    }
  }
  return out;
}

function svgForToc(obj, x, y) {
  const L = computeTocLayout(obj);
  let out = '';
  if (obj.fill) out += `<rect x="${x}" y="${y}" width="${obj.w}" height="${obj.h}" fill="${obj.fill}"/>`;
  if (obj.title) {
    out += `<text x="${x + L.pad}" y="${y + L.pad + obj.titleSize * 0.82}" font-family="${esc(obj.fontFamily)}" font-size="${obj.titleSize}" font-weight="700" fill="${obj.titleColor || obj.color}">${esc(obj.title)}</text>`;
  }
  for (const row of L.rows) {
    const e = row.entry;
    const st = row.style;
    const baseline = y + row.y + st.size * 0.82;
    const x0 = x + L.pad + st.indent;
    const weight = st.bold ? '700' : '400';
    const fstyle = st.italic ? ' font-style="italic"' : '';
    out += `<text x="${x0}" y="${baseline}" font-family="${esc(obj.fontFamily)}" font-size="${st.size}" font-weight="${weight}"${fstyle} fill="${st.color}">${esc(e.text)}</text>`;
    if (st.showPage) out += `<text x="${x + obj.w - L.pad}" y="${baseline}" text-anchor="end" font-family="${esc(obj.fontFamily)}" font-size="${st.size}" font-weight="${weight}"${fstyle} fill="${st.color}">${e.page}</text>`;
  }
  return out;
}

function svgForTable(obj, x, y) {
  const L = tableFrameLayout(obj);
  const head = L.head;
  let out = '';
  for (const vr of L.visualRows) {
    let bg = vr.kind === 'header' ? head.headerFill : (head.zebra && (vr.dataIndex % 2 === 1)) ? head.zebra : head.fill;
    if (bg) out += `<rect x="${x}" y="${y + vr.y}" width="${obj.w}" height="${vr.h}" fill="${bg}"/>`;
  }
  if (head.borderWidth > 0) {
    const bc = head.borderColor || '#000', bw = head.borderWidth;
    out += `<rect x="${x}" y="${y}" width="${obj.w}" height="${L.totalH}" fill="none" stroke="${bc}" stroke-width="${bw}"/>`;
    for (let i = 1; i < L.visualRows.length; i++) out += `<line x1="${x}" y1="${y + L.visualRows[i].y}" x2="${x + obj.w}" y2="${y + L.visualRows[i].y}" stroke="${bc}" stroke-width="${bw}"/>`;
    for (let c = 1; c < L.ncols; c++) out += `<line x1="${x + L.colX[c]}" y1="${y}" x2="${x + L.colX[c]}" y2="${y + L.totalH}" stroke="${bc}" stroke-width="${bw}"/>`;
  }
  for (const vr of L.visualRows) {
    const isHeader = vr.kind === 'header';
    const style = { fontFamily: head.fontFamily, size: head.size, bold: isHeader, italic: false, tracking: 0 };
    const color = isHeader ? (head.headerColor || '#fff') : (head.color || '#222');
    const weight = isHeader ? '700' : '400';
    const align = head.align || 'left';
    const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
    for (let c = 0; c < L.ncols; c++) {
      const txt = vr.cells[c] != null ? vr.cells[c] : '';
      const lines = wrapText(txt, style, Math.max(8, L.colW[c] - L.pad * 2));
      const tx = x + L.colX[c] + (align === 'center' ? L.colW[c] / 2 : align === 'right' ? L.colW[c] - L.pad : L.pad);
      lines.forEach((ln, i) => {
        out += `<text x="${tx}" y="${y + vr.y + L.pad + head.size * 0.82 + i * L.lineH}" text-anchor="${anchor}" font-family="${esc(head.fontFamily)}" font-size="${head.size}" font-weight="${weight}" fill="${color}">${esc(ln)}</text>`;
      });
    }
  }
  return out;
}

/* ---------- PDF via print (all spreads) ---------- */
export function exportPDF() {
  preloadImages((map) => {
    const spreads = getSpreads();
    const imgs = spreads.map((sp) => renderSpreadToCanvas(sp, 2, false, map).toDataURL('image/png'));
    const s = store.doc.settings;
    const w = spreadWidth(spreads[0]), h = s.pageHeight;
    const win = window.open('', '_blank');
    if (!win) { alert('Allow pop-ups to export PDF.'); return; }
    // Chromium preserves in-document #anchors and external hrefs when printing to PDF,
    // so cross-references and hyperlinks stay clickable in the exported file.
    const pages = spreads.map((sp, i) => `<div class="page">
        <img src="${imgs[i]}"/>${pdfOverlays(sp)}
      </div>`).join('');
    win.document.write(`<!doctype html><html><head><title>${esc(store.doc.meta.title)}</title>
      <style>
        @page { size: ${w}pt ${h}pt; margin: 0; }
        html,body{margin:0;padding:0;background:#fff;}
        .page{position:relative;width:${w}pt;height:${h}pt;page-break-after:always;overflow:hidden;}
        .page img{position:absolute;inset:0;width:100%;height:100%;display:block;}
        .page a.lnk{position:absolute;display:block;}
        .page span.anc{position:absolute;width:1pt;height:1pt;}
        @media screen { body{background:#444;padding:20px;} .page{margin:0 auto 20px;box-shadow:0 2px 12px #0008;} .page a.lnk{outline:1px dashed rgba(47,129,247,.5);} }
      </style></head><body onload="setTimeout(()=>window.print(),350)">${pages}</body></html>`);
    win.document.close();
  });
}

// Build absolutely-positioned anchor targets and clickable links for one spread.
function pdfOverlays(spread) {
  const pls = placementsFor(spread);
  let out = '';
  for (const pl of pls) {
    if (pl.pageNumber != null) out += `<span class="anc" id="apub-page-${pl.pageNumber}" style="left:${pl.ox}pt;top:0pt"></span>`;
    for (const obj of pl.page.objects) {
      if (obj.anchorName) out += `<span class="anc" id="apub-anchor-${esc(slug(obj.anchorName))}" style="left:${pl.ox + obj.x}pt;top:${obj.y}pt"></span>`;
      if (obj.link) {
        const href = linkHref(obj.link);
        if (href) {
          const tgt = obj.link.type === 'url' ? ' target="_blank"' : '';
          out += `<a class="lnk" href="${esc(href)}"${tgt} style="left:${pl.ox + obj.x}pt;top:${obj.y}pt;width:${obj.w}pt;height:${obj.h}pt"></a>`;
        }
      }
      // TOC: each entry links to its page
      if (obj.type === 'toc') {
        const L = computeTocLayout(obj);
        for (const row of L.rows) {
          out += `<a class="lnk" href="#apub-page-${row.entry.page}" style="left:${pl.ox + obj.x}pt;top:${obj.y + row.y}pt;width:${obj.w}pt;height:${row.h}pt"></a>`;
        }
      }
      // Index: each entry links to its first page
      if (obj.type === 'index') {
        const L = computeIndexLayout(obj);
        for (const row of L.rows) {
          if (row.kind !== 'entry' || !row.entry.pages.length) continue;
          out += `<a class="lnk" href="#apub-page-${row.entry.pages[0]}" style="left:${pl.ox + obj.x + row.x}pt;top:${obj.y + row.y}pt;width:${row.colW}pt;height:${row.h}pt"></a>`;
        }
      }
      // Nav bar: each non-current entry is a rectangular link to its target.
      if (obj.type === 'navbar') {
        const L = computeNavbarLayout(obj, navCurrentPage(pl));
        for (const it of L.items) {
          if (it.current || !it.link) continue;
          const href = linkHref(it.link);
          if (!href) continue;
          const tgt = it.link.type === 'url' ? ' target="_blank"' : '';
          out += `<a class="lnk" href="${esc(href)}"${tgt} style="left:${pl.ox + obj.x + it.x}pt;top:${obj.y + it.y}pt;width:${it.w}pt;height:${it.h}pt"></a>`;
        }
      }
      // Hex map: PDF link annotations are rectangular, so approximate each linked
      // hex with a stack of inscribed horizontal strips (never overlapping a
      // neighbour). More strips → closer to the true hexagon.
      if (obj.type === 'hexmap') {
        const geo = hexGeometry(obj);
        const STRIPS = 6;
        for (const key in obj.hexes) {
          const d = obj.hexes[key];
          if (!d || !d.link) continue;
          const href = linkHref(d.link);
          if (!href) continue;
          const tgt = d.link.type === 'url' ? ' target="_blank"' : '';
          const [c, r] = key.split(',').map(Number);
          const cn = hexCenter(geo, c, r);
          const poly = hexPoly(cn.x, cn.y, geo.size, geo.pointy);
          const ys = poly.map((p) => p.y); const top = Math.min(...ys), bot = Math.max(...ys);
          for (let i = 0; i < STRIPS; i++) {
            const y0 = top + i * (bot - top) / STRIPS, y1 = top + (i + 1) * (bot - top) / STRIPS;
            const s0 = spanAtY(poly, y0), s1 = spanAtY(poly, y1);
            if (!s0 || !s1) continue;
            const left = Math.max(s0[0], s1[0]), right = Math.min(s0[1], s1[1]); // inscribed
            if (right - left < 1) continue;
            out += `<a class="lnk" href="${esc(href)}"${tgt} style="left:${pl.ox + obj.x + left}pt;top:${obj.y + y0}pt;width:${right - left}pt;height:${y1 - y0}pt"></a>`;
          }
        }
      }
    }
  }
  return out;
}
function linkHref(link) {
  if (link.type === 'url') return link.target;
  if (link.type === 'page') return `#apub-page-${parseInt(link.target, 10) || 1}`;
  if (link.type === 'anchor') return `#apub-anchor-${slug(link.target)}`;
  return null;
}

// Horizontal extent [xmin, xmax] of a convex polygon at height y (or null).
function spanAtY(poly, y) {
  const xs = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (y < Math.min(a.y, b.y) || y > Math.max(a.y, b.y)) continue;
    if (a.y === b.y) { xs.push(a.x, b.x); }
    else xs.push(a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x));
  }
  return xs.length ? [Math.min(...xs), Math.max(...xs)] : null;
}

/* ---------- utils ---------- */
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function slug(s) { return (s || 'document').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
