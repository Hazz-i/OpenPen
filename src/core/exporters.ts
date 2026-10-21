/**
 * Pure SVG / HTML serializers and PNG rasterizer.
 * No network, no external fonts, no runtime dependencies.
 */
import type { Paint, PenDocument, PenNode, Rect } from './types';

interface SvgContext {
  defs: string[];
  seq: number;
  doc?: PenDocument;
  refStack: Set<string>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function activePaint(fill: Paint | Paint[] | undefined): Paint | null {
  if (!fill) return null;
  if (typeof fill === 'string') return fill;
  if (Array.isArray(fill)) {
    for (const paint of fill) {
      if (typeof paint === 'string') return paint;
      if (isObject(paint) && paint.enabled !== false) return paint as unknown as Paint;
    }
    return null;
  }
  if (isObject(fill) && fill.enabled === false) return null;
  return fill;
}

function paintOpacity(paint: Paint): number {
  if (typeof paint === 'string' || !isObject(paint)) return 1;
  return typeof paint.opacity === 'number' ? paint.opacity : 1;
}

function colorValue(paint: Paint): string | null {
  if (typeof paint === 'string') return paint === 'none' ? null : paint;
  if (isObject(paint) && paint.type === 'color' && typeof paint.color === 'string') {
    return paint.color;
  }
  return null;
}

function gradientDef(
  paint: Extract<Paint, { type: 'gradient' }>,
  ctx: SvgContext,
): string | null {
  const colors = Array.isArray(paint.colors) ? paint.colors : [];
  if (!colors.length) return null;
  const id = `grad-${++ctx.seq}`;
  const stops = colors
    .map((stop) => {
      const raw = typeof stop.position === 'number' ? stop.position : 0;
      const position = Math.min(1, Math.max(0, raw > 1 ? raw / 100 : raw));
      const color = typeof stop.color === 'string' ? stop.color : '#000000';
      return `<stop offset="${position}" stop-color="${esc(color)}"/>`;
    })
    .join('');
  const radial = paint.gradientType === 'radial';
  const def = radial
    ? `<radialGradient id="${id}" cx="50%" cy="50%" r="65%">${stops}</radialGradient>`
    : `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient>`;
  ctx.defs.push(def);
  return `url(#${id})`;
}

interface FillValue {
  value: string;
  opacity: number;
}

function paintFill(paint: Paint | null, ctx: SvgContext): FillValue | null {
  if (!paint) return null;
  const color = colorValue(paint);
  if (color) return { value: color, opacity: paintOpacity(paint) };
  if (isObject(paint) && paint.type === 'gradient') {
    const gradient = gradientDef(paint as Extract<Paint, { type: 'gradient' }>, ctx);
    if (gradient) return { value: gradient, opacity: paintOpacity(paint) };
  }
  return null;
}

function imagePaintOf(fill: Paint | Paint[] | undefined): Extract<Paint, { type: 'image' }> | null {
  const list = Array.isArray(fill) ? fill : fill ? [fill] : [];
  for (const paint of list) {
    if (isObject(paint) && paint.type === 'image' && paint.enabled !== false) {
      return paint as Extract<Paint, { type: 'image' }>;
    }
  }
  return null;
}

function preserveAspect(mode: string | undefined): string {
  if (mode === 'contain') return 'xMidYMid meet';
  if (mode === 'stretch') return 'none';
  return 'xMidYMid slice';
}

function nodeSize(node: PenNode): { width: number; height: number } {
  return {
    width: Math.max(1, num(node.width, 100)),
    height: Math.max(1, num(node.height, 100)),
  };
}

function nodeBounds(node: PenNode): Rect {
  const size = nodeSize(node);
  return {
    x: num(node.x),
    y: num(node.y),
    width: size.width,
    height: size.height,
  };
}

function cornerRadii(node: PenNode): [number, number, number, number] {
  const raw = node.cornerRadius;
  if (Array.isArray(raw)) {
    return [
      num(raw[0]),
      num(raw[1] ?? raw[0]),
      num(raw[2] ?? raw[0]),
      num(raw[3] ?? raw[1] ?? raw[0]),
    ].map((v) => Math.max(0, v)) as [number, number, number, number];
  }
  const r = Math.max(0, num(raw));
  return [r, r, r, r];
}

function roundedPath(w: number, h: number, radii: [number, number, number, number]): string {
  const max = Math.min(w, h) / 2;
  const [tl, tr, br, bl] = radii.map((r) => Math.min(max, Math.max(0, r)));
  return [
    `M${tl} 0`,
    `H${w - tr}`,
    tr ? `Q${w} 0 ${w} ${tr}` : `L${w} 0`,
    `V${h - br}`,
    br ? `Q${w} ${h} ${w - br} ${h}` : `L${w} ${h}`,
    `H${bl}`,
    bl ? `Q0 ${h} 0 ${h - bl}` : `L0 ${h}`,
    `V${tl}`,
    tl ? `Q0 0 ${tl} 0` : `L0 0`,
    'Z',
  ].join(' ');
}

function strokeAttrs(node: PenNode, ctx: SvgContext): string {
  const stroke = activePaint(node.stroke);
  if (!stroke) return '';
  const fill = paintFill(stroke, ctx);
  if (!fill) return '';
  const width = Math.max(0, num(node.strokeWidth, 1));
  if (width === 0) return '';
  let attrs = ` stroke="${fill.value}" stroke-width="${width}"`;
  if (fill.opacity < 1) attrs += ` stroke-opacity="${fill.opacity}"`;
  if (node.strokeLinecap) attrs += ` stroke-linecap="${esc(node.strokeLinecap)}"`;
  if (node.strokeLinejoin) attrs += ` stroke-linejoin="${esc(node.strokeLinejoin)}"`;
  return attrs;
}

function fillAttrs(paint: Paint | null, ctx: SvgContext): string {
  const fill = paintFill(paint, ctx);
  if (!fill) return ' fill="none"';
  let attrs = ` fill="${fill.value}"`;
  if (fill.opacity < 1) attrs += ` fill-opacity="${fill.opacity}"`;
  return attrs;
}

function clipIdFor(
  node: PenNode,
  width: number,
  height: number,
  ctx: SvgContext,
): string {
  const id = `clip-${++ctx.seq}`;
  const radii = cornerRadii(node);
  const uniform = radii.every((r) => r === radii[0]);
  if (node.type === 'ellipse') {
    ctx.defs.push(
      `<clipPath id="${id}"><ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}"/></clipPath>`,
    );
  } else if (node.type === 'polygon') {
    ctx.defs.push(`<clipPath id="${id}"><polygon points="${polygonPoints(node, width, height)}"/></clipPath>`);
  } else if (uniform) {
    const r = radii[0] || 0;
    ctx.defs.push(
      `<clipPath id="${id}"><rect x="0" y="0" width="${width}" height="${height}"${r ? ` rx="${r}"` : ''}/></clipPath>`,
    );
  } else {
    ctx.defs.push(`<clipPath id="${id}"><path d="${roundedPath(width, height, radii)}"/></clipPath>`);
  }
  return id;
}

function imageElement(
  paint: Extract<Paint, { type: 'image' }>,
  width: number,
  height: number,
  clipId?: string,
): string {
  const url = str(paint.url);
  if (!url) return '';
  const image = `<image x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="${preserveAspect(paint.mode)}" href="${esc(url)}"/>`;
  return clipId ? `<g clip-path="url(#${clipId})">${image}</g>` : image;
}

function polygonPoints(node: PenNode, width: number, height: number): string {
  const count = Math.max(3, Math.round(num(node.polygonCount, 6)));
  const cx = width / 2;
  const cy = height / 2;
  const points: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = -Math.PI / 2 + (i / count) * Math.PI * 2;
    points.push(`${cx + Math.cos(angle) * cx},${cy + Math.sin(angle) * cy}`);
  }
  return points.join(' ');
}

function transformFor(node: PenNode): string {
  const x = num(node.x);
  const y = num(node.y);
  const rotation = num(node.rotation);
  const parts = [`translate(${x} ${y})`];
  if (rotation) parts.push(`rotate(${rotation})`);
  return parts.join(' ');
}

function opacityAttr(node: PenNode): string {
  const opacity = num(node.opacity, 1);
  return opacity < 1 ? ` opacity="${Math.max(0, opacity)}"` : '';
}

function wrapText(node: PenNode, width: number, size: number): string[] {
  const raw = str(node.content).replace(/\r\n/g, '\n');
  const perLine = node.textGrowth === 'auto' ? Infinity : Math.max(1, Math.floor(width / Math.max(1, size * 0.55)));
  const out: string[] = [];
  for (const paragraph of raw.split('\n')) {
    if (!Number.isFinite(perLine) || paragraph.length <= perLine) {
      out.push(paragraph);
      continue;
    }
    const words = paragraph.split(/\s+/);
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (next.length > perLine && line) {
        out.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

function renderText(node: PenNode, width: number, ctx: SvgContext): string {
  const size = Math.max(1, num(node.fontSize, 16));
  const lineHeight = size * Math.max(0.5, num(node.lineHeight, 1.2));
  const fill = paintFill(activePaint(node.fill), ctx);
  const fillValue = fill?.value ?? '#000000';
  const align = node.textAlign === 'center' ? 'middle' : node.textAlign === 'right' ? 'end' : 'start';
  const x = align === 'middle' ? width / 2 : align === 'end' ? width : 0;
  const lines = wrapText(node, width, size);
  const baseline = size * 0.82;
  const tspans = lines
    .map(
      (line, index) =>
        `<tspan x="${x}"${index === 0 ? ` y="${baseline}"` : ` dy="${lineHeight}"`}>${esc(line)}</tspan>`,
    )
    .join('');
  let attrs = '';
  if (node.fontFamily) attrs += ` font-family="${esc(node.fontFamily)}"`;
  if (node.fontStyle) attrs += ` font-style="${esc(node.fontStyle)}"`;
  if (node.fontWeight) attrs += ` font-weight="${esc(String(node.fontWeight))}"`;
  if (node.letterSpacing != null) attrs += ` letter-spacing="${num(node.letterSpacing)}"`;
  if (node.underline || node.strikethrough) {
    const decorations = [node.underline ? 'underline' : '', node.strikethrough ? 'line-through' : '']
      .filter(Boolean)
      .join(' ');
    attrs += ` text-decoration="${decorations}"`;
  }
  const opacity = fill && fill.opacity < 1 ? ` fill-opacity="${fill.opacity}"` : '';
  return `<text${attrs} font-size="${size}" fill="${fillValue}" text-anchor="${align}"${opacity}>${tspans}</text>`;
}

function renderShapeBody(
  node: PenNode,
  width: number,
  height: number,
  ctx: SvgContext,
  fillPaint: Paint | null,
): string {
  const stroke = strokeAttrs(node, ctx);
  const image = imagePaintOf(node.fill);
  if (image) {
    const clip = clipIdFor(node, width, height, ctx);
    const shape =
      node.type === 'ellipse'
        ? `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}" fill="none"${stroke}/>`
        : node.type === 'polygon'
          ? `<polygon points="${polygonPoints(node, width, height)}" fill="none"${stroke}/>`
          : `<rect x="0" y="0" width="${width}" height="${height}" fill="none"${stroke}/>`;
    return imageElement(image, width, height, clip) + shape;
  }

  const fill = fillAttrs(fillPaint, ctx);
  if (node.type === 'ellipse') {
    return `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}"${fill}${stroke}/>`;
  }
  if (node.type === 'polygon') {
    return `<polygon points="${polygonPoints(node, width, height)}"${fill}${stroke}/>`;
  }
  const radii = cornerRadii(node);
  const uniform = radii.every((r) => r === radii[0]);
  if (uniform) {
    const r = radii[0] || 0;
    return `<rect x="0" y="0" width="${width}" height="${height}"${r ? ` rx="${r}"` : ''}${fill}${stroke}/>`;
  }
  return `<path d="${roundedPath(width, height, radii)}"${fill}${stroke}/>`;
}

function renderPath(node: PenNode, width: number, height: number, ctx: SvgContext): string {
  const geometry = str(node.geometry);
  if (!geometry) return '';
  const fill = fillAttrs(activePaint(node.fill), ctx);
  const stroke = strokeAttrs(node, ctx);
  let transform = '';
  if (Array.isArray(node.viewBox) && node.viewBox.length === 4) {
    const [vx, vy, vw, vh] = node.viewBox.map((v) => num(v));
    if (vw > 0 && vh > 0) {
      const sx = width / vw;
      const sy = height / vh;
      transform = ` transform="scale(${sx} ${sy}) translate(${-vx} ${-vy})"`;
    }
  }
  const rule = node.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : '';
  return `<g${transform}><path d="${esc(geometry)}"${fill}${stroke}${rule}/></g>`;
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

function renderRef(node: PenNode, width: number, height: number, ctx: SvgContext, depth: number): string {
  const ref = str(node.ref);
  if (!ref || !ctx.doc || ctx.refStack.has(ref)) return '';
  const source = findNode(ctx.doc.children, ref);
  if (!source) return '';
  const clone: PenNode = {
    ...source,
    id: `${node.id}-source`,
    x: 0,
    y: 0,
    width,
    height,
    rotation: 0,
    opacity: 1,
  };
  if (source.type !== 'frame' && source.type !== 'group') {
    return renderShapeBody(clone, width, height, ctx, activePaint(clone.fill));
  }
  if (clone.children) clone.children = source.children ?? [];
  ctx.refStack.add(ref);
  try {
    return renderNode(clone, ctx, depth + 1);
  } finally {
    ctx.refStack.delete(ref);
  }
}

function renderNode(node: PenNode, ctx: SvgContext, depth: number): string {
  if (node.visible === false || depth > 60) return '';
  const { width, height } = nodeSize(node);

  if (node.type === 'ref') {
    const contents = renderRef(node, width, height, ctx, depth);
    if (!contents) return '';
    return `<g transform="${transformFor(node)}"${opacityAttr(node)}>${contents}</g>`;
  }

  if (node.type === 'text' || node.type === 'note' || node.type === 'prompt' || node.type === 'context') {
    return `<g transform="${transformFor(node)}"${opacityAttr(node)}>${renderText(node, width, ctx)}</g>`;
  }

  if (node.type === 'frame' || node.type === 'group') {
    let inner = '';
    if (node.type === 'frame') inner += renderShapeBody(node, width, height, ctx, activePaint(node.fill));
    const children = (node.children ?? []).map((child) => renderNode(child, ctx, depth + 1)).join('');
    if (children) {
      if (node.clip) {
        const clip = clipIdFor(node, width, height, ctx);
        inner += `<g clip-path="url(#${clip})">${children}</g>`;
      } else {
        inner += children;
      }
    }
    return `<g transform="${transformFor(node)}"${opacityAttr(node)}>${inner}</g>`;
  }

  if (node.type === 'path') {
    return `<g transform="${transformFor(node)}"${opacityAttr(node)}>${renderPath(node, width, height, ctx)}</g>`;
  }

  if (node.type === 'rectangle' || node.type === 'ellipse' || node.type === 'polygon') {
    return `<g transform="${transformFor(node)}"${opacityAttr(node)}>${renderShapeBody(
      node,
      width,
      height,
      ctx,
      activePaint(node.fill),
    )}</g>`;
  }

  return '';
}

function svgShell(
  width: number,
  height: number,
  inner: string,
  defs: string[],
  minX = 0,
  minY = 0,
): string {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    defs.length ? `<defs>${defs.join('')}</defs>` : '',
    `<g transform="translate(${-minX} ${-minY})">`,
    inner,
    '</g>',
    '</svg>',
  ].join('');
}

export function nodeToSvg(node: PenNode, doc?: PenDocument): string {
  const bounds = nodeBounds(node);
  const ctx: SvgContext = { defs: [], seq: 0, doc, refStack: new Set() };
  const inner = renderNode(node, ctx, 0);
  return svgShell(bounds.width, bounds.height, inner, ctx.defs, bounds.x, bounds.y);
}

export function documentToSvg(doc: PenDocument): string {
  const rects = doc.children.map((node) => nodeBounds(node));
  const minX = rects.length ? Math.min(...rects.map((r) => r.x)) : 0;
  const minY = rects.length ? Math.min(...rects.map((r) => r.y)) : 0;
  const maxX = rects.length ? Math.max(...rects.map((r) => r.x + r.width)) : 800;
  const maxY = rects.length ? Math.max(...rects.map((r) => r.y + r.height)) : 600;
  const ctx: SvgContext = { defs: [], seq: 0, doc, refStack: new Set() };
  const inner = doc.children.map((node) => renderNode(node, ctx, 0)).join('');
  return svgShell(maxX - minX, maxY - minY, inner, ctx.defs, minX, minY);
}

/* ------------------------------------------------------------------ */
/* HTML                                                               */
/* ------------------------------------------------------------------ */

function cssColor(paint: Paint | null): string | null {
  if (!paint) return null;
  const color = colorValue(paint);
  if (color) return color;
  if (isObject(paint) && paint.type === 'gradient' && Array.isArray(paint.colors)) {
    const first = paint.colors[0];
    if (first && typeof first.color === 'string') return first.color;
  }
  return null;
}

function cssBackground(fill: Paint | Paint[] | undefined): string | null {
  const paint = activePaint(fill);
  if (!paint) return null;
  if (typeof paint === 'string') return paint === 'none' ? null : paint;
  if (isObject(paint) && paint.type === 'color' && typeof paint.color === 'string') {
    return paint.color;
  }
  if (isObject(paint) && paint.type === 'image' && typeof paint.url === 'string') {
    const fit = paint.mode === 'contain' ? 'contain' : paint.mode === 'stretch' ? '100% 100%' : 'cover';
    return `url("${paint.url.replace(/"/g, '%22')}")|${fit}`;
  }
  if (isObject(paint) && paint.type === 'gradient' && Array.isArray(paint.colors)) {
    const stops = paint.colors
      .map((stop) => {
        const raw = typeof stop.position === 'number' ? stop.position : 0;
        const position = Math.min(1, Math.max(0, raw > 1 ? raw / 100 : raw)) * 100;
        return `${stop.color} ${position}%`;
      })
      .join(', ');
    return paint.gradientType === 'radial'
      ? `radial-gradient(circle at center, ${stops})`
      : `linear-gradient(135deg, ${stops})`;
  }
  return null;
}

function backgroundStyle(fill: Paint | Paint[] | undefined): string {
  const background = cssBackground(fill);
  if (!background) return '';
  if (background.startsWith('url("')) {
    const [url, fit] = background.split('|');
    return `background-image:${url};background-size:${fit || 'cover'};background-position:center;background-repeat:no-repeat;`;
  }
  return `background:${background};`;
}

function borderStyle(node: PenNode): string {
  const stroke = activePaint(node.stroke);
  const color = cssColor(stroke);
  if (!color) return '';
  const width = Math.max(0, num(node.strokeWidth, 1));
  if (!width) return '';
  return `border:${width}px ${node.strokeStyle === 'dashed' ? 'dashed' : 'solid'} ${color};`;
}

function radiusStyle(node: PenNode): string {
  const [tl, tr, br, bl] = cornerRadii(node);
  if (!tl && !tr && !br && !bl) return '';
  if (tl === tr && tr === br && br === bl) return `border-radius:${tl}px;`;
  return `border-radius:${tl}px ${tr}px ${br}px ${bl}px;`;
}

function htmlNodeStyle(node: PenNode, x: number, y: number): string {
  const { width, height } = nodeSize(node);
  const rotation = num(node.rotation);
  const opacity = num(node.opacity, 1);
  return [
    'position:absolute',
    `left:${x}px`,
    `top:${y}px`,
    `width:${width}px`,
    `height:${height}px`,
    'box-sizing:border-box',
    rotation ? `transform:rotate(${rotation}deg)` : '',
    rotation ? 'transform-origin:0 0' : '',
    opacity < 1 ? `opacity:${Math.max(0, opacity)}` : '',
  ]
    .filter(Boolean)
    .join(';');
}

function textStyle(node: PenNode): string {
  const color = cssColor(activePaint(node.fill)) ?? '#000000';
  const size = Math.max(1, num(node.fontSize, 16));
  return [
    `color:${color}`,
    `font-family:${node.fontFamily ? `${node.fontFamily}, system-ui, sans-serif` : 'Inter, system-ui, sans-serif'}`,
    `font-size:${size}px`,
    `font-weight:${node.fontWeight ?? '400'}`,
    `line-height:${num(node.lineHeight, 1.2)}`,
    node.textAlign ? `text-align:${node.textAlign}` : '',
    node.letterSpacing != null ? `letter-spacing:${num(node.letterSpacing)}px` : '',
    node.fontStyle ? `font-style:${node.fontStyle}` : '',
    node.underline ? 'text-decoration:underline' : '',
    node.strikethrough ? 'text-decoration:line-through' : '',
    'white-space:pre-wrap',
    'overflow-wrap:break-word',
  ]
    .filter(Boolean)
    .join(';');
}

function renderHtmlNode(
  node: PenNode,
  doc: PenDocument | undefined,
  offsetX: number,
  offsetY: number,
  depth: number,
  refStack: Set<string>,
): string {
  if (node.visible === false || depth > 60) return '';
  const x = num(node.x) + offsetX;
  const y = num(node.y) + offsetY;
  const { width, height } = nodeSize(node);
  const common = htmlNodeStyle(node, x, y);
  const name = esc(node.name ?? node.type);

  if (node.type === 'ref') {
    const ref = str(node.ref);
    if (!ref || !doc || refStack.has(ref)) return '';
    const source = findNode(doc.children, ref);
    if (!source) return '';
    const clone: PenNode = { ...source, x: 0, y: 0, width, height, rotation: 0, opacity: 1 };
    refStack.add(ref);
    try {
      const body = renderHtmlNode(clone, doc, 0, 0, depth + 1, refStack);
      return `<div class="pn-node" data-name="${name}" style="${common}">${body}</div>`;
    } finally {
      refStack.delete(ref);
    }
  }

  if (node.type === 'text' || node.type === 'note' || node.type === 'prompt' || node.type === 'context') {
    return `<div class="pn-text" data-name="${name}" style="${common};${textStyle(node)}">${esc(
      str(node.content),
    )}</div>`;
  }

  if (node.type === 'path') {
    const geometry = str(node.geometry);
    if (!geometry) return '';
    const fill = cssColor(activePaint(node.fill)) ?? 'none';
    const stroke = cssColor(activePaint(node.stroke));
    const strokeWidth = Math.max(0, num(node.strokeWidth, 1));
    const strokeAttrs = stroke ? ` stroke="${esc(stroke)}" stroke-width="${strokeWidth}"` : '';
    return `<div class="pn-node" data-name="${name}" style="${common}"><svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><path d="${esc(
      geometry,
    )}" fill="${esc(fill)}"${strokeAttrs}/></svg></div>`;
  }

  const background = backgroundStyle(node.fill);
  const border = borderStyle(node);
  const radius = radiusStyle(node);
  const clip = node.clip ? 'overflow:hidden;' : '';
  const ellipse = node.type === 'ellipse' ? 'border-radius:50%;' : '';
  const polygon =
    node.type === 'polygon'
      ? `clip-path:polygon(${polygonPoints(node, 100, 100)
          .split(' ')
          .map((pair) => {
            const [px, py] = pair.split(',').map((v) => Number(v));
            return `${(px / 100) * 100}% ${(py / 100) * 100}%`;
          })
          .join(', ')});`
      : '';

  const children = (node.children ?? [])
    .map((child) => renderHtmlNode(child, doc, 0, 0, depth + 1, refStack))
    .join('');

  return `<div class="pn-node" data-name="${name}" style="${common};${background}${border}${radius}${ellipse}${polygon}${clip}">${children}</div>`;
}

const HTML_STYLE = [
  '*{box-sizing:border-box}',
  'html,body{margin:0;padding:0}',
  'body{background:#ffffff}',
  '.pn-page{position:relative;overflow:hidden}',
  '.pn-node,.pn-text{position:absolute}',
  '.pn-text{white-space:pre-wrap;overflow-wrap:break-word}',
].join('\n');

export function nodeToHtml(node: PenNode, opts: { inline?: boolean } = {}): string {
  const bounds = nodeBounds(node);
  const body = renderHtmlNode(node, undefined, -bounds.x, -bounds.y, 0, new Set());
  if (opts.inline !== false) {
    return `<div class="pn-page" style="position:relative;width:${Math.ceil(bounds.width)}px;height:${Math.ceil(
      bounds.height,
    )}px;overflow:hidden">${body}</div>`;
  }
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8"/>',
    '<meta name="viewport" content="width=device-width, initial-scale=1"/>',
    `<title>${esc(node.name ?? 'Export')}</title>`,
    `<style>${HTML_STYLE}</style>`,
    '</head>',
    '<body>',
    `<div class="pn-page" style="width:${Math.ceil(bounds.width)}px;height:${Math.ceil(
      bounds.height,
    )}px;overflow:hidden">${body}</div>`,
    '</body>',
    '</html>',
  ].join('\n');
}

export function documentToHtml(doc: PenDocument): string {
  const rects = doc.children.map((node) => nodeBounds(node));
  const minX = rects.length ? Math.min(...rects.map((r) => r.x)) : 0;
  const minY = rects.length ? Math.min(...rects.map((r) => r.y)) : 0;
  const maxX = rects.length ? Math.max(...rects.map((r) => r.x + r.width)) : 800;
  const maxY = rects.length ? Math.max(...rects.map((r) => r.y + r.height)) : 600;
  const width = Math.max(1, Math.ceil(maxX - minX));
  const height = Math.max(1, Math.ceil(maxY - minY));
  const body = doc.children
    .map((node) => renderHtmlNode(node, doc, -minX, -minY, 0, new Set()))
    .join('');

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8"/>',
    '<meta name="viewport" content="width=device-width, initial-scale=1"/>',
    '<title>Pencil export</title>',
    `<style>${HTML_STYLE}</style>`,
    '</head>',
    '<body>',
    `<div class="pn-page" style="width:${width}px;height:${height}px;overflow:hidden">${body}</div>`,
    '</body>',
    '</html>',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* PNG + downloads                                                    */
/* ------------------------------------------------------------------ */

export async function svgToPngBlob(
  svg: string,
  width: number,
  height: number,
  scale: number,
): Promise<Blob> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new Error('PNG export requires a browser');
  }
  const safeScale = Math.min(8, Math.max(0.1, Number.isFinite(scale) ? scale : 1));
  const w = Math.max(1, Math.round(width * safeScale));
  const h = Math.max(1, Math.round(height * safeScale));

  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not rasterize SVG'));
      img.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    ctx.drawImage(image, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not encode PNG');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function exportName(name: string, extension: string): string {
  const base = (name || 'export').replace(/\.(pen|png|svg|html?)$/i, '');
  return `${base}.${extension}`;
}

export function downloadSvg(doc: PenDocument, node: PenNode | null, name: string): void {
  const svg = node ? nodeToSvg(node, doc) : documentToSvg(doc);
  downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), exportName(name, 'svg'));
}

export function downloadHtml(doc: PenDocument, node: PenNode | null, name: string): void {
  const html = node ? nodeToHtml(node, { inline: false }) : documentToHtml(doc);
  downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), exportName(name, 'html'));
}

export async function downloadPng(
  doc: PenDocument,
  node: PenNode | null,
  name: string,
  scale: number,
  background?: string,
): Promise<void> {
  const bounds = node ? nodeBounds(node) : documentBounds(doc);
  let svg = node ? nodeToSvg(node, doc) : documentToSvg(doc);
  if (background) {
    svg = svg.replace(
      /<svg([^>]*)>/,
      `<svg$1><rect x="0" y="0" width="100%" height="100%" fill="${esc(background)}"/>`,
    );
  }
  const blob = await svgToPngBlob(svg, bounds.width, bounds.height, scale);
  downloadBlob(blob, exportName(name, 'png'));
}

function documentBounds(doc: PenDocument): Rect {
  if (!doc.children.length) return { x: 0, y: 0, width: 800, height: 600 };
  const rects = doc.children.map((node) => nodeBounds(node));
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return;
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch {
    // Download blocked; nothing else to do.
  }
}
