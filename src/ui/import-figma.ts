import type { PenNode } from '../core/types';
import { svgIcon } from './icons';
import { toast } from './dialogs';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/components.css';
import '../styles/imports.css';

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
              throw new Error(errData.error || `Import failed (${res.status})`);
            }

            const data = await res.json();
            // Create fallback frame with doc title
            const docName = data.document?.name || 'Figma Import';
            const frameNode: PenNode = {
              type: 'frame',
              id: `figma-${Date.now()}`,
              name: docName,
              x: 0,
              y: 0,
              width: 1200,
              height: 800,
              fill: '#ffffff',
            };
            close({ nodes: [frameNode], name: docName });
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
