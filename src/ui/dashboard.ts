import type { StoredFile } from '../core/storage';
import {
  listRecents,
  deleteRecent,
  saveRecent,
  listDrafts,
  saveDraft,
  setRecentPinned,
} from '../core/storage';
import {
  mirrorDelete,
  mirrorPin,
  mirrorDuplicate,
  queueFileSync,
  discardDraft,
  isServerOnline,
} from '../core/sync';
import { getAuth, subscribeAuth } from '../core/auth';
import { openAccountMenu, openUpgradeDialog, renderUsageMeter } from './account';
import { generateFromPrompt, SAMPLES } from '../core/samples';
import { uid } from '../core/store';
import { renderThumbnail } from './thumbnail';
import { svgIcon } from './icons';
import { openSettings } from './settings';
import { confirmDialog, promptDialog, showContextMenu, toast } from './dialogs';
import { readDroppedFiles } from '../core/files';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/dashboard.css';
import '../styles/components.css';

export interface DashboardOptions {
  onOpen(file: StoredFile): void;
  onCreate(kind?: string): void;
  onOpenFile(): void;
  onOpenSettings?(): void;
}

export function mountDashboard(
  root: HTMLElement,
  opts: DashboardOptions
): { destroy(): void } {
  let isGenerating = false;
  let activeTab: 'recents' | 'drafts' | 'templates' | 'design-systems' = 'recents';
  let activeTemplate = 'Landing page';
  let searchQuery = '';
  let viewMode: 'grid' | 'list' = 'grid';
  let recents: StoredFile[] = [];
  let drafts: StoredFile[] = [];

  function loadFiles() {
    recents = listRecents();
    drafts = listDrafts().map((f) => ({ ...f, draft: true }));
  }

  function escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function initials(name?: string, email?: string): string {
    const source = (name || email || '?').trim();
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return source.slice(0, 2).toUpperCase();
  }

  function cloudStatus(): string {
    if (!isServerOnline()) return 'Cloud unavailable';
    return getAuth().user ? 'Cloud \u00b7 Synced' : 'Local only';
  }

  function renderAccountChip(): string {
    const user = getAuth().user;
    const plan = user?.plan || 'local';
    const label = user ? user.name || user.email : 'Sign in';
    return `
      <button class="pen-dash-account-chip" id="btn-dash-account-top" title="Account menu"
        style="display:flex;align-items:center;gap:7px;background:transparent;border:1px solid var(--border);border-radius:var(--radius-pill);padding:3px 8px 3px 3px;cursor:pointer;color:var(--fg);max-width:190px;">
        <span style="width:22px;height:22px;border-radius:50%;background:var(--input);border:1px solid var(--border-strong);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:var(--fg-strong);flex-shrink:0;">${escapeHtml(initials(user?.name, user?.email))}</span>
        <span style="font-size:11px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(label)}</span>
        <span class="pen-plan-badge ${plan === 'pro' ? 'pro' : 'free'}">${plan}</span>
      </button>
    `;
  }

  function renderAccountArea(): string {
    const user = getAuth().user;
    const online = isServerOnline();
    const plan = user?.plan || 'local';
    return `
      <div style="margin-top:auto;padding-top:10px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:8px;">
        <button id="btn-dash-account" title="Account menu"
          style="display:flex;align-items:center;gap:8px;background:transparent;border:none;padding:4px 6px;border-radius:var(--radius-sm);cursor:pointer;text-align:left;color:var(--fg);">
          <span style="width:26px;height:26px;border-radius:50%;background:var(--input);border:1px solid var(--border-strong);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--fg-strong);flex-shrink:0;">${escapeHtml(initials(user?.name, user?.email))}</span>
          <span style="min-width:0;display:flex;flex-direction:column;gap:1px;flex:1;">
            <span style="font-size:12px;font-weight:600;color:var(--fg-strong);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(user ? user.name || user.email : 'Sign in')}</span>
            <span style="font-size:10px;color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(user ? user.email : 'Local browser storage')}</span>
          </span>
        </button>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:0 6px;">
          <span class="pen-plan-badge ${plan === 'pro' ? 'pro' : 'free'}">${plan}</span>
          <span title="${online ? 'Cloud connection status' : 'Server unavailable'}" style="font-size:10px;color:${!online ? 'var(--warning)' : user ? 'var(--accent)' : 'var(--faint)'};">${escapeHtml(cloudStatus())}</span>
        </div>
        <div id="dash-usage-slot" style="padding:0 2px;"></div>
        ${!user ? `<button class="pen-btn-secondary" id="btn-dash-signin" style="width:100%;height:28px;font-size:11px;">Sign in to sync</button>` : ''}
        ${user?.plan === 'free' ? `<button class="pen-btn-primary" id="btn-dash-upgrade" style="width:100%;height:28px;font-size:11px;background:var(--accent);color:#fff;">Upgrade to Pro</button>` : ''}
      </div>
    `;
  }

  loadFiles();

  const container = document.createElement('div');
  container.className = 'pen-dashboard';

  function formatRelativeTime(ts: number): string {
    const diff = Math.max(0, Date.now() - ts);
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'Just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  function render() {
    const filesForTab = activeTab === 'drafts' ? drafts : recents;
    const filteredRecents = filesForTab.filter((f) =>
      f.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    container.innerHTML = `
      <!-- Sidebar -->
      <aside class="pen-dashboard-sidebar">
        <div class="pen-brand" style="justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="pen-brand-icon">${svgIcon('pen', 18, 2)}</span>
            <span>pen.dev</span>
          </div>
          <button class="pen-icon-btn" id="btn-sidebar-settings" title="Settings">
            ${svgIcon('settings', 14)}
          </button>
        </div>

        <div class="pen-nav-group">
          <div class="pen-nav-item ${activeTab === 'recents' ? 'active' : ''}" data-nav="recents">
            ${svgIcon('clock', 16)}
            <span>Recents</span>
          </div>
          <div class="pen-nav-item ${activeTab === 'drafts' ? 'active' : ''}" data-nav="drafts">
            ${svgIcon('file-text', 16)}
            <span>Drafts</span>
          </div>
        </div>

        <div class="pen-nav-header">TEMPLATES</div>
        <div class="pen-nav-group">
          <div class="pen-nav-item ${activeTab === 'templates' ? 'active' : ''}" data-nav="templates">
            ${svgIcon('layout-grid', 16)}
            <span>All Templates</span>
          </div>
          <div class="pen-nav-item ${activeTab === 'design-systems' ? 'active' : ''}" data-nav="design-systems">
            ${svgIcon('design-systems', 16)}
            <span>Design Systems</span>
          </div>
        </div>
        ${renderAccountArea()}
      </aside>

      <!-- Main Section -->
      <main class="pen-dashboard-main">
        <header class="pen-dashboard-topbar">
          <div class="pen-dashboard-title" style="text-transform: capitalize;">${activeTab.replace('-', ' ')}</div>
          <div class="pen-dashboard-actions">
            <span title="Cloud connection status" style="font-size:10px;color:${!isServerOnline() ? 'var(--warning)' : getAuth().user ? 'var(--accent)' : 'var(--faint)'};margin-right:2px;">${escapeHtml(cloudStatus())}</span>
            <button class="pen-btn-secondary" id="btn-open-file">
              ${svgIcon('folder', 15)}
              <span>Open File</span>
            </button>
            <button class="pen-btn-primary" id="btn-new-file">
              ${svgIcon('plus', 15, 2)}
              <span>New File</span>
            </button>
            <button class="pen-icon-btn" id="btn-header-settings" title="Preferences">
              ${svgIcon('settings', 16)}
            </button>
            ${renderAccountChip()}
          </div>
        </header>

        ${isServerOnline() && !getAuth().user ? `
          <div style="margin:0 24px 12px;padding:10px 14px;display:flex;align-items:center;gap:12px;background:var(--input);border:1px solid var(--border-strong);border-radius:var(--radius);font-size:11px;color:var(--muted);">
            <span style="flex:1;">Sign in to sync your files across devices. Local editing always stays available.</span>
            <button class="pen-btn-secondary" id="btn-banner-signin" style="height:26px;font-size:11px;">Sign in</button>
            <button class="pen-btn-primary" id="btn-banner-create" style="height:26px;font-size:11px;">Create account</button>
          </div>
        ` : ''}
        <div class="pen-dashboard-content">
          ${renderTabContent(filteredRecents)}
        </div>
      </main>
    `;

    bindEvents();
    const usageSlot = container.querySelector('#dash-usage-slot');
    if (usageSlot) usageSlot.appendChild(renderUsageMeter(getAuth().usage));
  }

  function renderTabContent(filteredRecents: StoredFile[]): string {
    if (activeTab === 'templates') {
      return `
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <span style="font-size: 13px; font-weight: 600; color: var(--fg-strong);">Starter Templates</span>
          <div class="pen-recents-grid">
            ${SAMPLES.map(
              (sample) => `
              <div class="pen-recent-card" data-sample-prompt="${sample.id}">
                <div class="pen-recent-thumb-container">
                  <img src="${renderThumbnail(sample.doc, 560, 350)}" alt="${escapeHtml(sample.name)}" />
                </div>
                <div class="pen-recent-meta">
                  <span class="pen-recent-name">${escapeHtml(sample.name)}</span>
                  <span class="pen-recent-subtext">${escapeHtml(sample.prompt || 'Ready-to-use template layout')}</span>
                </div>
              </div>
            `
            ).join('')}
          </div>
        </div>
      `;
    }

    if (activeTab === 'design-systems') {
      return `
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <span style="font-size: 13px; font-weight: 600; color: var(--fg-strong);">Design Systems & Libraries</span>
          <div class="pen-agent-banner" style="padding: 16px;">
            <div class="pen-agent-banner-title" style="font-size: 14px;">Color Tokens & Component Specs</div>
            <div style="line-height: 1.5; margin-top: 4px;">
              Design systems in pen.dev define typography scales, shared styles and reusable components across frames.
            </div>
            <button class="pen-btn-primary" id="btn-load-ds-sample" style="margin-top: 12px; width: fit-content;">
              Open Design System Template
            </button>
          </div>
        </div>
      `;
    }

    // Recents or Drafts page
    return `
      <!-- Template Chips -->
      <div class="pen-template-chips">
        ${[
          { id: 'Landing page', icon: 'frame' },
          { id: 'Mobile app', icon: 'tv' },
          { id: 'Web app', icon: 'globe' },
          { id: 'Slides', icon: 'slides' },
          { id: 'Dashboard', icon: 'layout-grid' },
          { id: 'Something else...', icon: 'file-text' },
        ]
          .map(
            (t) => `
          <button class="pen-chip ${activeTemplate === t.id ? 'active' : ''}" data-chip="${t.id}">
            ${svgIcon(t.icon, 14)}
            <span>${t.id}</span>
          </button>
        `
          )
          .join('')}
      </div>

      <!-- Prompt Composer -->
      <div class="pen-composer-box">
        <textarea
          class="pen-composer-textarea"
          placeholder="Design anything..."
          id="prompt-input"
        ></textarea>
        <div class="pen-composer-footer">
          <div class="pen-composer-left">
            <button class="pen-icon-btn" title="Add context">
              ${svgIcon('plus', 16)}
            </button>
          </div>
          <div class="pen-composer-right">
            <div class="pen-badge-tag">
              ${svgIcon('zap', 12)}
              <span>1x</span>
            </div>
            <div class="pen-badge-muted">
              ${svgIcon('grid', 12)}
              <span>1x</span>
            </div>
            <div class="pen-model-select">
              <span>cmc/deepseek/deepseek-v4-pro</span>
              ${svgIcon('chevron-down', 12)}
            </div>
            <button class="pen-submit-btn" id="btn-send-prompt" title="Generate">
              ${svgIcon('arrow-up', 14, 2)}
            </button>
          </div>
        </div>
      </div>

      ${
        isGenerating
          ? `
        <div class="pen-generating-banner">
          ${svgIcon('sparkles', 16)}
          <span>Generating document with offline template engine...</span>
        </div>
      `
          : ''
      }

      <!-- Import Cards -->
      <div class="pen-import-cards">
        <div class="pen-import-card" data-import="figma">
          ${svgIcon('figma', 22)}
          <span class="pen-import-card-title">Import from Figma</span>
        </div>
        <div class="pen-import-card" data-import="browser">
          ${svgIcon('globe', 22)}
          <span class="pen-import-card-title">Import from browser</span>
        </div>
        <div class="pen-import-card" data-import="screenshot">
          ${svgIcon('image', 22)}
          <span class="pen-import-card-title">Recreate a screenshot</span>
        </div>
      </div>

      <!-- Search & View Toggle -->
      <div class="pen-recents-header">
        <div style="display: flex; align-items: center; gap: 12px;">
          <span class="pen-recents-title">${activeTab.toUpperCase()}</span>
          <div style="background: var(--input); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 2px 6px; display: flex; align-items: center; gap: 4px;">
            ${svgIcon('search', 12)}
            <input type="text" id="dash-search" value="${escapeHtml(searchQuery)}" placeholder="Search files..." style="border: none; background: transparent; font-size: 11px; outline: none; width: 120px;" />
          </div>
        </div>
        <div class="pen-recents-view-toggle">
          <button class="pen-icon-btn ${viewMode === 'grid' ? 'active' : ''}" id="btn-view-grid" title="Grid view">${svgIcon('layout-grid', 15)}</button>
          <button class="pen-icon-btn ${viewMode === 'list' ? 'active' : ''}" id="btn-view-list" title="List view">${svgIcon('list', 15)}</button>
        </div>
      </div>

      ${
        filteredRecents.length === 0
          ? `
        <div style="padding: 44px 20px; text-align: center; border: 1px dashed var(--border-strong); border-radius: var(--radius); background: var(--panel);">
          <div style="font-size: 13px; font-weight: 600; color: var(--fg-strong); margin-bottom: 6px;">
            ${searchQuery ? 'No files match your search' : activeTab === 'drafts' ? 'No drafts yet' : 'No files yet'}
          </div>
          <div style="font-size: 11px; color: var(--faint); line-height: 1.6; margin-bottom: 14px;">
            ${searchQuery ? 'Try a different name or clear the search field.' : activeTab === 'drafts' ? 'Start a file, then save it to keep it forever.' : 'Create a new file or open an existing .pen document.'}
          </div>
          ${searchQuery ? '' : `<button class="pen-btn-primary" id="btn-empty-new">${svgIcon('plus', 14, 2)}<span>New File</span></button>`}
        </div>
      `
          : viewMode === 'grid'
          ? `
        <div class="pen-recents-grid">
          ${filteredRecents
            .map(
              (file) => `
            <div class="pen-recent-card" data-file-id="${file.id}">
              <div class="pen-recent-thumb-container">
                <img src="${file.thumbnail || renderThumbnail(file.doc, 560, 350)}" alt="${escapeHtml(file.name)}" />
              </div>
              <div class="pen-recent-meta">
                <div class="pen-recent-name-row">
                  <span class="pen-recent-name">${escapeHtml(file.name)}</span>
                </div>
                <span class="pen-recent-subtext">Opened ${formatRelativeTime(file.updatedAt)}</span>
                <button class="pen-recent-menu-btn" data-card-menu="${file.id}" title="File options">
                  ${svgIcon('more-horizontal', 14)}
                </button>
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      `
          : `
        <div style="display: flex; flex-direction: column; gap: 4px; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden;">
          ${filteredRecents
            .map(
              (file) => `
            <div class="pen-tree-item" data-file-id="${file.id}" style="height: 36px; padding: 0 12px; margin: 0; border-bottom: 1px solid var(--border);">
              ${svgIcon('file-text', 14)}
              <span class="pen-tree-name" style="font-weight: 500;">${escapeHtml(file.name)}</span>
              <span style="font-size: 11px; color: var(--faint); margin-right: 12px;">${formatRelativeTime(file.updatedAt)}</span>
              <button class="pen-icon-btn" data-card-menu="${file.id}">
                ${svgIcon('more-horizontal', 14)}
              </button>
            </div>
          `
            )
            .join('')}
        </div>
      `
      }
    `;
  }

  function handleSendPrompt() {
    const input = container.querySelector('#prompt-input') as HTMLTextAreaElement;
    const prompt = input?.value.trim() || activeTemplate;
    if (isGenerating) return;

    isGenerating = true;
    render();

    setTimeout(() => {
      try {
        const generated = generateFromPrompt(prompt);
        opts.onOpen({
          id: `file-${Date.now()}`,
          name: `${generated.name}.pen`,
          updatedAt: Date.now(),
          doc: generated.doc,
          thumbnail: renderThumbnail(generated.doc, 560, 350),
        });
      } catch {
        opts.onCreate(prompt);
      }
    }, 600);
  }

  function bindEvents() {
    const openAuth = () => window.dispatchEvent(new CustomEvent('penclone:open-auth'));
    container.querySelector('#btn-dash-account')?.addEventListener('click', (e) =>
      openAccountMenu(e.currentTarget as HTMLElement),
    );
    container.querySelector('#btn-dash-account-top')?.addEventListener('click', (e) =>
      openAccountMenu(e.currentTarget as HTMLElement),
    );
    container.querySelector('#btn-dash-signin')?.addEventListener('click', openAuth);
    container.querySelector('#btn-banner-signin')?.addEventListener('click', openAuth);
    container.querySelector('#btn-banner-create')?.addEventListener('click', openAuth);
    container.querySelector('#btn-dash-upgrade')?.addEventListener('click', () => openUpgradeDialog());

    // Nav items
    container.querySelectorAll('[data-nav]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        activeTab = (e.currentTarget as HTMLElement).getAttribute('data-nav') as any;
        render();
      });
    });

    // Settings openers
    const triggerSettings = () => {
      if (opts.onOpenSettings) {
        opts.onOpenSettings();
      } else {
        openSettings();
      }
    };
    container.querySelector('#btn-sidebar-settings')?.addEventListener('click', triggerSettings);
    container.querySelector('#btn-header-settings')?.addEventListener('click', triggerSettings);

    // Search
    const searchInput = container.querySelector('#dash-search') as HTMLInputElement;
    searchInput?.addEventListener('input', () => {
      const value = searchInput.value;
      searchQuery = value;
      render();
      const next = container.querySelector('#dash-search') as HTMLInputElement | null;
      next?.focus();
      next?.setSelectionRange(value.length, value.length);
    });

    // Grid / List toggles
    container.querySelector('#btn-view-grid')?.addEventListener('click', () => {
      viewMode = 'grid';
      render();
    });
    container.querySelector('#btn-view-list')?.addEventListener('click', () => {
      viewMode = 'list';
      render();
    });

    // Actions
    container.querySelector('#btn-open-file')?.addEventListener('click', () => opts.onOpenFile());
    container.querySelector('#btn-new-file')?.addEventListener('click', () => opts.onCreate());
    container.querySelector('#btn-empty-new')?.addEventListener('click', () => opts.onCreate());
    container.querySelector('#btn-load-ds-sample')?.addEventListener('click', () => opts.onCreate('design-system'));

    // Template sample cards
    container.querySelectorAll('[data-sample-prompt]').forEach((card) => {
      card.addEventListener('click', () => {
        const p = card.getAttribute('data-sample-prompt')!;
        opts.onCreate(p);
      });
    });

    // Chips
    container.querySelectorAll('[data-chip]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        activeTemplate = (e.currentTarget as HTMLElement).getAttribute('data-chip') || 'Landing page';
        render();
      });
    });

    // Prompt submit
    container.querySelector('#btn-send-prompt')?.addEventListener('click', handleSendPrompt);
    const textarea = container.querySelector('#prompt-input') as HTMLTextAreaElement;
    if (textarea) {
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSendPrompt();
        }
      });
    }

    // Import cards
    container.querySelectorAll('[data-import]').forEach((card) => {
      card.addEventListener('click', (e) => {
        const kind = (e.currentTarget as HTMLElement).getAttribute('data-import');
        opts.onCreate(kind || 'landing');
      });
    });

    // File Cards & Card Menus
    container.querySelectorAll('[data-file-id]').forEach((card) => {
      card.addEventListener('click', (e) => {
        const menuBtn = (e.target as HTMLElement).closest('[data-card-menu]');
        const id = card.getAttribute('data-file-id')!;
        const pool = activeTab === 'drafts' ? drafts : recents;
        const file = pool.find((f) => f.id === id);
        if (!file) return;

        if (menuBtn) {
          e.stopPropagation();
          const rect = menuBtn.getBoundingClientRect();
          const items: Parameters<typeof showContextMenu>[2] = [
            {
              label: 'Open',
              action: () => opts.onOpen({ ...file, draft: activeTab === 'drafts' }),
            },
            {
              label: 'Rename...',
              action: async () => {
                const name = await promptDialog({
                  title: 'Rename File',
                  value: file.name,
                });
                if (name) {
                  file.name = name.endsWith('.pen') ? name : `${name}.pen`;
                  file.updatedAt = Date.now();
                  if (activeTab === 'drafts') saveDraft(file);
                  else saveRecent(file);
                  queueFileSync(file);
                  loadFiles();
                  render();
                }
              },
            },
            {
              label: 'Duplicate',
              action: () => {
                const copy: StoredFile = {
                  id: uid('file'),
                  name: `Copy of ${file.name}`,
                  updatedAt: Date.now(),
                  doc: JSON.parse(JSON.stringify(file.doc)),
                  thumbnail: file.thumbnail,
                  draft: activeTab === 'drafts',
                };
                if (activeTab === 'drafts') saveDraft(copy);
                else saveRecent(copy);
                queueFileSync(copy);
                loadFiles();
                render();
                toast('File duplicated', 'success');
              },
            },
          ];
          if (activeTab !== 'drafts') {
            items.push({
              label: file.pinned ? 'Unpin' : 'Pin to top',
              action: () => {
                const next = !file.pinned;
                setRecentPinned(file.id, next);
                mirrorPin(file.id, next);
                loadFiles();
                render();
              },
            });
          }
          items.push('separator', {
            label: 'Delete',
            danger: true,
            action: async () => {
              const ok = await confirmDialog({
                title: activeTab === 'drafts' ? 'Delete Draft' : 'Delete File',
                message: `Permanently delete "${file.name}"?`,
                confirmLabel: 'Delete',
                danger: true,
              });
              if (ok) {
                if (activeTab === 'drafts') {
                  discardDraft(file.id);
                } else {
                  deleteRecent(file.id);
                  mirrorDelete(file.id);
                }
                loadFiles();
                render();
                toast('File deleted', 'info');
              }
            },
          });
          showContextMenu(rect.left, rect.bottom + 4, items);
          return;
        }

        opts.onOpen({ ...file, draft: activeTab === 'drafts' });
      });
    });
  }

  // Window drag/drop for .pen files
  const onDragOver = (e: DragEvent) => e.preventDefault();
  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    if (!e.dataTransfer?.files?.length) return;
    try {
      const results = await readDroppedFiles(e.dataTransfer.files);
      const pen = results.find((r) => r.kind === 'pen');
      if (pen && pen.kind === 'pen') {
        const { parsePenFile } = await import('../core/format');
        const doc = parsePenFile(pen.text);
        opts.onOpen({
          id: `file-${Date.now()}`,
          name: pen.name,
          updatedAt: Date.now(),
          doc,
          thumbnail: renderThumbnail(doc, 560, 350),
        });
      }
    } catch {
      toast('Failed to load dropped .pen file', 'error');
    }
  };

  window.addEventListener('dragover', onDragOver);
  window.addEventListener('drop', onDrop);

  const unsubAuth = subscribeAuth(() => {
    loadFiles();
    render();
  });
  const onCloudFiles = () => {
    loadFiles();
    render();
  };
  window.addEventListener('penclone:cloud-files', onCloudFiles);

  render();
  root.appendChild(container);

  return {
    destroy() {
      unsubAuth();
      window.removeEventListener('penclone:cloud-files', onCloudFiles);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      container.remove();
    },
  };
}
