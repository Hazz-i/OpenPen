import type { EditorStore } from '../core/store';
import {
  listComponents,
  createComponentFromSelection,
  insertComponentInstance,
} from '../core/docops';
import { renderThumbnail } from './thumbnail';
import { svgIcon } from './icons';
import { toast } from './dialogs';

export function createComponents(store: EditorStore): {
  el: HTMLElement;
  refresh(): void;
  destroy?(): void;
} {
  const el = document.createElement('div');
  el.className = 'pen-agent-container';

  function render() {
    const list = listComponents(store);

    el.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <span style="font-size: 11px; font-weight: 600; color: var(--fg-strong);">Components (${list.length})</span>
        <button class="pen-btn-secondary" id="btn-create-comp-tab" style="height: 24px; padding: 0 8px; font-size: 11px;">
          ${svgIcon('plus', 12)}
          <span>Create</span>
        </button>
      </div>

      ${
        list.length === 0
          ? `
        <div style="padding: 32px 16px; text-align: center; color: var(--faint); font-size: 11px;">
          No components yet.<br />Select a frame or group and click "Create" to build reusable components.
        </div>
      `
          : `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px;">
          ${list
            .map((c) => {
              const thumb = renderThumbnail(
                { version: store.doc.version, children: [c.node] },
                200,
                140
              );
              return `
              <div class="pen-slide-card" data-comp-id="${c.id}" title="Double click to insert">
                <div class="pen-slide-thumb" style="aspect-ratio: 4 / 3;">
                  <img src="${thumb}" style="width: 100%; height: 100%; object-fit: contain;" />
                </div>
                <div class="pen-slide-footer">
                  <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${c.name}</span>
                  <button class="pen-icon-btn" data-insert-comp="${c.id}" title="Insert instance">
                    ${svgIcon('plus', 12)}
                  </button>
                </div>
              </div>
            `;
            })
            .join('')}
        </div>
      `
      }
    `;

    bindEvents();
  }

  function insertAtCenter(compId: string) {
    const vp = store.viewport;
    const cx = -vp.panX / vp.zoom + 200;
    const cy = -vp.panY / vp.zoom + 200;
    const id = insertComponentInstance(store, compId, cx, cy);
    if (id) {
      store.selectOnly(id);
      toast('Component instance inserted', 'success');
    }
  }

  function bindEvents() {
    el.querySelector('#btn-create-comp-tab')?.addEventListener('click', () => {
      const comp = createComponentFromSelection(store);
      if (comp) {
        toast(`Component "${comp.name}" created`, 'success');
        render();
      } else {
        toast('Select an element first to create component', 'error');
      }
    });

    el.querySelectorAll('[data-comp-id]').forEach((card) => {
      card.addEventListener('dblclick', () => {
        const id = card.getAttribute('data-comp-id')!;
        insertAtCenter(id);
      });

      card.querySelector('[data-insert-comp]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = card.getAttribute('data-comp-id')!;
        insertAtCenter(id);
      });
    });
  }

  const unsubscribe = store.subscribe((event) => {
    if (event === 'doc') {
      render();
    }
  });

  render();

  return {
    el,
    refresh: render,
    destroy() {
      unsubscribe();
    },
  };
}
