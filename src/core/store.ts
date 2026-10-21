import type {
  PenDocument,
  PenNode,
  Paint,
  Point,
  Rect,
  Tool,
  Viewport,
} from './types';

let idCounter = 0;

export function uid(prefix = 'n'): string {
  idCounter += 1;
  return `${prefix}${Date.now().toString(36).slice(-4)}${idCounter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 5)}`;
}

export function nodeFillColor(node: PenNode, fallback = '#E7E8E5'): string {
  const f = node.fill;
  if (!f) return fallback;
  if (typeof f === 'string') return f;
  if (Array.isArray(f)) {
    for (const p of f) {
      const c = paintColor(p);
      if (c) return c;
    }
    return fallback;
  }
  return paintColor(f) ?? fallback;
}

export function paintColor(paint: Paint | undefined): string | null {
  if (!paint) return null;
  if (typeof paint === 'string') return paint;
  if (paint.type === 'color' && paint.enabled !== false) return paint.color;
  return null;
}

export function isContainer(node: PenNode): boolean {
  return node.type === 'frame' || node.type === 'group';
}

export function walkNodes(
  nodes: PenNode[],
  cb: (node: PenNode, parent: PenNode | null, depth: number) => void,
  parent: PenNode | null = null,
  depth = 0,
): void {
  for (const n of nodes) {
    cb(n, parent, depth);
    if (n.children) walkNodes(n.children, cb, n, depth + 1);
  }
}

export type StoreEvent = 'doc' | 'selection' | 'viewport' | 'tool' | 'mode' | 'save-state';

export class EditorStore {
  doc: PenDocument;
  selection: string[] = [];
  tool: Tool = 'select';
  viewport: Viewport = { zoom: 1, panX: 0, panY: 0 };
  dirty = false;
  filePath: string | null = null;
  fileName = 'untitled.pen';

  private listeners = new Set<(event: StoreEvent) => void>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private txBase: string | null = null;
  private maxHistory = 80;

  constructor(doc: PenDocument, fileName = 'untitled.pen') {
    this.doc = doc;
    this.fileName = fileName;
  }

  subscribe(fn: (event: StoreEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event: StoreEvent): void {
    for (const fn of this.listeners) fn(event);
  }

  setDoc(doc: PenDocument, fileName?: string): void {
    this.doc = doc;
    if (fileName) this.fileName = fileName;
    this.selection = [];
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.emit('doc');
    this.emit('selection');
  }

  // ---- history -------------------------------------------------------

  private snapshot(): string {
    return JSON.stringify(this.doc);
  }

  private pushUndo(base?: string): void {
    this.undoStack.push(base ?? this.snapshot());
    if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
    this.redoStack = [];
  }

  beginTransaction(): void {
    if (this.txBase === null) this.txBase = this.snapshot();
  }

  endTransaction(): void {
    if (this.txBase === null) return;
    const base = this.txBase;
    this.txBase = null;
    if (base !== this.snapshot()) {
      this.pushUndo(base);
      this.dirty = true;
      this.emit('doc');
      this.emit('save-state');
    }
  }

  /** Mutate the document in place; one history entry per call. */
  mutate(fn: (doc: PenDocument) => void, event: StoreEvent = 'doc'): void {
    const base = this.snapshot();
    fn(this.doc);
    if (base === this.snapshot()) return;
    if (this.txBase === null) this.pushUndo(base);
    this.dirty = true;
    this.emit(event);
    this.emit('save-state');
  }

  /** Mutate without adding a history entry (live drag updates). */
  mutateSilent(fn: (doc: PenDocument) => void): void {
    fn(this.doc);
    this.dirty = true;
    this.emit('doc');
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.snapshot());
    this.doc = JSON.parse(prev) as PenDocument;
    this.pruneSelection();
    this.dirty = true;
    this.emit('doc');
    this.emit('selection');
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshot());
    this.doc = JSON.parse(next) as PenDocument;
    this.pruneSelection();
    this.dirty = true;
    this.emit('doc');
    this.emit('selection');
  }

  // ---- tree access ---------------------------------------------------

  allNodes(): PenNode[] {
    const out: PenNode[] = [];
    walkNodes(this.doc.children, (n) => out.push(n));
    return out;
  }

  getNode(id: string): PenNode | null {
    let found: PenNode | null = null;
    walkNodes(this.doc.children, (n) => {
      if (n.id === id) found = n;
    });
    return found;
  }

  getParent(id: string): PenNode | null {
    let parent: PenNode | null = null;
    walkNodes(this.doc.children, (n, p) => {
      if (n.id === id) parent = p;
    });
    return parent;
  }

  getSiblings(id: string): PenNode[] {
    const parent = this.getParent(id);
    return parent ? parent.children ?? [] : this.doc.children;
  }

  // ---- selection -----------------------------------------------------

  setSelection(ids: string[]): void {
    const next = [...new Set(ids)].filter((id) => this.getNode(id));
    const same =
      next.length === this.selection.length && next.every((id, i) => id === this.selection[i]);
    if (same) return;
    this.selection = next;
    this.emit('selection');
  }

  selectOnly(id: string | null): void {
    this.setSelection(id ? [id] : []);
  }

  toggleSelection(id: string, additive = false): void {
    if (!additive) {
      this.selectOnly(id);
      return;
    }
    if (this.selection.includes(id)) {
      this.setSelection(this.selection.filter((s) => s !== id));
    } else {
      this.setSelection([...this.selection, id]);
    }
  }

  private pruneSelection(): void {
    this.selection = this.selection.filter((id) => this.getNode(id));
  }

  // ---- viewport ------------------------------------------------------

  setViewport(v: Partial<Viewport>): void {
    this.viewport = { ...this.viewport, ...v };
    this.emit('viewport');
  }

  screenToWorld(p: Point): Point {
    return {
      x: (p.x - this.viewport.panX) / this.viewport.zoom,
      y: (p.y - this.viewport.panY) / this.viewport.zoom,
    };
  }

  worldToScreen(p: Point): Point {
    return {
      x: p.x * this.viewport.zoom + this.viewport.panX,
      y: p.y * this.viewport.zoom + this.viewport.panY,
    };
  }

  zoomAt(client: Point, factor: number, min = 0.02, max = 16): void {
    const before = this.screenToWorld(client);
    const zoom = Math.min(max, Math.max(min, this.viewport.zoom * factor));
    this.viewport.zoom = zoom;
    this.viewport.panX = client.x - before.x * zoom;
    this.viewport.panY = client.y - before.y * zoom;
    this.emit('viewport');
  }

  // ---- editing -------------------------------------------------------

  setTool(tool: Tool): void {
    this.tool = tool;
    this.emit('tool');
  }

  updateNode(id: string, patch: Partial<PenNode>, silent = false): void {
    const apply = (doc: PenDocument) => {
      const node = findIn(doc.children, id);
      if (node) Object.assign(node, patch);
    };
    if (silent) {
      this.mutateSilent(apply);
    } else {
      this.mutate(apply);
    }
    this.emit('selection');
  }

  addNode(node: PenNode, parentId?: string | null, index?: number): void {
    this.mutate((doc) => {
      const parent = parentId ? findIn(doc.children, parentId) : null;
      const list = parent ? (parent.children ??= []) : doc.children;
      if (index == null || index < 0 || index >= list.length) list.push(node);
      else list.splice(index, 0, node);
    });
    this.selectOnly(node.id);
  }

  removeNodes(ids: string[]): void {
    if (!ids.length) return;
    this.mutate((doc) => {
      for (const id of ids) removeFrom(doc.children, id);
    });
    this.setSelection(this.selection.filter((s) => !ids.includes(s)));
  }

  duplicateNodes(ids: string[]): void {
    const created: string[] = [];
    this.mutate((doc) => {
      for (const id of ids) {
        const parent = this.getParent(id);
        const list = parent ? parent.children ?? [] : doc.children;
        const idx = list.findIndex((n) => n.id === id);
        const src = list[idx];
        if (!src) continue;
        const copy = deepClone(src);
        reid(copy);
        copy.name = `${src.name ?? src.type} copy`;
        copy.x = (num(src.x) ?? 0) + 20;
        copy.y = (num(src.y) ?? 0) + 20;
        list.splice(idx + 1, 0, copy);
        created.push(copy.id);
      }
    });
    if (created.length) this.setSelection(created);
  }

  moveBy(ids: string[], dx: number, dy: number): void {
    if (!dx && !dy) return;
    this.mutateSilent((doc) => {
      for (const id of ids) {
        const n = findIn(doc.children, id);
        if (!n) continue;
        n.x = (num(n.x) ?? 0) + dx;
        n.y = (num(n.y) ?? 0) + dy;
      }
    });
  }

  setNodeVisible(id: string, visible: boolean): void {
    this.updateNode(id, { visible });
  }

  renameNode(id: string, name: string): void {
    this.updateNode(id, { name });
  }
}

export function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function reid(node: PenNode): void {
  node.id = uid(node.type.slice(0, 2));
  for (const child of node.children ?? []) reid(child);
}

export function findIn(list: PenNode[], id: string): PenNode | null {
  for (const n of list) {
    if (n.id === id) return n;
    if (n.children) {
      const hit = findIn(n.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

export function removeFrom(list: PenNode[], id: string): boolean {
  const i = list.findIndex((n) => n.id === id);
  if (i >= 0) {
    list.splice(i, 1);
    return true;
  }
  for (const n of list) {
    if (n.children && removeFrom(n.children, id)) return true;
  }
  return false;
}

/** Absolute bounds of a node, honouring parent offsets and simple rotation. */
export function absoluteBounds(doc: PenDocument, id: string): Rect | null {
  const path: PenNode[] = [];
  const find = (list: PenNode[]): boolean => {
    for (const n of list) {
      path.push(n);
      if (n.id === id) return true;
      if (n.children && find(n.children)) return true;
      path.pop();
    }
    return false;
  };
  if (!find(doc.children)) return null;
  let x = 0;
  let y = 0;
  for (const n of path) {
    x += num(n.x);
    y += num(n.y);
  }
  const node = path[path.length - 1];
  return { x, y, width: num(node.width), height: num(node.height) };
}
