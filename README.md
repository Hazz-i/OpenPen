# OpenPen

A lightweight web clone of the **pen.dev / Pencil** desktop design app (Electron 44 +
React 19 + Skia WASM in the original), rebuilt as a dependency-free browser editor with an
optional single-binary Go backend.

- **Frontend:** Vite + TypeScript, Canvas2D, zero runtime dependencies (~60 KB gzipped JS).
- **Backend:** Go stdlib only (~5.4 MB binary), filesystem storage, no database.
- **Cloud:** accounts, Free plan (5 GB) / Pro plan (unlimited), per-user documents and assets.
- **Offline:** everything still works with localStorage when the server is unavailable.

## Features

**Editor**
- Infinite canvas, pan/zoom, grid, smart guides and snapping
- Frames, rectangles, ellipses, polygons, paths, text, images, icons
- Select/multi-select, marquee, move, 8-handle resize, rotation, opacity
- Layers: search, rename, reorder/reparent, lock, hide, context menu
- Inspector: alignment/distribute, arrange, group/ungroup, position/size, fill (solid/gradient/image),
  stroke, radius, effects, typography
- Slides (with presentation mode), Components + instances, Libraries
- Comments, undo/redo, keyboard shortcuts, command palette
- Import/export `.pen`, paste/export HTML, export SVG/PNG (1x/2x/3x)
- Local offline agent: template generation, code generation, layout actions

**Dashboard**
- Recents, Drafts, Templates, Design Systems
- Search, grid/list view, rename/duplicate/pin/delete
- Prompt composer with offline template generation
- Drag & drop `.pen`

**Cloud**
- Email/password accounts (PBKDF2-HMAC-SHA256, HttpOnly session cookie)
- Google OAuth (optional, configured via env)
- Free plan: 5 GiB hard quota; Pro: unlimited
- Usage meter, plan switcher, account deletion
- Local-only mode

## Run

Requirements: Node 20+, and Go 1.22+ for the backend.

```bash
npm install

# Option A — client only (localStorage)
npm run dev            # http://localhost:5173

# Option B — with cloud backend
npm run build
npm run server         # http://127.0.0.1:8787 serves the built app + API

# Development with hot reload + backend
bash scripts/dev.sh    # starts Go on :8787, prints dev instructions
npm run dev            # in another terminal; /api is proxied to :8787

# Single binary
npm run server:build   # -> bin/penclone
./bin/penclone -addr 127.0.0.1:8787 -data ./data
```

### Google OAuth (optional)

```bash
export GOOGLE_CLIENT_ID=...
export GOOGLE_CLIENT_SECRET=...
export PENCLONE_PUBLIC_URL=http://localhost:8787
./bin/penclone
```

Add `http://localhost:8787/api/auth/google/callback` as an authorized redirect URI in Google
Cloud Console. If these variables are absent, the Google button is disabled with an explanation;
email/password and local mode still work. There is no fake Google login.

### Plans

| Plan | Storage | Enforcement |
| --- | --- | --- |
| Free | 5 GiB | server-side 402 on writes that exceed the quota |
| Pro | Unlimited | no quota check |

Upgrading is a demo action — no payment provider is integrated. The UI labels it as such.
For testing the quota, start the server with `-free-quota-bytes 4096`.

## Data layout

```
data/
  users.json
  sessions.json
  users/<userID>/
    user.json
    files/<docID>.json
    assets/<assetID>-<name>
    assets/index.json
    settings.json
```

Documents are JSON (`.pen` v2 subset). Writes are atomic (temp + fsync + rename). Files and
assets are scoped to their owner; foreign ids return 404.

## Project layout

```
src/
  core/    document model, store, geometry, format, settings, storage, sync, API client,
           exporters, docops, assets
  ui/      dashboard, editor, canvas, layers, inspector, menu, dialogs, settings,
           slides, components, libraries, agent, welcome, account
server/
  main.go  flags, static/embed serving, shutdown
  api.go   routes, middleware, per-user handlers, OAuth
  store.go per-user file/asset storage, quota
  auth.go  accounts, PBKDF2, sessions
```

## Development notes

- `.pen` import is tolerant: missing ids, numeric strings and unknown node types are normalized.
- Cloud sync is additive: localStorage is always the instant cache; the server is the shared copy.
- The app never blocks editing on auth or network.
- `npm run build` runs `tsc --noEmit` first; `go test ./...` covers auth, isolation and quota.
