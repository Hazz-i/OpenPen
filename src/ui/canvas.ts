import type { EditorStore } from '../core/store';
import type { PenNode, Point, Rect } from '../core/types';
import type { AppSettings } from '../core/settings';
import { num, uid } from '../core/store';
import { resolvePaintColor } from './thumbnail';
import {
  layoutDocument,
  hitTest,
  resizeRect,
  handlePoint,
  findLaidOut,
  rectsIntersect,
  type LaidOutNode,
  type HandleId,
  HANDLE_IDS,
} from '../core/geometry';
import {
  computeSnap,
  listComments,
  addComment,
  resolveComment,
  deleteComment,
  type CommentPin,
  type Guide,
} from '../core/docops';
import { svgToPngBlob, documentToSvg, nodeToSvg } from '../core/exporters';
import { loadImageElement } from '../core/assets';
import { showContextMenu, promptDialog, toast } from './dialogs';

export class CanvasView {
  container: HTMLElement;
  store: EditorStore;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  settings?: AppSettings;

  private isDragging = false;
  private dragMode: 'pan' | 'move' | 'resize' | 'create' | 'marquee' | null = null;
  private dragStartClient: Point = { x: 0, y: 0 };
  private dragStartWorld: Point = { x: 0, y: 0 };
  private resizeHandle: HandleId | null = null;
  private resizeInitialRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private initialNodePositions = new Map<string, Point>();
  private marqueeRect: Rect | null = null;
  private hoverNodeId: string | null = null;
  private createdNodeId: string | null = null;
  private activeGuides: Guide[] = [];

  private textEditorOverlay: HTMLTextAreaElement | null = null;
  private unsubscribe: () => void;
  private ro: ResizeObserver;
  private rafId: number | null = null;

  // Cached layout per doc version
  private cachedDoc: any = null;
  private cachedLaidOut: LaidOutNode[] = [];
  private decodedImages = new Map<string, HTMLImageElement>();
  private failedImages = new Set<string>();

  constructor(container: HTMLElement, store: EditorStore, settings?: AppSettings) {
    this.container = container;
    this.store = store;
    this.settings = settings;

    this.canvas = document.createElement('canvas');
    this.container.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not supported');
    this.ctx = ctx;

    this.setupEvents();
    this.ro = new ResizeObserver(() => this.resizeCanvas());
    this.ro.observe(this.container);

    this.unsubscribe = this.store.subscribe((event) => {
      if (event === 'doc') {
        this.cachedDoc = null; // Invalidate cache
        this.requestRender();
      } else if (event === 'viewport' || event === 'selection') {
        this.requestRender();
      }
    });

    this.resizeCanvas();
  }

  private getLayout(): LaidOutNode[] {
    if (this.cachedDoc === this.store.doc) {
      return this.cachedLaidOut;
    }
    this.cachedDoc = this.store.doc;
    this.cachedLaidOut = layoutDocument(this.store.doc);
    return this.cachedLaidOut;
  }

  private resizeCanvas(): void {
    const rect = this.container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.render();
  }

  private requestRender(): void {
    if (this.rafId != null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.render();
    });
  }

  getViewportCenter(): { x: number; y: number } {
    const rect = this.container.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    return this.store.screenToWorld({ x: cx, y: cy });
  }

  focusNode(id: string): void {
    const laidOut = this.getLayout();
    const item = findLaidOut(laidOut, id);
    if (!item) return;

    const rect = this.container.getBoundingClientRect();
    const zoom = Math.min(
      2,
      Math.max(
        0.2,
        Math.min((rect.width - 100) / item.rect.width, (rect.height - 100) / item.rect.height)
      )
    );
    const panX = rect.width / 2 - (item.rect.x + item.rect.width / 2) * zoom;
    const panY = rect.height / 2 - (item.rect.y + item.rect.height / 2) * zoom;
    this.store.setViewport({ zoom, panX, panY });
  }

  zoomToFit(): void {
    const laidOut = this.getLayout();
    if (laidOut.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const item of laidOut) {
      minX = Math.min(minX, item.rect.x);
      minY = Math.min(minY, item.rect.y);
      maxX = Math.max(maxX, item.rect.x + item.rect.width);
      maxY = Math.max(maxY, item.rect.y + item.rect.height);
    }

    const docW = maxX - minX;
    const docH = maxY - minY;
    if (docW <= 0 || docH <= 0) return;

    const rect = this.container.getBoundingClientRect();
    const pad = 80;
    const availW = Math.max(100, rect.width - pad * 2);
    const availH = Math.max(100, rect.height - pad * 2);

    const zoom = Math.max(0.02, Math.min(16, Math.min(availW / docW, availH / docH)));
    const panX = rect.width / 2 - (minX + docW / 2) * zoom;
    const panY = rect.height / 2 - (minY + docH / 2) * zoom;

    this.store.setViewport({ zoom, panX, panY });
  }

  async exportPng(nodeId: string | null, scale = 2): Promise<Blob> {
    const node = nodeId ? this.store.getNode(nodeId) : null;
    const svg = node ? nodeToSvg(node, this.store.doc) : documentToSvg(this.store.doc);
    const w = node ? (num(node.width) ?? 800) : 1200;
    const h = node ? (num(node.height) ?? 600) : 900;
    return await svgToPngBlob(svg, w, h, scale);
  }

  render(): void {
    const dpr = window.devicePixelRatio || 1;
    const ctx = this.ctx;
    ctx.resetTransform();
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Canvas background
    const bg = this.settings?.canvasBackground || '#1d1d1f';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const vp = this.store.viewport;

    // Optional Grid
    if (this.settings?.showGrid) {
      this.renderGrid(vp, dpr);
    }

    // World transform
    ctx.scale(dpr, dpr);
    ctx.translate(vp.panX, vp.panY);
    ctx.scale(vp.zoom, vp.zoom);

    const laidOut = this.getLayout();
    const laidOutMap = new Map<string, LaidOutNode>();
    const indexNodes = (items: LaidOutNode[]): void => {
      for (const item of items) {
        laidOutMap.set(item.node.id, item);
        indexNodes(item.children);
      }
    };
    indexNodes(laidOut);

    // 1. Render all visible nodes
    for (const item of laidOut) {
      this.renderNode(item);
    }

    // 2. Render top-level frame labels above artboards
    if (this.settings?.showFrameNames !== false) {
      for (const child of this.store.doc.children) {
        const item = laidOutMap.get(child.id);
        if (item && item.node.type === 'frame') {
          ctx.save();
          ctx.fillStyle = '#8a8a8a';
          ctx.font = `${11 / vp.zoom < 9 ? 9 * vp.zoom : 11}px sans-serif`;
          ctx.textBaseline = 'bottom';
          ctx.fillText(child.name || 'Frame', item.rect.x, item.rect.y - 6);
          ctx.restore();
        }
      }
    }

    // 3. Hover outline
    if (this.hoverNodeId && !this.store.selection.includes(this.hoverNodeId)) {
      const item = laidOutMap.get(this.hoverNodeId);
      if (item && !item.node.locked) {
        ctx.save();
        ctx.strokeStyle = this.settings?.accent || '#3d99ff';
        ctx.lineWidth = 1 / vp.zoom;
        ctx.strokeRect(item.rect.x, item.rect.y, item.rect.width, item.rect.height);
        ctx.restore();
      }
    }

    // 4. Selection outline and handles
    if (this.store.selection.length > 0) {
      for (const selId of this.store.selection) {
        const item = laidOutMap.get(selId);
        if (!item) continue;
        const r = item.rect;

        ctx.save();
        ctx.strokeStyle = this.settings?.accent || '#3d99ff';
        ctx.lineWidth = 1.5 / vp.zoom;
        ctx.strokeRect(r.x, r.y, r.width, r.height);

        // Draw resize handles if single selection and not locked
        if (this.store.selection.length === 1 && !item.node.locked) {
          const handleSize = 7 / vp.zoom;
          const half = handleSize / 2;

          for (const handleId of HANDLE_IDS) {
            const pt = handlePoint(r, handleId);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(pt.x - half, pt.y - half, handleSize, handleSize);
            ctx.strokeStyle = this.settings?.accent || '#3d99ff';
            ctx.lineWidth = 1 / vp.zoom;
            ctx.strokeRect(pt.x - half, pt.y - half, handleSize, handleSize);
          }
        }

        ctx.restore();
      }
    }

    // 5. Smart Snap Guides
    if (this.activeGuides.length > 0) {
      ctx.save();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1 / vp.zoom;
      ctx.setLineDash([4 / vp.zoom, 4 / vp.zoom]);
      for (const g of this.activeGuides) {
        ctx.beginPath();
        if (g.axis === 'x') {
          ctx.moveTo(g.position, g.from);
          ctx.lineTo(g.position, g.to);
        } else {
          ctx.moveTo(g.from, g.position);
          ctx.lineTo(g.to, g.position);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // 6. Marquee box
    if (this.marqueeRect) {
      ctx.save();
      ctx.strokeStyle = this.settings?.accent || '#3d99ff';
      ctx.fillStyle = 'rgba(61, 153, 255, 0.15)';
      ctx.lineWidth = 1 / vp.zoom;
      ctx.fillRect(
        this.marqueeRect.x,
        this.marqueeRect.y,
        this.marqueeRect.width,
        this.marqueeRect.height
      );
      ctx.strokeRect(
        this.marqueeRect.x,
        this.marqueeRect.y,
        this.marqueeRect.width,
        this.marqueeRect.height
      );
      ctx.restore();
    }

    // 7. Comments Pins
    const comments = listComments(this.store);
    for (const c of comments) {
      if (c.resolved) continue;
      ctx.save();
      ctx.fillStyle = '#f99c00';
      ctx.beginPath();
      ctx.arc(c.x, c.y, 8 / vp.zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `${10 / vp.zoom}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('C', c.x, c.y);
      ctx.restore();
    }
  }

  private renderGrid(vp: { zoom: number; panX: number; panY: number }, dpr: number): void {
    const ctx = this.ctx;
    const gSize = (this.settings?.gridSize || 8) * vp.zoom;
    if (gSize < 5) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';

    const startX = (vp.panX % gSize);
    const startY = (vp.panY % gSize);
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;

    for (let x = startX; x < w; x += gSize) {
      for (let y = startY; y < h; y += gSize) {
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.restore();
  }

  private drawImageFill(
    img: HTMLImageElement,
    rect: { x: number; y: number; width: number; height: number },
    node: PenNode,
  ): void {
    const ctx = this.ctx;
    const mode =
      typeof node.fill === 'object' && !Array.isArray(node.fill) && node.fill.type === 'image'
        ? node.fill.mode
        : undefined;
    const iw = img.naturalWidth || img.width || rect.width;
    const ih = img.naturalHeight || img.height || rect.height;
    if (!iw || !ih) return;

    let drawW = rect.width;
    let drawH = rect.height;
    let drawX = rect.x;
    let drawY = rect.y;

    if (mode === 'contain' || mode === 'cover') {
      const scale = mode === 'contain'
        ? Math.min(rect.width / iw, rect.height / ih)
        : Math.max(rect.width / iw, rect.height / ih);
      drawW = iw * scale;
      drawH = ih * scale;
      drawX = rect.x + (rect.width - drawW) / 2;
      drawY = rect.y + (rect.height - drawH) / 2;
    }

    ctx.save();
    ctx.beginPath();
    const radius = typeof node.cornerRadius === 'number' ? node.cornerRadius : 0;
    if (node.type === 'ellipse') {
      ctx.ellipse(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width / 2, rect.height / 2, 0, 0, Math.PI * 2);
    } else if (radius > 0 && typeof ctx.roundRect === 'function') {
      ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
    } else {
      ctx.rect(rect.x, rect.y, rect.width, rect.height);
    }
    ctx.clip();
    ctx.drawImage(img, drawX, drawY, drawW, drawH);
    ctx.restore();
  }

  private renderNode(item: LaidOutNode): void {
    const node = item.node;
    if (node.visible === false) return;
    const r = item.rect;
    const ctx = this.ctx;

    ctx.save();

    if (node.opacity != null) {
      ctx.globalAlpha *= Math.max(0, Math.min(1, node.opacity));
    }

    if (node.rotation) {
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate((node.rotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }

    if (node.clip) {
      ctx.beginPath();
      const radius = typeof node.cornerRadius === 'number' ? node.cornerRadius : 0;
      if (radius > 0 && typeof ctx.roundRect === 'function') {
        ctx.roundRect(r.x, r.y, r.width, r.height, radius);
      } else {
        ctx.rect(r.x, r.y, r.width, r.height);
      }
      ctx.clip();
    }

    // Check Image fill
    if (typeof node.fill === 'object' && !Array.isArray(node.fill) && node.fill?.type === 'image' && node.fill.url) {
      const image = this.decodedImages.get(node.fill.url);
      if (image) {
        this.drawImageFill(image, r, node);
      } else if (this.failedImages.has(node.fill.url)) {
        ctx.fillStyle = '#27272a';
        ctx.fillRect(r.x, r.y, r.width, r.height);
      } else {
        const url = node.fill.url;
        loadImageElement(url)
          .then((img) => {
            this.decodedImages.set(url, img);
            this.requestRender();
          })
          .catch(() => {
            this.failedImages.add(url);
            this.requestRender();
          });
        ctx.fillStyle = '#27272a';
        ctx.fillRect(r.x, r.y, r.width, r.height);
      }
    } else {
      const fill = resolvePaintColor(node.fill);
      if (fill) {
        ctx.fillStyle = fill;
        if (node.type === 'ellipse') {
          ctx.beginPath();
          ctx.ellipse(r.x + r.width / 2, r.y + r.height / 2, r.width / 2, r.height / 2, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const radius = typeof node.cornerRadius === 'number' ? node.cornerRadius : 0;
          if (radius > 0 && typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(r.x, r.y, r.width, r.height, radius);
            ctx.fill();
          } else {
            ctx.fillRect(r.x, r.y, r.width, r.height);
          }
        }
      }
    }

    // Stroke
    const stroke = resolvePaintColor(node.stroke);
    if (stroke && (node.strokeWidth ?? 1) > 0) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = node.strokeWidth || 1;
      if (node.type === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(r.x + r.width / 2, r.y + r.height / 2, r.width / 2, r.height / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const radius = typeof node.cornerRadius === 'number' ? node.cornerRadius : 0;
        if (radius > 0 && typeof ctx.roundRect === 'function') {
          ctx.beginPath();
          ctx.roundRect(r.x, r.y, r.width, r.height, radius);
          ctx.stroke();
        } else {
          ctx.strokeRect(r.x, r.y, r.width, r.height);
        }
      }
    }

    // Text content
    if (node.type === 'text' && node.content) {
      ctx.fillStyle = resolvePaintColor(node.fill) || '#000000';
      const fSize = node.fontSize || 14;
      ctx.font = `${node.fontWeight || 'normal'} ${fSize}px sans-serif`;
      ctx.textBaseline = 'top';

      const lines = node.content.split('\n');
      let curY = r.y;
      const lHeight = (node.lineHeight ? node.lineHeight * fSize : fSize * 1.3);

      for (const line of lines) {
        ctx.fillText(line, r.x, curY);
        curY += lHeight;
      }
    }

    // Children paint above their parent, inside its clip/opacity/transform.
    for (const child of item.children) this.renderNode(child);

    ctx.restore();
  }

  private setupEvents(): void {
    const c = this.container;

    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    c.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    c.addEventListener('dblclick', (e) => this.onDoubleClick(e));

    // Right click context menu on canvas
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const client = this.getClientPoint(e);
      const world = this.store.screenToWorld(client);
      const laidOut = this.getLayout();
      const hits = hitTest(laidOut, world);

      if (hits.length > 0) {
        const hit = hits[0].node;
        this.store.selectOnly(hit.id);
        showContextMenu(e.clientX, e.clientY, [
          {
            label: 'Duplicate',
            shortcut: 'Cmd+D',
            action: () => this.store.duplicateNodes([hit.id]),
          },
          {
            label: 'Delete',
            shortcut: 'Backspace',
            danger: true,
            action: () => this.store.removeNodes([hit.id]),
          },
          'separator',
          {
            label: hit.locked ? 'Unlock' : 'Lock',
            action: () => this.store.updateNode(hit.id, { locked: !hit.locked }),
          },
          {
            label: 'Add Comment Here',
            action: async () => {
              const text = await promptDialog({ title: 'Add Comment' });
              if (text) addComment(this.store, world.x, world.y, text);
            },
          },
        ]);
      } else {
        showContextMenu(e.clientX, e.clientY, [
          {
            label: 'Zoom to Fit',
            shortcut: 'Shift+1',
            action: () => this.zoomToFit(),
          },
          {
            label: 'Add Comment Here',
            action: async () => {
              const text = await promptDialog({ title: 'Add Comment' });
              if (text) addComment(this.store, world.x, world.y, text);
            },
          },
        ]);
      }
    });
  }

  private getClientPoint(e: MouseEvent): Point {
    const rect = this.container.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const client = this.getClientPoint(e);

    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * 0.005);
      this.store.zoomAt(client, factor);
    } else {
      this.store.setViewport({
        panX: this.store.viewport.panX - e.deltaX,
        panY: this.store.viewport.panY - e.deltaY,
      });
    }
  }

  private findHandleUnderPointer(client: Point): HandleId | null {
    if (this.store.selection.length !== 1) return null;
    const selId = this.store.selection[0];
    const laidOut = this.getLayout();
    const item = findLaidOut(laidOut, selId);
    if (!item || item.node.locked) return null;

    const world = this.store.screenToWorld(client);
    const threshold = 8 / this.store.viewport.zoom;

    for (const h of HANDLE_IDS) {
      const pt = handlePoint(item.rect, h);
      if (Math.abs(pt.x - world.x) <= threshold && Math.abs(pt.y - world.y) <= threshold) {
        return h;
      }
    }
    return null;
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.textEditorOverlay) {
      this.commitTextEditing();
    }

    const client = this.getClientPoint(e);
    const world = this.store.screenToWorld(client);
    this.dragStartClient = client;
    this.dragStartWorld = world;
    this.isDragging = true;
    this.activeGuides = [];

    // Comments Tool
    if (this.store.tool === 'comment') {
      promptDialog({ title: 'New Comment' }).then((text) => {
        if (text) {
          addComment(this.store, world.x, world.y, text);
          this.store.setTool('select');
          toast('Comment added', 'success');
        }
      });
      this.isDragging = false;
      return;
    }

    // Pan with space or middle click or hand tool
    if (e.button === 1 || this.store.tool === 'hand') {
      this.dragMode = 'pan';
      this.container.style.cursor = 'grabbing';
      return;
    }

    // Creation tools
    if (['rectangle', 'ellipse', 'frame', 'text', 'polygon'].includes(this.store.tool)) {
      this.dragMode = 'create';
      this.store.beginTransaction();

      const type = this.store.tool as any;
      const newId = uid(type);
      const isFrame = type === 'frame';
      const isText = type === 'text';

      const newNode: PenNode = {
        type,
        id: newId,
        x: world.x,
        y: world.y,
        width: isText ? 100 : 1,
        height: isText ? 24 : 1,
        fill: isFrame ? '#FFFFFF' : isText ? '#000000' : '#E0E0E0',
        content: isText ? 'Text' : undefined,
      };

      this.createdNodeId = newId;
      this.store.addNode(newNode);
      this.store.selectOnly(newId);
      return;
    }

    // Check resize handles on selection
    const handle = this.findHandleUnderPointer(client);
    if (handle) {
      this.dragMode = 'resize';
      this.resizeHandle = handle;
      const laidOut = this.getLayout();
      const item = findLaidOut(laidOut, this.store.selection[0]);
      if (item) {
        this.resizeInitialRect = { ...item.rect };
      }
      this.store.beginTransaction();
      return;
    }

    // Hit test top leaf node
    const laidOut = this.getLayout();
    const hits = hitTest(laidOut, world);
    const validHits = hits.filter((h) => !h.node.locked && h.node.visible !== false);

    if (validHits.length > 0) {
      let targetNode = validHits[0].node;
      if (e.altKey) {
        const parent = this.store.getParent(targetNode.id);
        if (parent && parent.id) targetNode = parent;
      }

      if (e.shiftKey) {
        this.store.toggleSelection(targetNode.id);
      } else if (!this.store.selection.includes(targetNode.id)) {
        this.store.selectOnly(targetNode.id);
      }

      this.dragMode = 'move';
      this.store.beginTransaction();
      this.initialNodePositions.clear();
      for (const id of this.store.selection) {
        const n = this.store.getNode(id);
        if (n) {
          this.initialNodePositions.set(id, { x: num(n.x) ?? 0, y: num(n.y) ?? 0 });
        }
      }
    } else {
      // Clicked empty canvas
      if (!e.shiftKey) {
        this.store.setSelection([]);
      }
      this.dragMode = 'marquee';
      this.marqueeRect = { x: world.x, y: world.y, width: 0, height: 0 };
    }
  }

  private onPointerMove(e: PointerEvent): void {
    const client = this.getClientPoint(e);
    const world = this.store.screenToWorld(client);

    if (!this.isDragging) {
      const handle = this.findHandleUnderPointer(client);
      if (handle) {
        this.setCursorForHandle(handle);
      } else if (this.store.tool === 'hand') {
        this.container.style.cursor = 'grab';
      } else if (['rectangle', 'ellipse', 'frame', 'polygon'].includes(this.store.tool)) {
        this.container.style.cursor = 'crosshair';
      } else if (this.store.tool === 'text') {
        this.container.style.cursor = 'text';
      } else {
        const laidOut = this.getLayout();
        const hits = hitTest(laidOut, world);
        const valid = hits.find((h) => !h.node.locked && h.node.visible !== false);
        this.hoverNodeId = valid ? valid.node.id : null;
        this.container.style.cursor = 'default';
        this.requestRender();
      }
      return;
    }

    let dx = world.x - this.dragStartWorld.x;
    let dy = world.y - this.dragStartWorld.y;

    if (this.dragMode === 'pan') {
      const cdx = client.x - this.dragStartClient.x;
      const cdy = client.y - this.dragStartClient.y;
      this.store.setViewport({
        panX: this.store.viewport.panX + cdx,
        panY: this.store.viewport.panY + cdy,
      });
      this.dragStartClient = client;
    } else if (this.dragMode === 'move') {
      // Snapping
      if (this.settings?.snapToObjects && this.store.selection.length === 1) {
        const selId = this.store.selection[0];
        const laidOut = this.getLayout();
        const item = findLaidOut(laidOut, selId);
        if (item) {
          const moving: Rect = {
            x: item.rect.x + dx,
            y: item.rect.y + dy,
            width: item.rect.width,
            height: item.rect.height,
          };
          const targets = laidOut
            .filter((o) => o.node.id !== selId && !o.node.locked)
            .map((o) => o.rect);

          const snap = computeSnap(moving, targets, {
            threshold: 6 / this.store.viewport.zoom,
            grid: this.settings?.snapToGrid ? this.settings.gridSize : undefined,
          });
          dx += snap.dx;
          dy += snap.dy;
          this.activeGuides = snap.guides;
        }
      }

      this.store.mutateSilent(() => {
        for (const [id, pos] of this.initialNodePositions.entries()) {
          const n = this.store.getNode(id);
          if (n) {
            n.x = Math.round(pos.x + dx);
            n.y = Math.round(pos.y + dy);
          }
        }
      });
      this.requestRender();
    } else if (this.dragMode === 'resize' && this.resizeHandle) {
      const nextRect = resizeRect(
        this.resizeInitialRect,
        this.resizeHandle,
        dx,
        dy,
        e.shiftKey
      );
      this.store.mutateSilent(() => {
        const n = this.store.getNode(this.store.selection[0]);
        if (n) {
          n.x = Math.round(nextRect.x);
          n.y = Math.round(nextRect.y);
          n.width = Math.round(nextRect.width);
          n.height = Math.round(nextRect.height);
        }
      });
      this.requestRender();
    } else if (this.dragMode === 'create' && this.createdNodeId) {
      const w = Math.max(1, Math.abs(dx));
      const h = Math.max(1, Math.abs(dy));
      const x = dx < 0 ? world.x : this.dragStartWorld.x;
      const y = dy < 0 ? world.y : this.dragStartWorld.y;

      this.store.mutateSilent(() => {
        const n = this.store.getNode(this.createdNodeId!);
        if (n) {
          n.x = Math.round(x);
          n.y = Math.round(y);
          n.width = Math.round(w);
          n.height = Math.round(h);
        }
      });
      this.requestRender();
    } else if (this.dragMode === 'marquee') {
      const minX = Math.min(this.dragStartWorld.x, world.x);
      const minY = Math.min(this.dragStartWorld.y, world.y);
      const w = Math.abs(dx);
      const h = Math.abs(dy);
      this.marqueeRect = { x: minX, y: minY, width: w, height: h };

      const laidOut = this.getLayout();
      const selected: string[] = [];
      for (const item of laidOut) {
        if (!item.node.locked && rectsIntersect(this.marqueeRect, item.rect)) {
          selected.push(item.node.id);
        }
      }
      this.store.setSelection(selected);
      this.requestRender();
    }
  }

  private onPointerUp(_e: PointerEvent): void {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.activeGuides = [];

    if (this.dragMode === 'create' && this.createdNodeId) {
      const node = this.store.getNode(this.createdNodeId);
      if (node && (num(node.width) ?? 0) <= 5 && (num(node.height) ?? 0) <= 5) {
        this.store.updateNode(this.createdNodeId, { width: 100, height: 100 });
      }
      this.store.setTool('select');
      this.store.endTransaction();
    } else if (this.dragMode === 'move' || this.dragMode === 'resize') {
      this.store.endTransaction();
    }

    this.dragMode = null;
    this.resizeHandle = null;
    this.marqueeRect = null;
    this.createdNodeId = null;
    this.requestRender();
  }

  private onDoubleClick(e: MouseEvent): void {
    const client = this.getClientPoint(e);
    const world = this.store.screenToWorld(client);
    const laidOut = this.getLayout();
    const hits = hitTest(laidOut, world);

    if (hits.length > 0 && hits[0].node.type === 'text') {
      this.startTextEditing(hits[0]);
    }
  }

  private startTextEditing(item: LaidOutNode): void {
    const node = item.node;
    const vp = this.store.viewport;
    const screenPos = this.store.worldToScreen({ x: item.rect.x, y: item.rect.y });

    const ta = document.createElement('textarea');
    ta.className = 'pen-text-overlay';
    ta.value = node.content || '';
    ta.style.left = `${screenPos.x}px`;
    ta.style.top = `${screenPos.y}px`;
    ta.style.width = `${Math.max(60, item.rect.width * vp.zoom)}px`;
    ta.style.height = `${Math.max(24, item.rect.height * vp.zoom)}px`;
    ta.style.fontSize = `${(node.fontSize || 14) * vp.zoom}px`;
    ta.style.fontFamily = 'sans-serif';
    ta.style.color = resolvePaintColor(node.fill) || '#ffffff';

    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        this.commitTextEditing();
      } else if (ev.key === 'Escape') {
        this.cancelTextEditing();
      }
    });

    ta.addEventListener('blur', () => this.commitTextEditing());

    this.container.appendChild(ta);
    ta.focus();
    ta.select();
    this.textEditorOverlay = ta;
  }

  private commitTextEditing(): void {
    if (!this.textEditorOverlay || this.store.selection.length === 0) return;
    const val = this.textEditorOverlay.value;
    const selId = this.store.selection[0];
    this.store.updateNode(selId, { content: val });
    this.cleanupTextOverlay();
  }

  private cancelTextEditing(): void {
    this.cleanupTextOverlay();
  }

  private cleanupTextOverlay(): void {
    if (this.textEditorOverlay) {
      this.textEditorOverlay.remove();
      this.textEditorOverlay = null;
    }
  }

  private setCursorForHandle(h: HandleId): void {
    switch (h) {
      case 'nw':
      case 'se':
        this.container.style.cursor = 'nwse-resize';
        break;
      case 'ne':
      case 'sw':
        this.container.style.cursor = 'nesw-resize';
        break;
      case 'n':
      case 's':
        this.container.style.cursor = 'ns-resize';
        break;
      case 'e':
      case 'w':
        this.container.style.cursor = 'ew-resize';
        break;
    }
  }

  destroy(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.unsubscribe();
    this.ro.disconnect();
    this.canvas.remove();
    this.cleanupTextOverlay();
  }
}
