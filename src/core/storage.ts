/**
 * Browser-local persistence for recent files and the editor autosave slot.
 * Every access is defensive: private mode, disabled storage and quota errors
 * must never break the editor.
 */
import type { PenDocument } from './types';
import { PEN_VERSION, hydrateDocument } from './format';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type AppSettings } from './settings';
import { uid } from './store';

export interface StoredFile {
  id: string;
  name: string;
  updatedAt: number;
  doc: PenDocument;
  thumbnail?: string;
  pinned?: boolean;
  /** Ephemeral hint populated by the dashboard for the drafts bucket. */
  draft?: boolean;
}

const PREFIX = 'penclone.';
const RECENTS_KEY = `${PREFIX}recents`;
const AUTOSAVE_KEY = `${PREFIX}autosave`;
const DRAFTS_KEY = `${PREFIX}drafts`;
const AGENT_PREFIX = `${PREFIX}agent.`;
const MAX_RECENTS = 12;
const MAX_DRAFTS = 20;
const BACKUP_VERSION = 1;
const MAX_DOC_BYTES = 400 * 1024;
const MAX_TOTAL_BYTES = 3 * 1024 * 1024;

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function emptyDoc(): PenDocument {
  return { version: PEN_VERSION, children: [] };
}

function byteLength(value: string): number {
  try {
    return new Blob([value]).size;
  } catch {
    return value.length * 2;
  }
}

function safeDoc(doc: unknown): PenDocument {
  try {
    return hydrateDocument(doc as PenDocument);
  } catch {
    return emptyDoc();
  }
}

function normalizeFile(value: unknown): StoredFile | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  const name = typeof raw.name === 'string' && raw.name ? raw.name : 'Untitled';
  const updatedAt =
    typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now();
  const file: StoredFile = {
    id: raw.id,
    name,
    updatedAt,
    doc: safeDoc(raw.doc),
  };
  if (typeof raw.thumbnail === 'string' && raw.thumbnail) file.thumbnail = raw.thumbnail;
  if (raw.pinned === true) file.pinned = true;
  return file;
}

function readFiles(key: string): StoredFile[] {
  const store = storage();
  if (!store) return [];
  try {
    const text = store.getItem(key);
    if (!text) return [];
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    const files: StoredFile[] = [];
    for (const item of parsed) {
      const file = normalizeFile(item);
      if (file) files.push(file);
    }
    return files.sort(
      (a, b) => Number(b.pinned === true) - Number(a.pinned === true) || b.updatedAt - a.updatedAt,
    );
  } catch {
    return [];
  }
}

function readRecents(): StoredFile[] {
  return readFiles(RECENTS_KEY);
}

function readDrafts(): StoredFile[] {
  return readFiles(DRAFTS_KEY);
}

/** Persist with graceful degradation: first sheds oversized docs, then old entries. */
function writeFiles(key: string, files: StoredFile[], max: number): void {
  const store = storage();
  if (!store) return;
  let list = files.slice(0, max);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      store.setItem(key, JSON.stringify(list));
      return;
    } catch {
      if (attempt === 0) {
        list = list.map((f) => ({ ...f, doc: emptyDoc(), thumbnail: undefined }));
      } else if (attempt === 1) {
        list = list.slice(0, 6);
      } else if (attempt === 2) {
        list = list.slice(0, 2);
      } else {
        return;
      }
    }
  }
}

function writeRecents(files: StoredFile[]): void {
  writeFiles(RECENTS_KEY, files, MAX_RECENTS);
}

function fitBudget(files: StoredFile[], max = MAX_RECENTS): StoredFile[] {
  const list = files.slice(0, max).map((file) => {
    try {
      const size = byteLength(JSON.stringify(file.doc));
      if (size > MAX_DOC_BYTES) return { ...file, doc: emptyDoc(), thumbnail: file.thumbnail };
    } catch {
      return { ...file, doc: emptyDoc() };
    }
    return file;
  });

  while (list.length > 1) {
    let total = 0;
    try {
      total = byteLength(JSON.stringify(list));
    } catch {
      return list;
    }
    if (total <= MAX_TOTAL_BYTES) break;
    list.pop();
  }
  return list;
}

export function listRecents(): StoredFile[] {
  return readRecents();
}

export function getRecent(id: string): StoredFile | null {
  if (!id) return null;
  return readRecents().find((f) => f.id === id) ?? null;
}

export function saveRecent(file: StoredFile): void {
  if (!file || typeof file.id !== 'string' || file.id === '') return;
  try {
    const next: StoredFile = {
      id: file.id,
      name: file.name || 'Untitled',
      updatedAt: Number.isFinite(file.updatedAt) ? file.updatedAt : Date.now(),
      doc: safeDoc(file.doc),
    };
    if (file.thumbnail) next.thumbnail = file.thumbnail;
    if (file.pinned === true) next.pinned = true;

    const rest = readRecents().filter((f) => f.id !== next.id);
    const list = fitBudget([next, ...rest]);
    writeRecents(list);
  } catch {
    // Ignore storage failures entirely.
  }
}

export function deleteRecent(id: string): void {
  if (!id) return;
  try {
    writeRecents(readRecents().filter((f) => f.id !== id));
  } catch {
    // Ignore.
  }
}

export function saveAutosave(name: string, doc: PenDocument, thumbnail?: string): void {
  const store = storage();
  if (!store) return;
  try {
    const payload: { name: string; doc: PenDocument; updatedAt: number; thumbnail?: string } = {
      name: name || 'Untitled',
      doc: safeDoc(doc),
      updatedAt: Date.now(),
    };
    if (thumbnail) payload.thumbnail = thumbnail;
    let text = JSON.stringify(payload);
    if (byteLength(text) > MAX_TOTAL_BYTES) {
      payload.doc = emptyDoc();
      payload.thumbnail = undefined;
      text = JSON.stringify(payload);
    }
    store.setItem(AUTOSAVE_KEY, text);
  } catch {
    // Quota or unavailable storage: autosave is best-effort.
  }
}

export function loadAutosave(): { name: string; doc: PenDocument; updatedAt: number } | null {
  const store = storage();
  if (!store) return null;
  try {
    const text = store.getItem(AUTOSAVE_KEY);
    if (!text) return null;
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const raw = parsed as Record<string, unknown>;
    if (!raw.doc || typeof raw.doc !== 'object') return null;
    return {
      name: typeof raw.name === 'string' && raw.name ? raw.name : 'Untitled',
      doc: safeDoc(raw.doc),
      updatedAt:
        typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
          ? raw.updatedAt
          : Date.now(),
    };
  } catch {
    return null;
  }
}

export function clearAutosave(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(AUTOSAVE_KEY);
  } catch {
    // Ignore.
  }
}


/* ------------------------------------------------------------------ */
/* Recents management                                                 */
/* ------------------------------------------------------------------ */

export function renameRecent(id: string, name: string): void {
  if (!id) return;
  try {
    const files = readRecents();
    let changed = false;
    for (const file of files) {
      if (file.id === id) {
        file.name = name.trim() || file.name;
        changed = true;
        break;
      }
    }
    if (changed) writeRecents(files);
  } catch {
    // Ignore.
  }
}

export function duplicateRecent(id: string): StoredFile | null {
  if (!id) return null;
  try {
    const source = readRecents().find((f) => f.id === id);
    if (!source) return null;
    const copy: StoredFile = {
      id: uid('file'),
      name: `${source.name} copy`,
      updatedAt: Date.now(),
      doc: safeDoc(source.doc),
    };
    if (source.thumbnail) copy.thumbnail = source.thumbnail;
    const list = fitBudget([copy, ...readRecents()]);
    writeRecents(list);
    return copy;
  } catch {
    return null;
  }
}

export function setRecentPinned(id: string, pinned: boolean): void {
  if (!id) return;
  try {
    const files = readRecents();
    let changed = false;
    for (const file of files) {
      if (file.id === id) {
        if (pinned) file.pinned = true;
        else delete file.pinned;
        changed = true;
        break;
      }
    }
    if (changed) writeRecents(files);
  } catch {
    // Ignore.
  }
}

export function clearRecents(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(RECENTS_KEY);
  } catch {
    // Ignore.
  }
}

/* ------------------------------------------------------------------ */
/* Drafts                                                             */
/* ------------------------------------------------------------------ */

export function listDrafts(): StoredFile[] {
  return readDrafts();
}

export function saveDraft(file: StoredFile): void {
  if (!file || typeof file.id !== 'string' || file.id === '') return;
  try {
    const next: StoredFile = {
      id: file.id,
      name: file.name || 'Untitled',
      updatedAt: Number.isFinite(file.updatedAt) ? file.updatedAt : Date.now(),
      doc: safeDoc(file.doc),
    };
    if (file.thumbnail) next.thumbnail = file.thumbnail;
    if (file.pinned === true) next.pinned = true;
    const rest = readDrafts().filter((f) => f.id !== next.id);
    writeFiles(DRAFTS_KEY, fitBudget([next, ...rest], MAX_DRAFTS), MAX_DRAFTS);
  } catch {
    // Ignore.
  }
}

export function deleteDraft(id: string): void {
  if (!id) return;
  try {
    writeFiles(DRAFTS_KEY, readDrafts().filter((f) => f.id !== id), MAX_DRAFTS);
  } catch {
    // Ignore.
  }
}

/* ------------------------------------------------------------------ */
/* Backup                                                             */
/* ------------------------------------------------------------------ */

export function exportBackup(): string {
  const backup = {
    app: 'penclone',
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    recents: readRecents(),
    drafts: readDrafts(),
    autosave: loadAutosave(),
    settings: loadSettings(),
  };
  return JSON.stringify(backup, null, 2);
}

export function importBackup(json: string): boolean {
  try {
    if (typeof json !== 'string' || !json.trim()) return false;
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
    const raw = parsed as Record<string, unknown>;
    if (raw.version !== BACKUP_VERSION) return false;

    if (Array.isArray(raw.recents)) {
      const files: StoredFile[] = [];
      for (const item of raw.recents) {
        const file = normalizeFile(item);
        if (file) files.push(file);
      }
      writeRecents(fitBudget(files));
    }

    if (Array.isArray(raw.drafts)) {
      const files: StoredFile[] = [];
      for (const item of raw.drafts) {
        const file = normalizeFile(item);
        if (file) files.push(file);
      }
      writeFiles(DRAFTS_KEY, fitBudget(files, MAX_DRAFTS), MAX_DRAFTS);
    }

    if (typeof raw.autosave === 'object' && raw.autosave !== null) {
      const auto = raw.autosave as Record<string, unknown>;
      if (typeof auto.doc === 'object' && auto.doc !== null) {
        saveAutosave(
          typeof auto.name === 'string' ? auto.name : 'Untitled',
          safeDoc(auto.doc),
          typeof auto.thumbnail === 'string' ? auto.thumbnail : undefined,
        );
      }
    }

    if (typeof raw.settings === 'object' && raw.settings !== null) {
      saveSettings({ ...DEFAULT_SETTINGS, ...(raw.settings as Partial<AppSettings>) });
    }

    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Agent threads                                                      */
/* ------------------------------------------------------------------ */

function agentKey(fileId: string): string {
  return `${AGENT_PREFIX}${encodeURIComponent(fileId || 'default')}`;
}

export function saveAgentThread(fileId: string, messages: unknown[]): void {
  const store = storage();
  if (!store) return;
  try {
    const trimmed = Array.isArray(messages) ? messages.slice(-300) : [];
    store.setItem(agentKey(fileId), JSON.stringify(trimmed));
  } catch {
    // Quota-safe: chat history is best-effort.
  }
}

export function loadAgentThread(fileId: string): unknown[] {
  const store = storage();
  if (!store) return [];
  try {
    const text = store.getItem(agentKey(fileId));
    if (!text) return [];
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
