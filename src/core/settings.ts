/**
 * Persistent application settings + theme application.
 * Safe without a DOM so it can be imported by Node-side tooling and tests.
 */

export interface AppSettings {
  theme: 'dark' | 'light' | 'system';
  accent: string;
  canvasBackground: string;
  showFrameNames: boolean;
  showGrid: boolean;
  gridSize: number;
  snapToObjects: boolean;
  snapToGrid: boolean;
  autosave: boolean;
  autosaveDelay: number;
  defaultFont: string;
  defaultFontSize: number;
  exportScale: 1 | 2 | 3;
  reduceMotion: boolean;
  units: 'px' | 'rem';
  agentModel: string;
  agentInstructions: string;
  confirmDelete: boolean;
  language: 'en' | 'id';
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  accent: '#3d99ff',
  canvasBackground: '#1d1d1f',
  showFrameNames: true,
  showGrid: false,
  gridSize: 8,
  snapToObjects: true,
  snapToGrid: false,
  autosave: true,
  autosaveDelay: 700,
  defaultFont: 'Inter',
  defaultFontSize: 16,
  exportScale: 1,
  reduceMotion: false,
  units: 'px',
  agentModel: 'cmc/deepseek/deepseek-v4-pro',
  agentInstructions: '',
  confirmDelete: true,
  language: 'en',
};

export const SETTINGS_KEY = 'penclone.settings';
const STORAGE_PREFIX = 'penclone.';
const QUOTA_FALLBACK = 5 * 1024 * 1024;

const DARK_TOKENS: Record<string, string> = {
  '--bg': '#18181b',
  '--panel': '#141414',
  '--input': '#1f1f1f',
  '--border': '#202020',
  '--border-strong': '#2a2a2a',
  '--fg': '#c8c8c8',
  '--fg-strong': '#f4f4f5',
  '--muted': '#a1a1aa',
  '--faint': '#71717a',
  '--warning': '#f99c00',
  '--radius': '10px',
};

/** A real light palette, not an inverted dark one. */
const LIGHT_TOKENS: Record<string, string> = {
  '--bg': '#f4f4f2',
  '--panel': '#ffffff',
  '--input': '#efefec',
  '--border': '#e2e2dd',
  '--border-strong': '#d0d0c9',
  '--fg': '#343430',
  '--fg-strong': '#121210',
  '--muted': '#6b6b64',
  '--faint': '#94948b',
  '--warning': '#b45309',
  '--radius': '10px',
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#([0-9a-f]{3,8})$/i.test(value.trim())
    ? value.trim()
    : fallback;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeSettings(value: unknown): AppSettings {
  const raw = isObject(value) ? value : {};
  const theme = raw.theme === 'light' || raw.theme === 'system' ? raw.theme : 'dark';
  const units = raw.units === 'rem' ? 'rem' : 'px';
  const language = raw.language === 'id' ? 'id' : 'en';
  const exportScaleRaw = finite(raw.exportScale, DEFAULT_SETTINGS.exportScale);
  const exportScale: 1 | 2 | 3 =
    exportScaleRaw === 2 || exportScaleRaw === 3 ? exportScaleRaw : 1;

  return {
    theme,
    accent: color(raw.accent, DEFAULT_SETTINGS.accent),
    canvasBackground: color(raw.canvasBackground, DEFAULT_SETTINGS.canvasBackground),
    showFrameNames: bool(raw.showFrameNames, DEFAULT_SETTINGS.showFrameNames),
    showGrid: bool(raw.showGrid, DEFAULT_SETTINGS.showGrid),
    gridSize: clamp(finite(raw.gridSize, DEFAULT_SETTINGS.gridSize), 1, 256),
    snapToObjects: bool(raw.snapToObjects, DEFAULT_SETTINGS.snapToObjects),
    snapToGrid: bool(raw.snapToGrid, DEFAULT_SETTINGS.snapToGrid),
    autosave: bool(raw.autosave, DEFAULT_SETTINGS.autosave),
    autosaveDelay: clamp(finite(raw.autosaveDelay, DEFAULT_SETTINGS.autosaveDelay), 0, 60000),
    defaultFont: text(raw.defaultFont, DEFAULT_SETTINGS.defaultFont) || 'Inter',
    defaultFontSize: clamp(finite(raw.defaultFontSize, DEFAULT_SETTINGS.defaultFontSize), 6, 400),
    exportScale,
    reduceMotion: bool(raw.reduceMotion, DEFAULT_SETTINGS.reduceMotion),
    units,
    agentModel: text(raw.agentModel, DEFAULT_SETTINGS.agentModel),
    agentInstructions: text(raw.agentInstructions, DEFAULT_SETTINGS.agentInstructions),
    confirmDelete: bool(raw.confirmDelete, DEFAULT_SETTINGS.confirmDelete),
    language,
  };
}

export function loadSettings(): AppSettings {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_SETTINGS };
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return normalizeSettings(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: AppSettings): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const next = normalizeSettings(s);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('penclone:settings', { detail: next }));
    }
  } catch {
    // Quota / private mode: settings are best-effort.
  }
}

export function resetSettings(): AppSettings {
  const next = { ...DEFAULT_SETTINGS };
  saveSettings(next);
  return next;
}

function resolvedTheme(s: AppSettings): 'dark' | 'light' {
  if (s.theme !== 'system') return s.theme;
  try {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
  } catch {
    // Fall through to dark.
  }
  return 'dark';
}

/** Writes data-theme, palette vars, accent and motion vars on <html>. */
export function applySettings(s: AppSettings, root?: HTMLElement): void {
  let target = root;
  if (!target) {
    if (typeof document === 'undefined') return;
    target = document.documentElement;
  }

  const settings = normalizeSettings(s);
  const theme = resolvedTheme(settings);
  target.setAttribute('data-theme', theme);
  target.setAttribute('data-reduce-motion', settings.reduceMotion ? 'true' : 'false');
  target.setAttribute('data-units', settings.units);
  target.style.setProperty('color-scheme', theme);

  const tokens = theme === 'light' ? LIGHT_TOKENS : DARK_TOKENS;
  for (const [key, value] of Object.entries(tokens)) target.style.setProperty(key, value);

  target.style.setProperty('--accent', settings.accent);
  target.style.setProperty('--canvas-bg', settings.canvasBackground);
  target.style.setProperty('--grid-size', `${settings.gridSize}px`);
  target.style.setProperty('--motion-scale', settings.reduceMotion ? '0' : '1');
}

export function storageUsage(): {
  usedBytes: number;
  quotaBytes: number;
  recents: number;
  drafts: number;
} {
  let usedBytes = 0;
  let recents = 0;
  let drafts = 0;

  try {
    if (typeof localStorage !== 'undefined') {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
        const value = localStorage.getItem(key) ?? '';
        usedBytes += key.length + value.length;
        if (key === `${STORAGE_PREFIX}recents`) {
          try {
            const parsed: unknown = JSON.parse(value);
            if (Array.isArray(parsed)) recents = parsed.length;
          } catch {
            // Ignore malformed bucket.
          }
        }
        if (key === `${STORAGE_PREFIX}drafts`) {
          try {
            const parsed: unknown = JSON.parse(value);
            if (Array.isArray(parsed)) drafts = parsed.length;
          } catch {
            // Ignore malformed bucket.
          }
        }
      }
    }
  } catch {
    // Ignore unavailable storage.
  }

  return { usedBytes, quotaBytes: QUOTA_FALLBACK, recents, drafts };
}

export function clearAllData(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && key.startsWith(STORAGE_PREFIX)) keys.push(key);
      }
      for (const key of keys) localStorage.removeItem(key);
    }
  } catch {
    // Ignore quota / unavailable storage.
  }
  applySettings({ ...DEFAULT_SETTINGS });
}
