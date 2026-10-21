/**
 * Image / attachment helpers shared by the canvas, agent panel and exporters.
 * Images are embedded as data URLs; nothing is fetched from the network.
 */
import type { Paint, PenDocument, PenNode } from './types';
import { uid } from './store';

export interface ImageAsset {
  id: string;
  name: string;
  dataUrl: string;
  width: number;
  height: number;
  size: number;
}

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function imagePaint(
  value: Paint | Paint[] | undefined,
): Extract<Paint, { type: 'image' }> | null {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  for (const paint of list) {
    if (typeof paint === 'object' && paint !== null && paint.type === 'image') {
      return paint as Extract<Paint, { type: 'image' }>;
    }
  }
  return null;
}

function assetMetadata(node: PenNode): Record<string, unknown> {
  const meta = node.metadata;
  return typeof meta === 'object' && meta !== null && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : {};
}

/** Cached image loader. Rejections are evicted so a retry can succeed. */
export function loadImageElement(url: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(url);
  if (cached) return cached;

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    if (typeof Image === 'undefined') {
      reject(new Error('Image is not available in this environment'));
      return;
    }
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image'));
    img.src = url;
  });

  imageCache.set(url, promise);
  void promise.catch(() => imageCache.delete(url));
  return promise;
}

export function clampImageSize(w: number, h: number, max = 640): { width: number; height: number } {
  const limit = max > 0 ? max : 640;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { width: limit, height: limit };
  }
  const scale = Math.min(1, limit / w, limit / h);
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

export function createImageNode(asset: ImageAsset, x: number, y: number): PenNode {
  const size = clampImageSize(asset.width, asset.height);
  const fill: Paint = {
    type: 'image',
    url: asset.dataUrl,
    mode: 'cover',
    enabled: true,
  };
  return {
    type: 'rectangle',
    id: uid('img'),
    name: asset.name || 'Image',
    x,
    y,
    width: size.width,
    height: size.height,
    layout: 'none',
    fill,
    cornerRadius: 0,
    metadata: {
      assetId: asset.id,
      assetName: asset.name,
      assetSize: asset.size,
      assetWidth: asset.width,
      assetHeight: asset.height,
    },
  };
}

export function createTextFileNode(name: string, text: string, x: number, y: number): PenNode {
  const fileName = name.trim() || 'Attachment.txt';
  const body = String(text ?? '');
  const content = `${fileName}\n\n${body}`;
  const width = 420;
  const fontSize = 13;
  const lineHeight = 1.5;
  const approxPerLine = Math.max(12, Math.floor(width / (fontSize * 0.55)));
  let lines = 0;
  for (const paragraph of content.split('\n')) {
    lines += Math.max(1, Math.ceil(paragraph.length / approxPerLine));
  }
  const height = Math.max(100, Math.min(560, Math.round(28 + lines * fontSize * lineHeight)));

  return {
    type: 'note',
    id: uid('note'),
    name: fileName,
    x,
    y,
    width,
    height,
    layout: 'none',
    content,
    textGrowth: 'fixed-width-height',
    fontFamily: 'Inter',
    fontSize,
    fontWeight: '400',
    lineHeight,
    fill: '#27272A',
    metadata: {
      attachmentName: fileName,
      attachmentSize: body.length,
    },
  };
}

export function listAssets(doc: PenDocument): ImageAsset[] {
  const out: ImageAsset[] = [];
  const seen = new Set<string>();

  const visit = (nodes: PenNode[]): void => {
    for (const node of nodes) {
      const paint = imagePaint(node.fill);
      if (paint && paint.type === 'image' && typeof paint.url === 'string' && paint.url.startsWith('data:')) {
        const meta = assetMetadata(node);
        const assetId = typeof meta.assetId === 'string' ? meta.assetId : null;
        const key = assetId ?? paint.url;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({
            id: assetId ?? `img-${out.length + 1}`,
            name:
              (typeof meta.assetName === 'string' && meta.assetName) ||
              node.name ||
              'Image',
            dataUrl: paint.url,
            width: num(node.width),
            height: num(node.height),
            size:
              (typeof meta.assetSize === 'number' && Number.isFinite(meta.assetSize)
                ? meta.assetSize
                : Math.round(paint.url.length * 0.75)),
          });
        }
      }
      if (node.children) visit(node.children);
    }
  };

  visit(doc.children);
  return out;
}
