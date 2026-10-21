/**
 * Typed client for the local Go backend (stdlib-only server).
 * Every call is bounded by a short timeout so the UI never hangs when the
 * server is not running — the app simply falls back to localStorage.
 */
import type { PenDocument } from './types';
import type { CloudUsage } from './auth';

export interface RemoteFileMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  draft: boolean;
  hasThumb: boolean;
}

export interface RemoteFile extends RemoteFileMeta {
  doc: PenDocument;
  thumbnail?: string;
}

export interface RemoteAsset {
  id: string;
  name: string;
  type: string;
  url: string;
  size: number;
  createdAt: number;
}

const TIMEOUT = 2500;

export class ApiError extends Error {
  status: number;
  code?: string;
  usage?: CloudUsage;
  limitBytes?: number;
  plan?: string;

  constructor(
    message: string,
    status: number,
    code?: string,
    extra?: { usage?: CloudUsage; limitBytes?: number; plan?: string },
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.usage = extra?.usage;
    this.limitBytes = extra?.limitBytes;
    this.plan = extra?.plan;
  }
}

type ErrorBody = {
  error?: string;
  code?: string;
  usage?: CloudUsage;
  limitBytes?: number;
  plan?: string;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(path, {
      ...init,
      signal: ctrl.signal,
      credentials: 'same-origin',
      headers: {
        ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      let body: ErrorBody = {};
      const text = await res.text();
      if (text) {
        try {
          body = JSON.parse(text) as ErrorBody;
        } catch {
          // non-JSON error body
        }
      }
      const code =
        body.code ||
        (body.error && /^[a-z0-9_]+$/.test(body.error) ? body.error : undefined);
      throw new ApiError(
        body.error || `${res.status} ${res.statusText}`,
        res.status,
        code,
        { usage: body.usage, limitBytes: body.limitBytes, plan: body.plan },
      );
    }
    if (res.status === 204) return undefined as T;
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('application/json')) return (await res.text()) as T;
    return (await res.json()) as T;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function health(): Promise<boolean> {
  // Short probe: a missing server must not delay the dashboard by seconds.
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 700);
  try {
    const res = await fetch('/api/health', {
      signal: ctrl.signal,
      credentials: 'same-origin',
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function listFiles(): Promise<RemoteFileMeta[]> {
  const res = await request<{ files: RemoteFileMeta[] }>('/api/files');
  return Array.isArray(res.files) ? res.files : [];
}

export async function getFile(id: string): Promise<RemoteFile> {
  return request<RemoteFile>(`/api/files/${encodeURIComponent(id)}`);
}

export async function createFile(file: {
  id: string;
  name: string;
  doc: PenDocument;
  thumbnail?: string;
  pinned?: boolean;
  draft?: boolean;
}): Promise<RemoteFileMeta> {
  return request<RemoteFileMeta>('/api/files', {
    method: 'POST',
    body: JSON.stringify(file),
  });
}

export async function putFile(
  id: string,
  file: {
    name: string;
    doc: PenDocument;
    thumbnail?: string;
    pinned?: boolean;
    draft?: boolean;
  },
): Promise<RemoteFileMeta> {
  return request<RemoteFileMeta>(`/api/files/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(file),
  });
}

export async function deleteFile(id: string): Promise<void> {
  await request(`/api/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function duplicateFile(id: string): Promise<RemoteFileMeta> {
  const res = await request<{ file: RemoteFileMeta }>(
    `/api/files/${encodeURIComponent(id)}/duplicate`,
    { method: 'POST' },
  );
  return res.file;
}

export async function pinFile(id: string, pinned: boolean): Promise<RemoteFileMeta> {
  return request<RemoteFileMeta>(`/api/files/${encodeURIComponent(id)}/pin`, {
    method: 'POST',
    body: JSON.stringify({ pinned }),
  });
}

export async function listAssets(): Promise<RemoteAsset[]> {
  const res = await request<{ assets: RemoteAsset[] }>('/api/assets');
  return Array.isArray(res.assets) ? res.assets : [];
}

export async function uploadAsset(file: File): Promise<RemoteAsset> {
  const form = new FormData();
  form.append('file', file, file.name);
  return request<RemoteAsset>('/api/assets', { method: 'POST', body: form });
}

export async function removeAsset(id: string): Promise<void> {
  await request(`/api/assets/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function getRemoteSettings<T>(): Promise<T | null> {
  const res = await request<{ settings: T | null }>('/api/settings');
  return res.settings ?? null;
}

export async function putRemoteSettings(settings: unknown): Promise<void> {
  await request('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}


export async function authConfig(): Promise<{ googleEnabled: boolean; authRequired?: boolean; version?: string }> {
  const res = await request<{ googleEnabled?: boolean; authRequired?: boolean; version?: string }>(
    '/api/auth/config',
  );
  return {
    googleEnabled: Boolean(res.googleEnabled),
    authRequired: res.authRequired,
    version: res.version,
  };
}

export function googleStartUrl(redirect = '/'): string {
  return `/api/auth/google/start?redirect=${encodeURIComponent(redirect)}`;
}

export async function deleteAccount(): Promise<void> {
  await request('/api/account', {
    method: 'DELETE',
    body: JSON.stringify({ confirm: true }),
  });
}
