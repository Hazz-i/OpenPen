import type { PenNode } from '../core/types';
import { svgIcon } from './icons';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/components.css';
import '../styles/imports.css';

export function openScreenshotImport(): Promise<{ nodes: PenNode[]; name: string } | null> {
  return new Promise((resolve) => {
    let imageSrc = '';
    let imageName = 'Screenshot';
    let imgNaturalW = 1440;
    let imgNaturalH = 900;
    let fitTo1440 = true;
    let extractPalette = true;
    let paletteColors: string[] = [];

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

    function samplePalette(imgEl: HTMLImageElement): string[] {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return ['#18181b', '#ffffff', '#3d99ff'];

      canvas.width = 64;
      canvas.height = 64;
      ctx.drawImage(imgEl, 0, 0, 64, 64);
      const data = ctx.getImageData(0, 0, 64, 64).data;

      const colors = new Set<string>();
      // Sample evenly
      for (let i = 0; i < data.length && colors.size < 6; i += 16 * 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const hex =
          '#' +
          [r, g, b]
            .map((x) => x.toString(16).padStart(2, '0'))
            .join('')
            .toUpperCase();
        colors.add(hex);
      }

      return Array.from(colors);
    }

    function handleFile(file: File) {
      imageName = file.name.replace(/\.[^.]+$/, '');
      const reader = new FileReader();
      reader.onload = (e) => {
        const url = e.target?.result as string;
        imageSrc = url;

        const img = new Image();
        img.onload = () => {
          imgNaturalW = img.naturalWidth || 1440;
          imgNaturalH = img.naturalHeight || 900;
          paletteColors = samplePalette(img);
          render();
        };
        img.src = url;
      };
      reader.readAsDataURL(file);
    }

    function render() {
      backdrop.innerHTML = `
        <div class="pen-modal pen-import-dialog" style="width: 520px;">
          <div class="pen-modal-header">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span>${svgIcon('image', 18)}</span>
              <span class="pen-modal-title">Recreate a Screenshot</span>
            </div>
            <button class="pen-icon-btn" id="btn-close-ss">${svgIcon('minus', 14)}</button>
          </div>

          <div class="pen-modal-body" style="display: flex; flex-direction: column; gap: 14px;">
            <div style="font-size: 11px; color: var(--faint); line-height: 1.4; padding: 6px 10px; background: rgba(255,255,255,0.02); border-radius: var(--radius-sm); border: 1px solid var(--border);">
              Local reference import — no AI reconstruction. Inserts your screenshot as a locked reference layer with color swatches so you can trace over the design.
            </div>

            ${
              !imageSrc
                ? `
              <div class="pen-import-dropzone" id="ss-dropzone">
                <span>${svgIcon('image', 32)}</span>
                <div style="font-size: 13px; font-weight: 500; color: var(--fg-strong);">
                  Drop screenshot here or click to browse
                </div>
                <div style="font-size: 11px; color: var(--faint);">
                  Supports PNG, JPG, WebP
                </div>
                <input type="file" id="ss-file-input" accept="image/png,image/jpeg,image/webp" style="display: none;" />
              </div>
            `
                : `
              <div class="pen-import-preview-box">
                <img src="${imageSrc}" alt="Screenshot preview" />
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--muted);">
                <span>${imgNaturalW} × ${imgNaturalH} px</span>
                <button type="button" class="pen-btn-secondary" id="btn-change-image" style="height: 24px; font-size: 11px;">
                  Change Image
                </button>
              </div>

              <div style="display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--border); padding-top: 10px;">
                <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer;">
                  <input type="checkbox" id="chk-fit-width" ${fitTo1440 ? 'checked' : ''} />
                  <span>Fit width to 1440 px standard artboard</span>
                </label>

                <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer;">
                  <input type="checkbox" id="chk-extract-palette" ${extractPalette ? 'checked' : ''} />
                  <span>Extract color palette (${paletteColors.length} swatches)</span>
                </label>

                ${
                  extractPalette && paletteColors.length > 0
                    ? `
                  <div class="pen-palette-row">
                    ${paletteColors
                      .map(
                        (c) => `
                      <div class="pen-palette-chip">
                        <div class="swatch" style="background: ${c};"></div>
                        <span>${c}</span>
                      </div>
                    `
                      )
                      .join('')}
                  </div>
                `
                    : ''
                }
              </div>
            `
            }
          </div>

          <div class="pen-modal-footer">
            <button class="pen-btn-secondary" id="btn-cancel-ss">Cancel</button>
            <button class="pen-btn-primary" id="btn-submit-ss" ${!imageSrc ? 'disabled' : ''}>
              <span>Import Reference</span>
            </button>
          </div>
        </div>
      `;

      bindEvents();
    }

    function bindEvents() {
      backdrop.querySelector('#btn-close-ss')?.addEventListener('click', () => close(null));
      backdrop.querySelector('#btn-cancel-ss')?.addEventListener('click', () => close(null));

      const dropzone = backdrop.querySelector('#ss-dropzone');
      const fileInput = backdrop.querySelector('#ss-file-input') as HTMLInputElement;

      dropzone?.addEventListener('click', () => fileInput?.click());
      dropzone?.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
      dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
      dropzone?.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        const file = (e as DragEvent).dataTransfer?.files?.[0];
        if (file) handleFile(file);
      });

      fileInput?.addEventListener('change', () => {
        if (fileInput.files?.[0]) handleFile(fileInput.files[0]);
      });

      backdrop.querySelector('#btn-change-image')?.addEventListener('click', () => {
        imageSrc = '';
        render();
      });

      const fitChk = backdrop.querySelector('#chk-fit-width') as HTMLInputElement;
      fitChk?.addEventListener('change', () => {
        fitTo1440 = fitChk.checked;
      });

      const palChk = backdrop.querySelector('#chk-extract-palette') as HTMLInputElement;
      palChk?.addEventListener('change', () => {
        extractPalette = palChk.checked;
        render();
      });

      backdrop.querySelector('#btn-submit-ss')?.addEventListener('click', () => {
        if (!imageSrc) return;

        let w = imgNaturalW;
        let h = imgNaturalH;
        if (fitTo1440 && w > 0) {
          const ratio = 1440 / w;
          w = 1440;
          h = Math.round(h * ratio);
        }

        const nodes: PenNode[] = [];

        // 1. Locked Reference Frame
        nodes.push({
          type: 'frame',
          id: `ref-img-${Date.now()}`,
          name: 'Locked reference',
          x: 0,
          y: 0,
          width: w,
          height: h,
          locked: true,
          fill: {
            type: 'image',
            url: imageSrc,
            mode: 'cover',
          },
        });

        // 2. Palette Swatches Frame
        if (extractPalette && paletteColors.length > 0) {
          const swatchNodes: PenNode[] = paletteColors.map((hex, idx) => ({
            type: 'rectangle',
            id: `swatch-${Date.now()}-${idx}`,
            name: `Color ${hex}`,
            x: idx * 48 + 12,
            y: 12,
            width: 36,
            height: 36,
            cornerRadius: 6,
            fill: hex,
          }));

          nodes.push({
            type: 'frame',
            id: `palette-${Date.now()}`,
            name: 'Extracted Palette',
            x: 0,
            y: h + 24,
            width: Math.max(300, paletteColors.length * 48 + 24),
            height: 60,
            fill: '#18181b',
            cornerRadius: 8,
            children: swatchNodes,
          });
        }

        close({ nodes, name: `Screenshot reference` });
      });
    }

    render();
    document.body.appendChild(backdrop);
  });
}
