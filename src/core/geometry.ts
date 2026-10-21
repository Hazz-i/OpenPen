import type { PenDocument, PenNode, Point, Rect } from './types';
import { num } from './store';

export const MIN_SIZE = 1;

export function isFillContainer(v: unknown): boolean {
  return typeof v === 'string' && v.startsWith('fill_container');
}

export function isFitContent(v: unknown): boolean {
  return typeof v === 'string' && v.startsWith('fit_content');
}

export function resolveDimension(value: unknown, fallback: number, parent: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (isFillContainer(value)) {
    const m = /\(([\d.]+)\)/.exec(value as string);
    return parent > 0 ? parent : m ? Number(m[1]) : fallback;
  }
  if (isFitContent(value)) return fallback;
  return fallback;
}

export function paddingValues(
  p: PenNode['padding'],
): [number, number, number, number] {
  if (typeof p === 'number') return [p, p, p, p];
  if (Array.isArray(p)) {
    if (p.length === 2) return [p[0], p[1], p[0], p[1]];
    if (p.length === 4) return [p[0], p[1], p[2], p[3]];
  }
  return [0, 0, 0, 0];
}

let measureCanvas: HTMLCanvasElement | null = null;
let measureCtx: CanvasRenderingContext2D | null = null;

export function measureTextWidth(node: PenNode): number {
  const text = String(node.content ?? '');
  const size = num(node.fontSize, 16);
  const weight = String(node.fontWeight ?? '400');
  const family = String(node.fontFamily ?? 'Inter, system-ui, sans-serif');
  if (!measureCanvas) {
    measureCanvas = document.createElement('canvas');
    measureCtx = measureCanvas.getContext('2d');
  }
  if (!measureCtx) return Math.max(10, text.length * size * 0.55);
  measureCtx.font = `${weight} ${size}px ${family}`;
  const lines = text.split('\n');
  let width = 10;
  for (const line of lines) width = Math.max(width, measureCtx.measureText(line).width);
  return width;
}

export function measureTextHeight(node: PenNode, width?: number): number {
  const text = String(node.content ?? '');
  const size = num(node.fontSize, 16);
  const lh = size * num(node.lineHeight, 1.2);
  const lines = text.split('\n');
  let count = lines.length;
  if (node.textGrowth === 'fixed-width' && width && width > 0) {
    const perLine = Math.max(1, Math.floor(width / Math.max(1, size * 0.55)));
    count = lines.reduce((sum, l) => sum + Math.max(1, Math.ceil(l.length / perLine)), 0);
  }
  return Math.max(lh, count * lh);
}

export function defaultSize(node: PenNode): { width: number; height: number } {
  switch (node.type) {
    case 'text':
    case 'note':
    case 'context':
    case 'prompt': {
      const width = measureTextWidth(node) + 4;
      return { width, height: measureTextHeight(node, width) };
    }
    case 'ellipse':
    case 'rectangle':
    case 'polygon':
    case 'icon':
      return { width: 100, height: 100 };
    case 'path':
      return { width: 100, height: 100 };
    case 'frame':
      return { width: 400, height: 300 };
    default:
      return { width: 200, height: 100 };
  }
}

export interface LaidOutNode {
  node: PenNode;
  /** Absolute rectangle in document space. */
  rect: Rect;
  children: LaidOutNode[];
  parent: LaidOutNode | null;
}

export function layoutDocument(doc: PenDocument): LaidOutNode[] {
  return doc.children.map((n) => layoutNode(n, 0, 0, 0, 0, null));
}

function layoutNode(
  node: PenNode,
  originX: number,
  originY: number,
  parentWidth: number,
  parentHeight: number,
  parent: LaidOutNode | null,
): LaidOutNode {
  const def = defaultSize(node);
  let width = resolveDimension(node.width, def.width, parentWidth);
  let height = resolveDimension(node.height, def.height, parentHeight);

  const x = originX + num(node.x);
  const y = originY + num(node.y);

  const kids = node.children ?? [];
  const laidChildren: LaidOutNode[] = [];

  if (kids.length > 0) {
    const [pt, pr, pb, pl] = paddingValues(node.padding);
    const innerW = Math.max(0, width - pl - pr);
    const innerH = Math.max(0, height - pt - pb);
    const vertical = node.layout === 'vertical';
    const horizontal = node.layout === 'horizontal';
    const gap = num(node.gap);
    let cursor = 0;

    // First pass: intrinsic sizes for fit_content containers.
    if (horizontal || vertical) {
      for (const child of kids) {
        const cd = defaultSize(child);
        const cw = resolveDimension(child.width, cd.width, innerW);
        const ch = resolveDimension(child.height, cd.height, innerH);
        laidChildren.push(
          layoutNode(child, x + pl, y + pt, vertical ? innerW : innerW, vertical ? innerH : innerH, null),
        );
        const laid = laidChildren[laidChildren.length - 1];
        if (isFitContent(child.width)) laid.rect.width = cw;
        if (isFitContent(child.height)) laid.rect.height = ch;
      }

      if (isFitContent(node.width)) {
        let total = 0;
        for (const c of laidChildren) total += horizontal ? c.rect.width : c.rect.width;
        width = total + gap * Math.max(0, kids.length - 1) + pl + pr;
      }
      if (isFitContent(node.height)) {
        let total = 0;
        for (const c of laidChildren) total += vertical ? c.rect.height : c.rect.height;
        height = total + gap * Math.max(0, kids.length - 1) + pt + pb;
      }

      const mainSize = vertical ? innerH : innerW;
      const totalMain = laidChildren.reduce(
        (s, c) => s + (vertical ? c.rect.height : c.rect.width),
        0,
      );
      const free = mainSize - totalMain - gap * Math.max(0, kids.length - 1);
      const count = laidChildren.length;

      for (let i = 0; i < count; i++) {
        const c = laidChildren[i];
        let offset = cursor;
        if (node.justifyContent === 'center') offset += free / 2;
        else if (node.justifyContent === 'end') offset += free;
        else if (node.justifyContent === 'space_between' && count > 1)
          offset += (free / (count - 1)) * i;
        else if (node.justifyContent === 'space_around' && count > 0)
          offset += (free / count) * (i + 0.5);

        if (vertical) {
          c.rect.y = y + pt + offset;
          if (node.alignItems === 'center') c.rect.x = x + pl + (innerW - c.rect.width) / 2;
          else if (node.alignItems === 'end') c.rect.x = x + pl + (innerW - c.rect.width);
          else c.rect.x = x + pl;
          cursor += offset - cursor + c.rect.height + gap;
        } else {
          c.rect.x = x + pl + offset;
          if (node.alignItems === 'center') c.rect.y = y + pt + (innerH - c.rect.height) / 2;
          else if (node.alignItems === 'end') c.rect.y = y + pt + (innerH - c.rect.height);
          else c.rect.y = y + pt;
          cursor += offset - cursor + c.rect.width + gap;
        }
      }
    } else {
      for (const child of kids) {
        laidChildren.push(layoutNode(child, x, y, width, height, null));
      }
    }
  }

  if ((node.type === 'group' || node.type === 'frame') && kids.length && node.width == null && node.height == null) {
    const union = unionRects(laidChildren.map((c) => c.rect));
    if (union) {
      width = union.width;
      height = union.height;
    }
  }

  const laid: LaidOutNode = {
    node,
    rect: { x, y, width, height },
    children: laidChildren,
    parent,
  };
  for (const c of laidChildren) c.parent = laid;
  return laid;
}

export function unionRects(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let x1 = Infinity,
    y1 = Infinity,
    x2 = -Infinity,
    y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.width);
    y2 = Math.max(y2, r.y + r.height);
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function rectContains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.y >= r.y && p.x <= r.x + r.width && p.y <= r.y + r.height;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y);
}

/** Depth-first hit test; later siblings paint on top. */
export function hitTest(
  roots: LaidOutNode[],
  p: Point,
  opts: { includeHidden?: boolean } = {},
): LaidOutNode[] {
  const hits: LaidOutNode[] = [];
  const visit = (n: LaidOutNode) => {
    if (n.node.visible === false && !opts.includeHidden) return;
    if (!rectContains(n.rect, p)) return;
    for (let i = n.children.length - 1; i >= 0; i--) visit(n.children[i]);
    hits.push(n);
  };
  for (let i = roots.length - 1; i >= 0; i--) visit(roots[i]);
  return hits;
}

export function findLaidOut(roots: LaidOutNode[], id: string): LaidOutNode | null {
  for (const r of roots) {
    if (r.node.id === id) return r;
    const hit = findLaidOut(r.children, id);
    if (hit) return hit;
  }
  return null;
}

export function absoluteRect(roots: LaidOutNode[], id: string): Rect | null {
  const laid = findLaidOut(roots, id);
  return laid ? { ...laid.rect } : null;
}

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const HANDLE_IDS: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function handlePoint(rect: Rect, handle: HandleId): Point {
  switch (handle) {
    case 'nw':
      return { x: rect.x, y: rect.y };
    case 'n':
      return { x: rect.x + rect.width / 2, y: rect.y };
    case 'ne':
      return { x: rect.x + rect.width, y: rect.y };
    case 'e':
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
    case 'se':
      return { x: rect.x + rect.width, y: rect.y + rect.height };
    case 's':
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
    case 'sw':
      return { x: rect.x, y: rect.y + rect.height };
    case 'w':
      return { x: rect.x, y: rect.y + rect.height / 2 };
  }
}

export function resizeRect(
  start: Rect,
  handle: HandleId,
  dx: number,
  dy: number,
  keepAspect = false,
): Rect {
  let { x, y, width, height } = start;
  const min = MIN_SIZE;
  if (handle.includes('w')) {
    width -= dx;
    x += dx;
  }
  if (handle.includes('e')) width += dx;
  if (handle.includes('n')) {
    height -= dy;
    y += dy;
  }
  if (handle.includes('s')) height += dy;

  if (keepAspect && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height;
    if (Math.abs(width - start.width) > Math.abs(height - start.height)) {
      height = width / ratio;
      if (handle.includes('n')) y = start.y + start.height - height;
    } else {
      width = height * ratio;
      if (handle.includes('w')) x = start.x + start.width - width;
    }
  }

  if (width < min) {
    if (handle.includes('w')) x = start.x + start.width - min;
    width = min;
  }
  if (height < min) {
    if (handle.includes('n')) y = start.y + start.height - min;
    height = min;
  }
  return { x, y, width, height };
}

export function screenDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
