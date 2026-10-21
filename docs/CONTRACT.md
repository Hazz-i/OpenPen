# Pen clone — build contract

A lightweight web clone of the **pen.dev (Pencil) desktop app 1.2.18**.
Original is Electron + React + WASM. We rebuild the product surface as a dependency-free
Canvas2D web app: **Vite + TypeScript only, zero runtime dependencies**.

## Ownership (do not edit other lanes' files)

- Orchestrator: `index.html`, `src/main.ts`, `src/core/types.ts`, `src/core/store.ts`,
  `src/core/geometry.ts`, `package.json`, `tsconfig.json`
- Core lane (fixer): `src/core/format.ts`, `src/core/samples.ts`, `src/core/storage.ts`
- UI lane (designer): `src/styles/*.css`, `src/ui/*.ts` (dashboard, editor, canvas,
  layers, inspector, toolbar, agent, thumbnail)

## Visual reference (read these images)

- `/tmp/opencode/ui-dashboard.png` — dashboard
- `/tmp/opencode/ui-editor2.png` / `ui-canvas2.png` — editor
- `/tmp/opencode/ui-layers2.png` — layers tab
- `/tmp/opencode/ui-props.png` — inspector with a frame selected
- `/tmp/opencode/ui-tree2.png` — group selected + inspector bottom

Theme tokens measured from the running app:

```
--bg: #18181b          app / dashboard background
--panel: #141414       bars, side panels, cards
--input: #1f1f1f       field / hover surface
--border: #202020      hairline borders
--border-strong: #2a2a2a
--fg: #c8c8c8          body text
--fg-strong: #f4f4f5   headings, filenames
--muted: #a1a1aa
--faint: #71717a
--accent: #3d99ff      selection blue
--warning: #f99c00     unsaved pill
--radius: 10px
font: ui-sans-serif, -apple-system, system-ui, "Segoe UI", Helvetica, Arial
```

Canvas backdrop `#1d1d1f`; artboards are document content (often `#E7E8E5`).
Top bar is 44 px tall. Editor left panel 320 px wide with 8 px margin, rounded 12 px.
Tool rail is a 32 px floating rounded panel. Inspector 216 px wide, rounded 12 px, 8 px margin.
Bottom-left breadcrumb pill and bottom-right zoom pill float over the canvas.

## Document model

`src/core/types.ts` is the contract; it mirrors the real `.pen` v2 schema subset.
`src/core/store.ts` exports `EditorStore`, `uid`, `num`, tree helpers and absolute bounds.
`src/core/geometry.ts` exports `layoutDocument`, `hitTest`, `resizeRect`, `handlePoint`,
`findLaidOut`, `rectContains`, `unionRects`.

Do not change these three files. If an API is missing, implement a local helper.

## Core lane deliverables

`src/core/format.ts`
- `PEN_VERSION = '2.21'`
- `parsePenFile(text: string): PenDocument` — tolerant JSON parse, fills version/children
  defaults, drops unknown node types safely, never throws (throw only for non-JSON).
- `serializePenFile(doc: PenDocument): string` — pretty JSON, stable key order not required.
- `createBlankDocument(): PenDocument` — one 800×600 frame named “Frame”, fill `#FFFFFF`.
- `createNode(type, x, y, width, height): PenNode` — sane defaults for
  frame/rectangle/ellipse/text/polygon/path; text gets content "Text", fontSize 16.
- `hydrateDocument(doc)`: assign missing ids, ensure arrays, clamp obvious invalids.

`src/core/samples.ts`
- `export const SAMPLES: { id, name, doc, prompt }[]` with at least:
  `welcome` (a beautiful 1000×1458 intro artboard, see /tmp/opencode/pen-asar/out/data/pencil-welcome.pen),
  `landing`, `mobile`, `dashboard`, `slides`.
- `generateFromPrompt(prompt: string): { doc: PenDocument; name: string }` — offline
  keyword routing to those templates (landing/mobile/dashboard/slides/design system/types).
- Designs must look genuinely good: real type scale, spacing, composition, realistic copy.
  Use only frame/rectangle/ellipse/path/text nodes. No external images/fonts.
- Export `WELCOME_DOC = SAMPLES[0].doc`.

`src/core/storage.ts`
- localStorage keys prefixed `penclone.`
- `listRecents(): StoredFile[]` sorted by `updatedAt` desc.
- `saveRecent(file: StoredFile)`, `deleteRecent(id)`, `getRecent(id)`.
- `saveAutosave(name, doc, thumbnail?)`, `loadAutosave()`, `clearAutosave()`.
- `StoredFile = { id, name, updatedAt, doc, thumbnail? }`; cap 12 recents.
- Never throw when localStorage is unavailable/quota exceeded.

Core lane must finish with `npx tsc --noEmit` clean.

## UI lane deliverables

All visual quality is owned here. Implement the following exports:

`src/ui/thumbnail.ts`
- `renderThumbnail(doc: PenDocument, cssWidth: number, cssHeight: number): string`
  returns a PNG data URL using an offscreen canvas, dark backdrop, centered doc content.

`src/ui/dashboard.ts`
- `mountDashboard(root: HTMLElement, opts: { onOpen(file: StoredFile): void; onCreate(kind?: string): void; onOpenFile(): void }): { destroy(): void }`
- Faithful layout: left sidebar 216 px (wordmark, Recents/Drafts, TEMPLATES/Design Systems);
  top bar (Dashboard, Open File, + New File); centered column max 840 px with template chips,
  large prompt composer, three import cards, RECENTS grid with preview cards and view toggle.
- Prompt send → `generateFromPrompt`, then `onOpen({doc,...})`; show a brief generating state.
- Recent cards render thumbnails via `renderThumbnail` when `thumbnail` is absent; open on click,
  have a “…” menu with Delete.
- Fully responsive down to 1024 px. No dead buttons: chips select style, New File creates blank,
  Open File triggers `onOpenFile`.

`src/ui/canvas.ts`
- `class CanvasView { constructor(container: HTMLElement, store: EditorStore); render(): void; zoomToFit(): void; destroy(): void; }`
- Full canvas interaction engine as specified in “Canvas behaviour”.

`src/ui/layers.ts`, `src/ui/inspector.ts`, `src/ui/toolbar.ts`, `src/ui/agent.ts`
- Each exports a factory `create…(store, opts)` returning `{ el: HTMLElement; refresh(): void; destroy?(): void }`.
  (Inspector opts include `onExportHtml(nodeId)`, `onCopyHtml(nodeId)`; implement those in editor.)

`src/ui/editor.ts`
- `mountEditor(root: HTMLElement, opts: { store: EditorStore; onExit(): void; onSave(): void; onSaveAs(): void; onOpenFile(): void }): { destroy(): void }`
- Assembles top bar, left tab panel (Agent / Layers / Slides / Components / Libraries),
  tool rail, canvas, inspector, breadcrumb, zoom pill.
- Payload of agent tab must be honest: a visible “local demo” note, no real network calls.
- Wire keyboard shortcuts, undo/redo, autosave status, title “name — Edited”, tabs switching,
  panel collapse, inspect-on-select, export/copy HTML for selected frame.
- `onExportHtml` / `onCopyHtml` produce a simple absolutely-positioned HTML renderer for a subtree.

## Canvas behaviour (MVP, must actually work)

- Render document via Canvas2D with DPR scaling; preserve `rotation`, `opacity`, solid fills,
  linear gradients, strokes, corner radius, `clip` on frames, text wrapping and line height.
- Pan: space+drag, Hand tool, middle mouse, trackpad two-finger (wheel without modifier).
- Zoom: ctrl/cmd+wheel and pinch around cursor; zoom pill +/−; `Shift+1` fit; clamp 2%–1600%.
- Select: click topmost leaf; shift-click multi; marquee on empty canvas; Alt-click selects parent.
- Move by drag; resize with 8 handles; shift keeps aspect; arrow keys nudge (shift = 10px).
- Create rectangle/ellipse/frame/text by dragging with the matching tool; text tool click creates text.
- Double-click text → inline textarea overlay, Enter/blur commits, Escape cancels.
- Delete/Backspace removes; Ctrl/Cmd+D duplicates; Ctrl/Cmd+Z / Shift+Z / Y undo-redo.
- Hover outline; selection outline `#3d99ff` 1px + white handle squares with blue border.
- Show frame name above top-level frames when selected or at low zoom (subtle, `#8a8a8a`).
- Cursor feedback per tool; disable browser context menu on canvas; wheel listeners passive:false.

## Rules

- No npm runtime deps. Inline SVG icons only (lucide-style, 1.75 stroke).
- No external fonts or network requests.
- Keep bundle lean: no framework, no canvas library.
- TypeScript strict, `npx tsc --noEmit` must pass.
- Match the reference screenshots closely; measure spacing instead of guessing.
