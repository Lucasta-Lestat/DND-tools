// Central application state + undo/redo history.
// `doc` is the serializable document; `ui` is transient editor state (not undoable).

const subscribers = new Set();

export const store = {
  doc: null,
  ui: {
    persona: 'publisher',
    tool: 'move',
    spreadIndex: 0,     // index into the list of spreads
    selection: [],      // array of object ids on the active spread
    zoom: 1,
    pan: { x: 0, y: 0 },
    showGuides: true,
    showMargins: true,
    snap: true,
    editingTextId: null,
    fillTarget: 'fill', // which attribute swatches apply to: 'fill' | 'stroke'
    masterEdit: null,   // master id currently being edited, or null for normal pages
  },
  history: { past: [], future: [], limit: 80 },
};

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function emit() {
  for (const fn of subscribers) fn(store);
}

// Snapshot the document for history.
function snapshot() {
  return JSON.stringify(store.doc);
}

let pendingLabel = null;
let lastSnapshot = null;

// Begin a mutation; pair with commit(). Captures the pre-state once.
export function begin(label) {
  if (lastSnapshot === null) {
    lastSnapshot = snapshot();
    pendingLabel = label;
  }
}

// Commit current doc state to history and notify subscribers.
export function commit(label) {
  if (lastSnapshot === null) lastSnapshot = snapshot();
  const after = snapshot();
  if (after !== lastSnapshot) {
    store.history.past.push(lastSnapshot);
    if (store.history.past.length > store.history.limit) store.history.past.shift();
    store.history.future.length = 0;
  }
  lastSnapshot = null;
  pendingLabel = null;
  emit();
}

// Convenience: mutate + commit in one call.
export function mutate(label, fn) {
  begin(label);
  fn(store.doc);
  commit(label);
}

export function undo() {
  if (!store.history.past.length) return;
  store.history.future.push(snapshot());
  store.doc = JSON.parse(store.history.past.pop());
  clampUi();
  emit();
}

export function redo() {
  if (!store.history.future.length) return;
  store.history.past.push(snapshot());
  store.doc = JSON.parse(store.history.future.pop());
  clampUi();
  emit();
}

export function resetHistory() {
  store.history.past.length = 0;
  store.history.future.length = 0;
  lastSnapshot = null;
}

// Keep transient UI references valid after structural changes.
export function clampUi() {
  const spreads = getSpreads();
  if (store.ui.spreadIndex >= spreads.length) store.ui.spreadIndex = Math.max(0, spreads.length - 1);
  store.ui.selection = store.ui.selection.filter((id) => findObject(id));
}

/* ---------- derived helpers ---------- */

// A spread is one or two facing pages rendered side by side.
export function getSpreads() {
  const d = store.doc;
  if (!d) return [];
  if (store.ui.masterEdit) {
    const m = d.masters.find((x) => x.id === store.ui.masterEdit);
    return m ? [{ pages: [m], master: true }] : [];
  }
  const facing = d.settings.facing;
  const pages = d.pages;
  if (!facing) return pages.map((p) => ({ pages: [p] }));
  const spreads = [];
  // First page sits alone on the right (recto), then pairs.
  let i = 0;
  spreads.push({ pages: [pages[0]] });
  i = 1;
  while (i < pages.length) {
    spreads.push({ pages: pages.slice(i, i + 2) });
    i += 2;
  }
  return spreads;
}

export function activeSpread() {
  return getSpreads()[store.ui.spreadIndex];
}

// Every object across master + page, with its owning page, for the active spread.
export function spreadObjects() {
  const sp = activeSpread();
  if (!sp) return [];
  const out = [];
  for (const page of sp.pages) {
    const master = !sp.master && page.masterId ? store.doc.masters.find((m) => m.id === page.masterId) : null;
    if (master && page.showMaster !== false) {
      for (const o of master.objects) out.push({ obj: o, page, fromMaster: true });
    }
    for (const o of page.objects) out.push({ obj: o, page, fromMaster: false });
  }
  return out;
}

export function findObject(id) {
  if (!store.doc) return null;
  const containers = [...store.doc.pages, ...store.doc.masters];
  for (const c of containers) {
    const o = c.objects.find((x) => x.id === id);
    if (o) return { obj: o, container: c };
  }
  return null;
}

export function selectedObjects() {
  return store.ui.selection.map(findObject).filter(Boolean).map((r) => r.obj);
}

export function layerById(id) {
  return store.doc.layers.find((l) => l.id === id);
}
