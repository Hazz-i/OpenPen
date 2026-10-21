import type { EditorStore } from '../core/store';
import type { AppSettings } from '../core/settings';
import type { PenNode } from '../core/types';
import { num } from '../core/store';
import { resolvePaintColor } from './thumbnail';
import { CanvasView } from './canvas';
import { createLayers } from './layers';
import { createInspector } from './inspector';
import { createToolbar } from './toolbar';
import { createAgent } from './agent';
import { createSlides } from './slides';
import { createComponents } from './components';
import { createLibraries } from './libraries';
import { createMenuBar } from './menu';
import { openSettings } from './settings';
import { openAccountMenu, openUpgradeDialog } from './account';
import { getAuth, subscribeAuth } from '../core/auth';
import {
  toast,
  confirmDialog,
  showCommandPalette,
  showContextMenu,
} from './dialogs';
import { serializePenFile } from '../core/format';
import {
  groupSelection,
  ungroupSelection,
  reorderSelection,
} from '../core/docops';
import {
  downloadPng,
  downloadSvg,
  downloadHtml,
  nodeToHtml,
} from '../core/exporters';
import { pickImageFile, readDroppedFiles } from '../core/files';
import { createImageNode } from '../core/assets';
import { svgIcon } from './icons';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/editor.css';
import '../styles/components.css';

export interface EditorMountOptions {
  store: EditorStore;
  onExit(): void;
  onSave(): void;
  onSaveAs(): void;
  onOpenFile(): void;
  onNewFile?(): void;
  onExport?(format: 'pen' | 'png' | 'svg' | 'html', scope: 'document' | 'selection'): void;
  onImportImage?(): void;
  onOpenSettings?(): void;
  onOpenAuth?(): void;
  settings?: AppSettings;
}

export function mountEditor(
  root: HTMLElement,
  opts: EditorMountOptions
): { destroy(): void } {
  const store = opts.store;
  let activeTab = 'layers';
  let isPanelCollapsed = false;

  const container = document.createElement('div');
  container.className = 'pen-editor';

  container.innerHTML = `
    <!-- Top bar -->
    <header class="pen-topbar">
      <div class="pen-topbar-left">
        <div class="pen-topbar-brand" id="btn-back-dashboard" title="Back to Dashboard">
          <span style="color: #ffffff;">${svgIcon('pen', 16, 2)}</span>
          <span>pen.dev</span>
          <span style="color: var(--faint); margin-left: 2px;">${svgIcon('layout-grid', 14)}</span>
        </div>

        <button class="pen-topbar-btn" id="btn-toggle-panel" title="Toggle left sidebar">
          ${svgIcon('panel-left', 16)}
        </button>

        <!-- Menu Bar Container -->
        <div id="menubar-slot"></div>

        <div class="pen-unsaved-pill" id="unsaved-pill" style="display: ${store.dirty ? 'flex' : 'none'};">
          ${svgIcon('alert-triangle', 12)}
          <span>Recovered changes</span>
        </div>

        <span class="pen-file-title" id="file-title">${store.fileName} — Edited</span>
      </div>

      <div class="pen-topbar-right">
        <button class="pen-btn-share" id="btn-share-top">
          ${svgIcon('share', 14)}
          <span>Share</span>
        </button>
        <button class="pen-topbar-btn" id="btn-cmd-palette" title="Command Palette (Cmd+K)">
          ${svgIcon('command', 15)}
        </button>
        <button class="pen-topbar-btn" id="btn-settings-top" title="Preferences (Cmd+,)">
          ${svgIcon('settings', 15)}
        </button>
        <button class="pen-account-chip" id="btn-account-chip" title="Account"
          style="display:flex;align-items:center;gap:6px;background:transparent;border:1px solid var(--border);border-radius:var(--radius-pill);padding:2px 7px 2px 2px;cursor:pointer;color:var(--fg);max-width:180px;"></button>
      </div>
    </header>

    <!-- Workspace -->
    <div class="pen-workspace">
      <!-- Canvas container -->
      <div class="pen-canvas-viewport" id="canvas-container"></div>

      <!-- Left floating panel -->
      <aside class="pen-left-panel" id="left-panel">
        <div class="pen-tabs-header">
          <button class="pen-tab-btn ${activeTab === 'agent' ? 'active' : ''}" data-tab="agent">
            ${svgIcon('message-square', 14)}
            <span>Agent</span>
          </button>
          <button class="pen-tab-btn ${activeTab === 'layers' ? 'active' : ''}" data-tab="layers">
            ${svgIcon('layers', 14)}
            <span>Layers</span>
          </button>
          <button class="pen-tab-btn ${activeTab === 'slides' ? 'active' : ''}" data-tab="slides">
            ${svgIcon('tv', 14)}
            <span>Slides</span>
          </button>
          <button class="pen-tab-btn ${activeTab === 'components' ? 'active' : ''}" data-tab="components">
            ${svgIcon('component', 14)}
            <span>Components</span>
          </button>
          <button class="pen-tab-btn ${activeTab === 'libraries' ? 'active' : ''}" data-tab="libraries">
            ${svgIcon('book-open', 14)}
            <span>Libraries</span>
          </button>
        </div>

        <div class="pen-left-content" id="left-content"></div>
      </aside>

      <!-- Floating tool rail -->
      <div id="tool-rail-container"></div>

      <!-- Floating right inspector -->
      <div id="inspector-container"></div>

      <!-- Floating Breadcrumb bottom-left -->
      <div class="pen-bottom-breadcrumb" id="breadcrumb">
        ${svgIcon('hash', 13)}
        <span id="breadcrumb-text">Canvas</span>
      </div>

      <!-- Floating Zoom bottom-right -->
      <div class="pen-bottom-zoom">
        <button class="pen-icon-btn" id="btn-zoom-out">${svgIcon('minus', 13)}</button>
        <span class="pen-zoom-value" id="zoom-value">${Math.round(store.viewport.zoom * 100)}%</span>
        <button class="pen-icon-btn" id="btn-zoom-in">${svgIcon('plus', 13)}</button>
      </div>
    </div>
  `;

  root.appendChild(container);

  // Initialize Canvas
  const canvasContainer = container.querySelector('#canvas-container') as HTMLElement;
  const canvasView = new CanvasView(canvasContainer, store, opts.settings);
  setTimeout(() => canvasView.zoomToFit(), 50);

  // Initialize Tool rail
  const toolRailContainer = container.querySelector('#tool-rail-container') as HTMLElement;
  const toolbar = createToolbar(store);
  toolRailContainer.appendChild(toolbar.el);

  // Handle Export / Copy HTML
  function handleCopyHtml(nodeId: string) {
    const node = store.getNode(nodeId);
    if (!node) return;
    const html = nodeToHtml(node);
    navigator.clipboard?.writeText(html);
    toast('HTML code copied to clipboard', 'success');
  }

  function handleExportHtml(nodeId: string) {
    const node = store.getNode(nodeId);
    if (!node) return;
    downloadHtml(store.doc, node, node.name || 'export');
  }

  // Initialize Inspector
  function escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function initials(name?: string, email?: string): string {
    const source = (name || email || '?').trim();
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return source.slice(0, 2).toUpperCase();
  }

  const accountChip = container.querySelector('#btn-account-chip') as HTMLButtonElement;
  function updateAccountChip(): void {
    if (!accountChip) return;
    const user = getAuth().user;
    const plan = user?.plan || 'local';
    const label = user ? user.name || user.email : 'Sign in';
    accountChip.innerHTML = `
      <span style="width:22px;height:22px;border-radius:50%;background:var(--input);border:1px solid var(--border-strong);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:var(--fg-strong);flex-shrink:0;">${escapeHtml(initials(user?.name, user?.email))}</span>
      <span style="font-size:11px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(label)}</span>
      <span class="pen-plan-pill">${plan === 'pro' ? 'Pro' : plan === 'free' ? 'Free' : 'Local'}</span>
    `;
    accountChip.title = user ? `${user.name || user.email} \u00b7 ${plan} plan` : 'Sign in to sync';
  }
  updateAccountChip();
  const unsubscribeAuth = subscribeAuth(updateAccountChip);
  accountChip?.addEventListener('click', () => openAccountMenu(accountChip));

  const inspectorContainer = container.querySelector('#inspector-container') as HTMLElement;
  const inspector = createInspector(store, {
    onCopyHtml: handleCopyHtml,
    onExportHtml: handleExportHtml,
  });
  inspectorContainer.appendChild(inspector.el);

  // Initialize Menu Bar
  const menubarSlot = container.querySelector('#menubar-slot') as HTMLElement;
  const menuBar = createMenuBar({
    newFile: () => {
      if (opts.onNewFile) opts.onNewFile();
    },
    openFile: () => opts.onOpenFile(),
    openRecent: () => opts.onExit(),
    save: () => opts.onSave(),
    saveAs: () => opts.onSaveAs(),
    close: async () => {
      if (store.dirty) {
        const ok = await confirmDialog({
          title: 'Unsaved Changes',
          message: 'You have unsaved changes. Discard and return to dashboard?',
          confirmLabel: 'Discard',
          danger: true,
        });
        if (!ok) return;
      }
      opts.onExit();
    },
    exportAs: (fmt) => {
      if (opts.onExport) {
        opts.onExport(fmt, store.selection.length > 0 ? 'selection' : 'document');
      } else {
        const selNode = store.selection.length > 0 ? store.getNode(store.selection[0]) : null;
        if (fmt === 'png') downloadPng(store.doc, selNode, store.fileName.replace(/\.pen$/, ''), 2);
        if (fmt === 'svg') downloadSvg(store.doc, selNode, store.fileName.replace(/\.pen$/, ''));
        if (fmt === 'html') downloadHtml(store.doc, selNode, store.fileName.replace(/\.pen$/, ''));
      }
    },
    account: () => openAccountMenu(container.querySelector('#btn-account-chip') as HTMLElement),
    storage: () => {
      if (getAuth().user) openUpgradeDialog();
      else opts.onOpenAuth?.();
    },
    importImage: async () => {
      if (opts.onImportImage) {
        opts.onImportImage();
      } else {
        const img = await pickImageFile();
        if (img) {
          const center = canvasView.getViewportCenter();
          const asset = { ...img, id: `img-${Date.now()}` };
          store.addNode(createImageNode(asset, center.x, center.y));
          toast('Image imported', 'success');
        }
      }
    },
    undo: () => store.undo(),
    redo: () => store.redo(),
    cut: () => {
      // Basic clipboard cut
      if (store.selection.length > 0) {
        store.removeNodes(store.selection);
      }
    },
    copy: () => {
      if (store.selection.length > 0) {
        store.duplicateNodes(store.selection);
      }
    },
    paste: () => {},
    duplicate: () => store.duplicateNodes(store.selection),
    delete: () => store.removeNodes(store.selection),
    selectAll: () => {
      store.setSelection(store.allNodes().map((n) => n.id));
    },
    zoomIn: () => {
      const c = { x: canvasContainer.clientWidth / 2, y: canvasContainer.clientHeight / 2 };
      store.zoomAt(c, 1.25);
    },
    zoomOut: () => {
      const c = { x: canvasContainer.clientWidth / 2, y: canvasContainer.clientHeight / 2 };
      store.zoomAt(c, 0.8);
    },
    zoomFit: () => canvasView.zoomToFit(),
    toggleGrid: () => {
      if (canvasView.settings) {
        canvasView.settings.showGrid = !canvasView.settings.showGrid;
        canvasView.render();
      }
    },
    toggleSnap: () => {
      if (canvasView.settings) {
        canvasView.settings.snapToObjects = !canvasView.settings.snapToObjects;
      }
    },
    group: () => groupSelection(store),
    ungroup: () => ungroupSelection(store),
    bringForward: () => reorderSelection(store, 'forward'),
    sendBackward: () => reorderSelection(store, 'backward'),
    bringToFront: () => reorderSelection(store, 'front'),
    sendToBack: () => reorderSelection(store, 'back'),
    togglePanel: () => {
      isPanelCollapsed = !isPanelCollapsed;
      leftPanel.classList.toggle('hidden', isPanelCollapsed);
    },
    settings: () => {
      if (opts.onOpenSettings) opts.onOpenSettings();
      else openSettings({ onApply: (s) => (canvasView.settings = s) });
    },
    shortcuts: () => {
      openSettings();
    },
    about: () => {
      openSettings();
    },
  });
  menubarSlot.appendChild(menuBar.el);

  // Initialize Left panel content
  const leftContent = container.querySelector('#left-content') as HTMLElement;
  let currentTabModule: { el: HTMLElement; refresh?(): void; destroy?(): void } | null = null;

  function switchTab(tab: string) {
    activeTab = tab;
    currentTabModule?.destroy?.();
    leftContent.innerHTML = '';

    container.querySelectorAll('.pen-tab-btn').forEach((btn) => {
      const bTab = btn.getAttribute('data-tab');
      btn.classList.toggle('active', bTab === tab);
    });

    if (tab === 'layers') {
      currentTabModule = createLayers(store);
      leftContent.appendChild(currentTabModule.el);
    } else if (tab === 'agent') {
      currentTabModule = createAgent(store, {
        onGenerate() {
          canvasView.zoomToFit();
        },
      });
      leftContent.appendChild(currentTabModule.el);
    } else if (tab === 'slides') {
      currentTabModule = createSlides(store);
      leftContent.appendChild(currentTabModule.el);
    } else if (tab === 'components') {
      currentTabModule = createComponents(store);
      leftContent.appendChild(currentTabModule.el);
    } else if (tab === 'libraries') {
      currentTabModule = createLibraries(store);
      leftContent.appendChild(currentTabModule.el);
    }
  }

  switchTab('layers');

  // Wire Top bar actions
  container.querySelector('#btn-back-dashboard')?.addEventListener('click', async () => {
    if (store.dirty) {
      const ok = await confirmDialog({
        title: 'Unsaved Changes',
        message: 'Leave without saving changes?',
        confirmLabel: 'Leave',
        danger: true,
      });
      if (!ok) return;
    }
    opts.onExit();
  });

  const leftPanel = container.querySelector('#left-panel') as HTMLElement;
  container.querySelector('#btn-toggle-panel')?.addEventListener('click', () => {
    isPanelCollapsed = !isPanelCollapsed;
    leftPanel.classList.toggle('hidden', isPanelCollapsed);
  });

  const openEditorSettings = () => {
    if (opts.onOpenSettings) opts.onOpenSettings();
    else openSettings({ onApply: (s) => (canvasView.settings = s) });
  };
  container.querySelector('#btn-settings-top')?.addEventListener('click', openEditorSettings);

  // Wire Share menu
  const shareBtn = container.querySelector('#btn-share-top') as HTMLElement;
  shareBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = shareBtn.getBoundingClientRect();
    const auth = getAuth();
    const hasSelection = store.selection.length > 0;
    const selectedNode = hasSelection ? store.getNode(store.selection[0]) : null;

    showContextMenu(rect.left, rect.bottom + 6, [
      {
        label: 'Copy .pen JSON',
        shortcut: 'Cmd+C',
        action: () => {
          const json = serializePenFile(store.doc);
          navigator.clipboard?.writeText(json);
          toast('Copied .pen document JSON to clipboard', 'success');
        },
      },
      {
        label: 'Download .pen File',
        shortcut: 'Cmd+S',
        action: () => {
          opts.onSaveAs();
        },
      },
      'separator',
      {
        label: hasSelection ? 'Copy Selected Frame HTML' : 'Copy Document HTML',
        action: () => {
          if (selectedNode) {
            handleCopyHtml(selectedNode.id);
          } else if (store.doc.children.length > 0) {
            handleCopyHtml(store.doc.children[0].id);
          } else {
            toast('No elements to copy HTML from', 'error');
          }
        },
      },
      {
        label: 'Export PNG Image',
        action: () => {
          downloadPng(store.doc, selectedNode, store.fileName.replace(/\.pen$/, ''), 2);
          toast('Exporting PNG...', 'info');
        },
      },
      'separator',
      {
        label: auth.user ? 'Copy cloud link' : 'Copy local file link',
        disabled: true,
        action: () => {},
      },
    ]);
  });

  const onOpenAuthEvent = () => {
    opts.onOpenAuth?.();
  };
  const onOpenSettingsEvent = () => openEditorSettings();
  window.addEventListener('penclone:open-auth', onOpenAuthEvent);
  window.addEventListener('penclone:open-settings', onOpenSettingsEvent);

  // Wire Command Palette
  function openCommandPalette() {
    showCommandPalette([
      { id: 'zoom-fit', label: 'Zoom: Zoom to Fit', shortcut: 'Shift+1', run: () => canvasView.zoomToFit() },
      { id: 'zoom-in', label: 'Zoom: Zoom In', shortcut: 'Cmd+=', run: () => store.zoomAt(canvasView.getViewportCenter(), 1.25) },
      { id: 'zoom-out', label: 'Zoom: Zoom Out', shortcut: 'Cmd+-', run: () => store.zoomAt(canvasView.getViewportCenter(), 0.8) },
      { id: 'group', label: 'Object: Group Selection', shortcut: 'Cmd+G', run: () => groupSelection(store) },
      { id: 'ungroup', label: 'Object: Ungroup Selection', shortcut: 'Cmd+Shift+G', run: () => ungroupSelection(store) },
      { id: 'save', label: 'File: Save Document', shortcut: 'Cmd+S', run: () => opts.onSave() },
      { id: 'save-as', label: 'File: Save As...', shortcut: 'Cmd+Shift+S', run: () => opts.onSaveAs() },
      { id: 'export-png', label: 'Export: Download PNG', run: () => downloadPng(store.doc, null, store.fileName.replace(/\.pen$/, ''), 2) },
      { id: 'export-svg', label: 'Export: Download SVG', run: () => downloadSvg(store.doc, null, store.fileName.replace(/\.pen$/, '')) },
      { id: 'export-html', label: 'Export: Download HTML', run: () => downloadHtml(store.doc, null, store.fileName.replace(/\.pen$/, '')) },
      { id: 'settings', label: 'Preferences: Open Settings', shortcut: 'Cmd+,', run: () => openSettings() },
    ]);
  }

  container.querySelector('#btn-cmd-palette')?.addEventListener('click', openCommandPalette);

  // Wire Tab Buttons
  container.querySelectorAll('.pen-tab-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const tab = (e.currentTarget as HTMLElement).getAttribute('data-tab');
      if (tab) switchTab(tab);
    });
  });

  // Wire Zoom controls
  const zoomValEl = container.querySelector('#zoom-value') as HTMLElement;
  container.querySelector('#btn-zoom-in')?.addEventListener('click', () => {
    const center = { x: canvasContainer.clientWidth / 2, y: canvasContainer.clientHeight / 2 };
    store.zoomAt(center, 1.25);
  });
  container.querySelector('#btn-zoom-out')?.addEventListener('click', () => {
    const center = { x: canvasContainer.clientWidth / 2, y: canvasContainer.clientHeight / 2 };
    store.zoomAt(center, 0.8);
  });

  // Drop zone for image insertion at cursor location
  canvasContainer.addEventListener('dragover', (e) => e.preventDefault());
  canvasContainer.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (!e.dataTransfer?.files?.length) return;
    const rect = canvasContainer.getBoundingClientRect();
    const world = store.screenToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    try {
      const results = await readDroppedFiles(e.dataTransfer.files);
      for (const res of results) {
        if (res.kind === 'image') {
          const asset = { ...res.image, id: `img-${Date.now()}` };
          const node = createImageNode(asset, world.x, world.y);
          store.addNode(node);
          toast(`Inserted image ${res.image.name}`, 'success');
        }
      }
    } catch {
      toast('Failed to process dropped files', 'error');
    }
  });

  // Update Breadcrumb & Title on store changes
  const breadcrumbText = container.querySelector('#breadcrumb-text') as HTMLElement;
  const unsavedPill = container.querySelector('#unsaved-pill') as HTMLElement;
  const fileTitle = container.querySelector('#file-title') as HTMLElement;

  const unsubscribeStore = store.subscribe((event) => {
    if (event === 'viewport') {
      zoomValEl.textContent = `${Math.round(store.viewport.zoom * 100)}%`;
    } else if (event === 'selection') {
      if (store.selection.length === 0) {
        breadcrumbText.textContent = 'Canvas';
      } else if (store.selection.length === 1) {
        const node = store.getNode(store.selection[0]);
        breadcrumbText.textContent = node?.name || node?.type || 'Element';
      } else {
        breadcrumbText.textContent = `${store.selection.length} Selected`;
      }
    } else if (event === 'save-state' || event === 'doc') {
      unsavedPill.style.display = store.dirty ? 'flex' : 'none';
      fileTitle.textContent = `${store.fileName}${store.dirty ? ' — Edited' : ''}`;
    }
  });

  // Keyboard shortcuts
  const keyHandler = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }

    const meta = e.metaKey || e.ctrlKey;

    if (meta && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openCommandPalette();
    } else if (meta && e.key === ',') {
      e.preventDefault();
      openSettings();
    } else if (meta && e.key.toLowerCase() === 'g') {
      e.preventDefault();
      if (e.shiftKey) {
        ungroupSelection(store);
      } else {
        groupSelection(store);
      }
    } else if (meta && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      store.setSelection(store.allNodes().map((n) => n.id));
    } else if (meta && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        store.redo();
      } else {
        store.undo();
      }
    } else if (meta && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      store.redo();
    } else if (meta && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      store.duplicateNodes(store.selection);
    } else if (meta && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (e.shiftKey) {
        opts.onSaveAs();
      } else {
        opts.onSave();
      }
    } else if (e.key === 'Escape') {
      store.setSelection([]);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      store.removeNodes(store.selection);
    } else if (e.key === 'v' || e.key === 'V') {
      store.setTool('select');
    } else if (e.key === 'h' || e.key === 'H') {
      store.setTool('hand');
    } else if (e.key === 'r' || e.key === 'R') {
      store.setTool('rectangle');
    } else if (e.key === 'o' || e.key === 'O') {
      store.setTool('ellipse');
    } else if (e.key === 'f' || e.key === 'F') {
      store.setTool('frame');
    } else if (e.key === 't' || e.key === 'T') {
      store.setTool('text');
    } else if (e.key === 'c' || e.key === 'C') {
      store.setTool('comment');
    } else if (e.key === '1' && e.shiftKey) {
      e.preventDefault();
      canvasView.zoomToFit();
    } else if (meta && e.key === '0') {
      e.preventDefault();
      canvasView.zoomToFit();
    } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      let dx = 0, dy = 0;
      if (e.key === 'ArrowUp') dy = -step;
      if (e.key === 'ArrowDown') dy = step;
      if (e.key === 'ArrowLeft') dx = -step;
      if (e.key === 'ArrowRight') dx = step;
      store.moveBy(store.selection, dx, dy);
    }
  };

  window.addEventListener('keydown', keyHandler);

  return {
    destroy() {
      window.removeEventListener('keydown', keyHandler);
      window.removeEventListener('penclone:open-auth', onOpenAuthEvent);
      window.removeEventListener('penclone:open-settings', onOpenSettingsEvent);
      unsubscribeAuth();
      unsubscribeStore();
      canvasView.destroy();
      toolbar.destroy?.();
      inspector.destroy?.();
      menuBar.destroy();
      currentTabModule?.destroy?.();
      container.remove();
    },
  };
}
