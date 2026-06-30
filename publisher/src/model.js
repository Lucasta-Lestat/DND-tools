// Document model factories and defaults.

let idCounter = 1;
export function uid(prefix = 'o') {
  return `${prefix}${(idCounter++).toString(36)}${Math.floor(performance.now() % 1000).toString(36)}`;
}

// Common page presets in points (1pt = 1/72").
export const PAGE_PRESETS = {
  'A4 Portrait': { w: 595, h: 842 },
  'A4 Landscape': { w: 842, h: 595 },
  'A5 Portrait': { w: 420, h: 595 },
  'US Letter': { w: 612, h: 792 },
  'US Half-Letter (Digest)': { w: 396, h: 612 },
  '6x9 Trade Book': { w: 432, h: 648 },
  'Square 210mm': { w: 595, h: 595 },
};

export const DEFAULT_SWATCHES = [
  '#000000', '#ffffff', '#e0654a', '#e7a13d', '#e7cf3d', '#7bbf57',
  '#3da3a3', '#2f81f7', '#6b5bd6', '#b455c9', '#c94f7c', '#8d949e',
  '#2c2018', '#5a3d2b', '#8a6d4f', '#c9b08a', '#f0e6d2', '#1d1f23',
];

export function newDocument(opts = {}) {
  const preset = opts.preset || '6x9 Trade Book';
  const dim = PAGE_PRESETS[preset];
  const layerId = uid('L');
  const masterId = uid('M');

  const doc = {
    meta: { title: opts.title || 'Untitled Rulebook', created: 'now' },
    settings: {
      preset,
      pageWidth: dim.w,
      pageHeight: dim.h,
      facing: opts.facing ?? true,
      margins: { top: 54, bottom: 54, inside: 54, outside: 40 },
      bleed: 9,
      columns: 1,
      gutter: 14,
      units: 'pt',
    },
    layers: [
      { id: layerId, name: 'Layer 1', visible: true, locked: false },
    ],
    masters: [
      {
        id: masterId,
        name: 'A — Master',
        objects: [
          pageNumberField(dim, masterId, layerId),
        ],
      },
    ],
    pages: [
      makePage(masterId, layerId),
      makePage(masterId, layerId),
    ],
    swatches: DEFAULT_SWATCHES.slice(),
    paragraphStyles: defaultParagraphStyles(),
  };
  return doc;
}

export function makePage(masterId) {
  return { id: uid('P'), masterId, showMaster: true, objects: [] };
}

// An auto page-number text field placed in the footer of a master.
function pageNumberField(dim, masterId, layerId) {
  return {
    ...baseText(layerId),
    id: uid('o'),
    x: dim.w / 2 - 40,
    y: dim.h - 40,
    w: 80,
    h: 20,
    text: '#',
    field: 'pageNumber',
    align: 'center',
    size: 10,
    fill: null,
    color: '#444444',
    fontFamily: 'Georgia, serif',
  };
}

export function defaultParagraphStyles() {
  return [
    { id: uid('ps'), name: 'Title', fontFamily: 'Georgia, serif', size: 30, color: '#1d1f23', bold: true, italic: false, align: 'left', lineHeight: 1.1, spaceAfter: 10, tracking: 0 },
    { id: uid('ps'), name: 'Heading 1', fontFamily: 'Georgia, serif', size: 20, color: '#7a2d1f', bold: true, italic: false, align: 'left', lineHeight: 1.15, spaceAfter: 6, tracking: 0 },
    { id: uid('ps'), name: 'Heading 2', fontFamily: 'Georgia, serif', size: 15, color: '#7a2d1f', bold: true, italic: false, align: 'left', lineHeight: 1.2, spaceAfter: 4, tracking: .5 },
    { id: uid('ps'), name: 'Body', fontFamily: 'Georgia, serif', size: 10.5, color: '#222222', bold: false, italic: false, align: 'justify', lineHeight: 1.35, spaceAfter: 6, tracking: 0 },
    { id: uid('ps'), name: 'Stat Block', fontFamily: '"Courier New", monospace', size: 9.5, color: '#222222', bold: false, italic: false, align: 'left', lineHeight: 1.3, spaceAfter: 3, tracking: 0 },
    { id: uid('ps'), name: 'Caption', fontFamily: 'Georgia, serif', size: 8.5, color: '#666666', bold: false, italic: true, align: 'left', lineHeight: 1.25, spaceAfter: 4, tracking: 0 },
  ];
}

/* ---------- object factories ---------- */

function baseObject(layerId) {
  return {
    id: uid('o'),
    layerId,
    x: 0, y: 0, w: 100, h: 100,
    rotation: 0,
    opacity: 1,
    locked: false,
    name: '',
    link: null,        // { type:'page'|'anchor'|'url', target } — cross-reference / hyperlink
    anchorName: '',     // named destination this object can be linked to / referenced by
  };
}

export function baseText(layerId) {
  return {
    ...baseObject(layerId),
    type: 'text',
    text: 'Type here…',
    fontFamily: 'Georgia, serif',
    size: 10.5,
    color: '#1d1f23',
    bold: false, italic: false,
    align: 'left',
    lineHeight: 1.35,
    tracking: 0,
    columns: 1,
    columnGap: 14,
    padding: 4,
    fill: null,
    stroke: null,
    strokeWidth: 0,
    paraStyleId: null,
    threadNext: null,   // id of next frame in the text thread
    threadPrev: null,
    field: null,        // 'pageNumber' for auto fields
  };
}

export function makeShape(type, layerId, fill) {
  return {
    ...baseObject(layerId),
    type, // 'rect' | 'ellipse' | 'line'
    fill: fill ?? '#2f81f7',
    stroke: '#1d1f23',
    strokeWidth: type === 'line' ? 2 : 0,
    radius: 0, // corner radius for rect
  };
}

export function makeImage(layerId, src, naturalW, naturalH) {
  return {
    ...baseObject(layerId),
    type: 'image',
    src,
    naturalW, naturalH,
    fit: 'cover', // 'cover' | 'contain' | 'fill'
    fill: '#e9eaec',
    stroke: null,
    strokeWidth: 0,
    radius: 0,
  };
}

// A data table — ideal for random/roll tables (e.g. d20 → result).
export function makeTable(layerId) {
  return {
    ...baseObject(layerId),
    type: 'table',
    w: 240, h: 120,
    rows: [
      ['d20', 'Result'],
      ['1–5', 'Nothing of note'],
      ['6–14', 'A wandering encounter'],
      ['15–20', 'A strange discovery'],
    ],
    colWeights: [1, 3],     // relative column widths
    headerRow: true,
    fontFamily: 'Georgia, serif',
    size: 9.5,
    color: '#222222',
    align: 'left',
    lineHeight: 1.25,
    padding: 5,
    borderColor: '#5a3d2b',
    borderWidth: 1,
    headerFill: '#5a3d2b',
    headerColor: '#ffffff',
    zebra: '#f0e6d2',        // alternating row tint, or null
    fill: '#ffffff',
    stroke: null,
    strokeWidth: 0,
  };
}
