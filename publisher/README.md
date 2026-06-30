# Aperture Publisher

A browser-based **desktop-publishing app** that replicates the core of Affinity
Publisher — including **StudioLink** persona switching — with zero build step and
zero dependencies. Built for laying out long-form documents like an RPG rulebook.

![Publisher persona](docs/screenshot.png)

## Run it

It is a static ES-module app, so it needs to be served over HTTP (modules don't
load from `file://`):

```sh
cd publisher
python3 -m http.server 8099
# then open http://localhost:8099
```

Any static server works (`npx serve`, VS Code Live Server, etc.).

## StudioLink personas

The toolbar at the top switches the active **persona** without leaving the
document — the heart of Affinity's StudioLink. Each persona swaps the toolset and
panels while editing the *same* pages:

| Persona | Focus | Tools | Panels |
| --- | --- | --- | --- |
| **Publisher** | Page layout & text | Move, Text Frame, Picture Frame, Rect, Ellipse, Line, **Link Text Frames** | Transform, Pages, Layers, Text & Styles, Color |
| **Designer** | Vector drawing | Move, Node, Rect, Ellipse, Line, Pen, Text | Transform, **Arrange & Align**, Layers, Color |
| **Photo** | Raster images | Move, Picture Frame, Crop, Adjust | Transform, **Image Adjustments**, Layers |

Switch with the buttons or keys **1 / 2 / 3**.

## Features

- **Document & pages** — facing-page spreads, multiple page sizes (A4, Letter,
  6×9 trade, digest…), margins, bleed, and multi-column page guides.
- **Master pages** — edit a master, apply it to pages, with **automatic page
  numbers** that update per page.
- **Text frames** — multi-column text, paragraph styles, and **linked text flow
  (threading)**: link frames with the chain tool and a story flows column-to-column
  and frame-to-frame. Lightweight markup — start a line with `# ` or `## ` for
  headings — lets one story mix styles.
- **Paragraph styles** — apply, create-from-frame, and redefine; full character
  controls (font, size, leading, tracking, alignment incl. justify, colour).
- **Vector objects** — rectangles (with corner radius), ellipses, lines, with
  fill/stroke and per-object opacity.
- **Picture frames** — place images, fit modes (cover/contain/fill), and Photo
  persona adjustments (brightness/contrast/saturation/grayscale).
- **Layers** — visibility, lock, naming, plus object stacking order.
- **Transform** — precise X/Y/W/H, rotation, and on-canvas move/resize/rotate with
  snapping to margins and page guides.
- **Arrange** — align and distribute multiple objects.
- **Color & swatches** — swatch grid, custom picker, fill/stroke targeting.
- **Undo/redo**, rulers, zoom/pan, and a marquee selection.
- **I/O** — save/open native `.apub` projects (JSON), and export the current
  spread to **PNG** or **SVG**, or the whole document to **PDF** (via print).

## Keyboard shortcuts

| | |
| --- | --- |
| `V` Move · `T` Text · `P` Picture · `M` Rect · `L` Ellipse · `\` Line · `K` Link frames | tools (per persona) |
| `1` / `2` / `3` | Publisher / Designer / Photo persona |
| `Ctrl/Cmd Z` · `Ctrl/Cmd Shift Z` | undo / redo |
| `Ctrl/Cmd S` · `Ctrl/Cmd O` | save / open |
| `Ctrl/Cmd =` · `Ctrl/Cmd -` · `F` | zoom in / out / fit |
| `Delete` | delete selection |
| Arrows (`Shift` = ×10) | nudge selection |
| `PageUp` / `PageDown` | previous / next spread |
| `[` / `]` | send backward / bring forward |
| Drag · double-click text · hold `Space` to pan · `Ctrl`+wheel to zoom | canvas |

## Linked text flow, quickly

1. Draw two (or more) **Text Frames** with the Text tool.
2. Pick the **Link Text Frames** tool (chain icon, `K`).
3. Click the first frame, then the second — overflowing text now flows into it.
   Repeat to thread a chapter across as many frames/pages as you like.

## Architecture

Plain ES modules, no framework:

| File | Responsibility |
| --- | --- |
| `src/store.js` | App state, spreads/derived selectors, undo-redo history |
| `src/model.js` | Document/object factories, presets, default styles |
| `src/personas.js` | StudioLink personas and tool definitions |
| `src/textlayout.js` | Wrapping, columns, paragraph styles, threading |
| `src/renderer.js` | Canvas drawing, hit-testing, selection chrome |
| `src/interaction.js` | Pointer tools: select/move/resize/rotate/create/thread/edit |
| `src/panels.js` | Persona switcher, tool strip, context bar, studio panels |
| `src/io.js` | Save/open and PNG/SVG/PDF export |
| `src/main.js` | Bootstrap, rulers, keyboard, render loop |

> This app is standalone and not connected to the spreadsheet tools elsewhere in
> this repo; it lives here as the eventual layout tool for the rulebook project.
