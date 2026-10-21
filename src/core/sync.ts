/**
 * Keeps the browser's instant localStorage cache in sync with the optional
 * local Go server. The app stays fully functional offline and signed-out:
 * every mirror/pull call becomes a no-op unless the cloud is reachable and a
 * user session is authenticated.
 *
 * Local ids are stable and are reused on the server, so sign-in can merge
 * local-only documents into the account without creating duplicates.
 */
import type { StoredFile } from './storage';
import { listRecents, saveRecent, listDrafts, saveDraft, deleteDraft } from './storage';
import { loadSettings, saveSettings, applySettings, type AppSettings } from './settings';
import { getAuth, refreshAuth, subscribeAuth, type CloudUsage } from './auth';
import {
  ApiError,
  health,
  listFiles,
  getFile,
  putFile,
  deleteFile,
  duplicateFile,
  pinFile,
  getRemoteSettings,
  putRemoteSettings,
} from './api';

let online = false;
let pulling: Promise<boolean> | null = null;

const pendingFiles = new Map<string, StoredFile>();
const pendingTimers = new Map<string, number>();
const deletedIds = new Set<string>();

export interface QuotaExceededDetail {
  usage: CloudUsage | null;
  limitBytes?: number;
  plan?: string;
}

export function isServerOnline(): boolean {
  return online;
}

function isAuthed(): boolean {
  return getAuth().user !== null;
}

function emit(name: string, detail?: unknown): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function emitCloudFiles(): void {
  emit('penclone:cloud-files');
}

function emitQuota(err: ApiError): void {
  const usage = err.usage ?? getAuth().usage;
  const detail: QuotaExceededDetail = {
    usage,
    limitBytes: err.limitBytes,
    plan: err.plan,
  };
  emit('penclone:quota-exceeded', detail);
}

async function handleApiFailure(err: unknown): Promise<boolean> {
  if (!(err instanceof ApiError)) {
    // fetch/abort/network failures mean the optional backend is unreachable.
    online = false;
    return false;
  }
  if (err.status === 0) {
    online = false;
    return false;
  }
  if (err.status === 401) {
    if (isAuthed()) {
      await refreshAuth();
      emit('penclone:auth-expired');
    }
    return true;
  }
  if (err.status === 402) {
    emitQuota(err);
    return true;
  }
  return false;
}

/** Step 1 of boot: check the optional backend only. Never pulls user data. */
export async function initCloud(): Promise<boolean> {
  online = await health();
  return online;
}

/** Backwards-compatible name: init cloud, then pull only when authenticated. */
export async function initSync(): Promise<boolean> {
  const ok = await initCloud();
  if (ok && isAuthed()) await pullCloudFiles();
  return ok;
}

/**
 * Pull the signed-in user's files, then merge local-only/offline edits back up.
 * Merge is by stable id + updatedAt, so repeated sign-ins do not duplicate docs.
 */
export async function pullCloudFiles(): Promise<boolean> {
  if (!isAuthed()) return false;
  if (pulling) return pulling;

  pulling = (async () => {
    if (!online) online = await health();
    if (!online || !isAuthed()) return false;

    try {
      const remote = await listFiles();
      const local: StoredFile[] = [
        ...listRecents().map((f) => ({ ...f, draft: false })),
        ...listDrafts().map((f) => ({ ...f, draft: true })),
      ];
      const localById = new Map(local.map((f) => [f.id, f]));
      const remoteById = new Map(remote.map((m) => [m.id, m]));

      // 1. Push local-only docs and newer offline edits.
      for (const file of local) {
        if (deletedIds.has(file.id)) continue;
        const meta = remoteById.get(file.id);
        if (meta && file.updatedAt <= meta.updatedAt) continue;
        try {
          await putFile(file.id, {
            name: file.name,
            doc: file.doc,
            thumbnail: file.thumbnail,
            pinned: file.pinned,
            draft: file.draft === true,
          });
        } catch (err) {
          const handled = await handleApiFailure(err);
          if (!handled) {
            // A single bad document must not block the rest of the merge.
            continue;
          }
          // 401/402: stop pushing, but still allow reads where possible.
          break;
        }
      }

      // 2. Pull remote documents that are missing or newer locally.
      const pulls = remote
        .filter((meta) => !deletedIds.has(meta.id))
        .slice(0, 40)
        .map(async (meta) => {
          const localFile = localById.get(meta.id);
          if (localFile && localFile.updatedAt >= meta.updatedAt) return;
          try {
            const full = await getFile(meta.id);
            const stored: StoredFile = {
              id: full.id,
              name: full.name,
              updatedAt: full.updatedAt,
              doc: full.doc,
              thumbnail: full.thumbnail,
              pinned: full.pinned,
              draft: full.draft,
            };
            if (full.draft) saveDraft(stored);
            else saveRecent(stored);
          } catch (err) {
            await handleApiFailure(err);
          }
        });
      await Promise.allSettled(pulls);

      // 3. Settings: the server is authoritative when it has a saved value.
      try {
        const remoteSettings = await getRemoteSettings<AppSettings>();
        if (remoteSettings && typeof remoteSettings === 'object') {
          const merged: AppSettings = { ...loadSettings(), ...remoteSettings };
          saveSettings(merged);
          applySettings(merged);
        }
      } catch (err) {
        await handleApiFailure(err);
      }

      emitCloudFiles();
      return true;
    } catch (err) {
      await handleApiFailure(err);
      return false;
    }
  })();

  try {
    return await pulling;
  } finally {
    pulling = null;
  }
}

/** Debounced mirror of a document save. */
export function queueFileSync(file: StoredFile): void {
  if (!online || !isAuthed() || deletedIds.has(file.id)) return;
  pendingFiles.set(file.id, file);
  const existing = pendingTimers.get(file.id);
  if (existing) window.clearTimeout(existing);
  pendingTimers.set(
    file.id,
    window.setTimeout(() => {
      pendingTimers.delete(file.id);
      void flushFile(file.id);
    }, 700),
  );
}

async function flushFile(id: string): Promise<void> {
  const file = pendingFiles.get(id);
  if (!file || !online || !isAuthed() || deletedIds.has(id)) return;
  pendingFiles.delete(id);
  try {
    await putFile(id, {
      name: file.name,
      doc: file.doc,
      thumbnail: file.thumbnail,
      pinned: file.pinned,
      draft: file.draft === true,
    });
    // A delete may have raced the upload; make sure it does not resurrect.
    if (deletedIds.has(id)) await deleteFile(id);
    emitCloudFiles();
  } catch (err) {
    // Keep the local doc intact; 401/402 must be visible to the UI.
    await handleApiFailure(err);
  }
}

export function mirrorDelete(id: string): void {
  deletedIds.add(id);
  pendingFiles.delete(id);
  const timer = pendingTimers.get(id);
  if (timer) {
    window.clearTimeout(timer);
    pendingTimers.delete(id);
  }
  if (!online || !isAuthed()) return;
  void deleteFile(id)
    .then(() => emitCloudFiles())
    .catch((err) => {
      void handleApiFailure(err);
    });
}

export function mirrorPin(id: string, pinned: boolean): void {
  if (!online || !isAuthed()) return;
  void pinFile(id, pinned).catch((err) => {
    void handleApiFailure(err);
  });
}

export async function mirrorDuplicate(id: string): Promise<StoredFile | null> {
  if (!online || !isAuthed()) return null;
  try {
    const meta = await duplicateFile(id);
    const full = await getFile(meta.id);
    const file: StoredFile = {
      id: full.id,
      name: full.name,
      updatedAt: full.updatedAt,
      doc: full.doc,
      thumbnail: full.thumbnail,
      pinned: full.pinned,
      draft: full.draft,
    };
    if (full.draft) saveDraft(file);
    else saveRecent(file);
    emitCloudFiles();
    return file;
  } catch (err) {
    await handleApiFailure(err);
    return null;
  }
}

export function mirrorSettings(settings: AppSettings): void {
  if (!online || !isAuthed()) return;
  void putRemoteSettings(settings).catch((err) => {
    void handleApiFailure(err);
  });
}

// Settings changes anywhere in the UI are mirrored to the local server.
if (typeof window !== 'undefined') {
  window.addEventListener('penclone:settings', (event) => {
    const detail = (event as CustomEvent<AppSettings>).detail;
    if (detail) mirrorSettings(detail);
  });

  // Sign-out immediately stops all pending mirrors. Local cache is untouched.
  subscribeAuth((state) => {
    if (!state.loading && !state.user) {
      for (const timer of pendingTimers.values()) window.clearTimeout(timer);
      pendingTimers.clear();
      pendingFiles.clear();
    }
  });
}

export function mirrorDraft(file: StoredFile): void {
  if (!online || !isAuthed()) return;
  queueFileSync(file);
}

export async function flushAll(): Promise<void> {
  const ids = [...pendingFiles.keys()];
  await Promise.allSettled(ids.map((id) => flushFile(id)));
}

/** Stop timers/in-flight mirrors before sign-out. Local cache is untouched. */
export function stopCloudSync(): void {
  for (const timer of pendingTimers.values()) window.clearTimeout(timer);
  pendingTimers.clear();
  pendingFiles.clear();
}

/** Remove a local draft from both caches. */
export function discardDraft(id: string): void {
  deletedIds.add(id);
  deleteDraft(id);
  if (online && isAuthed()) {
    void deleteFile(id)
      .then(() => emitCloudFiles())
      .catch((err) => {
        void handleApiFailure(err);
      });
  }
}
