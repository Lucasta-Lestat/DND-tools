// Document-wide find & replace over text frames and table cells.
// Matches are highlighted in place by opening the editor on the match and
// selecting it, while keeping focus in the find bar so Enter repeats the search.
import { store, begin, commit, emit, findObject } from './store.js';
import {
  goToPageNumber, startTextEdit, startCellEdit, commitTextEdit, setBlurSuppressed,
} from './interaction.js';
import { tableChainOf, tableFrameLayout, findOnSpread, tableContentHeight } from './renderer.js';

const editorEl = () => document.getElementById('text-editor');
const state = { query: '', replace: '', matchCase: false, matches: [], idx: -1 };
let bar = null;
const els = {};

export function initFind() { buildBar(); }
export function isFindOpen() { return !!bar && bar.classList.contains('open'); }

export function toggleFind(withReplace) {
  if (!bar) buildBar();
  if (isFindOpen() && (!withReplace || els.rep === document.activeElement || els.find === document.activeElement)) {
    // already open — just refocus
    els.find.focus(); els.find.select();
    return;
  }
  bar.classList.add('open');
  const focusEl = withReplace ? els.rep : els.find;
  focusEl.focus(); focusEl.select();
  computeMatches(); updateCount();
}

export function closeFind() {
  if (!bar) return;
  bar.classList.remove('open');
  setBlurSuppressed(false);
  commitTextEdit();
  store.ui.selection = store.ui.selection; // no-op; keep selection
  emit();
}

/* ---------- matching ---------- */
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function indicesOf(hay, needle, matchCase) {
  if (!needle) return [];
  const h = matchCase ? hay : hay.toLowerCase();
  const n = matchCase ? needle : needle.toLowerCase();
  const out = []; let i = 0;
  while ((i = h.indexOf(n, i)) !== -1) { out.push(i); i += n.length; }
  return out;
}

function textHeads() {
  const out = [];
  store.doc.pages.forEach((p, i) => { for (const o of p.objects) if (o.type === 'text' && !o.threadPrev && !o.field) out.push({ o, page: i + 1 }); });
  return out;
}
function tableHeads() {
  const out = [];
  store.doc.pages.forEach((p, i) => { for (const o of p.objects) if (o.type === 'table' && !o.threadPrev) out.push({ o, page: i + 1 }); });
  return out;
}

function computeMatches() {
  const q = state.query;
  const ms = [];
  if (q) {
    for (const { o, page } of textHeads()) for (const index of indicesOf(o.text || '', q, state.matchCase)) ms.push({ objId: o.id, kind: 'text', page, index });
    for (const { o, page } of tableHeads()) (o.rows || []).forEach((row, r) => row.forEach((cell, c) => {
      for (const index of indicesOf(String(cell == null ? '' : cell), q, state.matchCase)) ms.push({ objId: o.id, kind: 'cell', r, c, page, index });
    }));
  }
  ms.sort((a, b) => a.page - b.page);
  state.matches = ms;
  if (state.idx >= ms.length) state.idx = ms.length - 1;
}

/* ---------- navigation & highlight ---------- */
function pageNumberOfObject(objId) {
  for (let i = 0; i < store.doc.pages.length; i++) if (store.doc.pages[i].objects.some((o) => o.id === objId)) return i + 1;
  return 1;
}

// Which frame of a (possibly threaded) table displays a given global row, plus the cell rect.
function displayFrameForRow(head, r, c) {
  for (const frame of tableChainOf(head)) {
    const L = tableFrameLayout(frame);
    const vr = L.visualRows.find((v) => v.globalIndex === r);
    if (vr) return { frame, cell: { r, c, x: L.colX[c], y: vr.y, w: L.colW[c], h: vr.h, headId: head.id } };
  }
  return { frame: head, cell: null };
}

function selectRange(start, len) {
  const e = editorEl();
  if (store.ui.editingTextId) { try { e.setSelectionRange(start, start + len); } catch (_) {} }
}

function highlight(m) {
  commitTextEdit();            // close the previous match's editor
  setBlurSuppressed(true);     // keep the new editor open while focus returns to the bar
  if (m.kind === 'text') {
    goToPageNumber(m.page, m.objId);
    startTextEdit(m.objId);
    selectRange(m.index, state.query.length);
  } else {
    const rec = findObject(m.objId);
    if (rec) {
      const { frame, cell } = displayFrameForRow(rec.obj, m.r, m.c);
      goToPageNumber(pageNumberOfObject(frame.id));
      const f = findOnSpread(frame.id);
      if (f && cell) { startCellEdit(f.obj, f.pl, cell); selectRange(m.index, state.query.length); }
      else { store.ui.selection = [frame.id]; emit(); }
    }
  }
  if (els.find) els.find.focus(); // blur is suppressed, so the editor stays open showing the match
  setBlurSuppressed(false);
}

export function findNext(dir = 1) {
  if (!isFindOpen()) { toggleFind(false); if (!state.query) return; }
  computeMatches();
  if (!state.matches.length) { state.idx = -1; updateCount(); return; }
  state.idx = ((state.idx + dir) % state.matches.length + state.matches.length) % state.matches.length;
  highlight(state.matches[state.idx]);
  updateCount();
}

/* ---------- replace ---------- */
function substringMatches(str, index) {
  const seg = str.substr(index, state.query.length);
  return state.matchCase ? seg === state.query : seg.toLowerCase() === state.query.toLowerCase();
}

function replaceCurrent() {
  if (!state.query) return;
  if (state.idx < 0 || !state.matches[state.idx]) { findNext(1); return; }
  const m = state.matches[state.idx];
  commitTextEdit();
  const rec = findObject(m.objId);
  if (rec) {
    begin('replace');
    if (m.kind === 'text') {
      const s = rec.obj.text || '';
      if (substringMatches(s, m.index)) rec.obj.text = s.slice(0, m.index) + state.replace + s.slice(m.index + state.query.length);
    } else {
      const cell = String(rec.obj.rows[m.r][m.c] == null ? '' : rec.obj.rows[m.r][m.c]);
      if (substringMatches(cell, m.index)) {
        rec.obj.rows[m.r][m.c] = cell.slice(0, m.index) + state.replace + cell.slice(m.index + state.query.length);
        if (!rec.obj.threadNext && !rec.obj.threadPrev) rec.obj.h = tableContentHeight(rec.obj);
      }
    }
    commit('replace');
  }
  computeMatches();
  if (state.matches.length) { state.idx = Math.min(state.idx, state.matches.length - 1); highlight(state.matches[state.idx]); }
  else state.idx = -1;
  updateCount();
}

function replaceAll() {
  if (!state.query) return;
  commitTextEdit();
  const re = new RegExp(escapeRegExp(state.query), state.matchCase ? 'g' : 'gi');
  let count = 0;
  begin('replace all');
  for (const { o } of textHeads()) {
    if (o.text) o.text = o.text.replace(re, () => { count++; return state.replace; });
  }
  for (const { o } of tableHeads()) {
    let changed = false;
    (o.rows || []).forEach((row) => row.forEach((cell, c) => {
      const s = String(cell == null ? '' : cell);
      const r2 = s.replace(re, () => { count++; return state.replace; });
      if (r2 !== s) { row[c] = r2; changed = true; }
    }));
    if (changed && !o.threadNext && !o.threadPrev) o.h = tableContentHeight(o);
  }
  commit('replace all');
  computeMatches();
  state.idx = -1;
  updateCount(`${count} replaced`);
}

/* ---------- UI ---------- */
function updateCount(msg) {
  if (!els.count) return;
  if (msg != null) { els.count.textContent = msg; return; }
  if (!state.query) els.count.textContent = 'Searches text frames and table cells.';
  else if (!state.matches.length) els.count.textContent = 'No matches';
  else els.count.textContent = `${state.idx >= 0 ? state.idx + 1 : '–'} of ${state.matches.length}`;
}

function mkBtn(label, title, onclick) {
  const b = document.createElement('button');
  b.textContent = label; if (title) b.title = title;
  // mousedown-preventDefault so clicking a button doesn't steal focus mid-highlight
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', onclick);
  return b;
}

function buildBar() {
  bar = document.createElement('div');
  bar.className = 'findbar';

  const findInput = document.createElement('input');
  findInput.type = 'text'; findInput.placeholder = 'Find';
  findInput.addEventListener('input', () => { state.query = findInput.value; state.idx = -1; computeMatches(); updateCount(); });
  findInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); findNext(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
  });

  const caseBtn = mkBtn('Aa', 'Match case', () => { state.matchCase = !state.matchCase; caseBtn.classList.toggle('on', state.matchCase); state.idx = -1; computeMatches(); updateCount(); });
  const prevBtn = mkBtn('‹', 'Previous (Shift+Enter)', () => findNext(-1));
  const nextBtn = mkBtn('›', 'Next (Enter)', () => findNext(1));

  const repInput = document.createElement('input');
  repInput.type = 'text'; repInput.placeholder = 'Replace with';
  repInput.addEventListener('input', () => { state.replace = repInput.value; });
  repInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); replaceCurrent(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
  });

  const repBtn = mkBtn('Replace', 'Replace current match', () => replaceCurrent());
  const allBtn = mkBtn('All', 'Replace all matches', () => replaceAll());
  const closeBtn = mkBtn('✕', 'Close (Esc)', () => closeFind());

  const row1 = document.createElement('div'); row1.className = 'fieldwrap';
  row1.append(findInput, caseBtn, prevBtn, nextBtn, closeBtn);
  const row2 = document.createElement('div'); row2.className = 'fieldwrap';
  row2.append(repInput, repBtn, allBtn);
  const count = document.createElement('div'); count.className = 'count';

  bar.append(row1, row2, count);
  document.getElementById('canvas-wrap').append(bar);
  els.find = findInput; els.rep = repInput; els.count = count;
  updateCount();
}
