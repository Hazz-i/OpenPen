export interface CloudUser {
  id: string;
  email: string;
  name: string;
  plan: 'free' | 'pro';
  createdAt: number;
  hasPassword?: boolean;
  googleLinked?: boolean;
  local?: boolean;
}

export interface CloudUsage {
  usedBytes: number;
  limitBytes: number; // 0 = unlimited
  percent: number;
  fileCount: number;
  assetCount: number;
}

export interface AuthState {
  user: CloudUser | null;
  usage: CloudUsage | null;
  loading: boolean;
}

export class AuthError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
  }
}

interface StoredLocalAccount {
  email: string;
  name: string;
  salt: string; // base64
  hash: string; // base64
  iterations: number;
  createdAt: number;
}

const LOCAL_ACCOUNT_KEY = 'penclone.localAccount';

export function getLocalAccount(): { email: string; name: string; createdAt: number } | null {
  try {
    const raw = localStorage.getItem(LOCAL_ACCOUNT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredLocalAccount;
    if (parsed && typeof parsed.email === 'string') {
      return {
        email: parsed.email,
        name: parsed.name || '',
        createdAt: parsed.createdAt || Date.now(),
      };
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

export function hasLocalAccount(): boolean {
  return getLocalAccount() !== null;
}

export function signOutLocal(): void {
  try {
    localStorage.removeItem(LOCAL_ACCOUNT_KEY);
  } catch {
    // Ignore
  }
}

// WebCrypto PBKDF2 helpers
function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function deriveKey(password: string, saltBuffer: ArrayBuffer, iterations: number): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return bufferToBase64(derived);
}

function computeLocalUsage(): CloudUsage {
  let bytes = 0;
  let fileCount = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('penclone.')) {
        const val = localStorage.getItem(k) || '';
        bytes += k.length + val.length * 2;
        if (k.startsWith('penclone.recents') || k.startsWith('penclone.drafts')) {
          fileCount++;
        }
      }
    }
  } catch {
    // Ignore
  }
  const limit = 5 * 1024 * 1024; // 5 MB local typical storage cap
  return {
    usedBytes: bytes,
    limitBytes: limit,
    percent: Math.min(100, Math.round((bytes / limit) * 100)),
    fileCount,
    assetCount: 0,
  };
}

export async function signUpLocal(email: string, password: string, name: string): Promise<AuthState> {
  if (!email || !email.includes('@')) {
    throw new AuthError('Valid email required', 400);
  }
  if (!password || password.length < 8) {
    throw new AuthError('Password must be at least 8 characters', 400);
  }

  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const iterations = 210000;
  const hash = await deriveKey(password, salt.buffer, iterations);

  const acc: StoredLocalAccount = {
    email,
    name: name || email.split('@')[0],
    salt: bufferToBase64(salt.buffer),
    hash,
    iterations,
    createdAt: Date.now(),
  };

  localStorage.setItem(LOCAL_ACCOUNT_KEY, JSON.stringify(acc));

  currentState = {
    user: {
      id: `local-${Date.now()}`,
      email: acc.email,
      name: acc.name,
      plan: 'free',
      createdAt: acc.createdAt,
      local: true,
    },
    usage: computeLocalUsage(),
    loading: false,
  };

  notify();
  return currentState;
}

export async function signInLocal(email: string, password: string): Promise<AuthState> {
  const raw = localStorage.getItem(LOCAL_ACCOUNT_KEY);
  if (!raw) {
    throw new AuthError('No local account found on this device', 401);
  }
  const acc = JSON.parse(raw) as StoredLocalAccount;
  if (acc.email.toLowerCase() !== email.toLowerCase()) {
    throw new AuthError('Invalid email or password', 401);
  }

  const saltBuf = base64ToBuffer(acc.salt);
  const hash = await deriveKey(password, saltBuf, acc.iterations || 210000);

  // Constant-time compare
  let mismatch = 0;
  if (hash.length !== acc.hash.length) {
    mismatch = 1;
  }
  for (let i = 0; i < hash.length; i++) {
    mismatch |= hash.charCodeAt(i) ^ (acc.hash.charCodeAt(i) || 0);
  }

  if (mismatch !== 0) {
    throw new AuthError('Invalid email or password', 401);
  }

  currentState = {
    user: {
      id: `local-${acc.createdAt}`,
      email: acc.email,
      name: acc.name,
      plan: 'free',
      createdAt: acc.createdAt,
      local: true,
    },
    usage: computeLocalUsage(),
    loading: false,
  };

  notify();
  return currentState;
}

let currentState: AuthState = {
  user: null,
  usage: null,
  loading: true,
};

const listeners = new Set<(s: AuthState) => void>();

function notify(): void {
  for (const fn of listeners) {
    try {
      fn(currentState);
    } catch {
      // Ignore listener error
    }
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  let res: Response;
  try {
    res = await fetch(path, {
      ...options,
      headers,
      credentials: 'same-origin',
    });
  } catch {
    throw new AuthError('Network request failed — server unreachable', 0);
  }

  if (!res.ok) {
    let errCode: string | undefined;
    let errMsg = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data && typeof data === 'object') {
        if (typeof data.error === 'string') errMsg = data.error;
        if (typeof data.code === 'string') errCode = data.code;
      }
    } catch {
      // Non-json error response
    }
    throw new AuthError(errMsg, res.status, errCode);
  }

  if (res.status === 204) {
    return {} as T;
  }

  return (await res.json()) as T;
}

export function getAuth(): AuthState {
  return currentState;
}

export function subscribeAuth(fn: (s: AuthState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function fetchAuthConfig(): Promise<{ googleEnabled: boolean; authRequired?: boolean; version?: string }> {
  try {
    const cfg = await request<{ googleEnabled: boolean; authRequired?: boolean; version?: string }>('/api/auth/config');
    return {
      googleEnabled: Boolean(cfg.googleEnabled),
      authRequired: cfg.authRequired,
      version: cfg.version,
    };
  } catch {
    return { googleEnabled: false };
  }
}

export async function refreshAuth(): Promise<AuthState> {
  currentState.loading = true;
  notify();

  try {
    const data = await request<{ user: CloudUser; usage: CloudUsage }>('/api/auth/me');
    currentState = {
      user: data.user || null,
      usage: data.usage || null,
      loading: false,
    };
  } catch {
    // Fallback to local account if exists
    const local = getLocalAccount();
    if (local) {
      currentState = {
        user: {
          id: `local-${local.createdAt}`,
          email: local.email,
          name: local.name,
          plan: 'free',
          createdAt: local.createdAt,
          local: true,
        },
        usage: computeLocalUsage(),
        loading: false,
      };
    } else {
      currentState = {
        user: null,
        usage: null,
        loading: false,
      };
    }
  }

  notify();
  return currentState;
}

export async function signUp(email: string, password: string, name: string): Promise<AuthState> {
  await request<{ user: CloudUser }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  });

  return await refreshAuth();
}

export async function signIn(email: string, password: string): Promise<AuthState> {
  await request<{ user: CloudUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  return await refreshAuth();
}

export async function signOut(): Promise<void> {
  try {
    await request('/api/auth/logout', { method: 'POST' });
  } catch {
    // Server offline or already logged out
  } finally {
    signOutLocal();
    currentState = {
      user: null,
      usage: null,
      loading: false,
    };
    notify();
  }
}

export async function refreshUsage(): Promise<CloudUsage | null> {
  if (currentState.user?.local) {
    const usage = computeLocalUsage();
    currentState = { ...currentState, usage };
    notify();
    return usage;
  }
  try {
    const data = await request<{ usage: CloudUsage }>('/api/account/usage');
    if (data.usage) {
      currentState = {
        ...currentState,
        usage: data.usage,
      };
      notify();
      return data.usage;
    }
  } catch {
    // Ignore usage refresh failure
  }
  return currentState.usage;
}

export async function changePlan(plan: 'free' | 'pro'): Promise<AuthState> {
  if (currentState.user?.local) {
    throw new AuthError('Local accounts are fixed on Free plan', 400);
  }
  const data = await request<{ user: CloudUser; usage: CloudUsage }>('/api/account/plan', {
    method: 'POST',
    body: JSON.stringify({ plan }),
  });

  currentState = {
    user: data.user || currentState.user,
    usage: data.usage || currentState.usage,
    loading: false,
  };
  notify();
  return currentState;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, i);
  return `${val < 10 && i > 0 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

export function quotaRemaining(usage: CloudUsage | null | undefined): number {
  if (!usage) return -1;
  if (!usage.limitBytes || usage.limitBytes <= 0) return -1; // unlimited
  return Math.max(0, usage.limitBytes - usage.usedBytes);
}
