import type { Paint, PaintGradient, PenNode } from '../core/types';
import { svgIcon } from './icons';
import { toast } from './dialogs';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/components.css';
import '../styles/imports.css';


type FigmaRecord = Record<string, unknown>;

const MAX_FIGMA_NODES = 3000;
const MAX_FIGMA_DEPTH = 50;

function isFigmaRecord(value: unknown): value is FigmaRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): FigmaRecord | null {
  return isFigmaRecord(value) ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hexByte(value: number): string {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0').toUpperCase();
}

function figmaColor(value: unknown, opacity = 1): string | null {
  const color = asRecord(value);
  if (!color) return null;
  const alpha = clamp(asNumber(color.a, 1) * clamp(opacity, 0, 1), 0, 1);
  const hex = `#${hexByte(asNumber(color.r) * 255)}${hexByte(asNumber(color.g) * 255)}${hexByte(
    asNumber(color.b) * 255,
  )}`;
  return alpha < 0.999 ? `${hex}${hexByte(alpha * 255)}` : hex;
}

function figmaGradient(paint: FigmaRecord): PaintGradient | null {
  const stops = asArray(paint.gradientStops);
  const colors: { color: string; position: number }[] = [];
  for (const rawStop of stops) {
    const stop = asRecord(rawStop);
    if (!stop) continue;
    const color = figmaColor(stop.color);
    if (!color) continue;
    colors.push({ color, position: clamp(asNumber(stop.position), 0, 1) });
  }
  if (colors.length < 2) return null;
  const gradient: PaintGradient = {
    type: 'gradient',
    gradientType: asString(paint.type) === 'GRADIENT_RADIAL' ? 'radial' : 'linear',
    colors,
  };
  const opacity = asNumber(paint.opacity, 1);
  if (opacity < 1) gradient.opacity = clamp(opacity, 0, 1);
  return gradient;
}

function figmaFill(fills: unknown): Paint | undefined {
  let imagePlaceholder = false;
  for (const rawPaint of asArray(fills)) {
    const paint = asRecord(rawPaint);
    if (!paint || paint.visible === false) continue;
    const type = asString(paint.type);
    if (type === 'SOLID') {
      const color = figmaColor(paint.color, asNumber(paint.opacity, 1));
      if (color) return color;
    } else if (type === 'GRADIENT_LINEAR' || type === 'GRADIENT_RADIAL') {
      const gradient = figmaGradient(paint);
      if (gradient) return gradient;
    } else if (type === 'IMAGE') {
      imagePlaceholder = true;
    }
  }
  return imagePlaceholder ? '#e4e4e7' : undefined;
}

function figmaStroke(node: FigmaRecord): { stroke?: Paint; strokeWidth?: number } {
  for (const rawPaint of asArray(node.strokes)) {
    const paint = asRecord(rawPaint);
    if (!paint || paint.visible === false || asString(paint.type) !== 'SOLID') continue;
    const color = figmaColor(paint.color, asNumber(paint.opacity, 1));
    if (!color) continue;
    const width = asNumber(node.strokeWeight, 1);
    if (width <= 0) return {};
    return { stroke: color, strokeWidth: width };
  }
  return {};
}

function figmaCornerRadius(node: FigmaRecord): number | [number, number, number, number] | undefined {
  const radii = asArray(node.rectangleCornerRadii);
  if (radii.length === 4 && radii.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return [
      Math.max(0, asNumber(radii[0])),
      Math.max(0, asNumber(radii[1])),
      Math.max(0, asNumber(radii[2])),
      Math.max(0, asNumber(radii[3])),
    ];
  }
  const radius = asNumber(node.cornerRadius, NaN);
  return Number.isFinite(radius) && radius >= 0 ? radius : undefined;
}

function figmaFontWeight(style: FigmaRecord): string | undefined {
  const fontName = asRecord(style.fontName);
  const styleName = `${asString(fontName?.style)} ${asString(style.fontStyle)}`.toLowerCase();
  if (/semi\s*bold/.test(styleName)) return '600';
  if (/extra\s*bold|ultra\s*bold/.test(styleName)) return '800';
  if (/bold/.test(styleName)) return '700';
  if (/black|heavy/.test(styleName)) return '900';
  if (/medium/.test(styleName)) return '500';
  if (/light/.test(styleName)) return '300';
  if (/thin|hairline/.test(styleName)) return '100';
  if (/regular|book|normal/.test(styleName)) return '400';
  const numeric = asNumber(style.fontWeight, NaN);
  return Number.isFinite(numeric) ? String(Math.round(numeric)) : undefined;
}

function figmaTextStyle(node: FigmaRecord): Partial<PenNode> {
  const style = asRecord(node.style) ?? {};
  const fontName = asRecord(style.fontName);
  const fontSize = asNumber(style.fontSize, 14);
  const text: Partial<PenNode> = {
    content: asString(node.characters),
    fontSize: Math.max(1, fontSize),
  };

  const family = asString(fontName?.family) || asString(style.fontFamily);
  if (family) text.fontFamily = family;
  const weight = figmaFontWeight(style);
  if (weight) text.fontWeight = weight;
  const styleName = `${asString(fontName?.style)} ${asString(style.fontStyle)}`.toLowerCase();
  if (/italic|oblique/.test(styleName)) text.fontStyle = 'italic';

  const letterSpacing = asNumber(style.letterSpacing, NaN);
  if (Number.isFinite(letterSpacing)) text.letterSpacing = letterSpacing;

  const lineHeightPx = asNumber(style.lineHeightPx, NaN);
  if (Number.isFinite(lineHeightPx) && fontSize > 0) {
    const multiplier = lineHeightPx / fontSize;
    if (multiplier >= 0.5 && multiplier <= 4) text.lineHeight = multiplier;
  }

  const align = (asString(node.textAlignHorizontal) || asString(style.textAlignHorizontal)).toUpperCase();
  if (align === 'LEFT' || align === 'CENTER' || align === 'RIGHT' || align === 'JUSTIFIED') {
    text.textAlign = align === 'JUSTIFIED' ? 'justify' : (align.toLowerCase() as 'left' | 'center' | 'right');
  }

  const fill = figmaFill(node.fills);
  if (fill) text.fill = fill;
  return text;
}

function figmaGeometry(node: FigmaRecord): string | null {
  for (const key of ['fillGeometry', 'strokeGeometry']) {
    for (const rawGeometry of asArray(node[key])) {
      const geometry = asRecord(rawGeometry);
      const path = asString(geometry?.path);
      if (path) return path;
    }
  }
  return null;
}

function figmaBox(
  node: FigmaRecord,
  parentX: number,
  parentY: number,
): { absX: number; absY: number; width: number; height: number } {
  const bbox = asRecord(node.absoluteBoundingBox);
  const size = asRecord(node.size);
  const absX = bbox ? asNumber(bbox.x, parentX) : parentX + asNumber(node.x, 0);
  const absY = bbox ? asNumber(bbox.y, parentY) : parentY + asNumber(node.y, 0);
  const width = bbox
    ? asNumber(bbox.width, 100)
    : asNumber(node.width, asNumber(size?.x, 100));
  const height = bbox
    ? asNumber(bbox.height, 100)
    : asNumber(node.height, asNumber(size?.y, 100));
  return {
    absX,
    absY,
    width: Math.max(0, Number.isFinite(width) ? width : 100),
    height: Math.max(0, Number.isFinite(height) ? height : 100),
  };
}

interface FigmaConvertState {
  count: number;
  ids: Set<string>;
  seq: number;
}

function figmaId(rawId: unknown, state: FigmaConvertState): string {
  const suffix = asString(rawId).replace(/[^a-zA-Z0-9_-]/g, '-');
  const base = suffix ? `fg-${suffix}` : `fg-node-${++state.seq}`;
  let id = base;
  let duplicate = 1;
  while (state.ids.has(id)) {
    duplicate += 1;
    id = `${base}-${duplicate}`;
  }
  state.ids.add(id);
  return id;
}

function convertFigmaNode(
  raw: unknown,
  parentX: number,
  parentY: number,
  depth: number,
  origin: { x: number; y: number },
  state: FigmaConvertState,
): PenNode | null {
  if (depth > MAX_FIGMA_DEPTH || state.count >= MAX_FIGMA_NODES) return null;
  const node = asRecord(raw);
  if (!node || node.visible === false) return null;
  state.count += 1;

  const type = asString(node.type).toUpperCase();
  const containerTypes = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'SECTION', 'INSTANCE', 'GROUP']);
  const shapeTypes = new Set(['RECTANGLE', 'ELLIPSE', 'LINE', 'VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON']);
  if (!containerTypes.has(type) && !shapeTypes.has(type) && type !== 'TEXT') return null;

  const box = figmaBox(node, parentX, parentY);
  const outType: PenNode['type'] =
    type === 'GROUP'
      ? 'group'
      : containerTypes.has(type)
        ? 'frame'
        : type === 'RECTANGLE'
          ? 'rectangle'
          : type === 'ELLIPSE'
            ? 'ellipse'
            : type === 'TEXT'
              ? 'text'
              : 'path';

  const converted: PenNode = {
    type: outType,
    id: figmaId(node.id, state),
    name: asString(node.name) || type.toLowerCase(),
    x: box.absX - origin.x,
    y: box.absY - origin.y,
    width: box.width,
    height: box.height,
  };

  const rotation = asNumber(node.rotation, 0);
  if (Math.abs(rotation) > 0.001) converted.rotation = -rotation;
  const opacity = asNumber(node.opacity, 1);
  if (opacity < 1) converted.opacity = clamp(opacity, 0, 1);
  if (type !== 'GROUP' && type !== 'TEXT' && type !== 'LINE') {
    const fill = figmaFill(node.fills);
    if (fill) converted.fill = fill;
  }
  if (type !== 'TEXT') {
    const stroke = figmaStroke(node);
    if (stroke.stroke) converted.stroke = stroke.stroke;
    if (stroke.strokeWidth != null) converted.strokeWidth = stroke.strokeWidth;
  }

  if (type === 'FRAME' || type === 'COMPONENT' || type === 'COMPONENT_SET' || type === 'SECTION' || type === 'INSTANCE') {
    converted.layout = 'none';
    const radius = figmaCornerRadius(node);
    if (radius != null) converted.cornerRadius = radius;
    if (node.clipsContent === true) converted.clip = true;
  } else if (type === 'GROUP') {
    converted.layout = 'none';
  } else if (type === 'RECTANGLE' || type === 'ELLIPSE') {
    const radius = figmaCornerRadius(node);
    if (radius != null) converted.cornerRadius = radius;
  } else if (type === 'LINE') {
    converted.geometry = `M0 0L${box.width} 0`;
    converted.height = Math.max(1, box.height);
  } else if (type === 'VECTOR' || type === 'BOOLEAN_OPERATION' || type === 'STAR' || type === 'POLYGON') {
    const geometry = figmaGeometry(node);
    if (geometry) {
      converted.geometry = geometry;
    } else {
      converted.type = 'rectangle';
    }
  } else if (type === 'TEXT') {
    Object.assign(converted, figmaTextStyle(node));
  }

  if (containerTypes.has(type)) {
    const children: PenNode[] = [];
    for (const rawChild of asArray(node.children)) {
      if (state.count >= MAX_FIGMA_NODES) break;
      try {
        const child = convertFigmaNode(rawChild, box.absX, box.absY, depth + 1, origin, state);
        if (child) children.push(child);
      } catch {
        // Keep the rest of the document even when one node is malformed.
      }
    }
    if (children.length > 0) converted.children = children;
  }

  return converted;
}

/**
 * Converts a Figma REST file or node payload into .pen nodes.
 * Accepts `{document: FigmaFile}` and `{nodes: Record<string, {document: FigmaNode}>}`.
 * Malformed nodes are skipped rather than aborting the whole import.
 */
export function figmaToPenDocument(payload: unknown): { nodes: PenNode[]; name: string } {
  const empty = { nodes: [] as PenNode[], name: 'Figma import' };
  try {
    const root = asRecord(payload);
    if (!root) return empty;

    let top: unknown[] = [];
    let name = 'Figma import';
    let origin = { x: 0, y: 0 };
    const outer = asRecord(root.document);

    // Figma's REST file payload is { name, document: DOCUMENT }. Our backend wraps
    // that as { document: File }; node endpoints return { nodes }. Accept every
    // shape, including a bare DOCUMENT/page node and the old nested fixture shape.
    let file: FigmaRecord | null = null;
    let documentNode: FigmaRecord | null = null;
    if (outer) {
      const nested = asRecord(outer.document);
      if (nested) {
        file = outer;
        documentNode = nested;
      } else {
        file = root;
        documentNode = outer;
      }
    } else if (asString(root.type).toUpperCase() === 'DOCUMENT') {
      file = root;
      documentNode = root;
    }

    if (documentNode) {
      name = asString(file?.name) || asString(documentNode.name) || name;
      const children = asArray(documentNode.children)
        .map(asRecord)
        .filter((node): node is FigmaRecord => !!node);
      const page = children.find((candidate) => asString(candidate.type).toUpperCase() === 'PAGE');
      const docType = asString(documentNode.type).toUpperCase();
      if (docType && docType !== 'DOCUMENT' && docType !== 'PAGE' && !page) {
        top = [documentNode];
      } else {
        const container = page ?? documentNode;
        const pageBox = asRecord(container.absoluteBoundingBox);
        if (pageBox) origin = { x: asNumber(pageBox.x), y: asNumber(pageBox.y) };
        top = asArray(container.children);
      }
    } else {
      const nodes = asRecord(root.nodes);
      if (nodes) {
        for (const value of Object.values(nodes)) {
          const entry = asRecord(value);
          const node = asRecord(entry?.document) ?? entry;
          if (!node) continue;
          if (name === 'Figma import') name = asString(node.name) || name;
          top.push(node);
        }
      } else if (Array.isArray(root.children)) {
        name = asString(root.name) || name;
        top = root.children;
      }
    }

    if (top.length === 0) return empty;
    if (name === 'Figma import') {
      const first = asRecord(top[0]);
      name = asString(first?.name) || name;
    }

    const state: FigmaConvertState = { count: 0, ids: new Set(), seq: 0 };
    const nodes: PenNode[] = [];
    for (const raw of top) {
      if (state.count >= MAX_FIGMA_NODES) break;
      try {
        const node = convertFigmaNode(raw, origin.x, origin.y, 0, origin, state);
        if (node) nodes.push(node);
      } catch {
        // A malformed subtree must not discard the rest of the import.
      }
    }
    return { nodes, name };
  } catch {
    return empty;
  }
}


const FIGMA_ERROR_HINTS: Record<string, string> = {
  figma_unauthorized: 'Figma rejected the personal access token.',
  figma_unavailable: 'Figma could not be reached.',
  figma_too_large: 'The Figma response was too large.',
  figma_token_required: 'A Figma personal access token is required.',
  invalid_figma_url: 'The Figma URL or file key is invalid.',
  invalid_token: 'The Figma token contains invalid characters.',
  invalid_node_id: 'The Figma node id is invalid.',
  rate_limited: 'Figma rate-limited the request. Try again later.',
};

function figmaErrorText(status: number, body: unknown, fallback: string): string {
  const record = asRecord(body);
  const code = asString(record?.error);
  if (!code) return `${fallback} (HTTP ${status})`;
  const hint = FIGMA_ERROR_HINTS[code];
  return hint ? `${code}: ${hint}` : code;
}

export function openFigmaImport(): Promise<{ nodes: PenNode[]; name: string } | null> {
  return new Promise((resolve) => {
    let activeTab: 'paste' | 'file' | 'url' = 'paste';
    let pasteSvgText = '';
    let parsedNodes: PenNode[] = [];
    let loading = false;
    let errorMessage = '';

    const backdrop = document.createElement('div');
    backdrop.className = 'pen-modal-backdrop';

    function close(result: { nodes: PenNode[]; name: string } | null) {
      window.removeEventListener('keydown', onKeyDown);
      backdrop.remove();
      resolve(result);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close(null);
    }
    window.addEventListener('keydown', onKeyDown);

    function parseSvgToNodes(svgStr: string): PenNode[] {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgStr, 'image/svg+xml');
      const svgEl = doc.querySelector('svg');
      if (!svgEl) return [];

      let width = parseFloat(svgEl.getAttribute('width') || '800') || 800;
      let height = parseFloat(svgEl.getAttribute('height') || '600') || 600;
      const viewBox = svgEl.getAttribute('viewBox');
      if (viewBox) {
        const parts = viewBox.split(/[\s,]+/).map(Number);
        if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
          width = parts[2];
          height = parts[3];
        }
      }

      const paths = Array.from(svgEl.querySelectorAll('path'));
      if (paths.length === 1) {
        const p = paths[0];
        const d = p.getAttribute('d') || '';
        const fill = p.getAttribute('fill') || '#3d99ff';
        return [
          {
            type: 'path',
            id: `fig-path-${Date.now()}`,
            name: 'Figma Vector',
            x: 0,
            y: 0,
            width,
            height,
            geometry: d,
            fill: fill === 'none' ? undefined : fill,
          },
        ];
      }

      // Multiple paths or complex SVG: Embed as Image Fill Frame
      const b64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)));
      return [
        {
          type: 'frame',
          id: `fig-frame-${Date.now()}`,
          name: 'Figma Component',
          x: 0,
          y: 0,
          width,
          height,
          fill: {
            type: 'image',
            url: b64,
            mode: 'contain',
          },
        },
      ];
    }

    function render() {
      backdrop.innerHTML = `
        <div class="pen-modal pen-import-dialog">
          <div class="pen-modal-header">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span>${svgIcon('figma', 18)}</span>
              <span class="pen-modal-title">Import from Figma</span>
            </div>
            <button class="pen-icon-btn" id="btn-close-figma">${svgIcon('minus', 14)}</button>
          </div>

          <!-- Navigation tabs -->
          <div class="pen-import-tabs">
            <button class="pen-import-tab-btn ${activeTab === 'paste' ? 'active' : ''}" data-tab="paste">
              ${svgIcon('copy', 13)}
              <span>Paste SVG</span>
            </button>
            <button class="pen-import-tab-btn ${activeTab === 'file' ? 'active' : ''}" data-tab="file">
              ${svgIcon('folder', 13)}
              <span>.fig File</span>
            </button>
            <button class="pen-import-tab-btn ${activeTab === 'url' ? 'active' : ''}" data-tab="url">
              ${svgIcon('globe', 13)}
              <span>Figma URL & API</span>
            </button>
          </div>

          <div class="pen-modal-body" style="display: flex; flex-direction: column; gap: 14px;">
            ${
              errorMessage
                ? `
              <div class="pen-auth-error">
                <span>${svgIcon('alert-triangle', 14)}</span>
                <span>${errorMessage}</span>
              </div>
            `
                : ''
            }

            ${renderTabBody()}
          </div>

          <div class="pen-modal-footer">
            <button class="pen-btn-secondary" id="btn-cancel-figma">Cancel</button>
            <button class="pen-btn-primary" id="btn-submit-figma" ${loading || (activeTab === 'paste' && !pasteSvgText) ? 'disabled' : ''}>
              ${loading ? '<div class="pen-submit-spinner"></div>' : ''}
              <span>Import to Canvas</span>
            </button>
          </div>
        </div>
      `;

      bindEvents();
    }

    function renderTabBody(): string {
      if (activeTab === 'paste') {
        return `
          <div style="font-size: 12px; color: var(--muted); line-height: 1.4;">
            In Figma: Select any layer or frame, press <kbd style="background:var(--input); padding: 2px 5px; border-radius:3px;">Cmd+C</kbd> (or right click → <em>Copy as SVG</em>), and paste below.
          </div>
          <textarea
            class="pen-form-input"
            id="figma-paste-input"
            placeholder="Paste SVG code or press Cmd+V anywhere here..."
            style="height: 120px; font-family: var(--font-mono); font-size: 11px; padding: 10px; resize: none;"
          >${pasteSvgText}</textarea>
          ${
            parsedNodes.length > 0
              ? `
            <div style="font-size: 11px; color: var(--success); display: flex; align-items: center; gap: 6px;">
              ${svgIcon('check', 13)}
              <span>Recognized ${parsedNodes.length} layer (${parsedNodes[0].name}) ready to import.</span>
            </div>
          `
              : ''
          }
        `;
      }

      if (activeTab === 'file') {
        return `
          <div class="pen-import-dropzone" id="fig-dropzone">
            <span>${svgIcon('file-text', 32)}</span>
            <div style="font-size: 13px; font-weight: 500; color: var(--fg-strong);">
              Drop your .fig file here
            </div>
            <div style="font-size: 11px; color: var(--faint); max-width: 340px;">
              Note: Proprietary binary .fig files cannot be decompiled in-browser. Please export from Figma as SVG or PNG for full fidelity.
            </div>
          </div>
        `;
      }

      // Figma URL
      return `
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <div class="pen-form-group">
            <label class="pen-form-label">Figma File URL</label>
            <input
              type="text"
              id="figma-url-input"
              class="pen-form-input"
              placeholder="https://www.figma.com/design/XXXX/My-Design"
            />
          </div>

          <div class="pen-form-group">
            <label class="pen-form-label">Personal Access Token (kept in memory only)</label>
            <input
              type="password"
              id="figma-token-input"
              class="pen-form-input"
              placeholder="figd_..."
            />
          </div>

          <div style="font-size: 11px; color: var(--faint); line-height: 1.4;">
            Calls <code>/api/import/figma</code> to fetch vector node JSON via your token without CORS restrictions.
          </div>
        </div>
      `;
    }

    function bindEvents() {
      backdrop.querySelectorAll('.pen-import-tab-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          activeTab = (e.currentTarget as HTMLElement).getAttribute('data-tab') as any;
          errorMessage = '';
          render();
        });
      });

      backdrop.querySelector('#btn-close-figma')?.addEventListener('click', () => close(null));
      backdrop.querySelector('#btn-cancel-figma')?.addEventListener('click', () => close(null));

      // Paste tab handlers
      const pasteArea = backdrop.querySelector('#figma-paste-input') as HTMLTextAreaElement;
      pasteArea?.addEventListener('input', () => {
        pasteSvgText = pasteArea.value.trim();
        if (pasteSvgText.includes('<svg')) {
          parsedNodes = parseSvgToNodes(pasteSvgText);
        } else {
          parsedNodes = [];
        }
        render();
      });

      pasteArea?.addEventListener('paste', (e) => {
        const text = e.clipboardData?.getData('text') || '';
        if (text.includes('<svg')) {
          pasteSvgText = text;
          parsedNodes = parseSvgToNodes(text);
          setTimeout(() => render(), 10);
        }
      });

      // .fig Dropzone
      const dropzone = backdrop.querySelector('#fig-dropzone');
      dropzone?.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
      dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
      dropzone?.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        errorMessage = 'Direct binary .fig parsing is proprietary and unsupported. Please export frames as SVG/PNG in Figma.';
        render();
      });
      dropzone?.addEventListener('click', () => {
        errorMessage = 'Please copy frames as SVG from Figma and use the "Paste SVG" tab.';
        render();
      });

      // Submit
      backdrop.querySelector('#btn-submit-figma')?.addEventListener('click', async () => {
        if (activeTab === 'paste') {
          if (parsedNodes.length > 0) {
            close({ nodes: parsedNodes, name: 'Figma import' });
          } else {
            errorMessage = 'No valid SVG content found.';
            render();
          }
          return;
        }

        if (activeTab === 'url') {
          const urlInput = backdrop.querySelector('#figma-url-input') as HTMLInputElement;
          const tokenInput = backdrop.querySelector('#figma-token-input') as HTMLInputElement;
          const figmaUrl = urlInput?.value.trim() || '';
          const token = tokenInput?.value.trim() || '';

          const match = figmaUrl.match(/(?:file|design)\/([a-zA-Z0-9]+)/);
          if (!match) {
            errorMessage = 'Invalid Figma URL. Expected: figma.com/design/<key>/...';
            render();
            return;
          }
          const fileKey = match[1];

          loading = true;
          errorMessage = '';
          render();

          try {
            const res = await fetch('/api/import/figma', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileKey, token }),
            });

            if (!res.ok) {
              const errData = await res.json().catch(() => ({}));
              throw new Error(figmaErrorText(res.status, errData, 'Figma import failed'));
            }

            const data = await res.json();
            const converted = figmaToPenDocument(data);
            if (converted.nodes.length === 0) {
              loading = false;
              errorMessage =
                'Figma returned no importable frames. Check that the file has visible frames, components, shapes, or text.';
              render();
              return;
            }
            close(converted);
          } catch (err) {
            loading = false;
            errorMessage = (err as Error).message || 'Failed to fetch Figma document.';
            render();
          }
        }
      });
    }

    render();
    document.body.appendChild(backdrop);
  });
}
