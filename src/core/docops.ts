/**
 * History-aware document operations used by menus, the inspector and panels.
 * Everything mutates through EditorStore.mutate so undo/redo keeps working.
 */
import type { PenDocument, PenNode, Rect } from './types';
import { EditorStore, absoluteBounds, num, uid } from './store';

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export type OrderMode = 'front' | 'forward' | 'backward' | 'back';

export interface Guide {
  axis: 'x' | 'y';
  position: number;
  from: number;
  to: number;
}

export interface ComponentSummary {
  id: string;
  name: string;
  node: PenNode;
}

export interface SlideSummary {
  id: string;
  name: string;
  index: number;
  width: number;
  height: number;
}

export interface CommentPin {
  id: string;
  x: number;
  y: number;
  text: string;
  createdAt: number;
  resolved?: boolean;
}

interface NodeLocation {
  node: PenNode;
  parent: PenNode | null;
  list: PenNode[];
  index: number;
}

interface DocMetadata {
  components?: unknown;
  slides?: unknown;
  comments?: unknown;
  [key: string]: unknown;
}

type DocWithMetadata = PenDocument & { metadata?: DocMetadata };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function locations(doc: PenDocument): Map<string, NodeLocation> {
  const map = new Map<string, NodeLocation>();
  const visit = (list: PenNode[], parent: PenNode | null): void => {
    list.forEach((node, index) => {
      map.set(node.id, { node, parent, list, index });
      if (node.children) visit(node.children, node);
    });
  };
  visit(doc.children, null);
  return map;
}

function topmostSelection(store: EditorStore, map: Map<string, NodeLocation>): NodeLocation[] {
  const selected = new Set(store.selection);
  const out: NodeLocation[] = [];
  for (const id of store.selection) {
    const loc = map.get(id);
    if (!loc) continue;
    let parent = loc.parent;
    let nested = false;
    while (parent) {
      if (selected.has(parent.id)) {
        nested = true;
        break;
      }
      parent = map.get(parent.id)?.parent ?? null;
    }
    if (!nested) out.push(loc);
  }
  return out;
}

function originOf(loc: NodeLocation, map: Map<string, NodeLocation>): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let parent = loc.parent;
  while (parent) {
    x += num(parent.x);
    y += num(parent.y);
    parent = map.get(parent.id)?.parent ?? null;
  }
  return { x, y };
}

function unionRects(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let minX = rects[0].x;
  let minY = rects[0].y;
  let maxX = rects[0].x + rects[0].width;
  let maxY = rects[0].y + rects[0].height;
  for (const r of rects.slice(1)) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function rectOf(doc: PenDocument, node: PenNode): Rect {
  return (
    absoluteBounds(doc, node.id) ?? {
      x: num(node.x),
      y: num(node.y),
      width: Math.max(1, num(node.width, 1)),
      height: Math.max(1, num(node.height, 1)),
    }
  );
}

function docMeta(doc: PenDocument, create = false): DocMetadata {
  const cast = doc as DocWithMetadata;
  if (isObject(cast.metadata)) return cast.metadata;
  if (!create) return {};
  const metadata: DocMetadata = {};
  cast.metadata = metadata;
  return metadata;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function findNode(nodes: PenNode[], id: string): PenNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Grouping / ordering                                                */
/* ------------------------------------------------------------------ */

export function groupSelection(store: EditorStore): void {
  const map = locations(store.doc);
  const selected = topmostSelection(store, map);
  if (!selected.length) return;

  const entries = new Map<
    string,
    { parent: PenNode | null; items: NodeLocation[] }
  >();
  for (const loc of selected) {
    const key = loc.parent ? loc.parent.id : '__root__';
    const entry = entries.get(key) ?? { parent: loc.parent, items: [] };
    entry.items.push(loc);
    entries.set(key, entry);
  }

  const created: string[] = [];

  store.mutate((doc) => {
    for (const entry of entries.values()) {
      const items = entry.items
        .filter((loc) => loc.list.includes(loc.node))
        .sort((a, b) => a.index - b.index);
      if (!items.length) continue;

      const bounds = unionRects(items.map((loc) => rectOf(doc, loc.node)));
      if (!bounds) continue;

      const parentAbs = entry.parent ? originOf(items[0], map) : { x: 0, y: 0 };
      const list = entry.parent ? (entry.parent.children ?? []) : doc.children;
      const ids = new Set(items.map((loc) => loc.node.id));
      const insertAt = Math.min(...items.map((loc) => loc.index));

      const frame: PenNode = {
        type: 'frame',
        id: uid('grp'),
        name: 'Group',
        x: bounds.x - parentAbs.x,
        y: bounds.y - parentAbs.y,
        width: bounds.width,
        height: bounds.height,
        layout: 'none',
        clip: false,
        children: [],
      };

      for (const loc of items) {
        const rect = rectOf(doc, loc.node);
        loc.node.x = rect.x - bounds.x;
        loc.node.y = rect.y - bounds.y;
        frame.children!.push(loc.node);
      }

      const rest = list.filter((node) => !ids.has(node.id));
      const at = Math.max(0, Math.min(insertAt, rest.length));
      rest.splice(at, 0, frame);

      if (entry.parent) entry.parent.children = rest;
      else doc.children = rest;
      created.push(frame.id);
    }
  });

  if (created.length) store.setSelection(created);
}

export function ungroupSelection(store: EditorStore): void {
  const map = locations(store.doc);
  const selected = topmostSelection(store, map).filter(
    (loc) =>
      (loc.node.type === 'frame' || loc.node.type === 'group') &&
      Array.isArray(loc.node.children),
  );
  if (!selected.length) return;

  const moved: string[] = [];

  store.mutate((doc) => {
    for (const loc of selected) {
      const parentList = loc.parent ? (loc.parent.children ?? []) : doc.children;
      const index = parentList.indexOf(loc.node);
      if (index < 0) continue;
      const children = loc.node.children ?? [];
      for (const child of children) {
        child.x = num(loc.node.x) + num(child.x);
        child.y = num(loc.node.y) + num(child.y);
        moved.push(child.id);
      }
      parentList.splice(index, 1, ...children);
    }
  });

  store.setSelection(moved);
}

export function alignSelection(store: EditorStore, mode: AlignMode): void {
  const map = locations(store.doc);
  const selected = topmostSelection(store, map).filter((loc) => !loc.node.locked);
  if (selected.length < 2) return;

  const rects = selected.map((loc) => rectOf(store.doc, loc.node));
  const minX = Math.min(...rects.map((r) => r.x));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));

  store.mutate((doc) => {
    selected.forEach((loc, i) => {
      const rect = rects[i];
      let dx = 0;
      let dy = 0;
      if (mode === 'left') dx = minX - rect.x;
      else if (mode === 'hcenter') dx = (minX + maxX) / 2 - (rect.x + rect.width / 2);
      else if (mode === 'right') dx = maxX - (rect.x + rect.width);
      else if (mode === 'top') dy = minY - rect.y;
      else if (mode === 'vcenter') dy = (minY + maxY) / 2 - (rect.y + rect.height / 2);
      else if (mode === 'bottom') dy = maxY - (rect.y + rect.height);
      const node = findNode(doc.children, loc.node.id);
      if (!node) return;
      node.x = num(node.x) + dx;
      node.y = num(node.y) + dy;
    });
  });
}

export function distributeSelection(store: EditorStore, axis: 'horizontal' | 'vertical'): void {
  const map = locations(store.doc);
  const selected = topmostSelection(store, map).filter((loc) => !loc.node.locked);
  if (selected.length < 3) return;

  const horizontal = axis === 'horizontal';
  const entries = selected
    .map((loc) => ({ loc, rect: rectOf(store.doc, loc.node) }))
    .sort((a, b) => (horizontal ? a.rect.x - b.rect.x : a.rect.y - b.rect.y));

  const first = entries[0].rect;
  const last = entries[entries.length - 1].rect;
  const span = horizontal
    ? last.x + last.width - first.x
    : last.y + last.height - first.y;
  const totalSize = entries.reduce(
    (sum, entry) => sum + (horizontal ? entry.rect.width : entry.rect.height),
    0,
  );
  const gap = (span - totalSize) / (entries.length - 1);
  let cursor = horizontal ? first.x : first.y;

  store.mutate((doc) => {
    for (const entry of entries) {
      const node = findNode(doc.children, entry.loc.node.id);
      if (!node) continue;
      if (horizontal) {
        node.x = num(node.x) + (cursor - entry.rect.x);
        cursor += entry.rect.width + gap;
      } else {
        node.y = num(node.y) + (cursor - entry.rect.y);
        cursor += entry.rect.height + gap;
      }
    }
  });
}

export function reorderSelection(store: EditorStore, mode: OrderMode): void {
  const map = locations(store.doc);
  const selected = topmostSelection(store, map);
  if (!selected.length) return;

  const entries = new Map<string, { list: PenNode[]; ids: Set<string> }>();
  for (const loc of selected) {
    const key = loc.parent ? loc.parent.id : '__root__';
    const entry = entries.get(key) ?? { list: loc.list, ids: new Set<string>() };
    entry.ids.add(loc.node.id);
    entries.set(key, entry);
  }

  store.mutate((doc) => {
    for (const [key, entry] of entries) {
      const parent = key === '__root__' ? null : findNode(doc.children, key);
      const list = parent ? (parent.children ?? []) : doc.children;
      if (mode === 'front' || mode === 'back') {
        const picked = list.filter((node) => entry.ids.has(node.id));
        const rest = list.filter((node) => !entry.ids.has(node.id));
        list.splice(0, list.length, ...(mode === 'front' ? [...rest, ...picked] : [...picked, ...rest]));
      } else if (mode === 'forward') {
        for (let i = list.length - 2; i >= 0; i -= 1) {
          if (entry.ids.has(list[i].id) && !entry.ids.has(list[i + 1].id)) {
            [list[i], list[i + 1]] = [list[i + 1], list[i]];
          }
        }
      } else {
        for (let i = 1; i < list.length; i += 1) {
          if (entry.ids.has(list[i].id) && !entry.ids.has(list[i - 1].id)) {
            [list[i], list[i - 1]] = [list[i - 1], list[i]];
          }
        }
      }
    }
  });
}

export function setSelectionLocked(store: EditorStore, locked: boolean): void {
  const ids = new Set(store.selection);
  if (!ids.size) return;
  store.mutate((doc) => {
    const apply = (nodes: PenNode[]): void => {
      for (const node of nodes) {
        if (ids.has(node.id)) node.locked = locked;
        if (node.children) apply(node.children);
      }
    };
    apply(doc.children);
  });
}

/* ------------------------------------------------------------------ */
/* Snapping                                                           */
/* ------------------------------------------------------------------ */

interface AxisMatch {
  distance: number;
  dx: number;
  position: number;
  target: Rect;
  axis: 'x' | 'y';
}

function bestAxisMatch(
  movingValues: number[],
  targetValue: number,
  target: Rect,
  axis: 'x' | 'y',
  threshold: number,
): AxisMatch | null {
  let best: AxisMatch | null = null;
  for (const value of movingValues) {
    const dx = targetValue - value;
    const distance = Math.abs(dx);
    if (distance > threshold) continue;
    if (!best || distance < best.distance) {
      best = { distance, dx, position: targetValue, target, axis };
    }
  }
  return best;
}

export function computeSnap(
  moving: Rect,
  targets: Rect[],
  opts: { threshold: number; grid?: number },
): { dx: number; dy: number; guides: Guide[] } {
  const threshold = Math.max(0, opts.threshold);
  if (threshold <= 0) return { dx: 0, dy: 0, guides: [] };

  const movingX = [moving.x, moving.x + moving.width / 2, moving.x + moving.width];
  const movingY = [moving.y, moving.y + moving.height / 2, moving.y + moving.height];

  let bestX: AxisMatch | null = null;
  let bestY: AxisMatch | null = null;

  for (const target of targets) {
    const targetX = [target.x, target.x + target.width / 2, target.x + target.width];
    const targetY = [target.y, target.y + target.height / 2, target.y + target.height];
    for (const value of targetX) {
      const match = bestAxisMatch(movingX, value, target, 'x', threshold);
      if (match && (!bestX || match.distance < bestX.distance)) bestX = match;
    }
    for (const value of targetY) {
      const match = bestAxisMatch(movingY, value, target, 'y', threshold);
      if (match && (!bestY || match.distance < bestY.distance)) bestY = match;
    }
  }

  let gridDx: number | null = null;
  let gridDy: number | null = null;
  if (opts.grid && opts.grid > 0) {
    const candidateX = Math.round(moving.x / opts.grid) * opts.grid - moving.x;
    if (Math.abs(candidateX) <= threshold && (!bestX || Math.abs(candidateX) < bestX.distance)) {
      gridDx = candidateX;
      bestX = null;
    }
    const candidateY = Math.round(moving.y / opts.grid) * opts.grid - moving.y;
    if (Math.abs(candidateY) <= threshold && (!bestY || Math.abs(candidateY) < bestY.distance)) {
      gridDy = candidateY;
      bestY = null;
    }
  }

  const dx = gridDx ?? (bestX ? bestX.dx : 0);
  const dy = gridDy ?? (bestY ? bestY.dx : 0);
  const guides: Guide[] = [];

  if (bestX) {
    const target = bestX.target;
    guides.push({
      axis: 'x',
      position: bestX.position,
      from: Math.min(moving.y + dy, target.y),
      to: Math.max(moving.y + dy + moving.height, target.y + target.height),
    });
  }
  if (bestY) {
    const target = bestY.target;
    guides.push({
      axis: 'y',
      position: bestY.position,
      from: Math.min(moving.x + dx, target.x),
      to: Math.max(moving.x + dx + moving.width, target.x + target.width),
    });
  }

  return { dx, dy, guides };
}

/* ------------------------------------------------------------------ */
/* Components                                                         */
/* ------------------------------------------------------------------ */

export function createComponentFromSelection(store: EditorStore): ComponentSummary | null {
  const map = locations(store.doc);
  const selected = topmostSelection(store, map);
  if (!selected.length) return null;

  let targetId: string | null = null;

  store.mutate((doc) => {
    let componentNode: PenNode | null = null;

    if (selected.length === 1 && selected[0].node.type === 'frame' && !selected[0].parent) {
      componentNode = selected[0].node;
    } else {
      const bounds = unionRects(selected.map((loc) => rectOf(doc, loc.node)));
      if (!bounds) return;
      const frame: PenNode = {
        type: 'frame',
        id: uid('cmp'),
        name: 'Component',
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        layout: 'none',
        clip: false,
        children: [],
      };

      for (const loc of selected) {
        const parentList = loc.parent ? (loc.parent.children ?? []) : doc.children;
        const index = parentList.indexOf(loc.node);
        if (index < 0) continue;
        const rect = rectOf(doc, loc.node);
        loc.node.x = rect.x - bounds.x;
        loc.node.y = rect.y - bounds.y;
        parentList.splice(index, 1);
        frame.children!.push(loc.node);
      }

      if (!frame.children!.length) return;
      doc.children.push(frame);
      componentNode = frame;
    }

    if (!componentNode) return;
    const meta = isObject(componentNode.metadata) ? componentNode.metadata : {};
    componentNode.metadata = { ...meta, component: true, reusable: true };
    if (!componentNode.name || componentNode.name === 'Frame' || componentNode.name === 'Group') {
      const existing = stringList(docMeta(doc, true).components).length;
      componentNode.name = `Component ${existing + 1}`;
    }

    const docMetadata = docMeta(doc, true);
    const components = stringList(docMetadata.components).filter((id) => id !== componentNode!.id);
    components.push(componentNode.id);
    docMetadata.components = components;
    targetId = componentNode.id;
  });

  if (!targetId) return null;
  const node = findNode(store.doc.children, targetId);
  if (!node) return null;
  store.setSelection([targetId]);
  return { id: node.id, name: node.name ?? 'Component', node };
}

export function listComponents(store: EditorStore): ComponentSummary[] {
  const metadata = docMeta(store.doc);
  const ids = stringList(metadata.components);
  const out: ComponentSummary[] = [];
  const seen = new Set<string>();

  const add = (node: PenNode | null): void => {
    if (!node || node.type !== 'frame' || seen.has(node.id)) return;
    seen.add(node.id);
    out.push({ id: node.id, name: node.name ?? 'Component', node });
  };

  for (const id of ids) add(findNode(store.doc.children, id));
  for (const node of store.doc.children) {
    const meta = isObject(node.metadata) ? node.metadata : {};
    if (meta.component === true) add(node);
  }
  return out;
}

export function insertComponentInstance(
  store: EditorStore,
  componentId: string,
  x: number,
  y: number,
): string | null {
  const source = findNode(store.doc.children, componentId);
  if (!source || source.type !== 'frame') return null;

  const instance: PenNode = {
    type: 'ref',
    id: uid('ref'),
    name: `${source.name ?? 'Component'} instance`,
    ref: componentId,
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    width: Math.max(1, num(source.width, 100)),
    height: Math.max(1, num(source.height, 100)),
    layout: 'none',
  };
  store.addNode(instance);
  return instance.id;
}

/* ------------------------------------------------------------------ */
/* Slides                                                             */
/* ------------------------------------------------------------------ */

export function listSlides(store: EditorStore): SlideSummary[] {
  const frames = store.doc.children.filter((node) => node.type === 'frame');
  const metadata = docMeta(store.doc);
  const order = stringList(metadata.slides);
  const byId = new Map(frames.map((frame) => [frame.id, frame]));
  const ordered: PenNode[] = [];

  for (const id of order) {
    const frame = byId.get(id);
    if (frame) {
      ordered.push(frame);
      byId.delete(id);
    }
  }
  for (const frame of frames) if (byId.has(frame.id)) ordered.push(frame);

  return ordered.map((frame, index) => ({
    id: frame.id,
    name: frame.name ?? `Slide ${index + 1}`,
    index,
    width: Math.max(1, num(frame.width, 1600)),
    height: Math.max(1, num(frame.height, 900)),
  }));
}

export function addSlide(store: EditorStore, preset: 'wide' | 'square' = 'wide'): string {
  const width = preset === 'square' ? 1080 : 1600;
  const height = preset === 'square' ? 1080 : 900;
  const frames = store.doc.children.filter((node) => node.type === 'frame');
  const right = frames.reduce((max, frame) => Math.max(max, num(frame.x) + num(frame.width)), 0);
  const x = frames.length ? right + 80 : 0;

  const frame: PenNode = {
    type: 'frame',
    id: uid('slide'),
    name: `Slide ${frames.length + 1}`,
    x,
    y: 0,
    width,
    height,
    layout: 'none',
    clip: true,
    fill: '#FFFFFF',
    children: [],
  };

  store.addNode(frame);
  store.mutate((doc) => {
    const metadata = docMeta(doc, true);
    const slides = stringList(metadata.slides).filter((id) => id !== frame.id);
    slides.push(frame.id);
    metadata.slides = slides;
  });
  return frame.id;
}

/* ------------------------------------------------------------------ */
/* Comments                                                           */
/* ------------------------------------------------------------------ */

function normalizeComment(value: unknown): CommentPin | null {
  if (!isObject(value)) return null;
  if (typeof value.id !== 'string' || value.id === '') return null;
  return {
    id: value.id,
    x: typeof value.x === 'number' && Number.isFinite(value.x) ? value.x : 0,
    y: typeof value.y === 'number' && Number.isFinite(value.y) ? value.y : 0,
    text: typeof value.text === 'string' ? value.text : '',
    createdAt:
      typeof value.createdAt === 'number' && Number.isFinite(value.createdAt)
        ? value.createdAt
        : Date.now(),
    resolved: value.resolved === true,
  };
}

export function listComments(store: EditorStore): CommentPin[] {
  const comments = docMeta(store.doc).comments;
  if (!Array.isArray(comments)) return [];
  return comments
    .map((comment) => normalizeComment(comment))
    .filter((comment): comment is CommentPin => comment !== null);
}

export function addComment(store: EditorStore, x: number, y: number, text: string): CommentPin {
  const pin: CommentPin = {
    id: uid('comment'),
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    text: text.trim() || 'Comment',
    createdAt: Date.now(),
  };

  store.mutate((doc) => {
    const metadata = docMeta(doc, true);
    const comments = Array.isArray(metadata.comments) ? metadata.comments : [];
    comments.push(pin);
    metadata.comments = comments;
  });

  return pin;
}

export function resolveComment(store: EditorStore, id: string): void {
  store.mutate((doc) => {
    const metadata = docMeta(doc, true);
    if (!Array.isArray(metadata.comments)) return;
    for (const comment of metadata.comments) {
      if (isObject(comment) && comment.id === id) comment.resolved = true;
    }
  });
}

export function deleteComment(store: EditorStore, id: string): void {
  store.mutate((doc) => {
    const metadata = docMeta(doc, true);
    if (!Array.isArray(metadata.comments)) return;
    metadata.comments = metadata.comments.filter(
      (comment) => !(isObject(comment) && comment.id === id),
    );
  });
}
