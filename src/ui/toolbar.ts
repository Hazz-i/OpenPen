import type { Tool } from '../core/types';
import type { EditorStore } from '../core/store';
import { svgIcon } from './icons';

export interface ToolbarOptions {
  onToolChange?(tool: Tool): void;
}

export function createToolbar(
  store: EditorStore,
  opts: ToolbarOptions = {}
): { el: HTMLElement; refresh(): void; destroy?(): void } {
  const el = document.createElement('div');
  el.className = 'pen-tool-rail';

  const tools: { id: Tool; icon: string; title: string; shortcut?: string }[] = [
    { id: 'select', icon: 'select', title: 'Select (V)', shortcut: 'V' },
    { id: 'hand', icon: 'hand', title: 'Hand tool (H / Space)', shortcut: 'H' },
    { id: 'frame', icon: 'frame', title: 'Frame (F)', shortcut: 'F' },
    { id: 'rectangle', icon: 'rectangle', title: 'Rectangle (R)', shortcut: 'R' },
    { id: 'ellipse', icon: 'ellipse', title: 'Ellipse (O)', shortcut: 'O' },
    { id: 'polygon', icon: 'polygon', title: 'Polygon', shortcut: '' },
    { id: 'text', icon: 'text', title: 'Text (T)', shortcut: 'T' },
    { id: 'comment', icon: 'message-square', title: 'Comment (C)', shortcut: 'C' },
    { id: 'icon', icon: 'sparkles', title: 'Components & Assets', shortcut: 'I' },
  ];

  function render() {
    el.innerHTML = tools
      .map(
        (t) => `
        <button
          class="pen-tool-btn ${store.tool === t.id ? 'active' : ''}"
          data-tool="${t.id}"
          title="${t.title}"
        >
          ${svgIcon(t.icon, 16)}
        </button>
      `
      )
      .join('');

    el.querySelectorAll('[data-tool]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const tool = (e.currentTarget as HTMLElement).getAttribute('data-tool') as Tool;
        store.setTool(tool);
        opts.onToolChange?.(tool);
      });
    });
  }

  const unsubscribe = store.subscribe((event) => {
    if (event === 'tool') {
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
