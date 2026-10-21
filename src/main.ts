import './styles/tokens.css';
import './styles/base.css';

import { EditorStore, uid } from './core/store';
import type { PenDocument, PenNode } from './core/types';
import { createBlankDocument, parsePenFile, serializePenFile } from './core/format';
import { generateFromPrompt } from './core/samples';
import {
  saveRecent,
  saveAutosave,
  clearAutosave,
  loadAutosave,
  listRecents,
  saveDraft,
  deleteDraft,
  type StoredFile,
} from './core/storage';
import {
  applySettings,
  loadSettings,
  type AppSettings,
} from './core/settings';
import {
  openPenFileDialog,
  savePenFile,
  pickImageFile,
} from './core/files';
import {
  downloadPng,
  downloadSvg,
  downloadHtml,
} from './core/exporters';
import { createImageNode, type ImageAsset } from './core/assets';
import { mountDashboard } from './ui/dashboard';
import { mountEditor } from './ui/editor';
import { mountWelcome } from './ui/welcome';
import { openSettings } from './ui/settings';
import { openQuotaDialog } from './ui/account';
import { renderThumbnail } from './ui/thumbnail';
import { confirmDialog, toast } from './ui/dialogs';
import {
  initCloud,
  pullCloudFiles,
  queueFileSync,
  mirrorDraft,
  isServerOnline,
  stopCloudSync,
  type QuotaExceededDetail,
} from './core/sync';
import {
  fetchAuthConfig,
  getAuth,
  refreshAuth,
  refreshUsage,
  signOut,
  type CloudUsage,
} from './core/auth';

type Screen = { destroy(): void };

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root');

let settings: AppSettings = loadSettings();
applySettings(settings);

let screen: Screen | null = null;
let store: EditorStore | null = null;
let current: StoredFile | null = null;
const diskHandles = new Map<string, FileSystemFileHandle>();
const draftIds = new Set<string>();
let autosaveTimer = 0;
let recoveryOffered = false;
const LOCAL_MODE_KEY = 'penclone.localMode';
const AUTH_HINT_KEY = 'penclone.authHint';

function authHintEnabled(): boolean {
  try {
    return localStorage.getItem(AUTH_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function setAuthHint(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(AUTH_HINT_KEY, '1');
    else localStorage.removeItem(AUTH_HINT_KEY);
  } catch {
    // Private mode: auth probing falls back to the explicit flow.
  }
}

function localModeEnabled(): boolean {
  try {
    return localStorage.getItem(LOCAL_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

function setLocalMode(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(LOCAL_MODE_KEY, '1');
    else localStorage.removeItem(LOCAL_MODE_KEY);
  } catch {
    // Private mode: the in-memory flow still works.
  }
}

function closeOverlays(): void {
  document
    .querySelectorAll('.pen-modal-backdrop, .pen-account-popover, .pen-context-menu')
    .forEach((el) => el.remove());
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

function thumbnailFor(doc: PenDocument): string | undefined {
  try {
    return renderThumbnail(doc, 560, 350);
  } catch {
    return undefined;
  }
}

function persistCurrent(): void {
  if (!store || !current) return;
  const live = loadSettings();
  const isDraft = draftIds.has(current.id) || current.draft === true;
  current = {
    ...current,
    doc: store.doc,
    updatedAt: Date.now(),
    name: store.fileName,
    thumbnail: thumbnailFor(store.doc),
    draft: isDraft,
  };
  if (isDraft) saveDraft(current);
  else saveRecent(current);
  if (store.dirty && live.autosave) {
    saveAutosave(current.name, store.doc, current.thumbnail);
  } else if (!store.dirty) {
    clearAutosave();
  }
  if (isDraft) mirrorDraft(current);
  else queueFileSync(current);
}

function scheduleAutosave(): void {
  if (autosaveTimer) window.clearTimeout(autosaveTimer);
  const live = loadSettings();
  if (!live.autosave) return;
  autosaveTimer = window.setTimeout(persistCurrent, Math.max(200, live.autosaveDelay));
}

async function doSave(forceDialog = false): Promise<boolean> {
  if (!store || !current) return false;
  const text = serializePenFile(store.doc);
  const saved = await savePenFile(
    text,
    store.fileName,
    diskHandles.get(current.id),
    forceDialog,
  );
  if (!saved) return false;
  if (saved.handle) diskHandles.set(current.id, saved.handle);
  store.fileName = saved.name;
  store.dirty = false;
  current.name = saved.name;
  if (draftIds.has(current.id) || current.draft) {
    draftIds.delete(current.id);
    deleteDraft(current.id);
    current.draft = false;
  }
  persistCurrent();
  clearAutosave();
  store.emit('save-state');
  void refreshUsage();
  toast(`Saved ${saved.name}`, 'success');
  return true;
}

async function confirmSafeExit(): Promise<boolean> {
  if (!store || !store.dirty) return true;
  const saveFirst = await confirmDialog({
    title: 'Save changes?',
    message: `“${store.fileName}” has unsaved changes.`,
    confirmLabel: 'Save',
  });
  if (saveFirst) {
    const ok = await doSave();
    if (!ok) return false;
    return true;
  }
  return confirmDialog({
    title: 'Discard changes?',
    message: 'Your changes since the last save will be lost.',
    confirmLabel: 'Discard',
    danger: true,
  });
}

/* ------------------------------------------------------------------ */
/* Screens                                                             */
/* ------------------------------------------------------------------ */

function teardown(): void {
  if (autosaveTimer) window.clearTimeout(autosaveTimer);
  screen?.destroy();
  screen = null;
  root!.innerHTML = '';
}

function openDocument(
  doc: PenDocument,
  name: string,
  opts: { id?: string; thumbnail?: string; draft?: boolean } = {},
): void {
  teardown();
  const id = opts.id ?? uid('file');
  current = {
    id,
    name,
    updatedAt: Date.now(),
    doc,
    thumbnail: opts.thumbnail,
    draft: opts.draft === true,
  };
  if (opts.draft) draftIds.add(id);
  store = new EditorStore(doc, name);
  if (opts.draft) saveDraft(current);
  else saveRecent(current);

  screen = mountEditor(root!, {
    store,
    settings: loadSettings(),
    onExit: () => {
      void (async () => {
        if (!(await confirmSafeExit())) return;
        persistCurrent();
        showDashboard();
      })();
    },
    onSave: () => {
      void doSave(false);
    },
    onSaveAs: () => {
      void doSave(true);
    },
    onOpenFile: () => {
      void openFileFlow();
    },
    onNewFile: () => {
      void newFileFlow();
    },
    onExport: (format, scope) => {
      void exportFlow(format, scope);
    },
    onImportImage: () => {
      void importImageFlow();
    },
    onOpenAuth: () => {
      void openAuthFlow();
    },
  });

  store.subscribe((event) => {
    if (event === 'doc' || event === 'save-state') scheduleAutosave();
    if (event === 'doc' && current && store) {
      const isDraft = draftIds.has(current.id) || current.draft === true;
      current = {
        ...current,
        doc: store.doc,
        name: store.fileName,
        updatedAt: Date.now(),
        draft: isDraft,
      };
      if (isDraft) saveDraft(current);
      else saveRecent(current);
    }
  });

  window.onbeforeunload = (e) => {
    if (store?.dirty) {
      persistCurrent();
      e.preventDefault();
      e.returnValue = '';
    }
    return undefined;
  };
}

function showDashboard(): void {
  teardown();
  if (store) persistCurrent();
  store = null;
  current = null;
  window.onbeforeunload = null;

  screen = mountDashboard(root!, {
    onOpen: (file) => {
      openDocument(file.doc, file.name, {
        id: file.id,
        thumbnail: file.thumbnail,
        draft: file.draft === true,
      });
    },
    onCreate: (kind) => {
      if (kind) {
        const generated = generateFromPrompt(kind);
        openDocument(generated.doc, `${generated.name}.pen`, { draft: true });
      } else {
        openDocument(createBlankDocument(), 'untitled.pen', { draft: true });
      }
    },
    onOpenFile: () => {
      void openFileFlow(true);
    },
  });
}

/* ------------------------------------------------------------------ */
/* Flows                                                               */
/* ------------------------------------------------------------------ */

async function newFileFlow(): Promise<void> {
  if (store && !(await confirmSafeExit())) return;
  teardown();
  openDocument(createBlankDocument(), 'untitled.pen', { draft: true });
}

async function openFileFlow(fromDashboard = false): Promise<void> {
  if (!fromDashboard && store && !(await confirmSafeExit())) return;
  try {
    const file = await openPenFileDialog();
    if (!file) return;
    const doc = parsePenFile(file.text);
    const id = uid('file');
    if (file.handle) diskHandles.set(id, file.handle);
    openDocument(doc, file.name, { id });
  } catch (err) {
    toast(`Could not open file: ${(err as Error).message}`, 'error');
  }
}

function firstFrameCenter(): { x: number; y: number } {
  if (!store) return { x: 0, y: 0 };
  const frame = store.doc.children.find((n) => n.type === 'frame') ?? store.doc.children[0];
  if (!frame) return { x: 0, y: 0 };
  const x = Number(frame.x ?? 0);
  const y = Number(frame.y ?? 0);
  const w = typeof frame.width === 'number' ? frame.width : 800;
  const h = typeof frame.height === 'number' ? frame.height : 600;
  return { x: x + w / 2, y: y + h / 2 };
}

async function importImageFlow(): Promise<void> {
  if (!store) return;
  try {
    const picked = await pickImageFile();
    if (!picked) return;
    const asset: ImageAsset = {
      id: uid('img'),
      name: picked.name,
      dataUrl: picked.dataUrl,
      width: picked.width,
      height: picked.height,
      size: picked.size,
    };
    const node = createImageNode(asset, 0, 0);
    const w = typeof node.width === 'number' ? node.width : 320;
    const h = typeof node.height === 'number' ? node.height : 240;
    const selected = store.selection.length === 1 ? store.getNode(store.selection[0]) : null;
    const frame =
      selected?.type === 'frame'
        ? selected
        : store.doc.children.find((child) => child.type === 'frame') ?? null;
    if (frame) {
      const fw = typeof frame.width === 'number' ? frame.width : 800;
      const fh = typeof frame.height === 'number' ? frame.height : 600;
      node.x = (fw - w) / 2;
      node.y = (fh - h) / 2;
      store.addNode(node, frame.id);
    } else {
      const center = firstFrameCenter();
      node.x = center.x - w / 2;
      node.y = center.y - h / 2;
      store.addNode(node);
    }
    toast(`Added ${picked.name}`, 'success');
  } catch (err) {
    toast(`Could not import image: ${(err as Error).message}`, 'error');
  }
}

function exportSelectionDoc(): { doc: PenDocument; node: PenNode | null; name: string } | null {
  if (!store) return null;
  const node =
    store.selection.length === 1 ? store.getNode(store.selection[0]) : null;
  const doc: PenDocument = node
    ? { version: store.doc.version, children: [node] }
    : store.doc;
  const base = store.fileName.replace(/\.pen$/i, '');
  const name = node?.name ? `${base}-${node.name}` : base || 'export';
  return { doc, node, name };
}

async function exportFlow(
  format: 'pen' | 'png' | 'svg' | 'html',
  scope: 'document' | 'selection',
): Promise<void> {
  if (!store) return;
  const live = loadSettings();
  const selection = scope === 'selection' ? exportSelectionDoc() : null;
  const doc = selection?.doc ?? store.doc;
  const node = selection?.node ?? null;
  const name = selection?.name ?? store.fileName.replace(/\.pen$/i, '');
  try {
    if (format === 'pen') {
      if (scope === 'document') {
        await doSave(true);
        return;
      }
      const saved = await savePenFile(serializePenFile(doc), `${name}.pen`, undefined, true);
      if (saved) toast(`Exported ${saved.name}`, 'success');
      return;
    }
    if (format === 'png') {
      await downloadPng(doc, node, name, live.exportScale, '#FFFFFF');
    } else if (format === 'svg') {
      downloadSvg(doc, node, name);
    } else {
      downloadHtml(doc, node, name);
    }
    toast(`${format.toUpperCase()} exported`, 'success');
  } catch (err) {
    toast(`Export failed: ${(err as Error).message}`, 'error');
  }
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

function bootSplash(): void {
  if (!root) return;
  root.innerHTML = `
    <div style="height:100vh;display:flex;align-items:center;justify-content:center;
      background:#18181b;color:#c8c8c8;font:13px ui-sans-serif,system-ui,sans-serif;gap:10px">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l7 6-7 14L5 8z"/></svg>
      <span>pen.dev</span>
    </div>`;
}

function offerRecovery(): void {
  if (recoveryOffered) return;
  recoveryOffered = true;
  const recovered = loadAutosave();
  if (!recovered || Date.now() - recovered.updatedAt >= 7 * 24 * 60 * 60 * 1000) return;
  window.setTimeout(() => {
    void (async () => {
      const restore = await confirmDialog({
        title: 'Recover unsaved work?',
        message: `\u201c${recovered.name}\u201d was not saved when the app closed.`,
        confirmLabel: 'Recover',
      });
      if (restore) {
        openDocument(recovered.doc, recovered.name, { draft: true });
        toast('Recovered unsaved document', 'success');
      } else {
        clearAutosave();
      }
    })();
  }, 500);
}

async function showWelcomeFlow(checkCloud = false): Promise<void> {
  closeOverlays();
  if (checkCloud) await initCloud().catch(() => false);
  teardown();
  store = null;
  current = null;
  window.onbeforeunload = null;

  const online = isServerOnline();
  let googleEnabled = false;
  if (online) {
    const config = await fetchAuthConfig();
    googleEnabled = config.googleEnabled;
  }

  screen = mountWelcome(root!, {
    online,
    googleEnabled,
    onAuthenticated: async () => {
      setLocalMode(false);
      setAuthHint(true);
      await refreshAuth();
      await pullCloudFiles();
      showDashboard();
      toast('Signed in \u2014 cloud sync enabled', 'success');
      offerRecovery();
    },
    onContinueLocal: () => {
      setLocalMode(true);
      showDashboard();
      offerRecovery();
    },
  });
}

async function openAuthFlow(): Promise<void> {
  if (getAuth().user) return;
  if (store) {
    if (!(await confirmSafeExit())) return;
    persistCurrent();
  }
  await showWelcomeFlow(true);
}

async function handleSignOut(): Promise<void> {
  const user = getAuth().user;
  if (!user) {
    await showWelcomeFlow(true);
    return;
  }
  closeOverlays();
  const ok = await confirmDialog({
    title: 'Sign Out',
    message: store?.dirty
      ? 'Sign out of your cloud account? Unsaved changes will remain in local browser storage.'
      : 'Sign out of your cloud account? Local files will remain available.',
    confirmLabel: 'Sign Out',
  });
  if (!ok) return;
  if (store) persistCurrent();
  stopCloudSync();
  await signOut();
  setLocalMode(false);
  setAuthHint(false);
  toast('Signed out \u2014 local files remain available', 'info');
  await showWelcomeFlow(false);
}

async function handleAuthExpired(): Promise<void> {
  if (document.querySelector('.pen-welcome-screen')) return;
  setAuthHint(false);
  stopCloudSync();
  if (store) persistCurrent();
  toast('Your session expired. Sign in again to resume cloud sync.', 'error');
  await showWelcomeFlow(false);
}

async function handleQuotaExceeded(event: Event): Promise<void> {
  if (document.querySelector('.pen-plans-grid')) return;
  const detail = (event as CustomEvent<QuotaExceededDetail>).detail;
  let usage: CloudUsage | null = detail?.usage ?? null;
  if (!usage) usage = await refreshUsage();
  toast('Cloud quota exceeded. Your document is safe in local storage.', 'error');
  if (usage) openQuotaDialog(usage);
}

async function boot(): Promise<void> {
  bootSplash();
  try {
    if (new URL(window.location.href).searchParams.has('authError')) setAuthHint(false);
  } catch {
    // Ignore malformed URL.
  }
  const online = await initCloud().catch(() => false);
  settings = loadSettings();
  applySettings(settings);

  const auth = online && authHintEnabled() ? await refreshAuth() : getAuth();
  if (auth.user) {
    setAuthHint(true);
    await pullCloudFiles();
    showDashboard();
    offerRecovery();
    console.info('[pen.clone] Signed in \u2014 cloud sync enabled.');
    return;
  }

  if (localModeEnabled()) {
    showDashboard();
    offerRecovery();
    console.info('[pen.clone] Local mode \u2014 cloud sync is off.');
    return;
  }

  if (online && authHintEnabled() && !auth.user) setAuthHint(false);
  await showWelcomeFlow(false);
  if (!online) {
    console.info('[pen.clone] Backend not detected \u2014 welcome offers local mode.');
  } else {
    console.info('[pen.clone] Backend online \u2014 authentication required.');
  }
}

/* ------------------------------------------------------------------ */
/* Auth / account events                                               */
/* ------------------------------------------------------------------ */

window.addEventListener('penclone:open-auth', () => {
  if (store) return; // The editor handles this while a document is open.
  void openAuthFlow();
});

window.addEventListener('penclone:open-settings', () => {
  if (store) return; // The editor owns its settings modal and canvas state.
  openSettings();
});

window.addEventListener('penclone:sign-out', () => {
  void handleSignOut();
});

window.addEventListener('penclone:signed-out', () => {
  setAuthHint(false);
  stopCloudSync();
  void showWelcomeFlow(false);
});

window.addEventListener('penclone:auth-expired', () => {
  void handleAuthExpired();
});

window.addEventListener('penclone:quota-exceeded', (event) => {
  void handleQuotaExceeded(event);
});

// account.ts owns the popover sign-out button. Intercept it in capture phase so
// an open editor can confirm unsaved work before the session is cleared.
document.addEventListener(
  'click',
  (event) => {
    const target = event.target as Element | null;
    const google = target?.closest?.('#btn-google-auth') as HTMLButtonElement | null;
    if (google && !google.disabled) setAuthHint(true);
    if (!target?.closest?.('#btn-popover-signout')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeOverlays();
    void handleSignOut();
  },
  true,
);

void boot();

