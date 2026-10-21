import type { EditorStore } from '../core/store';
import { listSlides, addSlide } from '../core/docops';
import { renderThumbnail } from './thumbnail';
import { svgIcon } from './icons';
import { promptDialog } from './dialogs';

export function createSlides(store: EditorStore): {
  el: HTMLElement;
  refresh(): void;
  destroy?(): void;
} {
  const el = document.createElement('div');
  el.className = 'pen-slides-list';

  let isPresenting = false;
  let presentIndex = 0;

  function render() {
    const slides = listSlides(store);

    el.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; padding-bottom: 4px;">
        <span style="font-size: 11px; font-weight: 600; color: var(--fg-strong);">Slides (${slides.length})</span>
        <div style="display: flex; gap: 4px;">
          <button class="pen-btn-secondary" id="btn-add-slide" style="height: 24px; padding: 0 6px; font-size: 11px;">
            ${svgIcon('plus', 12)}
            <span>Add</span>
          </button>
          <button class="pen-btn-primary" id="btn-present" style="height: 24px; padding: 0 8px; font-size: 11px;">
            ${svgIcon('play', 12)}
            <span>Present</span>
          </button>
        </div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;">
        ${slides
          .map((slide, idx) => {
            const isSelected = store.selection.includes(slide.id);
            const node = store.getNode(slide.id);
            const thumb = node
              ? renderThumbnail({ version: store.doc.version, children: [node] }, 280, 160)
              : '';
            return `
            <div class="pen-slide-card ${isSelected ? 'active' : ''}" data-slide-id="${slide.id}">
              <div class="pen-slide-thumb">
                ${thumb ? `<img src="${thumb}" style="width: 100%; height: 100%; object-fit: contain;" />` : ''}
              </div>
              <div class="pen-slide-footer">
                <span style="display: flex; align-items: center; gap: 6px;">
                  <span style="color: var(--faint); font-size: 10px;">#${idx + 1}</span>
                  <span>${slide.name}</span>
                </span>
                <button class="pen-icon-btn" data-rename-slide="${slide.id}" title="Rename slide">
                  ${svgIcon('edit', 12)}
                </button>
              </div>
            </div>
          `;
          })
          .join('')}
      </div>
    `;

    bindEvents();
  }

  function bindEvents() {
    el.querySelector('#btn-add-slide')?.addEventListener('click', () => {
      const id = addSlide(store, 'wide');
      store.selectOnly(id);
      render();
    });

    el.querySelector('#btn-present')?.addEventListener('click', () => {
      startPresentation();
    });

    el.querySelectorAll('[data-slide-id]').forEach((card) => {
      card.addEventListener('click', (e) => {
        const renBtn = (e.target as HTMLElement).closest('[data-rename-slide]');
        if (renBtn) {
          e.stopPropagation();
          const sId = renBtn.getAttribute('data-rename-slide')!;
          const node = store.getNode(sId);
          promptDialog({
            title: 'Rename Slide',
            value: node?.name || 'Slide',
          }).then((name) => {
            if (name) {
              store.renameNode(sId, name);
              render();
            }
          });
          return;
        }

        const id = card.getAttribute('data-slide-id')!;
        store.selectOnly(id);
        render();
      });
    });
  }

  function startPresentation() {
    const slides = listSlides(store);
    if (slides.length === 0) return;

    isPresenting = true;
    presentIndex = 0;

    const overlay = document.createElement('div');
    overlay.className = 'pen-modal-backdrop';
    overlay.style.background = '#000000';
    overlay.style.zIndex = '5000';

    function updateSlide() {
      const current = slides[presentIndex];
      const node = store.getNode(current.id);
      if (!node) return;
      const thumb = renderThumbnail(
        { version: store.doc.version, children: [node] },
        window.innerWidth,
        window.innerHeight
      );

      overlay.innerHTML = `
        <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;">
          <img src="${thumb}" style="max-width: 95vw; max-height: 95vh; object-fit: contain; box-shadow: 0 10px 40px rgba(0,0,0,0.8);" />
        </div>
        <div style="position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); color: #888; font-size: 12px; background: rgba(20,20,20,0.8); padding: 4px 12px; border-radius: 20px;">
          ${presentIndex + 1} / ${slides.length} • Press Esc to exit
        </div>
      `;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        window.removeEventListener('keydown', onKeyDown);
        overlay.remove();
        isPresenting = false;
      } else if (e.key === 'ArrowRight' || e.key === 'Space') {
        presentIndex = (presentIndex + 1) % slides.length;
        updateSlide();
      } else if (e.key === 'ArrowLeft') {
        presentIndex = (presentIndex - 1 + slides.length) % slides.length;
        updateSlide();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    updateSlide();
    document.body.appendChild(overlay);
  }

  const unsubscribe = store.subscribe((event) => {
    if (event === 'doc' || event === 'selection') {
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
