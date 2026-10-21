import type { AppSettings } from '../core/settings';
import {
  loadSettings,
  saveSettings,
  resetSettings,
  applySettings,
  storageUsage,
  clearAllData,
} from '../core/settings';
import { getAuth, signOut, subscribeAuth } from '../core/auth';
import { deleteAccount } from '../core/api';
import { openUpgradeDialog, renderUsageMeter } from './account';
import { svgIcon } from './icons';
import { confirmDialog, promptDialog, toast } from './dialogs';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function openSettings(opts?: {
  onApply?(s: AppSettings): void;
  onClose?(): void;
}): { close(): void } {
  let settings: AppSettings = loadSettings();
  let activeTab:
    | 'account'
    | 'general'
    | 'appearance'
    | 'editor'
    | 'agent'
    | 'shortcuts'
    | 'storage'
    | 'about' = 'general';

  const backdrop = document.createElement('div');
  backdrop.className = 'pen-modal-backdrop';

  let unsubscribeAuth: (() => void) | null = null;

  function close() {
    unsubscribeAuth?.();
    unsubscribeAuth = null;
    backdrop.remove();
    opts?.onClose?.();
  }

  function render() {
    backdrop.innerHTML = `
      <div class="pen-modal pen-settings-dialog">
        <!-- Sidebar nav -->
        <nav class="pen-settings-nav">
          <div style="font-size: 11px; font-weight: 600; color: var(--fg-strong); padding: 4px 8px 8px 8px;">Settings</div>
          <button class="pen-settings-nav-item ${activeTab === 'account' ? 'active' : ''}" data-tab="account">
            ${svgIcon('pen', 13)}
            <span>Account</span>
          </button>
          <button class="pen-settings-nav-item ${activeTab === 'general' ? 'active' : ''}" data-tab="general">
            ${svgIcon('settings', 13)}
            <span>General</span>
          </button>
          <button class="pen-settings-nav-item ${activeTab === 'appearance' ? 'active' : ''}" data-tab="appearance">
            ${svgIcon('eye', 13)}
            <span>Appearance</span>
          </button>
          <button class="pen-settings-nav-item ${activeTab === 'editor' ? 'active' : ''}" data-tab="editor">
            ${svgIcon('frame', 13)}
            <span>Editor</span>
          </button>
          <button class="pen-settings-nav-item ${activeTab === 'agent' ? 'active' : ''}" data-tab="agent">
            ${svgIcon('sparkles', 13)}
            <span>Agent</span>
          </button>
          <button class="pen-settings-nav-item ${activeTab === 'shortcuts' ? 'active' : ''}" data-tab="shortcuts">
            ${svgIcon('command', 13)}
            <span>Shortcuts</span>
          </button>
          <button class="pen-settings-nav-item ${activeTab === 'storage' ? 'active' : ''}" data-tab="storage">
            ${svgIcon('folder', 13)}
            <span>Storage</span>
          </button>
          <button class="pen-settings-nav-item ${activeTab === 'about' ? 'active' : ''}" data-tab="about">
            ${svgIcon('pen', 13)}
            <span>About</span>
          </button>
        </nav>

        <!-- Main content area -->
        <div class="pen-settings-content">
          <div class="pen-modal-header">
            <span class="pen-modal-title" style="text-transform: capitalize;">${activeTab} Settings</span>
            <button class="pen-icon-btn" id="btn-close-settings">${svgIcon('minus', 14)}</button>
          </div>

          <div class="pen-settings-page" id="settings-body">
            ${renderTabContent()}
          </div>

          <div class="pen-modal-footer">
            <button class="pen-btn-secondary" id="btn-reset-settings" style="margin-right: auto;">Reset Defaults</button>
            <button class="pen-btn-primary" id="btn-save-settings">Done</button>
          </div>
        </div>
      </div>
    `;

    bindTabEvents();
  }

  function renderTabContent(): string {
    if (activeTab === 'account') {
      const user = getAuth().user;
      if (!user) {
        return `
          <div style="display: flex; flex-direction: column; gap: 12px; font-size: 12px; color: var(--fg);">
            <div style="font-size: 14px; font-weight: 600; color: var(--fg-strong);">Local mode</div>
            <div style="color: var(--muted); line-height: 1.6;">
              You are working without a cloud account. Files stay in this browser. Sign in to sync them across devices.
            </div>
            <div style="display: flex; gap: 8px; margin-top: 6px;">
              <button class="pen-btn-primary" id="btn-settings-signin" style="height: 30px; font-size: 12px;">Sign in</button>
              <button class="pen-btn-secondary" id="btn-settings-create" style="height: 30px; font-size: 12px;">Create account</button>
            </div>
          </div>
        `;
      }
      return `
        <div style="display: flex; flex-direction: column; gap: 14px; font-size: 12px; color: var(--fg);">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 34px; height: 34px; border-radius: 50%; background: var(--input); border: 1px solid var(--border-strong); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: var(--fg-strong);">
              ${escapeHtml((user.name || user.email).slice(0, 2).toUpperCase())}
            </div>
            <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
              <span style="font-size: 13px; font-weight: 600; color: var(--fg-strong);">${escapeHtml(user.name || user.email)}</span>
              <span style="font-size: 11px; color: var(--muted);">${escapeHtml(user.email)}</span>
            </div>
            <span class="pen-plan-badge ${user.plan === 'pro' ? 'pro' : 'free'}" style="margin-left: auto;">${user.plan}</span>
          </div>
          <div id="settings-usage-slot"></div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button class="pen-btn-primary" id="btn-settings-manage-plan" style="height: 30px; font-size: 12px;">${user.plan === 'free' ? 'Upgrade to Pro' : 'Manage plan'}</button>
            <button class="pen-btn-secondary" id="btn-settings-signout" style="height: 30px; font-size: 12px;">Sign out</button>
          </div>
          <div style="margin-top: 10px; padding-top: 12px; border-top: 1px solid var(--border);">
            <button class="pen-btn-secondary" id="btn-settings-delete" style="height: 28px; font-size: 11px; color: var(--danger); border-color: var(--border);">Delete account\u2026</button>
            <div style="font-size: 10px; color: var(--faint); margin-top: 6px;">Permanently deletes cloud files, assets and settings. Local browser files remain.</div>
          </div>
        </div>
      `;
    }

    if (activeTab === 'general') {
      return `
        <div class="pen-settings-row">
          <div class="pen-settings-label-group">
            <span class="pen-settings-label">Language</span>
            <span class="pen-settings-hint">Application UI language</span>
          </div>
          <select id="setting-language" class="pen-field-input" style="width: 120px; padding: 4px;">
            <option value="en" ${settings.language === 'en' ? 'selected' : ''}>English</option>
            <option value="id" ${settings.language === 'id' ? 'selected' : ''}>Bahasa Indonesia</option>
          </select>
        </div>

        <div class="pen-settings-row">
          <div class="pen-settings-label-group">
            <span class="pen-settings-label">Autosave</span>
            <span class="pen-settings-hint">Automatically persist changes</span>
          </div>
          <input type="checkbox" id="setting-autosave" ${settings.autosave ? 'checked' : ''} />
        </div>

        <div class="pen-settings-row">
          <div class="pen-settings-label-group">
            <span class="pen-settings-label">Confirm Deletion</span>
            <span class="pen-settings-hint">Ask before deleting files or components</span>
          </div>
          <input type="checkbox" id="setting-confirmDelete" ${settings.confirmDelete ? 'checked' : ''} />
        </div>
      `;
    }

    if (activeTab === 'appearance') {
      return `
        <div class="pen-settings-row">
          <div class="pen-settings-label-group">
            <span class="pen-settings-label">Theme</span>
            <span class="pen-settings-hint">Select dark, light, or system theme</span>
          </div>
          <select id="setting-theme" class="pen-field-input" style="width: 120px; padding: 4px;">
            <option value="dark" ${settings.theme === 'dark' ? 'selected' : ''}>Dark</option>
            <option value="light" ${settings.theme === 'light' ? 'selected' : ''}>Light</option>
            <option value="system" ${settings.theme === 'system' ? 'selected' : ''}>System</option>
          </select>
        </div>

        <div class="pen-settings-row">
          <div class="pen-settings-label-group">
            <span class="pen-settings-label">Accent Color</span>
            <span class="pen-settings-hint">Primary selection & highlights</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="color" id="setting-accent" value="${settings.accent}" style="border: none; width: 28px; height: 28px; border-radius: 4px; cursor: pointer; background: transparent;" />
            <span style="font-size: 11px; font-family: var(--font-mono);">${settings.accent}</span>
          </div>
        </div>

        <div class="pen-settings-row">
          <div class="pen-settings-label-group">
            <span class="pen-settings-label">Canvas Background</span>
            <span class="pen-settings-hint">Backdrop behind design artboards</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="color" id="setting-canvasBg" value="${settings.canvasBackground}" style="border: none; width: 28px; height: 28px; border-radius: 4px; cursor: pointer; background: transparent;" />
            <span style="font-size: 11px; font-family: var(--font-mono);">${settings.canvasBackground}</span>
          </div>
        </div>

        <div class="pen-settings-row">
          <div class="pen-settings-label-group">
            <span class="pen-settings-label">Reduce Motion</span>
            <span class="pen-settings-hint">Minimize UI transitions & animations</span>
          </div>
          <input type="checkbox" id="setting-reduceMotion" ${settings.reduceMotion ? 'checked' : ''} />
        </div>
      `;
    }

    if (activeTab === 'editor') {
      return `
        <div class="pen-settings-row">
          <div class="pen-settings-label-group">
            <span class="pen-settings-label">Show Grid</span>
            <span class="pen-settings-hint">Render dot grid pattern on canvas</span>
          </div>
          <input type="checkbox" id="setting-showGrid" ${settings.showGrid ? 'checked' : ''} />
        </div>

        <div class="pen-settings-row">
          <div class="pen-settings-label-group">
            <span class="pen-settings-label">Grid Size</span>
            <span class="pen-settings-hint">Pixel spacing between grid lines</span>
          </div>
          <input type="number" id="setting-gridSize" value="${settings.gridSize}" min="4" max="64" class="pen-field-input" style="width: 70px; padding: 4px 6px;" />
        </div>

        <div class="pen-settings-row">
          <div class="pen-settings-label-group">
            <span class="pen-settings-label">Snap to Objects</span>
            <span class="pen-settings-hint">Align elements with smart guides</span>
          </div>
          <input type="checkbox" id="setting-snapObjects" ${settings.snapToObjects ? 'checked' : ''} />
        </div>

        <div class="pen-settings-row">
          <div class="pen-settings-label-group">
            <span class="pen-settings-label">Snap to Grid</span>
            <span class="pen-settings-hint">Lock positioning to grid increments</span>
          </div>
          <input type="checkbox" id="setting-snapGrid" ${settings.snapToGrid ? 'checked' : ''} />
        </div>

        <div class="pen-settings-row">
          <div class="pen-settings-label-group">
            <span class="pen-settings-label">Show Frame Labels</span>
            <span class="pen-settings-hint">Display artboard names on canvas</span>
          </div>
          <input type="checkbox" id="setting-frameNames" ${settings.showFrameNames ? 'checked' : ''} />
        </div>
      `;
    }

    if (activeTab === 'agent') {
      return `
        <div class="pen-settings-row">
          <div class="pen-settings-label-group">
            <span class="pen-settings-label">AI Model Profile</span>
            <span class="pen-settings-hint">Current prompt engine identifier</span>
          </div>
          <input type="text" id="setting-agentModel" value="${settings.agentModel}" class="pen-field-input" style="width: 200px; padding: 4px 8px;" />
        </div>

        <div style="display: flex; flex-direction: column; gap: 6px;">
          <span class="pen-settings-label">Custom Agent Instructions</span>
          <span class="pen-settings-hint">System prompt additions for design generation</span>
          <textarea id="setting-agentInstructions" class="pen-field-input" style="height: 100px; padding: 8px; resize: none; font-size: 11px;">${settings.agentInstructions || ''}</textarea>
        </div>
      `;
    }

    if (activeTab === 'shortcuts') {
      const list = [
        ['Select tool', 'V'],
        ['Hand (pan)', 'H / Space'],
        ['Frame', 'F'],
        ['Rectangle', 'R'],
        ['Ellipse', 'O'],
        ['Text', 'T'],
        ['Zoom to Fit', 'Shift + 1 / Cmd + 0'],
        ['Zoom 100%', 'Cmd + 1'],
        ['Command Palette', 'Cmd + K'],
        ['Duplicate', 'Cmd + D'],
        ['Group', 'Cmd + G'],
        ['Ungroup', 'Cmd + Shift + G'],
        ['Undo / Redo', 'Cmd + Z / Cmd + Shift + Z'],
      ];
      return `
        <div style="display: flex; flex-direction: column; gap: 6px;">
          ${list
            .map(
              ([name, key]) => `
            <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid var(--border); font-size: 11px;">
              <span style="color: var(--fg);">${name}</span>
              <kbd style="font-family: var(--font-mono); background: var(--input); padding: 2px 6px; border-radius: 4px; color: var(--fg-strong);">${key}</kbd>
            </div>
          `
            )
            .join('')}
        </div>
      `;
    }

    if (activeTab === 'storage') {
      const usage = storageUsage();
      const pct = Math.min(100, Math.round((usage.usedBytes / usage.quotaBytes) * 100));
      return `
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <div style="display: flex; justify-content: space-between; font-size: 12px;">
            <span>Local Storage Used</span>
            <span>${(usage.usedBytes / 1024).toFixed(1)} KB / ${(usage.quotaBytes / (1024 * 1024)).toFixed(0)} MB</span>
          </div>
          <div style="height: 8px; background: var(--input); border-radius: 4px; overflow: hidden;">
            <div style="height: 100%; width: ${Math.max(2, pct)}%; background: var(--accent);"></div>
          </div>
          <div style="font-size: 11px; color: var(--faint);">
            Includes ${usage.recents} recent files and ${usage.drafts} drafts saved in your browser.
          </div>
          <div style="margin-top: 16px;">
            <button class="pen-btn-primary" id="btn-clear-all" style="background: var(--danger); color: #fff;">
              Clear All Data
            </button>
          </div>
        </div>
      `;
    }

    // About
    return `
      <div style="display: flex; flex-direction: column; gap: 12px; font-size: 12px; line-height: 1.5; color: var(--fg);">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="color: #fff;">${svgIcon('pen', 22, 2)}</span>
          <span style="font-size: 16px; font-weight: 600; color: var(--fg-strong);">pen.dev clone</span>
          <span class="pen-plan-pill">v1.2.18</span>
        </div>
        <div>
          Faithful, zero-dependency canvas design editor reverse-engineered from pen.dev desktop.
        </div>
        <div style="font-size: 11px; color: var(--faint);">
          Runs completely in-browser with HTML5 Canvas 2D. No network requests, zero telemetry.
        </div>
      </div>
    `;
  }

  function bindTabEvents() {
    // Nav switching
    backdrop.querySelectorAll('.pen-settings-nav-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        const tab = (e.currentTarget as HTMLElement).getAttribute('data-tab') as any;
        if (tab) {
          activeTab = tab;
          render();
        }
      });
    });

    backdrop.querySelector('#btn-close-settings')?.addEventListener('click', close);
    backdrop.querySelector('#btn-save-settings')?.addEventListener('click', () => {
      saveSettings(settings);
      applySettings(settings);
      opts?.onApply?.(settings);
      close();
    });

    backdrop.querySelector('#btn-reset-settings')?.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Reset Settings',
        message: 'Restore all settings to their default values?',
      });
      if (ok) {
        settings = resetSettings();
        applySettings(settings);
        opts?.onApply?.(settings);
        render();
      }
    });

    backdrop.querySelector('#btn-clear-all')?.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Clear All Local Data',
        message: 'This will delete all saved documents and settings. This cannot be undone.',
        confirmLabel: 'Clear Everything',
        danger: true,
      });
      if (ok) {
        clearAllData();
        toast('Local data wiped clean.', 'info');
        render();
      }
    });

    // Real-time form listeners
    const themeSel = backdrop.querySelector('#setting-theme') as HTMLSelectElement;
    themeSel?.addEventListener('change', () => {
      settings.theme = themeSel.value as any;
      applySettings(settings);
      opts?.onApply?.(settings);
    });

    const accentInput = backdrop.querySelector('#setting-accent') as HTMLInputElement;
    accentInput?.addEventListener('input', () => {
      settings.accent = accentInput.value;
      applySettings(settings);
      opts?.onApply?.(settings);
    });

    const canvasBgInput = backdrop.querySelector('#setting-canvasBg') as HTMLInputElement;
    canvasBgInput?.addEventListener('input', () => {
      settings.canvasBackground = canvasBgInput.value;
      applySettings(settings);
      opts?.onApply?.(settings);
    });

    const autoBox = backdrop.querySelector('#setting-autosave') as HTMLInputElement;
    autoBox?.addEventListener('change', () => {
      settings.autosave = autoBox.checked;
    });

    const confBox = backdrop.querySelector('#setting-confirmDelete') as HTMLInputElement;
    confBox?.addEventListener('change', () => {
      settings.confirmDelete = confBox.checked;
    });

    const redMotBox = backdrop.querySelector('#setting-reduceMotion') as HTMLInputElement;
    redMotBox?.addEventListener('change', () => {
      settings.reduceMotion = redMotBox.checked;
      applySettings(settings);
    });

    const gridBox = backdrop.querySelector('#setting-showGrid') as HTMLInputElement;
    gridBox?.addEventListener('change', () => {
      settings.showGrid = gridBox.checked;
      applySettings(settings);
      opts?.onApply?.(settings);
    });

    const snapObjBox = backdrop.querySelector('#setting-snapObjects') as HTMLInputElement;
    snapObjBox?.addEventListener('change', () => {
      settings.snapToObjects = snapObjBox.checked;
    });

    const snapGridBox = backdrop.querySelector('#setting-snapGrid') as HTMLInputElement;
    snapGridBox?.addEventListener('change', () => {
      settings.snapToGrid = snapGridBox.checked;
    });

    const frameNamesBox = backdrop.querySelector('#setting-frameNames') as HTMLInputElement;
    frameNamesBox?.addEventListener('change', () => {
      settings.showFrameNames = frameNamesBox.checked;
      opts?.onApply?.(settings);
    });

    const modelInput = backdrop.querySelector('#setting-agentModel') as HTMLInputElement;
    modelInput?.addEventListener('change', () => {
      settings.agentModel = modelInput.value.trim();
    });

    const instTextarea = backdrop.querySelector('#setting-agentInstructions') as HTMLTextAreaElement;
    instTextarea?.addEventListener('change', () => {
      settings.agentInstructions = instTextarea.value.trim();
    });

    // Account tab actions
    const usageSlot = backdrop.querySelector('#settings-usage-slot');
    if (usageSlot) usageSlot.appendChild(renderUsageMeter(getAuth().usage));

    const openAuth = () => {
      window.dispatchEvent(new CustomEvent('penclone:open-auth'));
    };
    backdrop.querySelector('#btn-settings-signin')?.addEventListener('click', openAuth);
    backdrop.querySelector('#btn-settings-create')?.addEventListener('click', openAuth);
    backdrop.querySelector('#btn-settings-manage-plan')?.addEventListener('click', () => {
      if (getAuth().user) openUpgradeDialog();
    });
    backdrop.querySelector('#btn-settings-signout')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('penclone:sign-out'));
    });
    backdrop.querySelector('#btn-settings-delete')?.addEventListener('click', async () => {
      const user = getAuth().user;
      if (!user) return;
      const typed = await promptDialog({
        title: 'Delete Cloud Account',
        label: `Type ${user.email} to confirm permanent deletion.`,
        value: '',
        placeholder: user.email,
      });
      if (typed === null) return;
      if (typed.trim().toLowerCase() !== user.email.toLowerCase()) {
        toast('Email did not match. Account was not deleted.', 'error');
        return;
      }
      const ok = await confirmDialog({
        title: 'Delete Account',
        message: 'This permanently deletes your cloud files, assets, settings and account. This cannot be undone.',
        confirmLabel: 'Delete Account',
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteAccount();
      } catch (err) {
        toast((err as Error).message || 'Could not delete account', 'error');
        return;
      }
      try {
        await signOut();
      } catch {
        // Session is already gone after account deletion.
      }
      toast('Cloud account deleted. Local files remain.', 'info');
      close();
      window.dispatchEvent(new CustomEvent('penclone:signed-out'));
    });
  }

  unsubscribeAuth = subscribeAuth(() => {
    if (document.body.contains(backdrop)) render();
  });
  render();
  document.body.appendChild(backdrop);

  return { close };
}
