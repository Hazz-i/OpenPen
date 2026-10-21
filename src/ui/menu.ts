import { showContextMenu } from './dialogs';

export interface MenuActions {
  newFile(): void;
  openFile(): void;
  openRecent(): void;
  save(): void;
  saveAs(): void;
  close(): void;
  exportAs(format: 'pen' | 'png' | 'svg' | 'html'): void;
  importImage(): void;
  undo(): void;
  redo(): void;
  cut(): void;
  copy(): void;
  paste(): void;
  duplicate(): void;
  delete(): void;
  selectAll(): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomFit(): void;
  toggleGrid(): void;
  toggleSnap(): void;
  group(): void;
  ungroup(): void;
  bringForward(): void;
  sendBackward(): void;
  bringToFront(): void;
  sendToBack(): void;
  togglePanel(): void;
  settings(): void;
  shortcuts(): void;
  about(): void;
  account?(): void;
  storage?(): void;
}

export function createMenuBar(actions: MenuActions): { el: HTMLElement; destroy(): void } {
  const el = document.createElement('div');
  el.className = 'pen-menubar';

  const menus: Record<
    string,
    Array<
      | {
          label: string;
          shortcut?: string;
          action(): void;
          danger?: boolean;
        }
      | 'separator'
    >
  > = {
    File: [
      { label: 'New File', shortcut: 'Cmd+N', action: actions.newFile },
      { label: 'Open...', shortcut: 'Cmd+O', action: actions.openFile },
      { label: 'Open Recent', action: actions.openRecent },
      'separator',
      { label: 'Save', shortcut: 'Cmd+S', action: actions.save },
      { label: 'Save As...', shortcut: 'Cmd+Shift+S', action: actions.saveAs },
      'separator',
      { label: 'Import Image...', action: actions.importImage },
      'separator',
      { label: 'Export as .pen', action: () => actions.exportAs('pen') },
      { label: 'Export as PNG', action: () => actions.exportAs('png') },
      { label: 'Export as SVG', action: () => actions.exportAs('svg') },
      { label: 'Export as HTML', action: () => actions.exportAs('html') },
      'separator',
      { label: 'Account\u2026', action: () => actions.account?.() },
      { label: 'Storage & plan\u2026', action: () => actions.storage?.() },
      'separator',
      { label: 'Close File', shortcut: 'Cmd+W', action: actions.close },
    ],
    Edit: [
      { label: 'Undo', shortcut: 'Cmd+Z', action: actions.undo },
      { label: 'Redo', shortcut: 'Cmd+Shift+Z', action: actions.redo },
      'separator',
      { label: 'Cut', shortcut: 'Cmd+X', action: actions.cut },
      { label: 'Copy', shortcut: 'Cmd+C', action: actions.copy },
      { label: 'Paste', shortcut: 'Cmd+V', action: actions.paste },
      { label: 'Duplicate', shortcut: 'Cmd+D', action: actions.duplicate },
      { label: 'Delete', shortcut: 'Backspace', action: actions.delete, danger: true },
      'separator',
      { label: 'Select All', shortcut: 'Cmd+A', action: actions.selectAll },
    ],
    View: [
      { label: 'Zoom In', shortcut: 'Cmd+=', action: actions.zoomIn },
      { label: 'Zoom Out', shortcut: 'Cmd+-', action: actions.zoomOut },
      { label: 'Zoom to Fit', shortcut: 'Shift+1', action: actions.zoomFit },
      'separator',
      { label: 'Toggle Grid', shortcut: "Cmd+'", action: actions.toggleGrid },
      { label: 'Toggle Snapping', action: actions.toggleSnap },
      'separator',
      { label: 'Toggle Left Panel', shortcut: 'Cmd+\\', action: actions.togglePanel },
    ],
    Object: [
      { label: 'Group Selection', shortcut: 'Cmd+G', action: actions.group },
      { label: 'Ungroup Selection', shortcut: 'Cmd+Shift+G', action: actions.ungroup },
      'separator',
      { label: 'Bring to Front', shortcut: 'Cmd+]', action: actions.bringToFront },
      { label: 'Bring Forward', action: actions.bringForward },
      { label: 'Send Backward', action: actions.sendBackward },
      { label: 'Send to Back', shortcut: 'Cmd+[', action: actions.sendToBack },
    ],
    Help: [
      { label: 'Keyboard Shortcuts', shortcut: 'Cmd+/', action: actions.shortcuts },
      { label: 'Preferences...', shortcut: 'Cmd+,', action: actions.settings },
      'separator',
      { label: 'About pen.dev', action: actions.about },
    ],
  };

  el.innerHTML = Object.keys(menus)
    .map(
      (m) => `
    <button class="pen-menubar-item" data-menu="${m}">${m}</button>
  `
    )
    .join('');

  el.querySelectorAll('[data-menu]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = btn.getBoundingClientRect();
      const mName = btn.getAttribute('data-menu')!;
      const items = menus[mName];
      if (items) {
        showContextMenu(rect.left, rect.bottom + 4, items);
      }
    });
  });

  return {
    el,
    destroy() {
      el.remove();
    },
  };
}
