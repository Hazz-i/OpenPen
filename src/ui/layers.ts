import type { EditorStore } from '../core/store';
import { svgIcon } from './icons';
import { showContextMenu, promptDialog, confirmDialog } from './dialogs';
import {
  reorderSelection,
  groupSelection,
  ungroupSelection,
  setSelectionLocked,
} from '../core/docops';

export interface LayersOptions {
  onSelect?(id: string): void;
}

export function createLayers(
  store: EditorStore,
  _opts: LayersOptions = {}
): { el: HTMLElement; refresh(): void; destroy?(): void } {
  const el = document.createElement('div');
  el.className = 'pen-tree';

  let searchQuery = '';
  let draggedNodeId: string | null = null;

  function getNodeIcon(type: string): string {
    switch (type) {
      case 'frame':
        return 'hash';
      case 'group':
        return 'layout-grid';
      case 'rectangle':
        return 'square';
      case 'ellipse':
        return 'circle';
      case 'text':
        return 'type';
      default:
        return 'hash';
    }
  }

  function renderTree(): string {
    const selection = new Set(store.selection);

    function renderNode(node: any, depth = 0): string {
      const name = node.name || node.content || node.type;
      if (searchQuery && !name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return '';
      }

      const isSelected = selection.has(node.id);
      const isVisible = node.visible !== false;
      const isLocked = node.locked === true;
      const hasChildren = Array.isArray(node.children) && node.children.length > 0;
      const padLeft = depth * 14 + 8;

      let html = `
        <div
          class="pen-tree-item ${isSelected ? 'selected' : ''}"
          data-node-id="${node.id}"
          draggable="true"
          style="padding-left: ${padLeft}px;"
        >
          <span class="pen-tree-expander">
            ${hasChildren ? svgIcon('chevron-right', 12) : ''}
          </span>
          ${svgIcon(getNodeIcon(node.type), 14)}
          <span class="pen-tree-name" data-node-name="${node.id}">${name}</span>
          <div class="pen-tree-actions">
            <button class="pen-icon-btn" data-toggle-lock="${node.id}" title="${isLocked ? 'Unlock' : 'Lock'}">
              ${svgIcon(isLocked ? 'lock' : 'unlock', 12)}
            </button>
            <button class="pen-icon-btn" data-toggle-vis="${node.id}" title="${isVisible ? 'Hide' : 'Show'}">
              ${svgIcon(isVisible ? 'eye' : 'eye-off', 12)}
            </button>
          </div>
        </div>
      `;

      if (hasChildren) {
        for (const child of node.children) {
          html += renderNode(child, depth + 1);
        }
      }

      return html;
    }

    let out = `
      <div style="padding: 4px 8px 6px 8px;">
        <div style="background: var(--input); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 2px 6px; display: flex; align-items: center; gap: 4px;">
          ${svgIcon('search', 12)}
          <input type="text" id="layers-search" value="${searchQuery}" placeholder="Filter layers..." style="background: transparent; border: none; font-size: 11px; width: 100%; outline: none;" />
        </div>
      </div>
    `;

    for (const rootNode of store.doc.children) {
      out += renderNode(rootNode, 0);
    }
    return out;
  }

  function refresh() {
    el.innerHTML = renderTree();

    const searchInput = el.querySelector('#layers-search') as HTMLInputElement;
    searchInput?.addEventListener('input', () => {
      searchQuery = searchInput.value;
      refresh();
    });

    el.querySelectorAll('.pen-tree-item').forEach((item) => {
      const id = item.getAttribute('data-node-id')!;

      // Click to select
      item.addEventListener('click', (e) => {
        const mouseEvent = e as MouseEvent;
        const visBtn = (mouseEvent.target as HTMLElement).closest('[data-toggle-vis]');
        const lockBtn = (mouseEvent.target as HTMLElement).closest('[data-toggle-lock]');

        if (visBtn) {
          mouseEvent.stopPropagation();
          const node = store.getNode(id);
          if (node) store.setNodeVisible(id, node.visible === false);
          return;
        }

        if (lockBtn) {
          mouseEvent.stopPropagation();
          const node = store.getNode(id);
          if (node) {
            store.selectOnly(id);
            setSelectionLocked(store, !node.locked);
          }
          return;
        }

        if (mouseEvent.shiftKey) {
          store.toggleSelection(id);
        } else {
          store.selectOnly(id);
        }
      });

      // Double click rename
      item.addEventListener('dblclick', async (e) => {
        e.stopPropagation();
        const node = store.getNode(id);
        if (!node) return;
        const newName = await promptDialog({
          title: 'Rename Layer',
          value: node.name || node.content || node.type,
        });
        if (newName) {
          store.renameNode(id, newName);
          refresh();
        }
      });

      // Right-click Context Menu
      item.addEventListener('contextmenu', (e) => {
        const mouseEvent = e as MouseEvent;
        mouseEvent.preventDefault();
        mouseEvent.stopPropagation();
        store.selectOnly(id);
        const node = store.getNode(id);

        showContextMenu(mouseEvent.clientX, mouseEvent.clientY, [
          {
            label: 'Rename...',
            shortcut: 'Enter',
            action: async () => {
              const name = await promptDialog({
                title: 'Rename Layer',
                value: node?.name || '',
              });
              if (name) store.renameNode(id, name);
            },
          },
          {
            label: 'Duplicate',
            shortcut: 'Cmd+D',
            action: () => store.duplicateNodes([id]),
          },
          {
            label: 'Delete',
            shortcut: 'Backspace',
            danger: true,
            action: () => store.removeNodes([id]),
          },
          'separator',
          {
            label: 'Group Selection',
            shortcut: 'Cmd+G',
            action: () => groupSelection(store),
          },
          {
            label: 'Ungroup',
            shortcut: 'Cmd+Shift+G',
            action: () => ungroupSelection(store),
          },
          'separator',
          {
            label: node?.locked ? 'Unlock' : 'Lock',
            action: () => setSelectionLocked(store, !node?.locked),
          },
          {
            label: node?.visible === false ? 'Show' : 'Hide',
            action: () => store.setNodeVisible(id, node?.visible === false),
          },
          'separator',
          {
            label: 'Bring to Front',
            shortcut: 'Cmd+]',
            action: () => reorderSelection(store, 'front'),
          },
          {
            label: 'Send to Back',
            shortcut: 'Cmd+[',
            action: () => reorderSelection(store, 'back'),
          },
        ]);
      });

      // Drag and drop reordering
      item.addEventListener('dragstart', (e) => {
        draggedNodeId = id;
        (e as DragEvent).dataTransfer?.setData('text/plain', id);
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        (item as HTMLElement).style.outline = '1px solid var(--accent)';
      });

      item.addEventListener('dragleave', () => {
        (item as HTMLElement).style.outline = 'none';
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        (item as HTMLElement).style.outline = 'none';
        if (!draggedNodeId || draggedNodeId === id) return;

        // Reparent or move within parent
        const targetNode = store.getNode(id);
        const srcNode = store.getNode(draggedNodeId);
        if (!targetNode || !srcNode) return;

        store.beginTransaction();
        store.removeNodes([draggedNodeId]);
        if (targetNode.type === 'frame' || targetNode.type === 'group') {
          // Drop inside frame/group
          store.addNode(srcNode, targetNode.id);
        } else {
          // Drop as sibling
          const parent = store.getParent(id);
          store.addNode(srcNode, parent ? parent.id : null);
        }
        store.endTransaction();
        draggedNodeId = null;
        refresh();
      });
    });
  }

  const unsubscribe = store.subscribe((event) => {
    if (event === 'doc' || event === 'selection') {
      refresh();
    }
  });

  refresh();

  return {
    el,
    refresh,
    destroy() {
      unsubscribe();
    },
  };
}
