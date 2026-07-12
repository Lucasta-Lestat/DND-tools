// App bootstrap: build the default document, wire panels, canvas, rulers,
// keyboard shortcuts, menu actions, and the render loop.
import { store, subscribe, emit, begin, commit, findObject, undo, redo, resetHistory, getSpreads } from './store.js';
import { newDocument, baseText, makeTable, makeToc, makeIndex, uid } from './model.js';
import { collectHeadings, collectIndex } from './textlayout.js';
import { PERSONAS, TOOLS } from './personas.js';
import {
  resizeCanvas, drawScene, fitView, getView, screenToDoc, tocContentHeight, indexContentHeight,
} from './renderer.js';
import {
  initInteraction, repositionEditorIfOpen, commitTextEdit, startTextEdit,
} from './interaction.js';
import {
  renderPersonas, renderToolstrip, renderContextbar, renderStudio, renderStatusbar,
  deleteSelection, orderChange,
} from './panels.js';
import {
  saveProject, openProjectFile, placeImageFile, exportPNG, exportSVG, exportPDF,
} from './io.js';
import { initFind, toggleFind, findNext, closeFind, isFindOpen } from './find.js';

let lastCursor = null;

/* ---------- render loop ---------- */
function renderAll() {
  if (!store.doc) return;
  renderPersonas();
  renderToolstrip();
  renderContextbar();
  renderStudio();
  renderStatusbar(lastCursor);
  drawScene();
  drawRulers();
  repositionEditorIfOpen();
}

/* ---------- rulers ---------- */
function drawRulers() {
  const top = document.getElementById('ruler-top');
  const left = document.getElementById('ruler-left');
  const view = getView();
  const dpr = window.devicePixelRatio || 1;
  for (const [canvas, horizontal] of [[top, true], [left, false]]) {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, rect.width * dpr);
    canvas.height = Math.max(1, rect.height * dpr);
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, rect.width, rect.height);
    g.fillStyle = '#25282d'; g.fillRect(0, 0, rect.width, rect.height);
    g.fillStyle = '#8d949e'; g.strokeStyle = '#454b54'; g.font = '9px system-ui'; g.lineWidth = 1;
    const zoom = store.ui.zoom;
    const pan = horizontal ? store.ui.pan.x : store.ui.pan.y;
    const length = horizontal ? rect.width : rect.height;
    const step = niceStep(zoom);
    const startDoc = Math.floor((-pan / zoom) / step) * step;
    for (let d = startDoc; d * zoom + pan < length; d += step) {
      const s = d * zoom + pan;
      if (s < 0) continue;
      g.beginPath();
      if (horizontal) { g.moveTo(s, rect.height); g.lineTo(s, rect.height - 7); }
      else { g.moveTo(rect.width, s); g.lineTo(rect.width - 7, s); }
      g.stroke();
      if (horizontal) g.fillText(String(Math.round(d)), s + 2, 9);
      else { g.save(); g.translate(9, s + 2); g.rotate(-Math.PI / 2); g.fillText(String(Math.round(d)), 0, 0); g.restore(); }
    }
  }
}
function niceStep(zoom) {
  const target = 64; // px between labels
  const raw = target / zoom;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (pow * m >= raw) return pow * m;
  return pow * 10;
}

/* ---------- cursor status ---------- */
window.addEventListener('cursor-move', (e) => {
  lastCursor = e.detail;
  renderStatusbar(lastCursor);
});

/* ---------- menu actions ---------- */
function bindMenu() {
  document.getElementById('menubar').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const a = btn.dataset.action;
    if (a === 'new') newDoc();
    else if (a === 'find') toggleFind(false);
    else if (a === 'open') document.getElementById('file-open').click();
    else if (a === 'save') saveProject();
    else if (a === 'undo') undo();
    else if (a === 'redo') redo();
    else if (a === 'export-png') exportPNG(3);
    else if (a === 'export-svg') exportSVG();
    else if (a === 'export-pdf') exportPDF();
  });
  document.getElementById('file-open').addEventListener('change', (e) => {
    if (e.target.files[0]) openProjectFile(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('file-image').addEventListener('change', (e) => {
    if (e.target.files[0]) placeImageFile(e.target.files[0]);
    e.target.value = '';
  });
}

function newDoc() {
  if (store.doc && !confirm('Start a new document? Unsaved changes will be lost.')) return;
  store.doc = seedDocument();
  store.ui.selection = [];
  store.ui.spreadIndex = 0;
  store.ui.masterEdit = null;
  resetHistory();
  fitView();
  emit();
}

// A starter document with a little sample content to show the features off.
function seedDocument() {
  const doc = newDocument({ title: 'My Rulebook', preset: '6x9 Trade Book', facing: true });
  doc.settings.columns = 2;
  const layerId = doc.layers[0].id;
  const page = doc.pages[0];

  const title = baseText(layerId);
  Object.assign(title, {
    x: 54, y: 80, w: doc.settings.pageWidth - 94, h: 120,
    text: '# The Veins Below\n\nA pocket bestiary & travel guide for the deep places of the earth.',
    paraStyleId: doc.paragraphStyles.find((p) => p.name === 'Title').id,
  });
  // copy style attrs onto the frame so editing reflects it
  const ts = doc.paragraphStyles.find((p) => p.name === 'Title');
  Object.assign(title, { fontFamily: ts.fontFamily, size: ts.size, color: ts.color, bold: ts.bold, italic: ts.italic, align: 'left', lineHeight: ts.lineHeight });

  const body = baseText(layerId);
  Object.assign(body, {
    x: 54, y: 230, w: doc.settings.pageWidth - 94, h: doc.settings.pageHeight - 230 - 60,
    columns: 2, columnGap: 16, align: 'justify', size: 10, color: '#222',
    fontFamily: 'Georgia, serif', lineHeight: 1.4,
    text: SAMPLE_BODY,
  });
  page.objects.push(title, body);

  // Page 2: a roll table, anchored so the body can cross-reference its page.
  const p2 = doc.pages[1];
  const tableHead = baseText(layerId);
  Object.assign(tableHead, {
    x: 54, y: 70, w: doc.settings.pageWidth - 94, h: 40,
    text: '## Wandering Encounters', size: 15, color: '#7a2d1f', bold: true,
    fontFamily: 'Georgia, serif',
  });
  const table = makeTable(layerId);
  Object.assign(table, {
    x: 54, y: 110, w: doc.settings.pageWidth - 94,
    anchorName: 'wandering-table',
    colWeights: [1, 4],
    rows: [
      ['d8', 'You encounter…'],
      ['1–2', 'A blind cartographer reciting a map aloud'],
      ['3–4', 'Knotsmen collecting a debt of stories'],
      ['5', 'A bloom of funginids sharing poisoned bread'],
      ['6', 'A river of pale eels flowing uphill'],
      ['7', 'The echo of a city that has not been built yet'],
      ['8', 'Something that has been following you for a day'],
    ],
  });
  table.h = 7 * (table.size * table.lineHeight + table.padding * 2);
  table.indexTerms = ['Wandering Encounters', 'encounters'];
  p2.objects.push(tableHead, table);

  // Front matter: a generated table of contents on its own page (page 1),
  // which pushes the chapters to pages 2–3 — note the live page numbers.
  const tocPage = { id: uid('P'), masterId: doc.masters[0].id, showMaster: true, objects: [] };
  doc.pages.unshift(tocPage);
  const toc = makeToc(layerId);
  Object.assign(toc, { x: 54, y: 80, w: doc.settings.pageWidth - 94 });
  const heads = collectHeadings(doc);
  toc.entries = heads.filter((h) => toc.levels.includes(h.level)).map((h) => ({ text: h.text, level: h.level, page: h.page }));
  toc.h = tocContentHeight(toc);
  tocPage.objects.push(toc);

  // Back matter: a generated index on the final page.
  const indexPage = { id: uid('P'), masterId: doc.masters[0].id, showMaster: true, objects: [] };
  doc.pages.push(indexPage);
  const index = makeIndex(layerId);
  Object.assign(index, { x: 54, y: 80, w: doc.settings.pageWidth - 94, columns: 2 });
  index.entries = collectIndex(doc);
  index.h = indexContentHeight(index);
  indexPage.objects.push(index);
  return doc;
}

const SAMPLE_BODY = `## On the Dark

Far beneath the roots of mountains the Dark{index:Dark, the} is not an absence of light but a presence of its own. It presses. It listens. Those who travel here learn quickly that a torch is a confession, and that silence is a currency more dear than gold.

This guide collects what little is known of the peoples and perils of the under-realms. Treat every entry as rumour sharpened to the edge of fact. A day below covers perhaps 12 miles, and a guttering torch throws light just 30 ft into the pressing dark.

### The Knotsmen

A guild of rope-priests{index:Knotsmen}{index:rope-priests} who believe the world is a single vast knot slowly tying itself tighter. They map the tunnels in cord and memory, and will trade safe passage for a true story you have never told anyone.

### Funginids

Not one creature but a parliament of spores{index:Funginids}{index:spores} wearing the shape of a person. They are unfailingly polite. They are always hungry. Do not eat their bread.

When the dark grows restless, roll on the Wandering Encounters table (see page {page:wandering-table}). The page number in that reference updates itself if the table ever moves.

Start a new paragraph and it flows down the first column, then into the second, and onward into any frame you link with the Link Text Frames tool. This is the same threaded text flow you would use to lay out a chapter across many pages.`;

/* ---------- keyboard ---------- */
function bindKeys() {
  window.addEventListener('keydown', (e) => {
    const typing = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); return; }
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); document.getElementById('file-open').click(); return; }
    if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFind(false); return; }
    if (mod && e.key.toLowerCase() === 'h') { e.preventDefault(); toggleFind(true); return; }
    if (mod && e.key.toLowerCase() === 'g') { e.preventDefault(); findNext(e.shiftKey ? -1 : 1); return; }
    if (e.key === 'F3') { e.preventDefault(); findNext(e.shiftKey ? -1 : 1); return; }
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); store.ui.zoom = Math.min(8, store.ui.zoom * 1.2); emit(); return; }
    if (mod && e.key === '-') { e.preventDefault(); store.ui.zoom = Math.max(0.05, store.ui.zoom / 1.2); emit(); return; }

    if (typing) return;

    if (e.key === 'Escape' && isFindOpen()) { closeFind(); return; }

    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
    if (e.key === 'Escape') { store.ui.selection = []; emit(); return; }
    if (e.key === 'f' || e.key === 'F') { fitView(); emit(); return; }
    if (e.key === '[') { orderChange('backward'); return; }
    if (e.key === ']') { orderChange('forward'); return; }

    // arrow nudge
    if (e.key.startsWith('Arrow') && store.ui.selection.length) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
      const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
      nudge(dx, dy);
      return;
    }
    // page navigation
    if (e.key === 'PageDown') { store.ui.spreadIndex = Math.min(getSpreads().length - 1, store.ui.spreadIndex + 1); store.ui.selection = []; fitView(); emit(); return; }
    if (e.key === 'PageUp') { store.ui.spreadIndex = Math.max(0, store.ui.spreadIndex - 1); store.ui.selection = []; fitView(); emit(); return; }

    // tool shortcuts within the active persona
    const persona = PERSONAS[store.ui.persona];
    for (const t of persona.tools) {
      if (t === 'sep') continue;
      if (TOOLS[t].kbd.toLowerCase() === e.key.toLowerCase()) { store.ui.tool = t; emit(); return; }
    }
    // persona shortcuts: 1/2/3
    if (e.key === '1') { setPersona('publisher'); }
    else if (e.key === '2') { setPersona('designer'); }
    else if (e.key === '3') { setPersona('photo'); }
  });
}

function setPersona(id) {
  store.ui.persona = id;
  const tools = PERSONAS[id].tools.filter((t) => t !== 'sep');
  if (!tools.includes(store.ui.tool)) store.ui.tool = tools[0];
  emit();
}

function nudge(dx, dy) {
  begin('nudge');
  for (const id of store.ui.selection) {
    const f = findObject(id); if (f) { f.obj.x += dx; f.obj.y += dy; }
  }
  commit('nudge');
}

/* ---------- boot ---------- */
function boot() {
  store.doc = seedDocument();
  resetHistory();
  subscribe(renderAll);
  initInteraction(emit);
  initFind();
  bindMenu();
  bindKeys();

  const ro = new ResizeObserver(() => { resizeCanvas(); fitView(); emit(); });
  ro.observe(document.getElementById('scene'));

  resizeCanvas();
  fitView();
  emit();
}

boot();
