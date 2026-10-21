import type { PenDocument, PenNode, Paint } from '../core/types';
import { num, paintColor } from '../core/store';
import { layoutDocument } from '../core/geometry';

export function resolvePaintColor(paint: Paint | Paint[] | undefined): string | null {
  if (!paint) return null;
  if (Array.isArray(paint)) {
    return paint.length > 0 ? paintColor(paint[0]) : null;
  }
  return paintColor(paint);
}

export function renderThumbnail(
  doc: PenDocument,
  cssWidth = 560,
  cssHeight = 350
): string {
  const canvas = document.createElement('canvas');
  const dpr = 2;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Background #1d1d1f
  ctx.fillStyle = '#1d1d1f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!doc.children || doc.children.length === 0) {
    return canvas.toDataURL('image/png');
  }

  const laidOut = layoutDocument(doc);
  if (laidOut.length === 0) {
    return canvas.toDataURL('image/png');
  }

  // Calculate bounding box of top-level nodes
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const item of laidOut) {
    minX = Math.min(minX, item.rect.x);
    minY = Math.min(minY, item.rect.y);
    maxX = Math.max(maxX, item.rect.x + item.rect.width);
    maxY = Math.max(maxY, item.rect.y + item.rect.height);
  }

  const docW = maxX - minX || 800;
  const docH = maxY - minY || 600;

  const pad = 24 * dpr;
  const availW = canvas.width - pad * 2;
  const availH = canvas.height - pad * 2;

  const scale = Math.min(availW / docW, availH / docH);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-(minX + docW / 2), -(minY + docH / 2));

  // Render tree
  function renderSubtree(node: PenNode, px: number, py: number) {
    if (node.visible === false) return;
    const nx = px + (num(node.x) ?? 0);
    const ny = py + (num(node.y) ?? 0);
    const nw = num(node.width) ?? 100;
    const nh = num(node.height) ?? 100;

    ctx!.save();
    if (node.opacity != null) ctx!.globalAlpha *= Math.max(0, Math.min(1, node.opacity));

    const color = resolvePaintColor(node.fill);
    if (color) {
      ctx!.fillStyle = color;
      if (node.type === 'ellipse') {
        ctx!.beginPath();
        ctx!.ellipse(nx + nw / 2, ny + nh / 2, nw / 2, nh / 2, 0, 0, Math.PI * 2);
        ctx!.fill();
      } else {
        const radius = typeof node.cornerRadius === 'number' ? node.cornerRadius : 0;
        if (radius > 0 && typeof ctx!.roundRect === 'function') {
          ctx!.beginPath();
          ctx!.roundRect(nx, ny, nw, nh, radius);
          ctx!.fill();
        } else {
          ctx!.fillRect(nx, ny, nw, nh);
        }
      }
    }

    if (node.type === 'text' && node.content) {
      ctx!.fillStyle = color || '#000000';
      const fSize = node.fontSize || 14;
      ctx!.font = `${node.fontWeight || 'normal'} ${fSize}px sans-serif`;
      ctx!.textBaseline = 'top';
      ctx!.fillText(node.content, nx, ny);
    }

    if (node.children) {
      for (const child of node.children) {
        renderSubtree(child, nx, ny);
      }
    }

    ctx!.restore();
  }

  for (const rootNode of doc.children) {
    renderSubtree(rootNode, 0, 0);
  }

  ctx.restore();
  return canvas.toDataURL('image/png');
}
