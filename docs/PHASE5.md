# Phase 5 — local email accounts + working import flows

Fixes from user feedback:

1. **Login must not disable email when the server is offline.** Local accounts (browser-only)
   are allowed; Google stays disabled offline with an honest tooltip.
2. Welcome form feels stiff: tighten spacing, 40–42px fields, clear focus rings, consistent
   label/placeholder hierarchy, better error/loading states.
3. The three dashboard cards must do real work:
   - **Import from Figma** — clipboard paste (SVG/HTML), `.fig` file drop guidance, and optional
     Figma REST import with a personal token.
   - **Import from browser** — URL → live `browser` node + extracted page outline.
   - **Recreate a screenshot** — image import at natural size + palette extraction, labelled as
     a local reference trace (no fake AI).

---

# Local accounts (frontend-only)

`src/core/auth.ts` additions (keep all existing exports compatible):

```ts
export function getLocalAccount(): { email: string; name: string; createdAt: number } | null;
export function hasLocalAccount(): boolean;
export async function signUpLocal(email: string, password: string, name: string): Promise<AuthState>;
export async function signInLocal(email: string, password: string): Promise<AuthState>;
export function signOutLocal(): void;
```
- Store `penclone.localAccount` = `{email,name,salt,hash,iterations,createdAt}`.
- Hash with WebCrypto PBKDF2-SHA256 (210k iterations, 16-byte salt, base64).
- `CloudUser` gains `local?: boolean`; plan stays `'free'`; usage computed from local storage.
- `refreshAuth()`: if the server is unreachable or returns 401 and a local account exists,
  return that local user instead of signed-out.
- `signOut()` clears both server session and local account.
- Honest UI copy: “Local account — stored only in this browser. No cloud sync.”
- This is a convenience lock, not a security boundary; say so in Settings.

`welcome.ts`
- `online:false` must keep email/password enabled; submit routes to local sign-in/sign-up.
- Add a small “Local account” chip when offline.
- Visual polish: 42px inputs, 8px label gap, 14px field gap, accent focus ring, spinner in
  submit, inline field-level errors, disabled state only while submitting.
- No dead controls. “Continue locally” stays.

`main.ts`
- If `refreshAuth()` returns a local user, render dashboard with “Local account” status
  (no cloud sync). Sign out returns to welcome.
- Signing into cloud later should keep local docs and merge them (existing sync flow).

---

# Import flows

## Figma (`src/ui/import-figma.ts` + backend proxy)

Dialog: tabs **Paste**, **Figma file**, **Figma URL**.

- **Paste:** listen for `paste`; accept `image/svg+xml`, `text/html` containing `<svg>`, or an
  `<img src="data:...">`. Convert SVG into `path`/`rect`/`ellipse`/`text` nodes (basic subset),
  or embed as an image node when conversion is not safe. Show a preview.
- **Figma file:** explain the original flow (Figma → File → Save local copy → drop `.fig`).
  Accept drops of `.fig`; if parsing is unsupported, show a precise error and offer PNG/SVG
  export instead. Never pretend it worked.
- **Figma URL:** input `https://figma.com/file/<key>/...` + personal access token. Call
  `POST /api/import/figma` through the local Go backend (avoids CORS, keeps token out of URLs).
  Backend fetches `https://api.figma.com/v1/files/<key>?geometry=paths` with the token and
  returns the raw JSON; frontend converts `FRAME/GROUP/RECTANGLE/ELLIPSE/TEXT/VECTOR` to `.pen`
  nodes. Skip unsupported effects. Never persist the token; keep it in memory only.
- Result: a new document with imported frames, or nodes inserted into the current document.

Backend (`server/import.go`):
```
POST /api/import/figma {url|fileKey, token, nodeId?} -> {document: <figma json>}
```
- Validate https URL/key; timeout 20s; max 25 MiB response; strip nothing; return upstream JSON.
- 401 upstream → 401 `figma_unauthorized`; network → 502 `figma_unavailable`.
- Token only in request body, never logged.

## Browser (`src/ui/import-browser.ts` + backend proxy)

Dialog: URL field + device preset (Desktop 1440, Tablet 834, Mobile 390) + “Import”.

- `POST /api/import/url {url}` → backend fetches HTML (http/https only, 10s, 2 MiB):
  - Reject non-http(s), credentials in URL, and link-local/metadata hosts
    (169.254.169.254, ::1, fe80::/10). Allow localhost only when `-allow-local-imports`.
  - Return `{url, finalUrl, title, description, image, themeColor, html}`.
- Frontend parses the HTML with DOMParser (never executes scripts) and builds a page frame:
  - Frame at device width with a header (title), nav row, hero heading/subtext, content blocks
    for headings/paragraphs/links/buttons/images found in order (cap ~80 nodes).
  - Adds a real `browser` node (new node type `browser`, url + width/height + deviceId) at the
    frame position. Canvas renders it as a live, scaled `<iframe>` overlay with a small
    address bar (read-only) and a “Open in tab” action; exports render the extracted outline,
    not the iframe. Make this limitation explicit in the UI.
- If fetch fails, show the error and offer “Insert empty browser node”.

## Recreate a screenshot (`src/ui/import-screenshot.ts`)

Dialog: drop/choose image (PNG/JPG/WebP), preview, options:
- Insert at natural size / fit to 1440 width.
- “Extract palette” (default on): sample the image in a canvas, k-means-lite (<=6 clusters),
  show swatches + hex; insert them as a small palette frame or document variables.
- Honest label: “Local reference import — no AI reconstruction. You can trace over the image.”
- Image becomes a rectangle with an image fill (existing asset pipeline), locked by default
  with a “Locked reference” name so it does not interfere with selection.

## Dashboard wiring

The three cards open the dialogs above. On success:
- create a new document from returned nodes, or insert into the current document if one is open;
- name it `Figma import`, `Browser import <host>`, `Screenshot reference`;
- show a toast and select the inserted frame.
Cancel returns to the dashboard unchanged. No dead cards.

## Acceptance

1. Offline welcome: email + password creates/signs into a local account; dashboard shows
   “Local account”.
2. Field spacing/focus/error states look intentional at 1440×900 and 1024×768.
3. Figma paste of an SVG creates editable nodes; Figma URL with a token imports frames
   (network test optional/manual); errors are specific.
4. Browser import of a public URL creates a frame outline + live browser node; failure is explicit.
5. Screenshot import inserts the image and a palette; labels are honest.
6. `npx tsc --noEmit`, `npm run build`, `go test ./...`, `go vet ./...` clean.
