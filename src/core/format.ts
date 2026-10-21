/**
 * .pen file (de)serialization. The parser is intentionally forgiving: documents
 * coming from the wild can be missing ids, contain numeric strings, or carry
 * node types this clone does not implement yet.
 */
import type { NodeType, Paint, PenDocument, PenNode } from './types';
import { uid } from './store';

export const PEN_VERSION = '2.21';

const VALID_TYPES = new Set<NodeType>([
  'frame',
  'group',
  'rectangle',
  'ellipse',
  'polygon',
  'path',
  'text',
  'note',
  'prompt',
  'context',
  'icon',
  'ref',
]);

const CONTAINERS = new Set<NodeType>(['frame', 'group']);

const ID_PREFIX: Record<NodeType, string> = {
  frame: 'fr',
  group: 'gr',
  rectangle: 'rc',
  ellipse: 'el',
  polygon: 'pg',
  path: 'pt',
  text: 'tx',
  note: 'nt',
  prompt: 'pm',
  context: 'cx',
  icon: 'ic',
  ref: 'rf',
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function numOr(value: unknown, fallback: number): number {
  return toNumber(value) ?? fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizePaint(value: unknown): Paint | Paint[] | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const paints = value.filter((v) => typeof v === 'string' || isObject(v)) as Paint[];
    return paints.length ? paints : undefined;
  }
  if (isObject(value)) return value as unknown as Paint;
  return undefined;
}

function normalizeNode(
  raw: unknown,
  seen: Set<string>,
  depth: number,
): PenNode | null {
  if (!isObject(raw)) return null;
  if (depth > 80) return null;

  const type = raw.type as NodeType;
  if (typeof type !== 'string' || !VALID_TYPES.has(type)) return null;

  const node = { ...raw } as PenNode;
  node.type = type;

  if (typeof node.id !== 'string' || node.id.trim() === '' || seen.has(node.id)) {
    node.id = uid(ID_PREFIX[type] ?? 'nd');
  }
  seen.add(node.id);

  node.x = numOr(node.x, 0);
  node.y = numOr(node.y, 0);

  // width/height can be sizing behaviours ("fill", "hug", ...) in real files;
  // only convert when the value is actually numeric.
  const width = toNumber(node.width);
  if (width !== null) node.width = width;
  else if (typeof node.width !== 'string' || node.width === '') node.width = 100;

  const height = toNumber(node.height);
  if (height !== null) node.height = height;
  else if (typeof node.height !== 'string' || node.height === '') node.height = 100;

  node.rotation = toNumber(node.rotation) ?? 0;
  node.opacity = clamp(numOr(node.opacity, 1), 0, 1);

  const paint = normalizePaint(node.fill);
  if (paint === undefined) delete node.fill;
  else node.fill = paint;

  if (CONTAINERS.has(type)) {
    if (!Array.isArray(node.children)) node.children = [];
  }

  if (Array.isArray(node.children)) {
    const children: PenNode[] = [];
    for (const child of node.children) {
      const normalized = normalizeNode(child, seen, depth + 1);
      if (normalized) children.push(normalized);
    }
    node.children = children;
  } else if (CONTAINERS.has(type)) {
    node.children = [];
  }

  if (type === 'frame' && typeof node.clip !== 'boolean') node.clip = true;
  if (type === 'text' && node.content == null) node.content = '';

  return node;
}

/** Deep-normalizes a document. Never throws for object-shaped input. */
export function hydrateDocument(doc: PenDocument): PenDocument {
  const source: Record<string, unknown> = isObject(doc) ? (doc as unknown as Record<string, unknown>) : {};
  const out: PenDocument = { ...(source as Partial<PenDocument>) } as PenDocument;

  out.version =
    typeof out.version === 'string' && out.version.trim() !== '' ? out.version : PEN_VERSION;

  const seen = new Set<string>();
  const rawChildren = Array.isArray(source.children) ? source.children : [];
  const children: PenNode[] = [];
  for (const child of rawChildren) {
    const node = normalizeNode(child, seen, 0);
    if (node) children.push(node);
  }
  out.children = children;

  if (!isObject(out.variables)) delete out.variables;
  if (!isObject(out.imports)) delete out.imports;
  if (!isObject(out.themes)) delete out.themes;

  return out;
}

/** Tolerant .pen parser. Throws only when `text` is not valid JSON. */
export function parsePenFile(text: string): PenDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Invalid .pen file: expected JSON');
  }
  return hydrateDocument(parsed as PenDocument);
}

/** Pretty, 2-space JSON suitable for a .pen download. */
export function serializePenFile(doc: PenDocument): string {
  return JSON.stringify(doc, null, 2);
}

export function createBlankDocument(): PenDocument {
  return {
    version: PEN_VERSION,
    children: [createNode('frame', 0, 0, 800, 600)],
  };
}

export function createNode(
  type: 'frame' | 'rectangle' | 'ellipse' | 'text' | 'polygon' | 'path',
  x: number,
  y: number,
  width: number,
  height: number,
): PenNode {
  const base: PenNode = {
    type,
    id: uid(ID_PREFIX[type] ?? 'nd'),
    x,
    y,
    width,
    height,
    layout: 'none',
  };

  switch (type) {
    case 'frame':
      return {
        ...base,
        name: 'Frame',
        clip: true,
        fill: '#FFFFFF',
        children: [],
      };
    case 'rectangle':
      return { ...base, name: 'Rectangle', fill: '#D9D9D9', cornerRadius: 0 };
    case 'ellipse':
      return { ...base, name: 'Ellipse', fill: '#D9D9D9' };
    case 'text':
      return {
        ...base,
        name: 'Text',
        content: 'Text',
        fontFamily: 'Inter',
        fontSize: 16,
        fontWeight: '400',
        lineHeight: 1.2,
        fill: '#18181B',
        textGrowth: 'fixed-width',
      };
    case 'polygon':
      return { ...base, name: 'Polygon', fill: '#D9D9D9', polygonCount: 6 };
    case 'path':
      return {
        ...base,
        name: 'Path',
        fill: 'none',
        stroke: '#18181B',
        strokeWidth: 2,
        geometry: 'M0 0L100 0L50 100Z',
      };
  }
}
