# Phase 3 — cloud accounts, plans and quota

The product now needs a cloud storage story:

- **Free plan:** up to **5 GB**.
- **Pro plan:** **unlimited**.
- Accounts with email + password; documents and assets belong to the signed-in user.
- The app must still work locally (localStorage) when not signed in or offline.
- No real payment provider in this build. Upgrading is a **demo** action, clearly labelled.

The Go stdlib backend from Phase 2 is the base. Extend it; do not introduce third-party modules.

---

# Backend (Go, stdlib only)

## Data layout

```
data/
  users.json                      # [{id,email,name,plan,createdAt}]
  users/<userID>/
    user.json                     # full record incl. password hash/salt
    files/<docID>.json
    assets/<assetID>-<name>
    assets/index.json
    settings.json
  sessions.json                   # tokenHash -> {userID, expiresAt}
  legacy/                         # anything migrated from the no-auth phase
```
Migration: if `data/files/` exists when the first user registers, move those files (and
`data/assets/`) into that user's directory and log it. Never delete user data silently.

## Auth

- `POST /api/auth/register` `{email,password,name}` → 201 `{user}` + session cookie.
  Validate email shape, password ≥ 8 chars, name 1..80. Duplicate email → 409.
- `POST /api/auth/login` `{email,password}` → `{user}` + cookie. Wrong creds → 401 (same message).
- `POST /api/auth/logout` → clears cookie, `{ok:true}` even if already signed out.
- `GET  /api/auth/me` → `{user, usage}` or 401 `{error:"unauthenticated"}`.
- Cookie: `penclone_session`, 32 random bytes base64url, HttpOnly, SameSite=Lax,
  Path=/, Max-Age 30 days; no Secure on plain HTTP; store only SHA-256 of the token.
- Password hashing with stdlib only: PBKDF2-HMAC-SHA256, 16-byte random salt,
  210_000 iterations, 32-byte key. Constant-time compare. Never log passwords/tokens.
- Sessions survive restarts via `sessions.json` (atomic writes, mutex). Expired entries pruned.
- Rate limit login attempts in memory (e.g. 10/min/IP) returning 429.

## User + plan model

```go
type User struct {
  ID, Email, Name string
  Plan string // "free" | "pro"
  CreatedAt int64
}
type Usage struct {
  UsedBytes  int64  `json:"usedBytes"`
  LimitBytes int64  `json:"limitBytes"` // 0 = unlimited
  Percent    int    `json:"percent"`    // 0..100, capped
  FileCount  int    `json:"fileCount"`
  AssetCount int    `json:"assetCount"`
}
```
- Free limit: `5 * 1024 * 1024 * 1024` bytes (5 GiB), configurable with
  `-free-quota-bytes` (env `PENCLONE_FREE_QUOTA`) so tests can use a tiny limit.
- Pro: `LimitBytes = 0`, unlimited.
- `POST /api/account/plan` `{plan:"pro"|"free"}` → `{user, usage}`. Demo switch; log it.
- `DELETE /api/account` → delete the signed-in user's files, assets, settings, sessions, record.
  Requires `{confirm:true}`.
- `GET /api/account/usage` → `{usage}` recomputed from disk.
- Usage is computed from file JSON sizes + asset sizes (including thumbnails embedded in files).
  Cache per user in memory, invalidate on every write; recompute at startup.

## Quota enforcement

- All `/api/files` and `/api/assets` routes require a session (401 otherwise).
- On create/update/upload compute the delta. If `plan == "free"` and
  `used + delta > limit`, return **402**:
  `{"error":"quota_exceeded","usage":{...},"limitBytes":N,"plan":"free"}`.
  No partial writes. Deleting files frees quota.
- `Content-Length`/body limits still apply. Reject uploads that alone exceed remaining quota
  before reading the whole body where possible.
- Per-user isolation is mandatory: a user must never read/list/delete another user's id.
  Return 404 for foreign ids, not 403.

## API changes

All existing endpoints (`/api/files*`, `/api/assets*`, `/api/settings`) stay the same shape but
become user-scoped and require auth. `/api/health` stays public and adds `authRequired:true`.
Unknown/unauthorized responses stay JSON.

CORS for the Vite dev origin must allow credentials:
`Access-Control-Allow-Origin: http://localhost:5173` (and 127.0.0.1 variant),
`Access-Control-Allow-Credentials: true`, methods + `Content-Type`, and handle OPTIONS.

## Tests (`server/api_test.go`, extend)

Cover: register/login/logout/me, duplicate email, weak password, wrong password,
session persistence, auth-required 401 on every protected route, user isolation (A cannot GET
B's file), free quota exceeded on create and on asset upload (use tiny `-free-quota-bytes`),
delete frees quota, pro unlimited (limit 0), plan switch persists, account delete removes data,
legacy migration on first register, rate limit, and that quota failure leaves the old file intact.
Use `httptest.Server` or direct handler with cookie jar. `go test ./...` green, `go vet` clean.

---

# Frontend

## `src/core/auth.ts`

```ts
export interface CloudUser { id: string; email: string; name: string; plan: 'free'|'pro'; createdAt: number }
export interface CloudUsage { usedBytes: number; limitBytes: number; percent: number; fileCount: number; assetCount: number }
export interface AuthState { user: CloudUser | null; usage: CloudUsage | null; loading: boolean }
export function getAuth(): AuthState;
export async function refreshAuth(): Promise<AuthState>;      // GET /me
export async function signUp(email, password, name): Promise<AuthState>;
export async function signIn(email, password): Promise<AuthState>;
export async function signOut(): Promise<void>;
export async function changePlan(plan: 'free'|'pro'): Promise<AuthState>;
export async function refreshUsage(): Promise<CloudUsage | null>;
export function subscribeAuth(fn: (s: AuthState) => void): () => void;
export function formatBytes(n: number): string;                // "4.2 GB"
export function quotaRemaining(usage): number;                 // -1 when unlimited
```
- The API client (`src/core/api.ts`) must send `credentials: 'same-origin'` (or include) so the
  cookie is used.
- 401 must be distinguishable from other errors (`ApiError.status`).

## Sync gating (`src/core/sync.ts`)

- Only mirror/pull when the server is reachable **and** `getAuth().user` is set.
- On sign-in: refresh auth, pull the user's cloud files, merge with local cache, push local-only
  docs, then notify the dashboard.
- On sign-out: stop mirroring; local cache remains usable.
- Quota failures (402) must surface as a toast + open the upgrade dialog, not be swallowed.

## UI

### `src/ui/auth.ts`
- `openAuthDialog(mode?: 'signin'|'signup', opts?): { close(): void }`
  Centered modal matching the Settings modal: logo, tabs Sign in / Create account, email,
  password, name (signup), validation, submit spinner, honest error messages, “Continue locally”
  link. No external auth providers.
- `openAccountMenu(anchor?: HTMLElement): void` — popover with name/email, plan badge,
  usage meter, Manage plan, Settings, Sign out. When signed out: “Sign in to sync”.
- `openUpgradeDialog(opts?): { close(): void }` — two cards:
  **Free — 5 GB**, features list, current plan state;
  **Pro — Unlimited**, highlighted, “Upgrade (demo — no payment)”; calls `changePlan('pro')`
  and updates the UI. Include a clear “Demo billing, no charge” note.
- Toasts for success/error; if quota exceeded open upgrade dialog automatically.

### Dashboard
- Sidebar bottom account area: avatar, name/email or “Sign in”, plan badge, usage bar
  (“2.1 GB of 5 GB”) and upgrade link. On Pro show “Unlimited”.
- Top bar right: account chip (avatar + plan) with the account menu.
- Cloud status: small “Cloud · Synced” / “Local only” indicator with tooltip.
- If the server is unreachable: “Local mode — cloud unavailable” (no blocking modal).
- If reachable and signed out: a slim banner “Sign in to sync your files to the cloud” with
  Sign in / Create account actions.
- After sign-in, refresh the file list from the cloud without a full reload.

### Editor
- Top-right replaces the fake “W” avatar and “Free” pill with real account chip + plan badge.
- Account menu includes usage and upgrade. Saving when over quota shows the upgrade dialog.
- File menu gains “Account…” and “Storage & plan…”.

### Settings
- Add an **Account** section (before General): signed-in identity, plan, usage meter, upgrade,
  sign out, delete account (typed confirmation). Signed out: sign in / create account.

## Rules

- No payment processing, no external auth, no network beyond the local backend.
- Never block local editing on auth; cloud is additive.
- Never claim “unlimited” for free; enforce exactly 5 GiB.
- All strings honest: “demo”, “no charge”, “local only” where applicable.
- Preserve the existing visual language and layout.
- `npx tsc --noEmit` + `npm run build` clean; `go test ./...` + `go vet ./...` clean.
