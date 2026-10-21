import type { EditorStore } from '../core/store';
import { generateFromPrompt } from '../core/samples';
import { svgIcon } from './icons';
import { toast } from './dialogs';

export function createLibraries(store: EditorStore): {
  el: HTMLElement;
  refresh(): void;
  destroy?(): void;
} {
  const el = document.createElement('div');
  el.className = 'pen-agent-container';

  let searchQuery = '';

  const starters = [
    { name: 'Hero Header', prompt: 'hero', desc: 'Heading with CTA and navbar' },
    { name: 'Feature Grid', prompt: 'features', desc: '3-column feature display' },
    { name: 'Pricing Cards', prompt: 'pricing', desc: '3-tier pricing table' },
    { name: 'Mobile Card', prompt: 'mobile', desc: 'Feed card with avatar & button' },
    { name: 'Dashboard Stat', prompt: 'dashboard', desc: 'Metric chart & summary card' },
  ];

  function render() {
    const filtered = starters.filter((s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    el.innerHTML = `
      <div style="font-size: 11px; font-weight: 600; color: var(--fg-strong);">Component Library</div>
      <div style="background: var(--input); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 4px 8px; display: flex; align-items: center; gap: 6px;">
        <span style="color: var(--faint);">${svgIcon('sparkles', 12)}</span>
        <input type="text" id="lib-search" value="${searchQuery}" placeholder="Search starters..." style="background: transparent; border: none; font-size: 11px; width: 100%; outline: none;" />
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 6px;">
        ${filtered
          .map(
            (s) => `
          <div class="pen-agent-chip" data-lib-prompt="${s.prompt}" style="display: flex; flex-direction: column; gap: 2px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: 600; color: var(--fg-strong);">${s.name}</span>
              ${svgIcon('plus', 12)}
            </div>
            <span style="font-size: 10px; color: var(--faint);">${s.desc}</span>
          </div>
        `
          )
          .join('')}
      </div>

      <div style="margin-top: 12px; border-top: 1px solid var(--border); padding-top: 12px;">
        <span style="font-size: 11px; font-weight: 600; color: var(--fg-strong);">Imported Assets</span>
        <div style="font-size: 10px; color: var(--faint); margin-top: 4px;">
          Drag & drop any PNG/SVG/JPG file directly onto the canvas or paste from clipboard.
        </div>
      </div>
    `;

    bindEvents();
  }

  function bindEvents() {
    const input = el.querySelector('#lib-search') as HTMLInputElement;
    input?.addEventListener('input', () => {
      searchQuery = input.value;
      render();
    });

    el.querySelectorAll('[data-lib-prompt]').forEach((item) => {
      item.addEventListener('click', () => {
        const prompt = item.getAttribute('data-lib-prompt')!;
        try {
          const gen = generateFromPrompt(prompt);
          if (gen.doc.children.length > 0) {
            // Append nodes to current document
            store.beginTransaction();
            for (const child of gen.doc.children) {
              store.addNode(child);
            }
            store.endTransaction();
            toast(`Inserted "${gen.name}" into canvas`, 'success');
          }
        } catch {
          toast('Could not insert starter component', 'error');
        }
      });
    });
  }

  render();

  return {
    el,
    refresh: render,
  };
}
