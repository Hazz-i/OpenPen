import type { PenNode } from '../core/types';
import { svgIcon } from './icons';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/components.css';
import '../styles/imports.css';

interface DevicePreset {
  id: string;
  name: string;
  width: number;
  height: number;
  icon: string;
}

const PRESETS: DevicePreset[] = [
  { id: 'desktop', name: 'Desktop (1440)', width: 1440, height: 900, icon: 'tv' },
  { id: 'tablet', name: 'Tablet (834)', width: 834, height: 1194, icon: 'frame' },
  { id: 'mobile', name: 'Mobile (390)', width: 390, height: 844, icon: 'message-square' },
];

export function openBrowserImport(): Promise<{ nodes: PenNode[]; name: string } | null> {
  return new Promise((resolve) => {
    let url = '';
    let selectedPreset = PRESETS[0];
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

    function buildNodesFromHtml(html: string, pageUrl: string, preset: DevicePreset): PenNode[] {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const title = doc.title || new URL(pageUrl).hostname;
      const h1 = doc.querySelector('h1')?.textContent?.trim() || title;
      const sub = doc.querySelector('p')?.textContent?.trim() || doc.querySelector('h2')?.textContent?.trim() || '';

      const frameId = `browser-frame-${Date.now()}`;
      const children: PenNode[] = [];

      // 1. Navigation bar
      children.push({
        type: 'frame',
        id: `nav-${Date.now()}`,
        name: 'Navigation Bar',
        x: 0,
        y: 0,
        width: preset.width,
        height: 64,
        fill: '#18181b',
        children: [
          {
            type: 'text',
            id: `brand-${Date.now()}`,
            name: 'Logo Text',
            x: 24,
            y: 22,
            width: 200,
            height: 24,
            content: title.slice(0, 30),
            fontSize: 16,
            fontWeight: '600',
            fill: '#ffffff',
          },
        ],
      });

      // 2. Hero Section
      children.push({
        type: 'frame',
        id: `hero-${Date.now()}`,
        name: 'Hero Section',
        x: 0,
        y: 64,
        width: preset.width,
        height: 380,
        fill: '#ffffff',
        children: [
          {
            type: 'text',
            id: `hero-title-${Date.now()}`,
            name: 'Hero Heading',
            x: 48,
            y: 80,
            width: Math.min(680, preset.width - 96),
            height: 80,
            content: h1.slice(0, 100),
            fontSize: preset.id === 'mobile' ? 24 : 36,
            fontWeight: '700',
            fill: '#09090b',
          },
          {
            type: 'text',
            id: `hero-sub-${Date.now()}`,
            name: 'Hero Subtext',
            x: 48,
            y: 180,
            width: Math.min(600, preset.width - 96),
            height: 60,
            content: sub ? sub.slice(0, 160) : 'Explore imported web content and structured outlines.',
            fontSize: 15,
            fill: '#71717a',
          },
        ],
      });

      // Add Browser Node alongside
      const browserNode: PenNode = {
        type: 'frame',
        id: `browser-node-${Date.now()}`,
        name: `Browser: ${new URL(pageUrl).hostname}`,
        x: 0,
        y: 450,
        width: preset.width,
        height: 500,
        fill: '#f4f4f5',
        metadata: {
          browserUrl: pageUrl,
          deviceId: preset.id,
        },
      };
      children.push(browserNode);

      const rootFrame: PenNode = {
        type: 'frame',
        id: frameId,
        name: `Browser import ${new URL(pageUrl).hostname}`,
        x: 0,
        y: 0,
        width: preset.width,
        height: Math.max(preset.height, 980),
        fill: '#ffffff',
        clip: true,
        children,
      };

      return [rootFrame];
    }

    function render() {
      backdrop.innerHTML = `
        <div class="pen-modal pen-import-dialog" style="width: 480px;">
          <div class="pen-modal-header">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span>${svgIcon('globe', 18)}</span>
              <span class="pen-modal-title">Import from Browser</span>
            </div>
            <button class="pen-icon-btn" id="btn-close-browser">${svgIcon('minus', 14)}</button>
          </div>

          <div class="pen-modal-body" style="display: flex; flex-direction: column; gap: 14px;">
            <div style="font-size: 12px; color: var(--muted); line-height: 1.4;">
              Enter any public web page URL. We'll fetch its outline structure and insert an editable layout frame with an embedded browser node.
            </div>

            ${
              errorMessage
                ? `
              <div class="pen-auth-error">
                <span>${svgIcon('alert-triangle', 14)}</span>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                  <span>${errorMessage}</span>
                  <button type="button" class="pen-btn-secondary" id="btn-fallback-browser" style="height: 22px; font-size: 10px; width: fit-content; background: rgba(0,0,0,0.2);">
                    Insert empty browser frame anyway
                  </button>
                </div>
              </div>
            `
                : ''
            }

            <div class="pen-form-group">
              <label class="pen-form-label">Page URL</label>
              <input
                type="url"
                id="browser-url-input"
                class="pen-form-input"
                placeholder="https://example.com"
                value="${url}"
                required
              />
            </div>

            <div class="pen-form-group">
              <label class="pen-form-label">Device Preset</label>
              <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;">
                ${PRESETS.map(
                  (p) => `
                  <button
                    type="button"
                    class="pen-btn-secondary ${selectedPreset.id === p.id ? 'active' : ''}"
                    data-preset="${p.id}"
                    style="height: 36px; gap: 6px; border: 1px solid ${
                      selectedPreset.id === p.id ? 'var(--accent)' : 'var(--border)'
                    };"
                  >
                    ${svgIcon(p.icon, 14)}
                    <span>${p.name.split(' ')[0]}</span>
                  </button>
                `
                ).join('')}
              </div>
            </div>
          </div>

          <div class="pen-modal-footer">
            <button class="pen-btn-secondary" id="btn-cancel-browser">Cancel</button>
            <button class="pen-btn-primary" id="btn-submit-browser" ${loading ? 'disabled' : ''}>
              ${loading ? '<div class="pen-submit-spinner"></div>' : ''}
              <span>${loading ? 'Fetching...' : 'Import Page'}</span>
            </button>
          </div>
        </div>
      `;

      bindEvents();
    }

    function createFallbackNodes(targetUrl: string): PenNode[] {
      let hostname = 'example.com';
      try {
        hostname = new URL(targetUrl).hostname;
      } catch {
        // Keep fallback
      }
      return [
        {
          type: 'frame',
          id: `browser-${Date.now()}`,
          name: `Browser: ${hostname}`,
          x: 0,
          y: 0,
          width: selectedPreset.width,
          height: selectedPreset.height,
          fill: '#ffffff',
          children: [
            {
              type: 'text',
              id: `text-${Date.now()}`,
              name: 'Browser Placeholder',
              x: 40,
              y: 40,
              width: 400,
              height: 40,
              content: `Live Browser frame for ${targetUrl}`,
              fontSize: 18,
            },
          ],
        },
      ];
    }

    function bindEvents() {
      backdrop.querySelector('#btn-close-browser')?.addEventListener('click', () => close(null));
      backdrop.querySelector('#btn-cancel-browser')?.addEventListener('click', () => close(null));

      backdrop.querySelectorAll('[data-preset]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const id = (e.currentTarget as HTMLElement).getAttribute('data-preset');
          const found = PRESETS.find((p) => p.id === id);
          if (found) {
            selectedPreset = found;
            render();
          }
        });
      });

      const urlInput = backdrop.querySelector('#browser-url-input') as HTMLInputElement;
      urlInput?.addEventListener('input', () => {
        url = urlInput.value.trim();
      });

      backdrop.querySelector('#btn-fallback-browser')?.addEventListener('click', () => {
        close({
          nodes: createFallbackNodes(url || 'https://example.com'),
          name: `Browser import ${url ? new URL(url).hostname : 'page'}`,
        });
      });

      backdrop.querySelector('#btn-submit-browser')?.addEventListener('click', async () => {
        let cleanUrl = url;
        if (!cleanUrl) {
          errorMessage = 'Please enter a valid page URL.';
          render();
          return;
        }
        if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
          cleanUrl = 'https://' + cleanUrl;
        }

        loading = true;
        errorMessage = '';
        render();

        try {
          const res = await fetch('/api/import/url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: cleanUrl }),
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `Fetch failed with status ${res.status}`);
          }

          const data = await res.json();
          const nodes = buildNodesFromHtml(data.html || '', cleanUrl, selectedPreset);
          close({
            nodes,
            name: `Browser import ${new URL(cleanUrl).hostname}`,
          });
        } catch (err) {
          loading = false;
          errorMessage = (err as Error).message || 'Failed to fetch the target URL.';
          render();
        }
      });
    }

    render();
    document.body.appendChild(backdrop);
  });
}
