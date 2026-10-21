/**
 * File open/save helpers. Uses the File System Access API when available and
 * silently falls back to <input type=file> / anchor downloads everywhere else.
 */
import { MAX_IMAGE_BYTES, loadImageElement } from './assets';

export interface DiskFile {
  name: string;
  text: string;
  handle?: FileSystemFileHandle;
}

export interface PickedImage {
  name: string;
  dataUrl: string;
  width: number;
  height: number;
  size: number;
}

interface PickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface OpenFilePickerOptions {
  multiple?: boolean;
  types?: PickerAcceptType[];
  excludeAcceptAllOption?: boolean;
  id?: string;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: PickerAcceptType[];
  excludeAcceptAllOption?: boolean;
  id?: string;
}

declare global {
  interface Window {
    showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
  }
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'];

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

function ensurePenName(name: string): string {
  const trimmed = (name || '').trim() || 'untitled.pen';
  return trimmed.toLowerCase().endsWith('.pen') ? trimmed : `${trimmed}.pen`;
}

export function supportsFileSystemAccess(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.showOpenFilePicker === 'function' &&
    typeof window.showSaveFilePicker === 'function'
  );
}

function pickFilesWithInput(accept: string, multiple = false): Promise<File[]> {
  if (typeof document === 'undefined') return Promise.resolve([]);

  return new Promise<File[]>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.position = 'fixed';
    input.style.left = '-10000px';
    input.style.top = '0';
    input.style.opacity = '0';

    let settled = false;
    let focusTimer = 0;
    const hardTimer = window.setTimeout(() => finish([]), 5 * 60 * 1000);

    const cleanup = (): void => {
      window.clearTimeout(focusTimer);
      window.clearTimeout(hardTimer);
      window.removeEventListener('focus', onFocus);
      input.remove();
    };
    const finish = (files: File[]): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(files);
    };
    const onFocus = (): void => {
      // Older browsers do not fire `cancel`; if focus returns without files, stop waiting.
      focusTimer = window.setTimeout(() => {
        if (!input.files || input.files.length === 0) finish([]);
      }, 900);
    };

    input.addEventListener('change', () => finish(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => finish([]));
    window.addEventListener('focus', onFocus, { once: true });

    document.body.appendChild(input);
    try {
      input.click();
    } catch {
      finish([]);
    }
  });
}

export async function openPenFileDialog(): Promise<DiskFile | null> {
  if (supportsFileSystemAccess()) {
    try {
      const handles = await window.showOpenFilePicker!({
        multiple: false,
        excludeAcceptAllOption: false,
        types: [
          {
            description: 'Pencil documents',
            accept: {
              'application/json': ['.pen', '.json'],
            },
          },
        ],
      });
      const handle = handles[0];
      if (!handle) return null;
      const file = await handle.getFile();
      return { name: file.name, text: await file.text(), handle };
    } catch (error) {
      if (isAbort(error)) return null;
      // Permission or unsupported-picker errors fall through to the input fallback.
    }
  }

  const files = await pickFilesWithInput('.pen,.json,application/json');
  const file = files[0];
  if (!file) return null;
  try {
    return { name: file.name, text: await file.text() };
  } catch {
    return null;
  }
}

async function writeHandle(handle: FileSystemFileHandle, text: string): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(text);
  } finally {
    await writable.close();
  }
}

export async function savePenFile(
  text: string,
  suggestedName: string,
  handle?: FileSystemFileHandle,
  forceDialog = false,
): Promise<{ name: string; handle?: FileSystemFileHandle } | null> {
  const fallbackName = ensurePenName(suggestedName);

  if (handle && !forceDialog) {
    try {
      await writeHandle(handle, text);
      return { name: handle.name || fallbackName, handle };
    } catch {
      // Re-prompt below; a stale handle is not fatal.
    }
  }

  if (supportsFileSystemAccess()) {
    try {
      const picked = await window.showSaveFilePicker!({
        suggestedName: fallbackName,
        excludeAcceptAllOption: false,
        types: [
          {
            description: 'Pencil document',
            accept: {
              'application/json': ['.pen'],
            },
          },
        ],
      });
      await writeHandle(picked, text);
      return { name: picked.name || fallbackName, handle: picked };
    } catch (error) {
      if (isAbort(error)) return null;
    }
  }

  downloadText(text, fallbackName, 'application/json');
  return { name: fallbackName };
}

export function downloadText(text: string, filename: string, mime = 'text/plain'): void {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}

export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return;
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch {
    // Download blocked: nothing else we can do.
  }
}

function imageFileAllowed(file: File): boolean {
  if (file.size > MAX_IMAGE_BYTES) return false;
  if (file.type) return file.type.startsWith('image/');
  return IMAGE_EXTENSIONS.includes(extensionOf(file.name));
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      reject(new Error('FileReader is not available'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not read file'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export async function imageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  try {
    const img = await loadImageElement(dataUrl);
    return {
      width: img.naturalWidth || img.width || 1,
      height: img.naturalHeight || img.height || 1,
    };
  } catch {
    return { width: 0, height: 0 };
  }
}

export async function pickImageFile(): Promise<PickedImage | null> {
  const files = await pickFilesWithInput(`image/*,${IMAGE_EXTENSIONS.map((e) => `.${e}`).join(',')}`);
  const file = files[0];
  if (!file || !imageFileAllowed(file)) return null;

  try {
    const dataUrl = await fileToDataUrl(file);
    const size = await imageSize(dataUrl);
    if (!size.width || !size.height) return null;
    return {
      name: file.name || 'Image',
      dataUrl,
      width: size.width,
      height: size.height,
      size: file.size,
    };
  } catch {
    return null;
  }
}

export async function readDroppedFiles(
  files: FileList | File[],
): Promise<Array<
  | { kind: 'pen'; name: string; text: string }
  | { kind: 'image'; image: PickedImage }
  | { kind: 'unsupported'; name: string }
>> {
  const list = Array.from(files);
  const out: Array<
    | { kind: 'pen'; name: string; text: string }
    | { kind: 'image'; image: PickedImage }
    | { kind: 'unsupported'; name: string }
  > = [];

  for (const file of list) {
    const ext = extensionOf(file.name);
    if (ext === 'pen' || ext === 'json') {
      try {
        out.push({ kind: 'pen', name: file.name, text: await file.text() });
      } catch {
        out.push({ kind: 'unsupported', name: file.name });
      }
      continue;
    }

    const isImage = file.type.startsWith('image/') || IMAGE_EXTENSIONS.includes(ext);
    if (isImage && imageFileAllowed(file)) {
      try {
        const dataUrl = await fileToDataUrl(file);
        const size = await imageSize(dataUrl);
        if (size.width > 0 && size.height > 0) {
          out.push({
            kind: 'image',
            image: {
              name: file.name || 'Image',
              dataUrl,
              width: size.width,
              height: size.height,
              size: file.size,
            },
          });
          continue;
        }
      } catch {
        // Fall through to unsupported.
      }
    }

    out.push({ kind: 'unsupported', name: file.name });
  }

  return out;
}
