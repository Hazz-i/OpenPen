import { svgIcon } from './icons';

export function toast(message: string, kind: 'info' | 'success' | 'error' = 'info'): void {
  let container = document.querySelector('.pen-toast-container') as HTMLElement;
  if (!container) {
    container = document.createElement('div');
    container.className = 'pen-toast-container';
    document.body.appendChild(container);
  }

  const el = document.createElement('div');
  el.className = `pen-toast ${kind}`;
  const icon = kind === 'success' ? 'check' : kind === 'error' ? 'alert-triangle' : 'sparkles';
  el.innerHTML = `
    <span>${svgIcon(icon, 14)}</span>
    <span>${message}</span>
  `;

  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    el.style.transition = 'all 0.2s ease-out';
    setTimeout(() => el.remove(), 200);
  }, 2500);
}

export function confirmDialog(opts: {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'pen-modal-backdrop';

    backdrop.innerHTML = `
      <div class="pen-modal" style="width: 380px;">
        <div class="pen-modal-header">
          <span class="pen-modal-title">${opts.title}</span>
          <button class="pen-icon-btn" id="btn-close-modal">${svgIcon('minus', 14)}</button>
        </div>
        <div class="pen-modal-body" style="font-size: 12px; color: var(--fg); line-height: 1.5;">
          ${opts.message || 'Are you sure you want to proceed?'}
        </div>
        <div class="pen-modal-footer">
          <button class="pen-btn-secondary" id="btn-cancel">Cancel</button>
          <button class="pen-btn-primary ${opts.danger ? 'danger' : ''}" id="btn-confirm" style="${opts.danger ? 'background: var(--danger); color: #fff;' : ''}">
            ${opts.confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    `;

    function close(result: boolean) {
      window.removeEventListener('keydown', onKeyDown);
      backdrop.remove();
      resolve(result);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    }

    window.addEventListener('keydown', onKeyDown);
    backdrop.querySelector('#btn-close-modal')?.addEventListener('click', () => close(false));
    backdrop.querySelector('#btn-cancel')?.addEventListener('click', () => close(false));
    backdrop.querySelector('#btn-confirm')?.addEventListener('click', () => close(true));

    document.body.appendChild(backdrop);
  });
}

export function promptDialog(opts: {
  title: string;
  label?: string;
  value?: string;
  placeholder?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'pen-modal-backdrop';

    backdrop.innerHTML = `
      <div class="pen-modal" style="width: 380px;">
        <div class="pen-modal-header">
          <span class="pen-modal-title">${opts.title}</span>
          <button class="pen-icon-btn" id="btn-close-modal">${svgIcon('minus', 14)}</button>
        </div>
        <div class="pen-modal-body" style="display: flex; flex-direction: column; gap: 8px;">
          ${opts.label ? `<label style="font-size: 11px; color: var(--muted);">${opts.label}</label>` : ''}
          <input type="text" class="pen-field-input" id="prompt-input" value="${opts.value || ''}" placeholder="${opts.placeholder || ''}" style="background: var(--input); padding: 8px 10px; height: 32px; border-radius: var(--radius-sm); border: 1px solid var(--border);" />
        </div>
        <div class="pen-modal-footer">
          <button class="pen-btn-secondary" id="btn-cancel">Cancel</button>
          <button class="pen-btn-primary" id="btn-confirm">Submit</button>
        </div>
      </div>
    `;

    const input = backdrop.querySelector('#prompt-input') as HTMLInputElement;

    function close(result: string | null) {
      window.removeEventListener('keydown', onKeyDown);
      backdrop.remove();
      resolve(result);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close(null);
      if (e.key === 'Enter') close(input.value.trim());
    }

    window.addEventListener('keydown', onKeyDown);
    backdrop.querySelector('#btn-close-modal')?.addEventListener('click', () => close(null));
    backdrop.querySelector('#btn-cancel')?.addEventListener('click', () => close(null));
    backdrop.querySelector('#btn-confirm')?.addEventListener('click', () => close(input.value.trim()));

    document.body.appendChild(backdrop);
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);
  });
}

export function showContextMenu(
  x: number,
  y: number,
  items: Array<
    | {
        label: string;
        shortcut?: string;
        danger?: boolean;
        disabled?: boolean;
        action(): void;
      }
    | 'separator'
  >
): void {
  // Remove existing
  document.querySelectorAll('.pen-context-menu').forEach((el) => el.remove());

  const menu = document.createElement('div');
  menu.className = 'pen-context-menu';

  // Screen clamping
  const winW = window.innerWidth;
  const winH = window.innerHeight;
  menu.style.left = `${Math.min(x, winW - 190)}px`;
  menu.style.top = `${Math.min(y, winH - 260)}px`;

  items.forEach((item) => {
    if (item === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'pen-menu-separator';
      menu.appendChild(sep);
      return;
    }

    const row = document.createElement('div');
    row.className = `pen-menu-item ${item.danger ? 'danger' : ''} ${item.disabled ? 'disabled' : ''}`;
    row.innerHTML = `
      <span>${item.label}</span>
      ${item.shortcut ? `<span class="pen-menu-shortcut">${item.shortcut}</span>` : ''}
    `;

    if (!item.disabled) {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.remove();
        item.action();
      });
    }

    menu.appendChild(row);
  });

  const dismiss = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) {
      menu.remove();
      window.removeEventListener('pointerdown', dismiss);
    }
  };

  setTimeout(() => window.addEventListener('pointerdown', dismiss), 10);
  document.body.appendChild(menu);
}

export function showCommandPalette(
  commands: Array<{ id: string; label: string; shortcut?: string; run(): void }>
): void {
  document.querySelectorAll('.pen-modal-backdrop').forEach((el) => el.remove());

  const backdrop = document.createElement('div');
  backdrop.className = 'pen-modal-backdrop';

  backdrop.innerHTML = `
    <div class="pen-palette-modal">
      <div class="pen-palette-input-box">
        <span style="color: var(--muted);">${svgIcon('sparkles', 16)}</span>
        <input type="text" class="pen-palette-input" id="palette-search" placeholder="Type a command or search actions..." />
      </div>
      <div class="pen-palette-list" id="palette-list"></div>
    </div>
  `;

  let selectedIdx = 0;
  let filtered = [...commands];

  const searchInput = backdrop.querySelector('#palette-search') as HTMLInputElement;
  const listEl = backdrop.querySelector('#palette-list') as HTMLElement;

  function renderList() {
    listEl.innerHTML = filtered
      .map(
        (cmd, idx) => `
        <div class="pen-palette-item ${idx === selectedIdx ? 'selected' : ''}" data-cmd-id="${cmd.id}">
          <span>${cmd.label}</span>
          ${cmd.shortcut ? `<span class="pen-menu-shortcut">${cmd.shortcut}</span>` : ''}
        </div>
      `
      )
      .join('');

    listEl.querySelectorAll('[data-cmd-id]').forEach((item, idx) => {
      item.addEventListener('click', () => {
        backdrop.remove();
        filtered[idx]?.run();
      });
    });
  }

  function updateFilter() {
    const q = searchInput.value.toLowerCase().trim();
    filtered = commands.filter((c) => c.label.toLowerCase().includes(q));
    selectedIdx = 0;
    renderList();
  }

  searchInput.addEventListener('input', updateFilter);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      backdrop.remove();
      window.removeEventListener('keydown', onKeyDown);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx = (selectedIdx + 1) % Math.max(1, filtered.length);
      renderList();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx = (selectedIdx - 1 + filtered.length) % Math.max(1, filtered.length);
      renderList();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIdx]) {
        backdrop.remove();
        window.removeEventListener('keydown', onKeyDown);
        filtered[selectedIdx].run();
      }
    }
  };

  window.addEventListener('keydown', onKeyDown);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      backdrop.remove();
      window.removeEventListener('keydown', onKeyDown);
    }
  });

  document.body.appendChild(backdrop);
  renderList();
  setTimeout(() => searchInput.focus(), 50);
}
