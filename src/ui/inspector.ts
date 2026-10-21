import type { EditorStore } from '../core/store';
import type { PenNode } from '../core/types';
import { num } from '../core/store';
import { resolvePaintColor } from './thumbnail';
import { svgIcon } from './icons';
import {
  alignSelection,
  distributeSelection,
  reorderSelection,
  groupSelection,
  ungroupSelection,
  createComponentFromSelection,
} from '../core/docops';
import { downloadHtml, downloadSvg, downloadPng } from '../core/exporters';
import { pickImageFile } from '../core/files';
import { toast, promptDialog } from './dialogs';

export interface InspectorOptions {
  onExportHtml?(nodeId: string): void;
  onCopyHtml?(nodeId: string): void;
}

export function createInspector(
  store: EditorStore,
  opts: InspectorOptions = {}
): { el: HTMLElement; refresh(): void; destroy?(): void } {
  const el = document.createElement('div');
  el.className = 'pen-inspector-panel';

  function getNode(): PenNode | null {
    if (store.selection.length === 0) return null;
    return store.getNode(store.selection[0]);
  }

  function render() {
    const node = getNode();

    if (!node) {
      if (store.selection.length > 1) {
        // Multi-selection panel
        el.innerHTML = `
          <div class="pen-inspector-header">
            <span class="pen-inspector-node-title">
              ${svgIcon('layers', 14)}
              <span>${store.selection.length} objects selected</span>
            </span>
          </div>
          <div class="pen-inspector-section">
            <button class="pen-create-component-btn" id="btn-multi-group">
              ${svgIcon('layout-grid', 13)}
              <span>Group Selection (Cmd+G)</span>
            </button>
          </div>
          <!-- Alignment -->
          <div class="pen-inspector-section">
            <div class="pen-section-title-row">
              <span>Align</span>
            </div>
            <div class="pen-align-row">
              <button class="pen-align-btn" data-align="left" title="Align Left">${svgIcon('minus', 13)}</button>
              <button class="pen-align-btn" data-align="hcenter" title="Align Horizontal Center">${svgIcon('more-horizontal', 13)}</button>
              <button class="pen-align-btn" data-align="right" title="Align Right">${svgIcon('minus', 13)}</button>
              <button class="pen-align-btn" data-align="top" title="Align Top">${svgIcon('arrow-up', 13)}</button>
              <button class="pen-align-btn" data-align="vcenter" title="Align Vertical Center">${svgIcon('more-horizontal', 13)}</button>
              <button class="pen-align-btn" data-align="bottom" title="Align Bottom">${svgIcon('chevron-down', 13)}</button>
            </div>
            <div style="display: flex; gap: 4px; margin-top: 4px;">
              <button class="pen-create-component-btn" id="btn-dist-h" style="font-size: 10px;">Distribute H</button>
              <button class="pen-create-component-btn" id="btn-dist-v" style="font-size: 10px;">Distribute V</button>
            </div>
          </div>
          <!-- Arrange -->
          <div class="pen-inspector-section">
            <div class="pen-section-title-row">
              <span>Arrange</span>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
              <button class="pen-create-component-btn" id="btn-front">To Front</button>
              <button class="pen-create-component-btn" id="btn-back">To Back</button>
            </div>
          </div>
        `;

        el.querySelector('#btn-multi-group')?.addEventListener('click', () => groupSelection(store));
        el.querySelectorAll('[data-align]').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            const mode = (e.currentTarget as HTMLElement).getAttribute('data-align') as any;
            alignSelection(store, mode);
          });
        });
        el.querySelector('#btn-dist-h')?.addEventListener('click', () => distributeSelection(store, 'horizontal'));
        el.querySelector('#btn-dist-v')?.addEventListener('click', () => distributeSelection(store, 'vertical'));
        el.querySelector('#btn-front')?.addEventListener('click', () => reorderSelection(store, 'front'));
        el.querySelector('#btn-back')?.addEventListener('click', () => reorderSelection(store, 'back'));
        return;
      }

      // Nothing selected
      el.innerHTML = `
        <div class="pen-inspector-header">
          <span class="pen-inspector-node-title">Canvas</span>
        </div>
        <div class="pen-inspector-section">
          <div class="pen-section-title-row">
            <span>Background</span>
          </div>
          <div class="pen-paint-row">
            <span class="pen-swatch" style="background: #1d1d1f;"></span>
            <input type="text" class="pen-field-input" value="1D1D1F" readonly style="width: 70px;" />
            <span style="font-size: 11px; color: var(--faint);">100%</span>
          </div>
        </div>
        <div class="pen-inspector-section">
          <div class="pen-section-title-row">
            <span>Export Document</span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <button class="pen-create-component-btn" id="btn-export-doc-png">
              ${svgIcon('download', 14)}
              <span>Export as PNG</span>
            </button>
            <button class="pen-create-component-btn" id="btn-export-doc-svg">
              ${svgIcon('download', 14)}
              <span>Export as SVG</span>
            </button>
          </div>
        </div>
      `;

      el.querySelector('#btn-export-doc-png')?.addEventListener('click', () => {
        downloadPng(store.doc, null, store.fileName.replace(/\.pen$/, ''), 2);
      });
      el.querySelector('#btn-export-doc-svg')?.addEventListener('click', () => {
        downloadSvg(store.doc, null, store.fileName.replace(/\.pen$/, ''));
      });
      return;
    }

    const x = Math.round(num(node.x) ?? 0);
    const y = Math.round(num(node.y) ?? 0);
    const w = Math.round(num(node.width) ?? 0);
    const h = Math.round(num(node.height) ?? 0);
    const rot = Math.round(node.rotation ?? 0);
    const op = Math.round((node.opacity ?? 1) * 100);
    const radius = typeof node.cornerRadius === 'number' ? node.cornerRadius : 0;
    const color = resolvePaintColor(node.fill) || '#D3D3D3';
    const hexColor = color.replace('#', '').toUpperCase();
    const isImage = typeof node.fill === 'object' && !Array.isArray(node.fill) && node.fill?.type === 'image';

    el.innerHTML = `
      <!-- Header -->
      <div class="pen-inspector-header">
        <span class="pen-inspector-node-title" id="btn-rename-node" style="cursor: pointer;" title="Click to rename">
          ${svgIcon('hash', 14)}
          <span>${node.name || node.content || node.type}</span>
        </span>
        <button class="pen-icon-btn" id="btn-del-node" title="Delete">
          ${svgIcon('trash', 14)}
        </button>
      </div>

      <!-- Action -->
      <div class="pen-inspector-section" style="padding-top: 8px; padding-bottom: 8px;">
        <button class="pen-create-component-btn" id="btn-create-comp">
          ${svgIcon('sparkles', 13)}
          <span>Create Component</span>
        </button>
      </div>

      <!-- Alignment (6 icon buttons) -->
      <div class="pen-inspector-section">
        <div class="pen-align-row">
          <button class="pen-align-btn" data-align="left" title="Align Left">${svgIcon('minus', 13)}</button>
          <button class="pen-align-btn" data-align="hcenter" title="Align Horizontal Center">${svgIcon('more-horizontal', 13)}</button>
          <button class="pen-align-btn" data-align="right" title="Align Right">${svgIcon('minus', 13)}</button>
          <button class="pen-align-btn" data-align="top" title="Align Top">${svgIcon('arrow-up', 13)}</button>
          <button class="pen-align-btn" data-align="vcenter" title="Align Vertical Center">${svgIcon('more-horizontal', 13)}</button>
          <button class="pen-align-btn" data-align="bottom" title="Align Bottom">${svgIcon('chevron-down', 13)}</button>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 4px;">
          <button class="pen-create-component-btn" id="btn-arrange-fwd">Forward</button>
          <button class="pen-create-component-btn" id="btn-arrange-back">Backward</button>
        </div>
      </div>

      <!-- Position -->
      <div class="pen-inspector-section">
        <div class="pen-section-title-row">
          <span>Position</span>
        </div>
        <div class="pen-field-grid">
          <div class="pen-field-input-box">
            <span class="pen-field-label">X</span>
            <input type="number" class="pen-field-input" id="prop-x" value="${x}" />
          </div>
          <div class="pen-field-input-box">
            <span class="pen-field-label">Y</span>
            <input type="number" class="pen-field-input" id="prop-y" value="${y}" />
          </div>
          <div class="pen-field-input-box">
            <span class="pen-field-label">∠</span>
            <input type="number" class="pen-field-input" id="prop-rot" value="${rot}" />
          </div>
          <div class="pen-field-input-box">
            <span class="pen-field-label">Op</span>
            <input type="number" min="0" max="100" class="pen-field-input" id="prop-opacity" value="${op}" />
          </div>
        </div>
      </div>

      <!-- Layout & Dimensions -->
      <div class="pen-inspector-section">
        <div class="pen-section-title-row">
          <span>Layout</span>
          ${svgIcon('grid', 13)}
        </div>
        <div class="pen-segmented">
          <button class="pen-segmented-btn ${!node.layout || node.layout === 'none' ? 'active' : ''}" data-layout="none">None</button>
          <button class="pen-segmented-btn ${node.layout === 'vertical' ? 'active' : ''}" data-layout="vertical">Col</button>
          <button class="pen-segmented-btn ${node.layout === 'horizontal' ? 'active' : ''}" data-layout="horizontal">Row</button>
        </div>
        <div class="pen-field-grid" style="margin-top: 4px;">
          <div class="pen-field-input-box">
            <span class="pen-field-label">W</span>
            <input type="number" class="pen-field-input" id="prop-w" value="${w}" />
          </div>
          <div class="pen-field-input-box">
            <span class="pen-field-label">H</span>
            <input type="number" class="pen-field-input" id="prop-h" value="${h}" />
          </div>
        </div>
      </div>

      <!-- Appearance -->
      <div class="pen-inspector-section">
        <div class="pen-section-title-row">
          <span>Appearance</span>
          ${svgIcon('eye', 13)}
        </div>
        <div class="pen-field-grid">
          <div class="pen-field-input-box">
            <span class="pen-field-label">R</span>
            <input type="number" min="0" class="pen-field-input" id="prop-radius" value="${radius}" />
          </div>
          <div class="pen-field-input-box">
            <label style="display: flex; align-items: center; gap: 4px; font-size: 10px; cursor: pointer;">
              <input type="checkbox" id="prop-lock" ${node.locked ? 'checked' : ''} />
              <span>Locked</span>
            </label>
          </div>
        </div>
      </div>

      <!-- Fill -->
      <div class="pen-inspector-section">
        <div class="pen-section-title-row">
          <span>Fill</span>
          <button class="pen-icon-btn" id="btn-add-img-fill" title="Use Image Fill">${svgIcon('image', 13)}</button>
        </div>
        ${
          isImage
            ? `
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px;">
              <span>Image Fill Active</span>
              <button class="pen-btn-secondary" id="btn-replace-img" style="height: 22px; font-size: 10px;">Replace Image</button>
            </div>
          </div>
        `
            : `
          <div class="pen-paint-row">
            <input type="color" id="prop-color-picker" value="${color.startsWith('#') ? color.slice(0, 7) : '#d3d3d3'}" style="position: absolute; opacity: 0; pointer-events: none;" />
            <span class="pen-swatch" id="prop-swatch" style="background: ${color};"></span>
            <input type="text" class="pen-field-input" id="prop-hex" value="${hexColor}" style="width: 60px; background: var(--input); padding: 4px 6px; border-radius: 4px;" />
            <span style="font-size: 11px; color: var(--faint);">100%</span>
          </div>
        `
        }
      </div>

      <!-- Typography Section if text node -->
      ${
        node.type === 'text'
          ? `
        <div class="pen-inspector-section">
          <div class="pen-section-title-row">
            <span>Typography</span>
            ${svgIcon('type', 13)}
          </div>
          <div class="pen-field-grid">
            <div class="pen-field-input-box">
              <span class="pen-field-label">Sz</span>
              <input type="number" class="pen-field-input" id="prop-font-size" value="${node.fontSize || 16}" />
            </div>
            <div class="pen-field-input-box">
              <span class="pen-field-label">Wt</span>
              <input type="text" class="pen-field-input" id="prop-font-weight" value="${node.fontWeight || 'normal'}" />
            </div>
          </div>
          <div class="pen-segmented" style="margin-top: 4px;">
            <button class="pen-segmented-btn ${!node.textAlign || node.textAlign === 'left' ? 'active' : ''}" data-align-text="left">L</button>
            <button class="pen-segmented-btn ${node.textAlign === 'center' ? 'active' : ''}" data-align-text="center">C</button>
            <button class="pen-segmented-btn ${node.textAlign === 'right' ? 'active' : ''}" data-align-text="right">R</button>
          </div>
        </div>
      `
          : ''
      }

      <!-- Code & Export Section -->
      <div class="pen-inspector-section">
        <div class="pen-section-title-row">
          <span>Export</span>
          ${svgIcon('download', 13)}
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
          <button class="pen-create-component-btn" id="btn-node-png">PNG (2x)</button>
          <button class="pen-create-component-btn" id="btn-node-svg">SVG</button>
          <button class="pen-create-component-btn" id="btn-node-html">HTML</button>
          <button class="pen-create-component-btn" id="btn-copy-node-html">Copy Code</button>
        </div>
      </div>
    `;

    bindEvents(node);
  }

  function bindEvents(node: PenNode) {
    el.querySelector('#btn-rename-node')?.addEventListener('click', async () => {
      const name = await promptDialog({
        title: 'Rename Node',
        value: node.name || node.content || node.type,
      });
      if (name) store.renameNode(node.id, name);
    });

    el.querySelector('#btn-del-node')?.addEventListener('click', () => {
      store.removeNodes([node.id]);
    });

    el.querySelector('#btn-create-comp')?.addEventListener('click', () => {
      const comp = createComponentFromSelection(store);
      if (comp) toast(`Component "${comp.name}" created`, 'success');
    });

    // Alignment
    el.querySelectorAll('[data-align]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const mode = (e.currentTarget as HTMLElement).getAttribute('data-align') as any;
        alignSelection(store, mode);
      });
    });

    el.querySelector('#btn-arrange-fwd')?.addEventListener('click', () => reorderSelection(store, 'forward'));
    el.querySelector('#btn-arrange-back')?.addEventListener('click', () => reorderSelection(store, 'backward'));

    // Position updates
    const bindNum = (id: string, prop: keyof PenNode, scale = 1) => {
      const input = el.querySelector(`#${id}`) as HTMLInputElement;
      input?.addEventListener('change', () => {
        const val = parseFloat(input.value);
        if (!isNaN(val)) store.updateNode(node.id, { [prop]: val * scale });
      });
    };

    bindNum('prop-x', 'x');
    bindNum('prop-y', 'y');
    bindNum('prop-w', 'width');
    bindNum('prop-h', 'height');
    bindNum('prop-rot', 'rotation');
    bindNum('prop-opacity', 'opacity', 0.01);
    bindNum('prop-radius', 'cornerRadius');

    const lockBox = el.querySelector('#prop-lock') as HTMLInputElement;
    lockBox?.addEventListener('change', () => {
      store.updateNode(node.id, { locked: lockBox.checked });
    });

    // Color picker
    const swatch = el.querySelector('#prop-swatch') as HTMLElement;
    const picker = el.querySelector('#prop-color-picker') as HTMLInputElement;
    const hexInput = el.querySelector('#prop-hex') as HTMLInputElement;

    swatch?.addEventListener('click', () => picker?.click());
    picker?.addEventListener('input', () => store.updateNode(node.id, { fill: picker.value }));
    hexInput?.addEventListener('change', () => {
      let val = hexInput.value.trim();
      if (!val.startsWith('#')) val = '#' + val;
      store.updateNode(node.id, { fill: val });
    });

    // Image fill buttons
    const handlePickImage = async () => {
      const picked = await pickImageFile();
      if (picked) {
        store.updateNode(node.id, {
          fill: { type: 'image', url: picked.dataUrl, mode: 'cover' },
        });
        toast('Image fill updated', 'success');
      }
    };
    el.querySelector('#btn-add-img-fill')?.addEventListener('click', handlePickImage);
    el.querySelector('#btn-replace-img')?.addEventListener('click', handlePickImage);

    // Text properties
    const fontSizeInput = el.querySelector('#prop-font-size') as HTMLInputElement;
    fontSizeInput?.addEventListener('change', () => {
      store.updateNode(node.id, { fontSize: parseFloat(fontSizeInput.value) || 16 });
    });

    const fontWtInput = el.querySelector('#prop-font-weight') as HTMLInputElement;
    fontWtInput?.addEventListener('change', () => {
      store.updateNode(node.id, { fontWeight: fontWtInput.value.trim() });
    });

    el.querySelectorAll('[data-align-text]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const textAlign = (e.currentTarget as HTMLElement).getAttribute('data-align-text') as any;
        store.updateNode(node.id, { textAlign });
      });
    });

    // Export node actions
    el.querySelector('#btn-node-png')?.addEventListener('click', () => {
      downloadPng(store.doc, node, node.name || 'node', 2);
    });
    el.querySelector('#btn-node-svg')?.addEventListener('click', () => {
      downloadSvg(store.doc, node, node.name || 'node');
    });
    el.querySelector('#btn-node-html')?.addEventListener('click', () => {
      downloadHtml(store.doc, node, node.name || 'node');
    });
    el.querySelector('#btn-copy-node-html')?.addEventListener('click', () => {
      opts.onCopyHtml?.(node.id);
    });
  }

  const unsubscribe = store.subscribe((event) => {
    if (event === 'selection' || event === 'doc') {
      render();
    }
  });

  render();

  return {
    el,
    refresh() {
      render();
    },
    destroy() {
      unsubscribe();
    },
  };
}
