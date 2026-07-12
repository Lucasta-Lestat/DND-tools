// StudioLink personas. Each persona exposes a focused toolset while editing
// the SAME document — switching does not convert or re-open anything.

export const PERSONAS = {
  publisher: {
    label: 'Publisher',
    color: '#2f81f7',
    blurb: 'Page layout, text frames, master pages, linked text flow.',
    tools: ['move', 'sep', 'text', 'pictureframe', 'table', 'toc', 'index', 'hexmap', 'sep', 'rect', 'ellipse', 'line', 'sep', 'thread', 'link'],
    panels: ['transform', 'hexmap', 'toc', 'index', 'table', 'links', 'pages', 'layers', 'textstyles', 'color'],
  },
  designer: {
    label: 'Designer',
    color: '#6b5bd6',
    blurb: 'Precise vector drawing, node editing, boolean shape ops.',
    tools: ['move', 'node', 'sep', 'rect', 'ellipse', 'line', 'pen', 'sep', 'text'],
    panels: ['transform', 'boolean', 'layers', 'color'],
  },
  photo: {
    label: 'Photo',
    color: '#3da3a3',
    blurb: 'Place and adjust raster images, filters, crop & fit.',
    tools: ['move', 'sep', 'pictureframe', 'crop', 'sep', 'adjust'],
    panels: ['transform', 'imageadjust', 'layers'],
  },
};

export const TOOLS = {
  move:         { icon: '✛', name: 'Move',          kbd: 'V', cursor: 'default' },
  node:         { icon: '⟡', name: 'Node',          kbd: 'A', cursor: 'crosshair' },
  text:         { icon: 'T', name: 'Text Frame',    kbd: 'T', cursor: 'text', create: 'text' },
  pictureframe: { icon: '▣', name: 'Picture Frame', kbd: 'P', cursor: 'crosshair', create: 'image' },
  rect:         { icon: '▭', name: 'Rectangle',     kbd: 'M', cursor: 'crosshair', create: 'rect' },
  ellipse:      { icon: '◯', name: 'Ellipse',       kbd: 'L', cursor: 'crosshair', create: 'ellipse' },
  line:         { icon: '╱', name: 'Line',          kbd: '\\', cursor: 'crosshair', create: 'line' },
  pen:          { icon: '✒', name: 'Pen',           kbd: 'N', cursor: 'crosshair', create: 'line' },
  thread:       { icon: '⛓', name: 'Link Text Frames', kbd: 'K', cursor: 'crosshair' },
  table:        { icon: '▦', name: 'Table',           kbd: 'B', cursor: 'crosshair', create: 'table' },
  toc:          { icon: '☰', name: 'Table of Contents', kbd: 'C', cursor: 'crosshair', create: 'toc' },
  index:        { icon: '≔', name: 'Index',           kbd: 'X', cursor: 'crosshair', create: 'index' },
  hexmap:       { icon: '⬡', name: 'Hex Map',         kbd: 'G', cursor: 'crosshair', create: 'hexmap' },
  link:         { icon: '🔗', name: 'Hyperlink / Cross-reference', kbd: 'H', cursor: 'pointer' },
  crop:         { icon: '⌗', name: 'Crop / Fit',    kbd: 'C', cursor: 'crosshair' },
  adjust:       { icon: '◐', name: 'Adjust Image',  kbd: 'J', cursor: 'default' },
};
