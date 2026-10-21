# Phase 2 — make it a real app, not a mockup

Phase 1 delivered the visual shell and a working canvas. Phase 2 adds the systems a
user actually needs: settings, file management, import/export, assets, menus, dialogs,
document operations, and functional side panels.

Same rules as `docs/CONTRACT.md`: no runtime deps, strict TS, match the reference UI.
File ownership is strict. Do not edit other lanes' files.

## Ownership

- Core lane (`fix-1`): `src/core/settings.ts`, `src/core/files.ts`, `src/core/exporters.ts`,
  `src/core/docops.ts`, `src/core/assets.ts`; may extend `src/core/storage.ts`.
- UI lane (`des-1`): every file in `src/ui/` and `src/styles/`.
- Orchestrator: `src/main.ts`, `src/core/{types,store,geometry}.ts`, configs.

If you need a core API that does not exist yet, code against the signatures below. They are
the contract.

---

# Core lane

### `src/core/settings.ts`

```ts
export interface AppSettings {
  theme: 'dark' | 'light' | 'system';
  accent: string;                 // hex, default '#3d99ff'
  canvasBackground: string;       // hex, default '#1d1d1f'
  showFrameNames: boolean;        // true
  showGrid: boolean;              // false
  gridSize: number;               // 8
  snapToObjects: boolean;         // true
  snapToGrid: boolean;            // false
  autosave: boolean;              // true
  autosaveDelay: number;          // 700
  defaultFont: string;            // 'Inter'
  defaultFontSize: number;        // 16
  exportScale: 1 | 2 | 3;         // 1
  reduceMotion: boolean;          // false
  units: 'px' | 'rem';            // 'px'
  agentModel: string;             // 'cmc/deepseek/deepseek-v4-pro'
  agentInstructions: string;      // ''
  confirmDelete: boolean;         // true
  language: 'en' | 'id';          // 'en'
}
export const DEFAULT_SETTINGS: AppSettings;
export function loadSettings(): AppSettings;
export function saveSettings(s: AppSettings): void;
export function resetSettings(): AppSettings;
/** Writes data-theme, accent and motion CSS vars on <html>. */
export function applySettings(s: AppSettings, root?: HTMLElement): void;
export function storageUsage(): { usedBytes: number; quotaBytes: number; recents: number; drafts: number };
export function clearAllData(): void;
```
Apply `data-theme="dark|light"` on `<html>`, set `--accent`, `--canvas-bg`,
`data-reduce-motion`, and `--grid-size`. Light theme must be a real, readable light palette.

### `src/core/files.ts`

```ts
export interface DiskFile { name: string; text: string; handle?: FileSystemFileHandle }
export function supportsFileSystemAccess(): boolean;
export async function openPenFileDialog(): Promise<DiskFile | null>;
export async function savePenFile(text: string, suggestedName: string, handle?: FileSystemFileHandle, forceDialog?: boolean): Promise<{ name: string; handle?: FileSystemFileHandle } | null>;
export function downloadText(text: string, filename: string, mime?: string): void;
export function downloadBlob(blob: Blob, filename: string): void;
export interface PickedImage { name: string; dataUrl: string; width: number; height: number; size: number }
export async function pickImageFile(): Promise<PickedImage | null>;
export function fileToDataUrl(file: File): Promise<string>;
export async function imageSize(dataUrl: string): Promise<{ width: number; height: number }>;
export async function readDroppedFiles(files: FileList | File[]): Promise<Array<{ kind: 'pen'; name: string; text: string } | { kind: 'image'; image: PickedImage } | { kind: 'unsupported'; name: string }>>;
```
Use File System Access API when present, otherwise input/download fallbacks. Declare any missing
DOM types locally instead of `any` where practical. Reject images > 8 MB.

### `src/core/exporters.ts`

```ts
export function nodeToSvg(node: PenNode, doc?: PenDocument): string;
export function documentToSvg(doc: PenDocument): string;
export function nodeToHtml(node: PenNode, opts?: { inline?: boolean }): string;
export function documentToHtml(doc: PenDocument): string;
export async function svgToPngBlob(svg: string, width: number, height: number, scale: number): Promise<Blob>;
export function downloadSvg(doc: PenDocument, node: PenNode | null, name: string): void;
export function downloadHtml(doc: PenDocument, node: PenNode | null, name: string): void;
export async function downloadPng(doc: PenDocument, node: PenNode | null, name: string, scale: number, background?: string): Promise<void>;
```
SVG output must include fills (solid/gradient/image), strokes, radii, rotation, opacity, text
(font family/size/weight/align/line-height), paths, ellipses, polygons and nested frames.
HTML output must be standalone, absolutely positioned, readable, with no external requests
(no Tailwind CDN). Escape text content.

### `src/core/docops.ts`

```ts
export type AlignMode = 'left'|'hcenter'|'right'|'top'|'vcenter'|'bottom';
export type OrderMode = 'front'|'forward'|'backward'|'back';
export interface Guide { axis: 'x'|'y'; position: number; from: number; to: number }
export function groupSelection(store: EditorStore): void;
export function ungroupSelection(store: EditorStore): void;
export function alignSelection(store: EditorStore, mode: AlignMode): void;
export function distributeSelection(store: EditorStore, axis: 'horizontal'|'vertical'): void;
export function reorderSelection(store: EditorStore, mode: OrderMode): void;
export function setSelectionLocked(store: EditorStore, locked: boolean): void;
export function computeSnap(moving: Rect, targets: Rect[], opts: { threshold: number; grid?: number }): { dx: number; dy: number; guides: Guide[] };
export interface ComponentSummary { id: string; name: string; node: PenNode }
export function createComponentFromSelection(store: EditorStore): ComponentSummary | null;
export function listComponents(store: EditorStore): ComponentSummary[];
export function insertComponentInstance(store: EditorStore, componentId: string, x: number, y: number): string | null;
export interface SlideSummary { id: string; name: string; index: number; width: number; height: number }
export function listSlides(store: EditorStore): SlideSummary[];
export function addSlide(store: EditorStore, preset?: 'wide'|'square'): string;
export interface CommentPin { id: string; x: number; y: number; text: string; createdAt: number; resolved?: boolean }
export function listComments(store: EditorStore): CommentPin[];
export function addComment(store: EditorStore, x: number, y: number, text: string): CommentPin;
export function resolveComment(store: EditorStore, id: string): void;
export function deleteComment(store: EditorStore, id: string): void;
```
Components: a component is a reusable top-level frame with `metadata.component = true` and a name;
instances use `{ type:'ref', ref: componentId }`. Keep it simple but functional. Comments and
slides persist inside `doc.metadata` (`doc.metadata.comments`, `.slides`), and components in
`doc.metadata.components` (ids only; the node is the source of truth).

### `src/core/assets.ts`

```ts
export interface ImageAsset { id: string; name: string; dataUrl: string; width: number; height: number; size: number }
export const MAX_IMAGE_BYTES: number;
export function loadImageElement(url: string): Promise<HTMLImageElement>; // cached
export function createImageNode(asset: ImageAsset, x: number, y: number): PenNode;
export function createTextFileNode(name: string, text: string, x: number, y: number): PenNode;
export function listAssets(doc: PenDocument): ImageAsset[];
export function clampImageSize(w: number, h: number, max?: number): { width: number; height: number };
```
Image nodes are rectangles with `fill: { type:'image', url:dataUrl, mode:'cover' }` and
`metadata.assetId/name`. Text attachments become `note` nodes.

### `src/core/storage.ts` additions (keep existing API)
```ts
export function renameRecent(id: string, name: string): void;
export function duplicateRecent(id: string): StoredFile | null;
export function setRecentPinned(id: string, pinned: boolean): void;
export function clearRecents(): void;
export function exportBackup(): string;                 // recents + autosave + settings + drafts
export function importBackup(json: string): boolean;
export function listDrafts(): StoredFile[];
export function saveDraft(file: StoredFile): void;      // drafts bucket, cap 20
export function deleteDraft(id: string): void;
export function saveAgentThread(fileId: string, messages: unknown[]): void;
export function loadAgentThread(fileId: string): unknown[];
```
Add `pinned?: boolean` to `StoredFile`. Keep quota-safe behaviour.

---

# UI lane

Phase 1 files stay yours. Extend them; do not rewrite the visual language.

### New: `src/ui/settings.ts`
`openSettings({ onApply?, onClose? }): { close(): void }` — centered modal (560px) with left
nav: General, Appearance, Editor, Agent, Shortcuts, Storage, About. Real controls bound to
`loadSettings`/`saveSettings`/`applySettings`, live preview, Reset, Done. Storage shows usage
with a bar and “Clear all data” (confirm). Shortcuts lists real implemented shortcuts. Agent
section edits model + instructions. About states this is an offline clone built from the
pen.dev 1.2.18 analysis + version. Use the existing dark tokens; support light theme.

### New: `src/ui/dialogs.ts`
`toast(message, kind?)`, `confirmDialog(opts): Promise<boolean>`, `promptDialog(opts): Promise<string|null>`,
`showCommandPalette(commands): void` (Ctrl/Cmd+K), `showContextMenu(x, y, items)`.
Style with tokens; all dismissible via Escape/backdrop.

### New: `src/ui/menu.ts`
`createMenuBar(actions): { el, destroy }` — File / Edit / View / Object / Help menus with
keyboard hints and separators. Actions interface:
```ts
interface MenuActions {
  newFile(); openFile(); openRecent(); save(); saveAs(); close();
  exportAs(format: 'pen'|'png'|'svg'|'html'): void;
  importImage(); undo(); redo(); cut(); copy(); paste(); duplicate(); delete();
  selectAll(); zoomIn(); zoomOut(); zoomFit(); toggleGrid(); toggleSnap();
  group(); ungroup(); bringForward(); sendBackward(); bringToFront(); sendToBack();
  togglePanel(); settings(); shortcuts(); about();
}
```
Props for disabled states may be supplied as optional getters.

### Upgrade: `src/ui/dashboard.ts`
- Real pages: Recents, Drafts, Templates, Design Systems (sidebar navigates them).
- Search field filtering by name; grid/list toggle works.
- Card menu: Open, Rename, Duplicate, Pin/Unpin, Delete (confirm) — wired to storage helpers.
- Template page: cards for the 6 samples; clicking opens a generated doc.
- Design Systems page: cards for design-system sample + an explanation panel.
- Settings gear / avatar opens `openSettings`.
- Keep prompt composer and import cards; “Open File” works; drag/drop a `.pen` onto the window opens it.
- Add a top-right “Open settings” affordance if not already present.

### Upgrade: `src/ui/editor.ts`
- Add the menu bar row above/inside the 44px top bar without breaking the reference layout.
- Add multi-document support: a slim document tab strip under the top bar (one tab for now,
  closable via File > Close; main.ts may pass a single doc). Do not fake tabs with no function.
- Integrate settings modal, command palette, toasts, confirm dialogs.
- Functional tabs: Slides, Components, Libraries (new modules below).
- Show save state: Saved / Unsaved / Recovered changes.
- Drop zone: images inserted at drop point, `.pen` opened through callback.
- Keyboard: add Ctrl/Cmd+G group, Shift+G ungroup, Ctrl/Cmd+K palette, Ctrl/Cmd+0 fit,
  Ctrl/Cmd+1 100%, Ctrl/Cmd+= / − zoom, Ctrl+A select all, Esc deselect, Space pan.
- Export/copy HTML uses core exporters now (no CDN).
- Right inspector width and floating layout must remain intact.

### New: `src/ui/slides.ts`
`createSlides(store): PanelModule` — list top-level frames as slides with index, name,
dimensions, thumbnail; click focuses/zooms to slide; add slide (wide/square); reorder with
up/down; rename inline; delete. “Present” button starts a simple fullscreen slideshow
(arrow keys, Esc).

### New: `src/ui/components.ts`
`createComponents(store): PanelModule` — list components from docops; thumbnail, name,
insert instance button; “Create component from selection”; empty state. Double-click inserts at
viewport center.

### New: `src/ui/libraries.ts`
`createLibraries(store): PanelModule` — starter library: insert a polished section/frame from
samples (hero, feature grid, pricing, mobile card, dashboard stat card), plus color styles
extracted from the document variables/fills. Search. Click inserts into canvas at viewport
center. Also list imported images (assets) with insert action.

### Upgrade: `src/ui/layers.ts`
- Search box; filter tree.
- Eye and lock toggles per row; locked nodes cannot be selected on canvas (canvas must check).
- Double-click rename (input, Enter/Esc).
- Drag to reorder within the same parent; drop onto a frame to reparent (with visible indicator).
- Right-click context menu: rename, duplicate, delete, group, ungroup, lock/unlock, hide/show,
  bring to front/back.
- Auto-expand ancestors of the selection.

### Upgrade: `src/ui/inspector.ts`
- Header menu: rename, lock, hide, duplicate, delete.
- Alignment buttons call `alignSelection`; add distribute buttons.
- Position X/Y/W/H/rotation editable; multi-select shows bounding box values and applies deltas.
- Add Arrange row (front/forward/backward/back) and “Group/Ungroup”.
- Appearance: opacity slider + corner radius; lock toggle.
- Fill: color picker + hex + alpha + visibility + add/remove; image fill shows Replace Image.
- Text section when text selected: family, size, weight, line height, letter spacing, align,
  color; edits apply live.
- Effects: add/remove drop shadow (offset, blur, color).
- Code/Export: Copy HTML, Export HTML, Export PNG (1x/2x/3x), Export SVG — all functional.
- Keep the existing compact 216px visual style; overflow scrolls.

### Upgrade: `src/ui/agent.ts`
- Chat transcript persisted per file via storage (`saveAgentThread`/`loadAgentThread`).
- Attachments: paperclip opens image/text/.pen picker; show chips; images become assets and
  are inserted on request; text becomes context.
- Local command engine (offline, honest): generate landing/mobile/dashboard/slides/design
  system, change accent/theme, add section, create component from selection, summarize selection,
  generate HTML/React code for selection, arrange/align, export PNG.
- Clear “Local demo — no network. Runs entirely in your browser.” notice.
- Model row uses settings.agentModel; token counter can be decorative but must not lie about a
  network call. Include a “Clear chat” action.

### Upgrade: `src/ui/canvas.ts`
- Settings-driven canvas background, grid, frame names, snapping (objects + grid) with smart
  guide lines while dragging.
- Image fill rendering (core/assets loader) with cover/contain/stretch.
- Comments mode: pin overlay, add/edit/resolve via prompt; pins scale with zoom.
- Locked nodes are not selectable; hidden nodes not rendered.
- Right-click context menu hook.
- Public `exportPng(nodeId: string|null, scale: number): Promise<Blob>` using core/exporters.
- Drop coordinates callback for image insertion.
- Performance: cache laid-out tree per doc version; do not relayout on pure viewport changes.
  Use `requestAnimationFrame` for drag renders.

### `src/styles/*`
Add settings/modal/menu/tabs/toast/light-theme styles. No inline style blocks in TS for anything
repeated; use classes. Maintain responsive behavior at 1024px.

---

# Orchestrator integration (do not touch)

`main.ts` will:
- load/apply settings at boot; pass settings into editor;
- own save/open/save-as/export/import-image callbacks and unsaved-change confirmation;
- keep FileSystemFileHandle for in-place saves when available;
- wire dashboard recents/drafts/templates to storage;
- global drop handling.

Keep your public APIs exactly as written so integration is mechanical.

## Acceptance checklist

1. `npx tsc --noEmit` clean, `npm run build` succeeds.
2. Settings persist across reload and visibly change theme/accent/canvas/grid/snapping.
3. New/Open/Save/Save As/Export (.pen/.png/.svg/.html) work; unsaved changes are confirmed.
4. Images can be added via menu, drag-drop and agent attachment; they render on canvas and in
   PNG/SVG export.
5. Group/ungroup, align/distribute, arrange, lock/hide, layer rename/reorder work.
6. Slides, Components and Libraries tabs are functional, not placeholders.
7. Agent commands genuinely generate/insert content offline and chat persists per file.
8. Comments can be added, resolved and deleted.
9. No network requests at runtime; bundle stays under ~250 KB gzipped JS.
