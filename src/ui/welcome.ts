import {
  signIn,
  signUp,
  signInLocal,
  signUpLocal,
  AuthError,
} from '../core/auth';
import { svgIcon } from './icons';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/auth.css';

export interface WelcomeOptions {
  online: boolean;
  googleEnabled: boolean;
  onAuthenticated(): void | Promise<void>;
  onContinueLocal(): void;
}

export function googleIconSvg(): string {
  return `<svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
  </svg>`;
}

export function mapAuthErrorCode(code: string): string {
  switch (code) {
    case 'google_unavailable':
      return 'Google sign-in is currently unavailable or unconfigured.';
    case 'invalid_state':
      return 'Authentication session expired or invalid state. Please try again.';
    case 'access_denied':
      return 'Google access was denied or cancelled.';
    case 'email_unverified':
      return 'The Google email account is unverified.';
    case 'exchange_failed':
      return 'Failed to exchange authorization token with Google.';
    case 'google_not_configured':
      return 'Google OAuth credentials are not set on the server.';
    default:
      return 'Authentication could not be completed. Please try again.';
  }
}

export function mountWelcome(
  root: HTMLElement,
  opts: WelcomeOptions
): { destroy(): void } {
  let isSignUp = false;
  let loading = false;
  let globalError = '';
  let fieldErrors: { email?: string; password?: string; name?: string } = {};

  // Check ?authError= from URL on mount
  try {
    const url = new URL(window.location.href);
    const errCode = url.searchParams.get('authError');
    if (errCode) {
      globalError = mapAuthErrorCode(errCode);
      url.searchParams.delete('authError');
      window.history.replaceState({}, document.title, url.pathname + (url.search ? url.search : ''));
    }
  } catch {
    // Ignore URL parse error
  }

  const screen = document.createElement('div');
  screen.className = 'pen-welcome-screen';

  function render() {
    screen.innerHTML = `
      <div class="pen-welcome-brand">
        <span style="color: #ffffff;">${svgIcon('pen', 20, 2)}</span>
        <span>pen.dev</span>
      </div>

      <div class="pen-welcome-card">
        <div class="pen-welcome-header">
          <h1 class="pen-welcome-title">Design anything.</h1>
          <p class="pen-welcome-subtitle">Sign in to sync your work across devices.</p>
        </div>

        ${
          !opts.online
            ? `
          <div class="pen-offline-banner">
            <span>${svgIcon('alert-triangle', 15)}</span>
            <span>Cloud unavailable. Email login will store an account locally in this browser.</span>
          </div>
        `
            : ''
        }

        ${
          globalError
            ? `
          <div class="pen-auth-error">
            <span style="flex-shrink: 0;">${svgIcon('alert-triangle', 15)}</span>
            <span>${globalError}</span>
          </div>
        `
            : ''
        }

        <!-- Google button -->
        <button
          type="button"
          class="pen-btn-google"
          id="btn-google-auth"
          ${!opts.online || !opts.googleEnabled ? 'disabled' : ''}
          title="${
            !opts.online
              ? 'Unavailable in offline mode'
              : !opts.googleEnabled
              ? 'Google Sign-In is not configured on this server'
              : 'Sign in with your Google account'
          }"
        >
          ${googleIconSvg()}
          <span>Continue with Google</span>
        </button>

        <div class="pen-auth-divider">
          <span>or with email</span>
        </div>

        <!-- Email form (always enabled even if offline) -->
        <form class="pen-auth-form" id="welcome-auth-form" novalidate>
          ${
            isSignUp
              ? `
            <div class="pen-form-group">
              <label class="pen-form-label" for="auth-name">Your Name</label>
              <input
                type="text"
                id="auth-name"
                class="pen-form-input ${fieldErrors.name ? 'has-error' : ''}"
                placeholder="Jane Doe"
                autocomplete="name"
                required
                ${loading ? 'disabled' : ''}
              />
              ${fieldErrors.name ? `<span class="pen-field-error">${fieldErrors.name}</span>` : ''}
            </div>
          `
              : ''
          }

          <div class="pen-form-group">
            <label class="pen-form-label" for="auth-email">Email Address</label>
            <input
              type="email"
              id="auth-email"
              class="pen-form-input ${fieldErrors.email ? 'has-error' : ''}"
              placeholder="name@example.com"
              autocomplete="email"
              required
              ${loading ? 'disabled' : ''}
            />
            ${fieldErrors.email ? `<span class="pen-field-error">${fieldErrors.email}</span>` : ''}
          </div>

          <div class="pen-form-group">
            <label class="pen-form-label" for="auth-password">Password</label>
            <input
              type="password"
              id="auth-password"
              class="pen-form-input ${fieldErrors.password ? 'has-error' : ''}"
              placeholder="${isSignUp ? 'At least 8 characters' : 'Enter your password'}"
              autocomplete="${isSignUp ? 'new-password' : 'current-password'}"
              required
              ${loading ? 'disabled' : ''}
            />
            ${fieldErrors.password ? `<span class="pen-field-error">${fieldErrors.password}</span>` : ''}
          </div>

          <button
            type="submit"
            class="pen-btn-auth-submit"
            id="btn-email-submit"
            ${loading ? 'disabled' : ''}
          >
            ${loading ? '<div class="pen-submit-spinner"></div>' : ''}
            <span>${loading ? 'Connecting...' : isSignUp ? 'Create account' : 'Sign in'}</span>
            ${loading ? '' : svgIcon('arrow-up', 14, 2)}
          </button>
        </form>

        <div class="pen-auth-footer">
          <div class="pen-auth-switch">
            <span>${isSignUp ? 'Already have an account?' : "Don't have an account?"}</span>
            <span class="pen-auth-link" id="btn-toggle-mode">
              ${isSignUp ? 'Sign in' : 'Create account'}
            </span>
          </div>

          <div class="pen-local-escape">
            <button type="button" class="pen-btn-local" id="btn-continue-local">
              Continue locally
            </button>
            <span class="pen-local-caption">
              No cloud sync. Files stay in this browser.
            </span>
          </div>
        </div>
      </div>
    `;

    bindEvents();
  }

  function bindEvents() {
    screen.querySelector('#btn-toggle-mode')?.addEventListener('click', () => {
      isSignUp = !isSignUp;
      globalError = '';
      fieldErrors = {};
      render();
    });

    screen.querySelector('#btn-google-auth')?.addEventListener('click', () => {
      if (!opts.online || !opts.googleEnabled) return;
      window.location.href = '/api/auth/google/start?redirect=' + encodeURIComponent('/');
    });

    screen.querySelector('#btn-continue-local')?.addEventListener('click', () => {
      opts.onContinueLocal();
    });

    const form = screen.querySelector('#welcome-auth-form') as HTMLFormElement;
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (loading) return;

      const emailInput = screen.querySelector('#auth-email') as HTMLInputElement;
      const passInput = screen.querySelector('#auth-password') as HTMLInputElement;
      const nameInput = screen.querySelector('#auth-name') as HTMLInputElement | null;

      const email = emailInput?.value.trim() || '';
      const password = passInput?.value || '';
      const name = nameInput ? nameInput.value.trim() : '';

      fieldErrors = {};
      let hasError = false;

      if (!email || !email.includes('@')) {
        fieldErrors.email = 'Please enter a valid email address.';
        hasError = true;
      }

      if (password.length < 8) {
        fieldErrors.password = 'Password must be at least 8 characters.';
        hasError = true;
      }

      if (isSignUp && !name) {
        fieldErrors.name = 'Please enter your name.';
        hasError = true;
      }

      if (hasError) {
        globalError = '';
        render();
        return;
      }

      loading = true;
      globalError = '';
      render();

      try {
        if (!opts.online) {
          // Offline mode -> Use local WebCrypto account
          if (isSignUp) {
            await signUpLocal(email, password, name);
          } else {
            await signInLocal(email, password);
          }
        } else {
          // Online mode -> Use server
          try {
            if (isSignUp) {
              await signUp(email, password, name);
            } else {
              await signIn(email, password);
            }
          } catch (serverErr) {
            // If server error was connection failure, offer or fallback to local
            if (serverErr instanceof AuthError && serverErr.status === 0) {
              if (isSignUp) {
                await signUpLocal(email, password, name);
              } else {
                await signInLocal(email, password);
              }
            } else {
              throw serverErr;
            }
          }
        }
        await opts.onAuthenticated();
      } catch (err) {
        loading = false;
        if (err instanceof AuthError) {
          globalError = err.message;
        } else {
          globalError = (err as Error).message || 'Authentication failed. Please check credentials.';
        }
        render();
      }
    });
  }

  render();
  root.appendChild(screen);

  return {
    destroy() {
      screen.remove();
    },
  };
}
