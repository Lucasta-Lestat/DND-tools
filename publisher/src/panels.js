// All chrome: persona switcher, tool strip, context bar, studio panels, status bar.
import { store, begin, commit, emit, selectedObjects, getSpreads, findObject } from './store.js';
import { PERSONAS, TOOLS } from './personas.js';
import { fitView, drawScene, tableContentHeight, tocContentHeight, indexContentHeight, tableChainOf, tocLevelStyle } from './renderer.js';
import { uid, makePage, PAGE_PRESETS } from './model.js';
import { startTextEdit, followLink, ensureAnchorName, regenerateToc, regenerateIndex } from './interaction.js';

const collapsed = new Set();

function el(tag, props = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(kids)) if (c != null) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
}

function applyToSelection(label, fn) {
  begin(label);
  for (const o of selectedObjects()) fn(o);
  commit(label);
}

/* ===================== Persona switcher ===================== */
export function renderPersonas() {
  const host = document.getElementById('personas');
  host.innerHTML = '';
  for (const [id, p] of Object.entries(PERSONAS)) {
    const b = el('button', {
      class: store.ui.persona === id ? 'active' : '',
      title: p.blurb,
      onclick: () => switchPersona(id),
    }, [el('span', { class: 'dot', style: `color:${p.color}` }), p.label]);
    host.append(b);
  }
}

function switchPersona(id) {
  store.ui.persona = id;
  const tools = PERSONAS[id].tools.filter((t) => t !== 'sep');
  if (!tools.includes(store.ui.tool)) store.ui.tool = tools[0];
  emit();
}

/* ===================== Tool strip ===================== */
export function renderToolstrip() {
  const host = document.getElementById('toolstrip');
  host.innerHTML = '';
  const persona = PERSONAS[store.ui.persona];
  for (const t of persona.tools) {
    if (t === 'sep') { host.append(el('div', { class: 'tool-sep' })); continue; }
    const def = TOOLS[t];
    const b = el('button', {
      class: 'tool' + (store.ui.tool === t ? ' active' : ''),
      title: `${def.name}  (${def.kbd})`,
      onclick: () => { store.ui.tool = t; emit(); },
    }, [def.icon, el('span', { class: 'kbd', text: def.kbd })]);
    host.append(b);
  }
}

/* ===================== Context bar ===================== */
export function renderContextbar() {
  const host = document.getElementById('contextbar');
  host.innerHTML = '';
  const ui = store.ui;
  const persona = PERSONAS[ui.persona];

  host.append(el('div', { class: 'grp' }, [
    el('span', { class: 'hint', html: `<b style="color:${persona.color}">${persona.label} Persona</b>` }),
    el('span', { class: 'hint', text: '· ' + persona.blurb }),
  ]));

  const sel = selectedObjects();
  if (sel.length) {
    const grp = el('div', { class: 'grp' }, [
      el('span', { class: 'hint', text: sel.length === 1 ? `${sel[0].type} selected` : `${sel.length} objects` }),
      el('button', { onclick: () => orderChange('front') , title: 'Bring to front' }, '⤒'),
      el('button', { onclick: () => orderChange('forward'), title: 'Forward' }, '↑'),
      el('button', { onclick: () => orderChange('backward'), title: 'Backward' }, '↓'),
      el('button', { onclick: () => orderChange('back'), title: 'Send to back' }, '⤓'),
      el('button', { class: 'danger', onclick: deleteSelection, title: 'Delete (Del)' }, '🗑'),
    ]);
    if (sel.length === 1 && sel[0].link) {
      grp.append(el('button', { class: 'on', title: 'Follow link (or Ctrl/Cmd-click it)', onclick: () => followLink(sel[0]) }, '↪ Go'));
    }
    host.append(grp);
  }

  // view toggles
  host.append(el('div', { class: 'grp' }, [
    toggleBtn('Margins', ui.showMargins, () => { ui.showMargins = !ui.showMargins; emit(); }),
    toggleBtn('Snap', ui.snap, () => { ui.snap = !ui.snap; emit(); }),
    el('button', { onclick: () => { fitView(); emit(); }, title: 'Fit spread' }, 'Fit'),
  ]));

  if (store.ui.masterEdit) {
    host.append(el('div', { class: 'grp' }, [
      el('span', { class: 'hint', html: '<b style="color:#e0654a">Editing Master Page</b>' }),
      el('button', { onclick: exitMasterEdit }, 'Done'),
    ]));
  }
}

function toggleBtn(label, on, onclick) {
  return el('button', { class: on ? 'on' : '', onclick }, label);
}

/* ===================== Studio panels ===================== */
export function renderStudio() {
  const host = document.getElementById('studio');
  host.innerHTML = '';
  const panels = PERSONAS[store.ui.persona].panels;
  const builders = {
    transform: buildTransform,
    toc: buildToc,
    index: buildIndex,
    table: buildTable,
    links: buildLinks,
    pages: buildPages,
    layers: buildLayers,
    textstyles: buildTextStyles,
    color: buildColor,
    boolean: buildArrange,
    imageadjust: buildImageAdjust,
  };
  for (const name of panels) {
    const b = builders[name];
    if (b) host.append(b());
  }
}

function section(key, title, bodyKids) {
  const isCollapsed = collapsed.has(key);
  const head = el('h3', {
    onclick: () => { if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key); emit(); },
  }, [el('span', { class: 'caret', text: '▾' }), title]);
  const body = el('div', { class: 'panel-body' }, bodyKids);
  return el('div', { class: 'panel' + (isCollapsed ? ' collapsed' : '') }, [head, body]);
}

function num(label, value, oninput, opts = {}) {
  const inp = el('input', {
    type: 'number', value: round(value), step: opts.step ?? 1,
    onchange: (e) => oninput(parseFloat(e.target.value)),
  });
  if (opts.min != null) inp.min = opts.min;
  return el('div', { class: 'field' }, [el('label', { text: label }), inp]);
}
function round(v) { return v == null ? '' : Math.round(v * 100) / 100; }

/* ---- Transform / Appearance ---- */
function buildTransform() {
  const sel = selectedObjects();
  if (!sel.length) {
    return section('transform', 'Transform', [el('div', { class: 'empty', text: 'Nothing selected.' })]);
  }
  const o = sel[0];
  const kids = [];
  kids.push(el('div', { class: 'row' }, [
    num('X', o.x, (v) => applyToSelection('move', (s) => s.x = v)),
    num('Y', o.y, (v) => applyToSelection('move', (s) => s.y = v)),
  ]));
  kids.push(el('div', { class: 'row' }, [
    num('W', o.w, (v) => applyToSelection('size', (s) => { s.w = Math.max(1, v); if (s.type === 'table' && !s.threadNext && !s.threadPrev) s.h = tableContentHeight(s); }), { min: 1 }),
    num('H', o.h, (v) => applyToSelection('size', (s) => { if (s.type !== 'table' || s.threadNext || s.threadPrev) s.h = Math.max(1, v); }), { min: 1 }),
  ]));
  kids.push(el('div', { class: 'row' }, [
    num('°', o.rotation || 0, (v) => applyToSelection('rotate', (s) => s.rotation = v)),
    el('div', { class: 'field' }, [
      el('label', { text: 'Opacity' }),
      el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: o.opacity ?? 1,
        oninput: (e) => { for (const s of selectedObjects()) s.opacity = parseFloat(e.target.value); drawScene(); },
        onchange: () => emit() }),
    ]),
  ]));
  if (o.type === 'rect' || o.type === 'image' || o.type === 'text') {
    kids.push(el('div', { class: 'row' }, [
      num('Corner', o.radius || 0, (v) => applyToSelection('radius', (s) => s.radius = Math.max(0, v)), { min: 0 }),
    ]));
  }

  // Appearance: fill / stroke
  kids.push(el('div', { class: 'row split' }, [
    el('label', { text: 'Fill' }),
    colorInput(o.fill, (c) => applyToSelection('fill', (s) => s.fill = c)),
    el('button', { class: 'mini', onclick: () => applyToSelection('fill', (s) => s.fill = null) }, 'None'),
  ]));
  if (o.type !== 'text' || true) {
    kids.push(el('div', { class: 'row split' }, [
      el('label', { text: 'Stroke' }),
      colorInput(o.stroke, (c) => applyToSelection('stroke', (s) => s.stroke = c)),
      num('W', o.strokeWidth || 0, (v) => applyToSelection('stroke', (s) => s.strokeWidth = Math.max(0, v)), { min: 0 }),
    ]));
  }

  if (o.type === 'image') kids.push(buildImageInline(o));
  if (o.type === 'text') kids.push(buildTextInline(o));

  return section('transform', 'Transform & Appearance', kids);
}

function colorInput(value, onchange) {
  return el('input', { type: 'color', value: value || '#000000', oninput: (e) => onchange(e.target.value) });
}

function buildImageInline(o) {
  return el('div', { class: 'row' }, [
    el('label', { text: 'Fit' }),
    select(['cover', 'contain', 'fill'], o.fit, (v) => applyToSelection('fit', (s) => s.fit = v)),
    el('button', { class: 'mini', onclick: () => { store.ui._replaceTarget = o.id; document.getElementById('file-image').click(); } }, 'Replace…'),
  ]);
}

function buildTextInline(o) {
  return el('div', { class: 'row' }, [
    el('button', { class: 'mini', onclick: () => startTextEdit(o.id) }, '✎ Edit text'),
    el('label', { text: 'Cols' }),
    el('input', { type: 'number', min: 1, max: 6, value: o.columns || 1, style: 'width:48px',
      onchange: (e) => applyToSelection('cols', (s) => s.columns = Math.max(1, parseInt(e.target.value) || 1)) }),
  ]);
}

function select(options, value, onchange) {
  const s = el('select', { onchange: (e) => onchange(e.target.value) });
  for (const op of options) {
    const o = el('option', { value: op, text: op });
    if (op === value) o.selected = true;
    s.append(o);
  }
  return s;
}

/* ---- Pages ---- */
function buildPages() {
  const kids = [];
  const s = store.doc.settings;

  // page setup
  kids.push(el('div', { class: 'row' }, [
    el('label', { text: 'Size' }),
    select(Object.keys(PAGE_PRESETS), s.preset in PAGE_PRESETS ? s.preset : Object.keys(PAGE_PRESETS)[0], (v) => {
      begin('page size'); s.preset = v; s.pageWidth = PAGE_PRESETS[v].w; s.pageHeight = PAGE_PRESETS[v].h; commit('page size'); fitView(); emit();
    }),
  ]));
  kids.push(el('div', { class: 'row' }, [
    toggleBtn('Facing pages', s.facing, () => { begin('facing'); s.facing = !s.facing; commit('facing'); fitView(); emit(); }),
    el('div', { class: 'field' }, [el('label', { text: 'Cols' }),
      el('input', { type: 'number', min: 1, max: 6, value: s.columns, style: 'width:48px',
        onchange: (e) => { begin('cols'); s.columns = Math.max(1, parseInt(e.target.value) || 1); commit('cols'); } })]),
  ]));
  kids.push(el('div', { class: 'row' }, [
    num('Top', s.margins.top, (v) => setMargin('top', v)),
    num('Bot', s.margins.bottom, (v) => setMargin('bottom', v)),
  ]));
  kids.push(el('div', { class: 'row' }, [
    num('In', s.margins.inside, (v) => setMargin('inside', v)),
    num('Out', s.margins.outside, (v) => setMargin('outside', v)),
  ]));
  kids.push(el('div', { class: 'row' }, [
    toggleBtn('Smart typography', s.smartTypography !== false, () => { begin('smart'); s.smartTypography = !(s.smartTypography !== false); commit('smart'); }),
    toggleBtn('Unit ties', s.nonBreakingUnits !== false, () => { begin('nbsp'); s.nonBreakingUnits = !(s.nonBreakingUnits !== false); commit('nbsp'); }),
  ]));

  // master list
  kids.push(el('div', { class: 'muted', text: 'Master Pages' }));
  const mlist = el('div', { class: 'list' });
  for (const m of store.doc.masters) {
    mlist.append(el('div', { class: 'item' + (store.ui.masterEdit === m.id ? ' active' : ''), onclick: () => editMaster(m.id) }, [
      el('span', { class: 'icon', text: '▦' }),
      el('span', { class: 'grow', text: m.name }),
      el('span', { class: 'mini', onclick: (e) => { e.stopPropagation(); editMaster(m.id); } }, 'Edit'),
    ]));
  }
  kids.push(mlist);
  kids.push(el('div', { class: 'btnrow' }, [
    el('button', { onclick: addMaster }, '+ Master'),
  ]));

  // pages list
  kids.push(el('div', { class: 'muted', text: 'Pages' }));
  const plist = el('div', { class: 'list' });
  const spreads = getSpreads();
  store.doc.pages.forEach((page, i) => {
    const onActiveSpread = spreads[store.ui.spreadIndex]?.pages.includes(page) && !store.ui.masterEdit;
    const masterName = store.doc.masters.find((m) => m.id === page.masterId)?.name?.split(' ')[0] || '—';
    plist.append(el('div', { class: 'item' + (onActiveSpread ? ' active' : ''), onclick: () => goToPage(i) }, [
      el('div', { class: 'thumb' }),
      el('div', { class: 'grow' }, [el('div', { text: `Page ${i + 1}` }), el('small', { text: `Master ${masterName}` })]),
      el('span', { class: 'mini', title: 'Apply master', onclick: (e) => { e.stopPropagation(); cycleMaster(page); } }, masterName),
    ]));
  });
  kids.push(plist);
  kids.push(el('div', { class: 'btnrow' }, [
    el('button', { onclick: () => addPage() }, '+ Page'),
    el('button', { onclick: duplicatePage }, 'Duplicate'),
    el('button', { class: 'danger', onclick: deletePage }, 'Delete'),
  ]));

  return section('pages', 'Pages & Document', kids);
}

function setMargin(k, v) { begin('margin'); store.doc.settings.margins[k] = v; commit('margin'); }

/* ---- Layers ---- */
function buildLayers() {
  const kids = [];
  const list = el('div', { class: 'list' });
  // top layer first
  for (let i = store.doc.layers.length - 1; i >= 0; i--) {
    const layer = store.doc.layers[i];
    const count = countLayerObjects(layer.id);
    list.append(el('div', { class: 'item' }, [
      el('span', { class: 'toggle' + (layer.visible ? '' : ' off'), title: 'Visibility',
        onclick: () => { begin('vis'); layer.visible = !layer.visible; commit('vis'); }, text: layer.visible ? '👁' : '∅' }),
      el('span', { class: 'toggle' + (layer.locked ? '' : ' off'), title: 'Lock',
        onclick: () => { begin('lock'); layer.locked = !layer.locked; commit('lock'); }, text: layer.locked ? '🔒' : '🔓' }),
      el('input', { class: 'grow', value: layer.name, style: 'background:transparent;border:0',
        onchange: (e) => { begin('rename'); layer.name = e.target.value; commit('rename'); } }),
      el('small', { text: count }),
    ]));
  }
  kids.push(list);
  kids.push(el('div', { class: 'btnrow' }, [
    el('button', { onclick: addLayer }, '+ Layer'),
    el('button', { onclick: () => moveSelToLayer(1), title: 'Move selection up a layer' }, 'Sel ↑'),
    el('button', { onclick: () => moveSelToLayer(-1) }, 'Sel ↓'),
    el('button', { class: 'danger', onclick: deleteLayer }, 'Delete'),
  ]));
  kids.push(el('div', { class: 'muted', text: 'Object order (within page): use the context bar arrows.' }));
  return section('layers', 'Layers', kids);
}

function countLayerObjects(layerId) {
  let n = 0;
  for (const c of [...store.doc.pages, ...store.doc.masters]) n += c.objects.filter((o) => o.layerId === layerId).length;
  return n;
}

/* ---- Text styles ---- */
function buildTextStyles() {
  const kids = [];
  const sel = selectedObjects().filter((o) => o.type === 'text');
  const o = sel[0];

  if (o) {
    kids.push(el('div', { class: 'row' }, [
      el('label', { text: 'Font' }),
      select(['Georgia, serif', 'system-ui, sans-serif', '"Times New Roman", serif', '"Courier New", monospace', 'Garamond, serif', '"Trebuchet MS", sans-serif', 'Palatino, serif'], o.fontFamily, (v) => applyToSelection('font', (s) => s.fontFamily = v)),
    ]));
    kids.push(el('div', { class: 'row' }, [
      num('Size', o.size, (v) => applyToSelection('size', (s) => s.size = Math.max(1, v)), { step: 0.5, min: 1 }),
      el('label', { text: 'Line' }),
      el('input', { type: 'number', step: 0.05, value: o.lineHeight, style: 'width:54px',
        onchange: (e) => applyToSelection('line', (s) => s.lineHeight = parseFloat(e.target.value) || 1.2) }),
    ]));
    kids.push(el('div', { class: 'row' }, [
      colorInput(o.color, (c) => applyToSelection('color', (s) => s.color = c)),
      styleToggle('B', o.bold, () => applyToSelection('bold', (s) => s.bold = !s.bold)),
      styleToggle('I', o.italic, () => applyToSelection('italic', (s) => s.italic = !s.italic)),
      alignBtn('left', o.align), alignBtn('center', o.align), alignBtn('right', o.align), alignBtn('justify', o.align),
    ]));
    kids.push(el('div', { class: 'row' }, [
      num('Track', o.tracking || 0, (v) => applyToSelection('track', (s) => s.tracking = v), { step: 0.1 }),
      num('Gap', o.columnGap || 14, (v) => applyToSelection('gap', (s) => s.columnGap = v)),
    ]));
    kids.push(el('div', { class: 'row' }, [
      num('Indent', o.firstLineIndent || 0, (v) => applyToSelection('indent', (s) => s.firstLineIndent = Math.max(0, v)), { min: 0 }),
      styleToggle('Hyphenate', o.hyphenate !== false, () => applyToSelection('hyphenate', (s) => s.hyphenate = !(s.hyphenate !== false))),
    ]));
  } else {
    kids.push(el('div', { class: 'empty', text: 'Select a text frame to edit its formatting.' }));
  }

  kids.push(el('div', { class: 'muted', text: 'Paragraph Styles (click to apply)' }));
  const list = el('div', { class: 'list' });
  for (const ps of store.doc.paragraphStyles) {
    const active = o && o.paraStyleId === ps.id;
    list.append(el('div', { class: 'item' + (active ? ' active' : ''),
      onclick: () => applyToSelection('apply style', (s) => { if (s.type === 'text') { s.paraStyleId = ps.id; copyStyleToFrame(ps, s); } }) }, [
      el('span', { class: 'grow', html: `<span style="font-family:${ps.fontFamily};color:${ps.color}">${ps.name}</span>` }),
      el('small', { text: `${ps.size}pt` }),
    ]));
  }
  kids.push(list);
  kids.push(el('div', { class: 'btnrow' }, [
    el('button', { onclick: createStyleFromSelection, title: 'Create a new paragraph style from the selected frame' }, '+ Style from frame'),
    el('button', { onclick: updateStyleFromSelection, title: 'Redefine the applied style from the selected frame' }, 'Update style'),
  ]));
  kids.push(el('div', { class: 'muted', html: 'Tip: start a line with <span class="kbd-tag"># </span> for Heading 1, <span class="kbd-tag">## </span> for Heading 2.' }));
  return section('textstyles', 'Text & Styles', kids);
}

function styleToggle(label, on, onclick) {
  return el('button', { class: 'mini' + (on ? ' on' : ''), style: on ? 'background:var(--accent);color:#fff' : '', onclick }, label);
}
function alignBtn(a, current) {
  const icons = { left: '⬱', center: '☰', right: '⬲', justify: '▤' };
  return el('button', { class: 'mini', style: current === a ? 'background:var(--accent);color:#fff' : '',
    onclick: () => applyToSelection('align', (s) => s.align = a) }, icons[a]);
}
function copyStyleToFrame(ps, frame) {
  for (const k of ['fontFamily', 'size', 'color', 'bold', 'italic', 'align', 'lineHeight', 'tracking', 'firstLineIndent']) frame[k] = ps[k];
}

/* ---- Color & swatches ---- */
function buildColor() {
  const kids = [];
  kids.push(el('div', { class: 'applies' }, [
    el('div', { class: 'chip' + (store.ui.fillTarget === 'fill' ? ' active' : ''), onclick: () => { store.ui.fillTarget = 'fill'; emit(); } }, 'Fill'),
    el('div', { class: 'chip' + (store.ui.fillTarget === 'stroke' ? ' active' : ''), onclick: () => { store.ui.fillTarget = 'stroke'; emit(); } }, 'Stroke'),
  ]));
  const grid = el('div', { class: 'swatches' });
  grid.append(el('div', { class: 'swatch none', title: 'None', onclick: () => applySwatch(null) }));
  for (const c of store.doc.swatches) {
    grid.append(el('div', { class: 'swatch', style: `background:${c}`, title: c, onclick: () => applySwatch(c) }));
  }
  kids.push(grid);
  const picker = el('input', { type: 'color', value: '#888888' });
  kids.push(el('div', { class: 'row' }, [
    picker,
    el('button', { class: 'mini', onclick: () => applySwatch(picker.value) }, 'Apply'),
    el('button', { class: 'mini', onclick: () => { begin('swatch'); store.doc.swatches.push(picker.value); commit('swatch'); } }, '+ Swatch'),
  ]));
  return section('color', 'Color & Swatches', kids);
}

function applySwatch(color) {
  const target = store.ui.fillTarget;
  applyToSelection('color', (s) => {
    if (target === 'stroke') { s.stroke = color; if (color && !s.strokeWidth) s.strokeWidth = 1; }
    else s.fill = color;
  });
}

/* ---- Arrange / Align (Designer) ---- */
function buildArrange() {
  const kids = [];
  const sel = selectedObjects();
  kids.push(el('div', { class: 'muted', text: 'Align' }));
  kids.push(el('div', { class: 'btnrow' }, [
    el('button', { onclick: () => align('left') }, '⬱'),
    el('button', { onclick: () => align('hcenter') }, '⬍'),
    el('button', { onclick: () => align('right') }, '⬲'),
    el('button', { onclick: () => align('top') }, '⤒'),
    el('button', { onclick: () => align('vcenter') }, '⬌'),
    el('button', { onclick: () => align('bottom') }, '⤓'),
  ]));
  kids.push(el('div', { class: 'btnrow' }, [
    el('button', { onclick: () => distribute('h') }, 'Distribute H'),
    el('button', { onclick: () => distribute('v') }, 'Distribute V'),
  ]));
  kids.push(el('div', { class: 'muted', text: 'Order' }));
  kids.push(el('div', { class: 'btnrow' }, [
    el('button', { onclick: () => orderChange('front') }, 'To Front'),
    el('button', { onclick: () => orderChange('forward') }, 'Forward'),
    el('button', { onclick: () => orderChange('backward') }, 'Backward'),
    el('button', { onclick: () => orderChange('back') }, 'To Back'),
  ]));
  if (sel.length < 2) kids.push(el('div', { class: 'muted', text: 'Select 2+ objects to align/distribute.' }));
  return section('boolean', 'Arrange & Align', kids);
}

/* ---- Image adjust (Photo) ---- */
function buildImageAdjust() {
  const kids = [];
  const sel = selectedObjects().filter((o) => o.type === 'image');
  const o = sel[0];
  if (!o) { kids.push(el('div', { class: 'empty', text: 'Select an image frame.' })); return section('imageadjust', 'Image Adjustments', kids); }
  o.adjust = o.adjust || { brightness: 1, contrast: 1, saturate: 1, grayscale: 0 };
  const slider = (label, key, min, max, step) => el('div', { class: 'row split' }, [
    el('label', { text: label, style: 'min-width:70px' }),
    el('input', { type: 'range', min, max, step, value: o.adjust[key],
      oninput: (e) => { for (const im of sel) { im.adjust = im.adjust || {}; im.adjust[key] = parseFloat(e.target.value); } drawScene(); },
      onchange: () => emit() }),
  ]);
  kids.push(slider('Brightness', 'brightness', 0, 2, 0.05));
  kids.push(slider('Contrast', 'contrast', 0, 2, 0.05));
  kids.push(slider('Saturation', 'saturate', 0, 2, 0.05));
  kids.push(slider('Grayscale', 'grayscale', 0, 1, 0.05));
  kids.push(el('div', { class: 'row' }, [
    el('label', { text: 'Fit' }),
    select(['cover', 'contain', 'fill'], o.fit, (v) => applyToSelection('fit', (s) => s.fit = v)),
    el('button', { class: 'mini', onclick: () => applyToSelection('reset', (s) => s.adjust = { brightness: 1, contrast: 1, saturate: 1, grayscale: 0 }) }, 'Reset'),
  ]));
  kids.push(el('div', { class: 'btnrow' }, [
    el('button', { onclick: () => { store.ui._replaceTarget = o.id; document.getElementById('file-image').click(); } }, 'Replace image…'),
  ]));
  return section('imageadjust', 'Image Adjustments', kids);
}

/* ---- Table of contents ---- */
function tocMutate(label, fn, regen) {
  const o = selectedObjects().find((s) => s.type === 'toc');
  if (!o) return;
  begin(label); fn(o); if (regen) regenerateToc(o); else o.h = tocContentHeight(o); commit(label);
}

function buildToc() {
  const o = selectedObjects().find((s) => s.type === 'toc');
  if (!o) return section('toc', 'Table of Contents', [el('div', { class: 'empty', text: 'Select a contents block (Contents tool, C) to edit it.' })]);
  const kids = [];

  kids.push(el('div', { class: 'btnrow' }, [
    el('button', { class: 'on', onclick: () => tocMutate('refresh toc', () => {}, true), title: 'Rescan headings and rebuild' }, '↻ Generate / Refresh'),
  ]));
  kids.push(el('div', { class: 'muted', text: `${(o.entries || []).length} entries · double-click an entry to jump to its page.` }));

  kids.push(el('div', { class: 'row' }, [
    el('label', { text: 'Include' }),
    levelToggle(o, 1, 'H1'), levelToggle(o, 2, 'H2'), levelToggle(o, 3, 'H3'),
  ]));
  kids.push(el('div', { class: 'row' }, [
    el('label', { text: 'Title' }),
    el('input', { class: 'grow', type: 'text', value: o.title || '', style: 'width:100%',
      onchange: (e) => tocMutate('toc title', (t) => t.title = e.target.value) }),
  ]));
  kids.push(el('div', { class: 'row' }, [
    el('label', { text: 'Font' }),
    select(['Georgia, serif', 'system-ui, sans-serif', '"Times New Roman", serif', '"Trebuchet MS", sans-serif'], o.fontFamily, (v) => tocMutate('toc font', (t) => t.fontFamily = v)),
  ]));
  kids.push(el('div', { class: 'row' }, [
    num('Size', o.size, (v) => tocMutate('toc size', (t) => t.size = Math.max(5, v)), { step: 0.5, min: 5 }),
    num('Title', o.titleSize, (v) => tocMutate('toc tsize', (t) => t.titleSize = Math.max(6, v)), { step: 0.5, min: 6 }),
  ]));
  kids.push(el('div', { class: 'row' }, [
    num('Indent', o.indent, (v) => tocMutate('toc indent', (t) => t.indent = Math.max(0, v)), { min: 0 }),
    num('Leading', o.lineHeight, (v) => tocMutate('toc lead', (t) => t.lineHeight = Math.max(1, v)), { step: 0.05, min: 1 }),
    el('div', { class: 'field' }, [el('label', { text: 'Leader' }),
      el('input', { type: 'text', maxlength: 1, value: o.leader || '', style: 'width:34px',
        onchange: (e) => tocMutate('toc leader', (t) => t.leader = e.target.value.slice(0, 1)) })]),
  ]));
  kids.push(el('div', { class: 'row split' }, [
    el('label', { text: 'Title colour' }),
    colorInput(o.titleColor || '#7a2d1f', (c) => tocMutate('toc tcolor', (t) => t.titleColor = c)),
  ]));

  kids.push(el('div', { class: 'muted', text: 'Per-level style — size · colour · B · I · indent · # (page no.)' }));
  for (const level of [1, 2, 3]) kids.push(tocLevelRow(o, level));

  kids.push(el('div', { class: 'muted', text: 'Headings come from text starting with “# ”, “## ”, or “### ”. Refresh after editing or repaginating.' }));
  return section('toc', 'Table of Contents', kids);
}

function tocLevelMutate(level, label, fn) {
  const o = selectedObjects().find((s) => s.type === 'toc');
  if (!o) return;
  begin(label);
  o.levelStyles = o.levelStyles || {};
  o.levelStyles[level] = { ...tocLevelStyle(o, level) }; // materialise resolved values, then edit
  fn(o.levelStyles[level]);
  o.h = tocContentHeight(o);
  commit(label);
}

function tocLevelRow(o, level) {
  const st = tocLevelStyle(o, level);
  return el('div', { class: 'row', style: 'flex-wrap:wrap;gap:5px' }, [
    el('label', { text: `H${level}`, style: 'min-width:22px' }),
    el('input', { type: 'number', step: 0.5, min: 4, value: round(st.size), title: 'Size', style: 'width:46px',
      onchange: (e) => tocLevelMutate(level, 'toc h size', (s) => s.size = Math.max(4, parseFloat(e.target.value) || st.size)) }),
    colorInput(st.color, (c) => tocLevelMutate(level, 'toc h colour', (s) => s.color = c)),
    styleToggle('B', st.bold, () => tocLevelMutate(level, 'toc h bold', (s) => s.bold = !s.bold)),
    styleToggle('I', st.italic, () => tocLevelMutate(level, 'toc h italic', (s) => s.italic = !s.italic)),
    el('input', { type: 'number', min: 0, value: round(st.indent), title: 'Indent', style: 'width:46px',
      onchange: (e) => tocLevelMutate(level, 'toc h indent', (s) => s.indent = Math.max(0, parseFloat(e.target.value) || 0)) }),
    el('button', { class: 'mini', title: 'Show page number for this level', style: st.showPage ? 'background:var(--accent);color:#fff' : '',
      onclick: () => tocLevelMutate(level, 'toc h page', (s) => s.showPage = !s.showPage) }, '#'),
  ]);
}

function levelToggle(o, level, label) {
  const on = (o.levels || []).includes(level);
  return el('button', { class: 'mini', style: on ? 'background:var(--accent);color:#fff' : '',
    onclick: () => tocMutate('toc levels', (t) => {
      const set = new Set(t.levels || []);
      if (set.has(level)) set.delete(level); else set.add(level);
      t.levels = [...set].sort();
    }, true) }, label);
}

/* ---- Index ---- */
function indexMutate(label, fn, regen) {
  const o = selectedObjects().find((s) => s.type === 'index');
  if (!o) return;
  begin(label); fn(o); if (regen) regenerateIndex(o); else o.h = indexContentHeight(o); commit(label);
}

function buildIndex() {
  const o = selectedObjects().find((s) => s.type === 'index');
  if (!o) return section('index', 'Index', [el('div', { class: 'empty', text: 'Select an index block (Index tool, X) to edit it.' })]);
  const kids = [];
  kids.push(el('div', { class: 'btnrow' }, [
    el('button', { class: 'on', onclick: () => indexMutate('refresh index', () => {}, true), title: 'Rescan index marks and rebuild' }, '↻ Generate / Refresh'),
  ]));
  kids.push(el('div', { class: 'muted', text: `${(o.entries || []).length} terms · double-click an entry to jump to its first page.` }));
  kids.push(el('div', { class: 'row' }, [
    el('div', { class: 'field' }, [el('label', { text: 'Columns' }),
      el('input', { type: 'number', min: 1, max: 4, value: o.columns, style: 'width:48px',
        onchange: (e) => indexMutate('index cols', (t) => t.columns = Math.max(1, Math.min(4, parseInt(e.target.value) || 1)), true) })]),
    toggleBtn('Group A–Z', o.groupByLetter, () => indexMutate('index group', (t) => t.groupByLetter = !t.groupByLetter, true)),
  ]));
  kids.push(el('div', { class: 'row' }, [
    el('label', { text: 'Title' }),
    el('input', { class: 'grow', type: 'text', value: o.title || '', style: 'width:100%',
      onchange: (e) => indexMutate('index title', (t) => t.title = e.target.value) }),
  ]));
  kids.push(el('div', { class: 'row' }, [
    el('label', { text: 'Font' }),
    select(['Georgia, serif', 'system-ui, sans-serif', '"Times New Roman", serif'], o.fontFamily, (v) => indexMutate('index font', (t) => t.fontFamily = v)),
  ]));
  kids.push(el('div', { class: 'row' }, [
    num('Size', o.size, (v) => indexMutate('index size', (t) => t.size = Math.max(5, v)), { step: 0.5, min: 5 }),
    num('Title', o.titleSize, (v) => indexMutate('index tsize', (t) => t.titleSize = Math.max(6, v)), { step: 0.5, min: 6 }),
    num('Gap', o.columnGap, (v) => indexMutate('index gap', (t) => t.columnGap = Math.max(4, v)), { min: 4 }),
  ]));
  kids.push(el('div', { class: 'row split' }, [
    el('label', { text: 'Letter / title' }),
    colorInput(o.letterColor || '#7a2d1f', (c) => indexMutate('index lcolor', (t) => t.letterColor = c)),
    colorInput(o.titleColor || '#7a2d1f', (c) => indexMutate('index tcolor', (t) => t.titleColor = c)),
    colorInput(o.color || '#222222', (c) => indexMutate('index color', (t) => t.color = c)),
  ]));
  kids.push(el('div', { class: 'muted', html: 'Mark terms in text with <span class="kbd-tag">{index:Term}</span> (invisible), or add index terms to any object in the <b>Cross-References &amp; Links</b> panel. Refresh after changes.' }));
  return section('index', 'Index', kids);
}

/* ---- Tables ---- */
function tableMutate(label, fn) {
  const sel = selectedObjects().find((s) => s.type === 'table');
  if (!sel) return;
  const o = tableChainOf(sel)[0]; // rows/styling live on the head
  begin(label); fn(o); if (!o.threadNext && !o.threadPrev) o.h = tableContentHeight(o); commit(label);
}

function buildTable() {
  const sel = selectedObjects().find((s) => s.type === 'table');
  if (!sel) return section('table', 'Table', [el('div', { class: 'empty', text: 'Select a table (Table tool, B) to edit it.' })]);
  const chain = tableChainOf(sel);
  const o = chain[0]; // edit the head — it holds the rows and styling
  const ncols = Math.max(1, ...o.rows.map((r) => r.length));
  const dataRows = o.rows.length - (o.headerRow ? 1 : 0);
  const kids = [];

  kids.push(el('div', { class: 'row split' }, [
    el('label', { text: 'Rows' }),
    el('div', { class: 'btnrow' }, [
      el('button', { class: 'mini', onclick: () => tableMutate('row+', (t) => t.rows.push(Array.from({ length: ncols }, () => ''))) }, '+ Row'),
      el('button', { class: 'mini', onclick: () => tableMutate('row-', (t) => { if (t.rows.length > 1) t.rows.pop(); }) }, '– Row'),
    ]),
  ]));
  kids.push(el('div', { class: 'row split' }, [
    el('label', { text: 'Cols' }),
    el('div', { class: 'btnrow' }, [
      el('button', { class: 'mini', onclick: () => tableMutate('col+', (t) => { t.rows.forEach((r) => r.push('')); t.colWeights = [...(t.colWeights || []), 1].slice(0, t.rows[0].length); }) }, '+ Col'),
      el('button', { class: 'mini', onclick: () => tableMutate('col-', (t) => { if (t.rows[0].length > 1) { t.rows.forEach((r) => r.pop()); t.colWeights = (t.colWeights || []).slice(0, t.rows[0].length); } }) }, '– Col'),
    ]),
  ]));

  // column weights
  const weights = (o.colWeights && o.colWeights.length === ncols) ? o.colWeights : Array.from({ length: ncols }, () => 1);
  const weightRow = el('div', { class: 'row' }, [el('label', { text: 'Widths' })]);
  weights.forEach((wt, c) => {
    weightRow.append(el('input', { type: 'number', min: 1, value: wt, style: 'width:42px',
      onchange: (e) => tableMutate('col width', (t) => { const w = (t.colWeights && t.colWeights.length === ncols) ? t.colWeights.slice() : weights.slice(); w[c] = Math.max(1, parseFloat(e.target.value) || 1); t.colWeights = w; }) }));
  });
  kids.push(weightRow);

  kids.push(el('div', { class: 'row' }, [
    toggleBtn('Header row', o.headerRow, () => tableMutate('header', (t) => t.headerRow = !t.headerRow)),
    toggleBtn('Zebra', !!o.zebra, () => tableMutate('zebra', (t) => t.zebra = t.zebra ? null : '#f0e6d2')),
  ]));
  kids.push(el('div', { class: 'row split' }, [
    el('label', { text: 'Header' }),
    colorInput(o.headerFill || '#5a3d2b', (c) => tableMutate('hfill', (t) => t.headerFill = c)),
    colorInput(o.headerColor || '#ffffff', (c) => tableMutate('hcolor', (t) => t.headerColor = c)),
    o.zebra ? colorInput(o.zebra, (c) => tableMutate('zcolor', (t) => t.zebra = c)) : null,
  ]));
  kids.push(el('div', { class: 'row split' }, [
    el('label', { text: 'Border' }),
    colorInput(o.borderColor || '#5a3d2b', (c) => tableMutate('bcolor', (t) => t.borderColor = c)),
    num('W', o.borderWidth || 0, (v) => tableMutate('bwidth', (t) => t.borderWidth = Math.max(0, v)), { min: 0, step: 0.5 }),
  ]));
  kids.push(el('div', { class: 'row' }, [
    el('label', { text: 'Font' }),
    select(['Georgia, serif', 'system-ui, sans-serif', '"Courier New", monospace', '"Times New Roman", serif'], o.fontFamily, (v) => tableMutate('font', (t) => t.fontFamily = v)),
  ]));
  kids.push(el('div', { class: 'row' }, [
    num('Size', o.size, (v) => tableMutate('size', (t) => t.size = Math.max(4, v)), { step: 0.5, min: 4 }),
    num('Pad', o.padding || 5, (v) => tableMutate('pad', (t) => t.padding = Math.max(0, v)), { min: 0 }),
    el('label', { text: 'Align' }),
    select(['left', 'center', 'right'], o.align, (v) => tableMutate('align', (t) => t.align = v)),
  ]));

  // roll-table helpers
  kids.push(el('div', { class: 'muted', text: 'Roll table helpers' }));
  const dice = [4, 6, 8, 10, 12, 20, 100];
  const dieRow = el('div', { class: 'btnrow' }, dice.map((d) =>
    el('button', { class: 'mini', title: `Make a d${d} table (fill 1..${d})`, onclick: () => fillDice(d) }, `d${d}`)));
  kids.push(dieRow);
  kids.push(el('div', { class: 'btnrow' }, [
    el('button', { onclick: () => fillSequential(), title: 'Number the first column 1..N for the current rows' }, 'Number 1–N'),
    el('button', { class: 'on', onclick: rollOnTable, title: 'Roll and highlight a row' }, '🎲 Roll'),
    el('button', { onclick: clearRoll }, 'Clear'),
  ]));
  const roll = store.ui.tableRoll;
  if (roll && roll.tableId === o.id && roll.value != null) {
    const cell = o.rows[roll.row] ? (o.rows[roll.row][1] ?? o.rows[roll.row][0] ?? '') : '';
    kids.push(el('div', { class: 'muted', html: `Rolled <b style="color:#2f81f7">${roll.value}</b> → ${escapeHtml(String(cell)).slice(0, 60)}` }));
  }
  // threading status / help
  if (chain.length > 1) {
    const pos = chain.indexOf(sel) + 1;
    kids.push(el('div', { class: 'muted', html: `Flows across <b>${chain.length}</b> linked frames (this is frame ${pos}). The header row repeats on each.` }));
  } else {
    kids.push(el('div', { class: 'muted', text: 'To flow a long table across pages: draw another table, then use the Link tool (K) to link this one into it. The header repeats automatically.' }));
  }
  kids.push(el('div', { class: 'muted', text: 'Double-click a cell to edit it.' }));
  return section('table', 'Table', kids);

  function fillDice(d) {
    tableMutate('dice', (t) => {
      const start = t.headerRow ? 1 : 0;
      const cols = Math.max(1, ...t.rows.map((r) => r.length));
      const header = t.headerRow ? t.rows[0] : null;
      const newRows = [];
      if (header) newRows.push(header);
      for (let i = 1; i <= d; i++) {
        const existing = t.rows[start + (i - 1)];
        const row = Array.from({ length: cols }, (_, c) => (existing && existing[c] != null && c > 0) ? existing[c] : '');
        row[0] = String(i);
        newRows.push(row);
      }
      t.rows = newRows;
    });
  }
  function fillSequential() {
    tableMutate('number', (t) => {
      const start = t.headerRow ? 1 : 0;
      for (let i = start; i < t.rows.length; i++) t.rows[i][0] = String(i - start + 1);
    });
  }
}

// Parse a die-range cell like "3", "6-14", "15–20" → {min,max}.
function parseRange(s) {
  const m = String(s).match(/(\d+)\s*[–-]\s*(\d+)/);
  if (m) return { min: +m[1], max: +m[2] };
  const n = String(s).match(/\d+/);
  if (n) return { min: +n[0], max: +n[0] };
  return null;
}
function rollOnTable() {
  const sel = selectedObjects().find((s) => s.type === 'table');
  if (!sel) return;
  const o = tableChainOf(sel)[0]; // roll over the whole (possibly threaded) table
  const start = o.headerRow ? 1 : 0;
  const ranges = [];
  let lo = Infinity, hi = -Infinity;
  for (let i = start; i < o.rows.length; i++) {
    const r = parseRange(o.rows[i][0]);
    if (r) { ranges.push({ i, ...r }); lo = Math.min(lo, r.min); hi = Math.max(hi, r.max); }
  }
  let value, row;
  if (ranges.length) {
    value = lo + Math.floor((hi - lo + 1) * pseudoRandom());
    const hit = ranges.find((r) => value >= r.min && value <= r.max);
    row = hit ? hit.i : start;
  } else {
    const n = o.rows.length - start;
    row = start + Math.floor(n * pseudoRandom());
    value = row - start + 1;
  }
  store.ui.tableRoll = { tableId: o.id, row, value };
  emit();
}
function clearRoll() { store.ui.tableRoll = null; emit(); }
// Date.now/Math.random are fine here (UI only, never inside a workflow script).
function pseudoRandom() { return Math.random(); }
function escapeHtml(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* ---- Cross-references & hyperlinks ---- */
function buildLinks() {
  const sel = selectedObjects();
  const o = sel[0];
  if (!o) return section('links', 'Cross-References & Links', [el('div', { class: 'empty', text: 'Select an object to link it or make it a reference target.' })]);
  const kids = [];
  const link = o.link || { type: 'none', target: '' };

  kids.push(el('div', { class: 'muted', text: 'This object links to…' }));
  kids.push(el('div', { class: 'row' }, [
    el('label', { text: 'Type' }),
    select(['none', 'page', 'anchor', 'url'], link.type, (v) => setLink((l) => { l.type = v; l.target = ''; })),
  ]));

  if (link.type === 'page') {
    kids.push(el('div', { class: 'row' }, [
      el('label', { text: 'Page' }),
      el('input', { type: 'number', min: 1, max: store.doc.pages.length, value: link.target || 1,
        onchange: (e) => setLink((l) => l.target = String(Math.max(1, Math.min(store.doc.pages.length, parseInt(e.target.value) || 1)))) }),
    ]));
  } else if (link.type === 'anchor') {
    const anchors = anchorList();
    kids.push(el('div', { class: 'row' }, [
      el('label', { text: 'Target' }),
      anchors.length
        ? select(anchors, link.target || anchors[0], (v) => setLink((l) => l.target = v))
        : el('span', { class: 'muted', text: 'No anchors yet — name one below or on another object.' }),
    ]));
  } else if (link.type === 'url') {
    kids.push(el('div', { class: 'row' }, [
      el('input', { class: 'grow', type: 'text', value: link.target || '', placeholder: 'https://…',
        style: 'width:100%', onchange: (e) => setLink((l) => l.target = e.target.value) }),
    ]));
  }
  if (o.link) {
    kids.push(el('div', { class: 'btnrow' }, [
      el('button', { class: 'on', onclick: () => followLink(o) }, '↪ Follow'),
      el('button', { onclick: () => { begin('unlink'); o.link = null; commit('unlink'); } }, 'Remove link'),
    ]));
  }

  kids.push(el('div', { class: 'muted', text: 'This object as a reference target (anchor)' }));
  kids.push(el('div', { class: 'row' }, [
    el('input', { class: 'grow', type: 'text', value: o.anchorName || '', placeholder: 'e.g. combat-rules',
      style: 'width:100%', onchange: (e) => { begin('anchor'); o.anchorName = e.target.value.trim(); commit('anchor'); } }),
  ]));
  kids.push(el('div', { class: 'btnrow' }, [
    el('button', { onclick: () => { begin('anchor'); ensureAnchorName(o); commit('anchor'); } }, 'Auto-name anchor'),
  ]));
  kids.push(el('div', { class: 'muted', html: 'In text, write <span class="kbd-tag">{page:combat-rules}</span> to insert that anchor\'s live page number. Ctrl/Cmd-click a linked object to follow it.' }));

  kids.push(el('div', { class: 'muted', text: 'Index terms for this object (comma-separated)' }));
  kids.push(el('div', { class: 'row' }, [
    el('input', { class: 'grow', type: 'text', value: (o.indexTerms || []).join(', '), placeholder: 'e.g. Knotsmen, rope-priests',
      style: 'width:100%', onchange: (e) => { begin('index terms'); o.indexTerms = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); commit('index terms'); } }),
  ]));
  return section('links', 'Cross-References & Links', kids);

  function setLink(mutator) {
    begin('set link');
    const l = o.link ? { ...o.link } : { type: 'none', target: '' };
    mutator(l);
    o.link = l.type === 'none' ? null : l;
    commit('set link');
  }
}

function anchorList() {
  const set = new Set();
  for (const p of store.doc.pages) for (const ob of p.objects) if (ob.anchorName) set.add(ob.anchorName);
  return [...set];
}

/* ===================== Status bar ===================== */
export function renderStatusbar(cursorDoc) {
  const host = document.getElementById('statusbar');
  host.innerHTML = '';
  const spreads = getSpreads();
  host.append(el('span', { text: `Spread ${store.ui.spreadIndex + 1} / ${spreads.length}` }));
  host.append(el('span', { text: `${store.doc.pages.length} pages` }));
  if (cursorDoc) host.append(el('span', { text: `x ${Math.round(cursorDoc.x)}  y ${Math.round(cursorDoc.y)} pt` }));
  host.append(el('span', { class: 'spacer' }));
  host.append(el('div', { class: 'zoom' }, [
    el('button', { onclick: () => zoomBy(1 / 1.2) }, '−'),
    el('span', { text: Math.round(store.ui.zoom * 100) + '%' }),
    el('button', { onclick: () => zoomBy(1.2) }, '+'),
    el('button', { onclick: () => { fitView(); emit(); }, title: 'Fit' }, '▭'),
  ]));
}

function zoomBy(f) {
  store.ui.zoom = Math.max(0.05, Math.min(8, store.ui.zoom * f));
  emit();
}

/* ===================== actions ===================== */
function deleteSelection() {
  if (!store.ui.selection.length) return;
  begin('delete');
  const ids = new Set(store.ui.selection);
  for (const c of [...store.doc.pages, ...store.doc.masters]) {
    for (const o of c.objects) { // mend threads
      if (o.threadNext && ids.has(o.threadNext)) o.threadNext = null;
      if (o.threadPrev && ids.has(o.threadPrev)) o.threadPrev = null;
    }
    c.objects = c.objects.filter((o) => !ids.has(o.id));
  }
  store.ui.selection = [];
  commit('delete');
}

function orderChange(kind) {
  begin('order');
  for (const id of store.ui.selection) {
    const f = findObject(id); if (!f) continue;
    const arr = f.container.objects;
    const i = arr.indexOf(f.obj);
    arr.splice(i, 1);
    if (kind === 'front') arr.push(f.obj);
    else if (kind === 'back') arr.unshift(f.obj);
    else if (kind === 'forward') arr.splice(Math.min(i + 1, arr.length), 0, f.obj);
    else if (kind === 'backward') arr.splice(Math.max(i - 1, 0), 0, f.obj);
  }
  commit('order');
}

function addLayer() {
  begin('add layer');
  store.doc.layers.push({ id: uid('L'), name: `Layer ${store.doc.layers.length + 1}`, visible: true, locked: false });
  commit('add layer');
}
function deleteLayer() {
  if (store.doc.layers.length <= 1) return;
  begin('del layer');
  const top = store.doc.layers[store.doc.layers.length - 1];
  for (const c of [...store.doc.pages, ...store.doc.masters]) c.objects = c.objects.filter((o) => o.layerId !== top.id);
  store.doc.layers = store.doc.layers.filter((l) => l !== top);
  commit('del layer');
}
function moveSelToLayer(dir) {
  begin('relayer');
  for (const o of selectedObjects()) {
    const i = store.doc.layers.findIndex((l) => l.id === o.layerId);
    const j = Math.max(0, Math.min(store.doc.layers.length - 1, i + dir));
    o.layerId = store.doc.layers[j].id;
  }
  commit('relayer');
}

function addPage(atIndex) {
  begin('add page');
  const master = store.doc.masters[0];
  const page = makePage(master.id);
  const idx = atIndex != null ? atIndex : store.doc.pages.length;
  store.doc.pages.splice(idx, 0, page);
  commit('add page');
}
function duplicatePage() {
  const spread = getSpreads()[store.ui.spreadIndex];
  if (!spread || store.ui.masterEdit) return;
  begin('dup page');
  for (const page of spread.pages) {
    const copy = JSON.parse(JSON.stringify(page));
    copy.id = uid('P');
    // new ids; drop thread links and anchor names so the copy can't collide with the original
    copy.objects.forEach((o) => { o.id = uid('o'); o.threadNext = null; o.threadPrev = null; o.anchorName = ''; });
    const i = store.doc.pages.indexOf(page);
    store.doc.pages.splice(i + 1, 0, copy);
  }
  commit('dup page');
}
function deletePage() {
  if (store.doc.pages.length <= 1 || store.ui.masterEdit) return;
  const spread = getSpreads()[store.ui.spreadIndex];
  begin('del page');
  for (const page of spread.pages) store.doc.pages = store.doc.pages.filter((p) => p !== page);
  store.ui.selection = [];
  if (store.ui.spreadIndex >= getSpreads().length) store.ui.spreadIndex = getSpreads().length - 1;
  commit('del page');
}
function goToPage(i) {
  if (store.ui.masterEdit) exitMasterEdit();
  const spreads = getSpreads();
  const idx = spreads.findIndex((sp) => sp.pages.includes(store.doc.pages[i]));
  store.ui.spreadIndex = Math.max(0, idx);
  store.ui.selection = [];
  fitView();
  emit();
}
function cycleMaster(page) {
  begin('master');
  const ids = [null, ...store.doc.masters.map((m) => m.id)];
  const cur = ids.indexOf(page.masterId);
  page.masterId = ids[(cur + 1) % ids.length];
  commit('master');
}
function addMaster() {
  begin('add master');
  const letter = String.fromCharCode(65 + store.doc.masters.length);
  store.doc.masters.push({ id: uid('M'), name: `${letter} — Master`, objects: [] });
  commit('add master');
}
function editMaster(id) {
  store.ui.masterEdit = id;
  store.ui.selection = [];
  store.ui.spreadIndex = 0;
  fitView();
  emit();
}
function exitMasterEdit() {
  store.ui.masterEdit = null;
  store.ui.selection = [];
  fitView();
  emit();
}

function createStyleFromSelection() {
  const o = selectedObjects().find((s) => s.type === 'text');
  if (!o) return;
  begin('new style');
  const ps = { id: uid('ps'), name: `Style ${store.doc.paragraphStyles.length + 1}`,
    fontFamily: o.fontFamily, size: o.size, color: o.color, bold: o.bold, italic: o.italic,
    align: o.align, lineHeight: o.lineHeight, tracking: o.tracking || 0, firstLineIndent: o.firstLineIndent || 0, spaceAfter: 4 };
  store.doc.paragraphStyles.push(ps);
  o.paraStyleId = ps.id;
  commit('new style');
}
function updateStyleFromSelection() {
  const o = selectedObjects().find((s) => s.type === 'text');
  if (!o || !o.paraStyleId) return;
  begin('update style');
  const ps = store.doc.paragraphStyles.find((p) => p.id === o.paraStyleId);
  if (ps) for (const k of ['fontFamily', 'size', 'color', 'bold', 'italic', 'align', 'lineHeight', 'tracking', 'firstLineIndent']) ps[k] = o[k];
  commit('update style');
}

function align(kind) {
  const sel = selectedObjects();
  if (sel.length < 2) return;
  begin('align');
  const minX = Math.min(...sel.map((o) => o.x));
  const maxX = Math.max(...sel.map((o) => o.x + o.w));
  const minY = Math.min(...sel.map((o) => o.y));
  const maxY = Math.max(...sel.map((o) => o.y + o.h));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  for (const o of sel) {
    if (kind === 'left') o.x = minX;
    else if (kind === 'right') o.x = maxX - o.w;
    else if (kind === 'hcenter') o.x = cx - o.w / 2;
    else if (kind === 'top') o.y = minY;
    else if (kind === 'bottom') o.y = maxY - o.h;
    else if (kind === 'vcenter') o.y = cy - o.h / 2;
  }
  commit('align');
}
function distribute(axis) {
  const sel = selectedObjects();
  if (sel.length < 3) return;
  begin('distribute');
  const key = axis === 'h' ? 'x' : 'y';
  const dim = axis === 'h' ? 'w' : 'h';
  const sorted = sel.slice().sort((a, b) => a[key] - b[key]);
  const first = sorted[0][key];
  const last = sorted[sorted.length - 1][key] + sorted[sorted.length - 1][dim];
  const totalDim = sorted.reduce((s, o) => s + o[dim], 0);
  const gap = (last - first - totalDim) / (sorted.length - 1);
  let cursor = first;
  for (const o of sorted) { o[key] = cursor; cursor += o[dim] + gap; }
  commit('distribute');
}

/* keyboard helpers exported for main */
export { deleteSelection, orderChange };
