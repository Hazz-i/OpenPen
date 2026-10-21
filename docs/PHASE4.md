# Phase 4 — welcome/login gate with Google or email

The first screen must be an authentication gate, not the dashboard:

- **Continue with Google** (real OAuth 2.0, server-side code exchange)
- **Email + password** (sign in / create account)
- A tertiary **Continue locally** escape hatch (local-only mode), because the editor must stay
  usable when the cloud is unreachable.
- Signed-in users flow straight to the dashboard (or the last open document).

Google is **optional configuration**: when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are absent,
the button appears disabled with an honest “Google sign-in isn’t configured on this server”
tooltip, and email/password remains fully functional. Never fake a Google login.

---

# Backend

## Config

Add flags/env (all optional):

```
-google-client-id       GOOGLE_CLIENT_ID
-google-client-secret   GOOGLE_CLIENT_SECRET
-public-url             PENCLONE_PUBLIC_URL   e.g. http://localhost:8787
```

`public-url` is used to build the redirect URI `<public-url>/api/auth/google/callback`.
If absent, derive from the request scheme+host (loopback only). Refuse Google start when the
client id/secret are empty.

`GET /api/auth/config` (public) →
```json
{ "googleEnabled": true, "authRequired": true, "version": "1" }
```

## Google OAuth (stdlib only, no third-party packages)

- `GET /api/auth/google/start?redirect=/` →
  - 503 JSON `{error:"google_not_configured"}` when unconfigured.
  - Otherwise generate a 32-byte random `state`, set a short-lived HttpOnly cookie
    `penclone_oauth_state` (SameSite=Lax, Path=/api/auth/google, Max-Age 600), then 302 to:
    `https://accounts.google.com/o/oauth2/v2/auth`
    with `client_id`, `redirect_uri`, `response_type=code`, `scope=openid email profile`,
    `state`, `prompt=select_account`.
- `GET /api/auth/google/callback?code=&state=` →
  1. Validate state against the cookie (constant-time); clear the cookie.
  2. Exchange `code` at `https://oauth2.googleapis.com/token` (form POST, 10s timeout),
     `grant_type=authorization_code`, client id/secret, redirect URI.
  3. Read `access_token`, call `https://openidconnect.googleapis.com/v1/userinfo`
     (Bearer, 10s timeout).
  4. Require `email_verified == true`; reject otherwise.
  5. Find user by `googleSub`; else by email → link `googleSub`; else create a Free user
     with a random unusable password hash and `googleSub`, `hasPassword=false`.
  6. Create the normal session cookie, then 302 to a validated local `redirect`
     (must start with a single `/`, reject `//`, backslashes, scheme, CR/LF; default `/`).
  7. On failure 302 to `/?authError=<code>` with one of:
     `google_unavailable`, `invalid_state`, `access_denied`, `email_unverified`, `exchange_failed`.
- Never expose the client secret, access token, or raw Google payload to the browser or logs.
- Network calls must be isolated behind a small `GoogleExchanger` interface so tests can inject
  a fake; unit tests must not hit Google.
- Add `hasPassword` and `googleLinked` to the `/api/auth/me` user payload.
- Password login for a Google-only user returns the generic 401 (no account enumeration).

## Tests

- config reports googleEnabled correctly
- start: 503 when unconfigured; 302 + state cookie + correct params when configured
- callback: invalid state → redirect authError=invalid_state
- callback with injected exchanger: new user created (free), existing email linked, unverified
  email rejected, redirect sanitization (`//evil`, absolute URL, CRLF rejected)
- hasPassword/googleLinked in /me
- all existing phase-3 tests continue to pass; `go vet`, `gofmt`, `go test` clean

---

# Frontend

## `src/ui/welcome.ts`

```ts
export interface WelcomeOptions {
  online: boolean;
  googleEnabled: boolean;
  onAuthenticated(): void | Promise<void>;
  onContinueLocal(): void;
}
export function mountWelcome(root: HTMLElement, opts: WelcomeOptions): { destroy(): void };
```

Design (match the app, not a generic template):
- Full-viewport dark background `#18181b` with a subtle radial glow, pen.dev wordmark.
- Centered card ~420px, rounded 16px, border `#202020`, panel `#141414`.
- Headline: “Design anything.” / sub: “Sign in to sync your work across devices.”
- **Continue with Google** — full-width white button with the official multicolor G icon
  (inline SVG) and dark text. Disabled state + tooltip when `!googleEnabled`.
- Divider “or”.
- Email form: email, password, and (create-account mode) name; primary button
  “Sign in” / “Create account”; toggle link; inline validation; loading state.
- Error area for wrong password / duplicate email / network failure, honest and non-leaky.
- Tertiary: “Continue locally” with a one-line explanation (“No cloud sync. Files stay in this
  browser.”). Hidden only if you have a better accessibility rationale.
- If `online === false`: show “Cloud unavailable — you can continue locally” and disable the
  Google/email buttons (or attempt and show a friendly error), still allowing local mode.
- Read `?authError=` from the URL on mount and show a mapped message; then clean the query
  string with `history.replaceState`.
- Keyboard accessible, Enter submits, focus ring visible, `prefers-reduced-motion` respected.
- Google click: `window.location.href = '/api/auth/google/start?redirect=' + encodeURIComponent('/')`.

## Boot flow (`src/main.ts`)

```
splash
→ health check (short timeout)
→ refreshAuth() (GET /api/auth/me)
→ if user: enable cloud sync, pull, showDashboard()
→ else if localMode flag set (penclone.localMode): showDashboard() with “Sign in to sync”
→ else if !online: showWelcome({online:false, googleEnabled:false, onContinueLocal})
→ else: GET /api/auth/config → showWelcome({online:true, googleEnabled, ...})
onAuthenticated → clear local flag, refreshAuth, pull cloud files, showDashboard()
onContinueLocal → set local flag, showDashboard()
```

- The welcome screen must be the **first** thing on a fresh install; no dashboard flash.
- Auth is never required to keep editing once the user chose local mode.
- Dashboard/editor show “Sign in” affordances when in local mode.
- Signing out returns to the welcome screen (after confirming unsaved work).

## API client (`src/core/api.ts`)

- Add `authConfig()`, `googleStartUrl()`, and make 401 distinguishable (`ApiError.status`).
- All requests use `credentials: 'same-origin'` (dev proxy is same-origin anyway).

## Account UI (already specified in PHASE3)

Keep: account menu, usage meter, upgrade dialog. The welcome gate is additive; do not duplicate
the sign-in form inside settings — settings shows status + actions that open the welcome/auth
dialog if signed out.

---

# Acceptance

1. Fresh browser, server running, Google **not** configured → welcome screen, Google disabled
   with explanation, email sign-up works, lands on dashboard.
2. Server running with Google credentials → “Continue with Google” completes OAuth and lands
   signed in with Free plan; `/api/auth/me` shows `googleLinked:true`.
3. Server stopped → welcome offers local mode; dashboard works; no dead network errors.
4. “Continue locally” is remembered; dashboard shows a sign-in affordance.
5. Sign out → welcome screen; unsaved changes are confirmed first.
6. No client secret or token reaches the browser; no fake Google flow.
7. `npx tsc --noEmit`, `npm run build`, `go test ./...`, `go vet ./...` clean.
