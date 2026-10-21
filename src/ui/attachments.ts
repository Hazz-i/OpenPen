export interface AttachmentItem {
  id: string;
  name: string;
  size: number;
  type: 'image' | 'text' | 'pen';
  text?: string;
  dataUrl?: string;
}

const MAX_ATTACHMENTS = 8;
const MAX_TEXT_BYTES = 2 * 1024 * 1024; // 2 MB

export async function processFilesToAttachments(
  files: FileList | File[]
): Promise<AttachmentItem[]> {
  const list = Array.from(files);
  const items: AttachmentItem[] = [];

  for (const f of list) {
    if (items.length >= MAX_ATTACHMENTS) break;

    const lower = f.name.toLowerCase();
    const isImage = f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)$/i.test(lower);
    const isPen = lower.endsWith('.pen');
    const isText =
      f.type.startsWith('text/') ||
      /\.(md|txt|json|ts|js|jsx|tsx|css|html)$/i.test(lower);

    if (isImage) {
      const dataUrl = await fileToDataUrl(f);
      items.push({
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: f.name,
        size: f.size,
        type: 'image',
        dataUrl,
      });
    } else if (isPen) {
      if (f.size > MAX_TEXT_BYTES) continue;
      const text = await f.text();
      items.push({
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: f.name,
        size: f.size,
        type: 'pen',
        text,
      });
    } else if (isText) {
      if (f.size > MAX_TEXT_BYTES) continue;
      const text = await f.text();
      items.push({
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: f.name,
        size: f.size,
        type: 'text',
        text,
      });
    }
  }

  return items;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
