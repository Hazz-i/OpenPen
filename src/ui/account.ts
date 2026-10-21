import {
  getAuth,
  subscribeAuth,
  signOut,
  changePlan,
  formatBytes,
  quotaRemaining,
  type CloudUsage,
} from '../core/auth';
import { svgIcon } from './icons';
import { confirmDialog, toast } from './dialogs';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/auth.css';

export function renderUsageMeter(usage: CloudUsage | null | undefined): HTMLElement {
  const container = document.createElement('div');
  container.className = 'pen-usage-box';

  if (!usage) {
    container.innerHTML = `
      <div class="pen-usage-labels">
        <span style="color: var(--muted);">Cloud Storage</span>
        <span style="color: var(--faint);">Local only</span>
      </div>
    `;
    return container;
  }

  const isUnlimited = !usage.limitBytes || usage.limitBytes <= 0;
  const usedStr = formatBytes(usage.usedBytes);
  const limitStr = isUnlimited ? 'Unlimited' : formatBytes(usage.limitBytes);
  const pct = isUnlimited ? 0 : Math.min(100, Math.max(0, usage.percent || 0));
  const warnClass = pct >= 90 ? 'danger' : pct >= 75 ? 'warn' : '';

  container.innerHTML = `
    <div class="pen-usage-labels">
      <span style="color: var(--muted); font-weight: 500;">Storage</span>
      <span style="color: var(--fg-strong); font-weight: 600;">
        ${usedStr} / ${limitStr}
      </span>
    </div>
    ${
      !isUnlimited
        ? `
      <div class="pen-usage-bar">
        <div class="pen-usage-fill ${warnClass}" style="width: ${Math.max(2, pct)}%;"></div>
      </div>
    `
        : `
      <div style="font-size: 10px; color: var(--accent);">Pro Plan — No quota limits</div>
    `
    }
    <div style="display: flex; justify-content: space-between; font-size: 10px; color: var(--faint);">
      <span>${usage.fileCount || 0} files</span>
      <span>${usage.assetCount || 0} assets</span>
    </div>
  `;

  return container;
}

export function openQuotaDialog(usage: CloudUsage): { close(): void } {
  return openUpgradeDialog({
    reason: `You have reached ${Math.round(usage.percent || 100)}% of your cloud storage quota (${formatBytes(usage.usedBytes)} of ${formatBytes(usage.limitBytes)}). Upgrade to Pro for unlimited storage.`,
  });
}

export function openUpgradeDialog(opts?: { reason?: string }): { close(): void } {
  const auth = getAuth();
  const currentPlan = auth.user?.plan || 'free';

  const backdrop = document.createElement('div');
  backdrop.className = 'pen-modal-backdrop';

  function close() {
    unsubscribe();
    backdrop.remove();
  }

  function render() {
    const user = getAuth().user;
    const plan = user?.plan || 'free';

    backdrop.innerHTML = `
      <div class="pen-modal" style="width: 540px; padding: 24px;">
        <div class="pen-modal-header" style="padding: 0 0 12px 0;">
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <span class="pen-modal-title" style="font-size: 16px;">Cloud Storage Plans</span>
            <span style="font-size: 11px; color: var(--muted);">Sync and store designs across all your devices.</span>
          </div>
          <button class="pen-icon-btn" id="btn-close-upgrade">${svgIcon('minus', 14)}</button>
        </div>

        ${
          opts?.reason
            ? `
          <div class="pen-auth-error" style="margin-top: 10px;">
            <span style="flex-shrink: 0;">${svgIcon('alert-triangle', 14)}</span>
            <span>${opts.reason}</span>
          </div>
        `
            : ''
        }

        <div class="pen-plans-grid">
          <!-- Free Plan -->
          <div class="pen-plan-card ${plan === 'free' ? 'featured' : ''}">
            <div class="pen-plan-card-header">
              <span class="pen-plan-card-title">Free</span>
              <span style="font-size: 11px; color: var(--muted);">Essential cloud workspace</span>
              <div class="pen-plan-price">$0 <span>/ forever</span></div>
            </div>

            <ul class="pen-plan-features">
              <li>${svgIcon('check', 13)} 5 GB Cloud storage</li>
              <li>${svgIcon('check', 13)} Unlimited local files</li>
              <li>${svgIcon('check', 13)} Offline agent & templates</li>
              <li>${svgIcon('check', 13)} Canvas 2D engine</li>
            </ul>

            <button
              class="pen-btn-secondary"
              id="btn-select-free"
              style="width: 100%; height: 32px; font-size: 12px;"
              ${plan === 'free' ? 'disabled' : ''}
            >
              ${plan === 'free' ? 'Current Plan' : 'Downgrade to Free'}
            </button>
          </div>

          <!-- Pro Plan -->
          <div class="pen-plan-card ${plan === 'pro' ? 'featured' : ''}" style="border-color: var(--accent);">
            <div class="pen-plan-card-header">
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <span class="pen-plan-card-title" style="color: var(--accent);">Pro</span>
                <span class="pen-plan-badge pro">Recommended</span>
              </div>
              <span style="font-size: 11px; color: var(--muted);">For intensive design workflows</span>
              <div class="pen-plan-price">$12 <span>/ month (Demo)</span></div>
            </div>

            <ul class="pen-plan-features">
              <li>${svgIcon('check', 13)} <strong>Unlimited</strong> Cloud storage</li>
              <li>${svgIcon('check', 13)} High-res image assets</li>
              <li>${svgIcon('check', 13)} Multi-device live sync</li>
              <li>${svgIcon('check', 13)} Priority component library</li>
            </ul>

            <button
              class="pen-btn-primary"
              id="btn-select-pro"
              style="width: 100%; height: 32px; font-size: 12px; background: var(--accent); color: #fff;"
              ${plan === 'pro' ? 'disabled' : ''}
            >
              ${plan === 'pro' ? 'Current Plan' : 'Upgrade (demo — no payment)'}
            </button>
          </div>
        </div>

        <div style="margin-top: 16px; padding: 10px; background: rgba(255, 255, 255, 0.02); border-radius: var(--radius-sm); border: 1px solid var(--border); font-size: 11px; color: var(--faint); text-align: center;">
          Demo billing — no actual charges or payment card required. Clicking upgrade instantly provisions unlimited storage.
        </div>
      </div>
    `;

    bindEvents();
  }

  function bindEvents() {
    backdrop.querySelector('#btn-close-upgrade')?.addEventListener('click', close);

    backdrop.querySelector('#btn-select-pro')?.addEventListener('click', async () => {
      try {
        await changePlan('pro');
        toast('Upgraded to Pro plan! Unlimited storage unlocked.', 'success');
        render();
      } catch (err) {
        toast((err as Error).message || 'Failed to update plan', 'error');
      }
    });

    backdrop.querySelector('#btn-select-free')?.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Downgrade to Free',
        message: 'Downgrading will set your storage quota to 5 GB. Continue?',
        confirmLabel: 'Downgrade',
      });
      if (ok) {
        try {
          await changePlan('free');
          toast('Plan changed to Free (5 GB).', 'info');
          render();
        } catch (err) {
          toast((err as Error).message || 'Failed to change plan', 'error');
        }
      }
    });
  }

  const unsubscribe = subscribeAuth(() => render());

  render();
  document.body.appendChild(backdrop);

  return { close };
}

export function openAccountMenu(anchor?: HTMLElement): void {
  // Dismiss any existing popovers
  document.querySelectorAll('.pen-account-popover').forEach((el) => el.remove());

  const auth = getAuth();
  const popover = document.createElement('div');
  popover.className = 'pen-account-popover';

  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    popover.style.top = `${rect.bottom + 6}px`;
    popover.style.right = `${window.innerWidth - rect.right}px`;
  } else {
    popover.style.top = '48px';
    popover.style.right = '16px';
  }

  function render() {
    const state = getAuth();
    if (!state.user) {
      // Signed-out state
      popover.innerHTML = `
        <div class="pen-account-header">
          <span class="pen-account-name">Not Signed In</span>
          <span class="pen-account-email">Working in local browser storage</span>
        </div>
        <div style="padding: 6px;">
          <div class="pen-menu-item" id="btn-popover-signin">
            <span>Sign in to sync</span>
            ${svgIcon('arrow-up', 12, 2)}
          </div>
          <div class="pen-menu-item" id="btn-popover-settings">
            <span>Settings</span>
            ${svgIcon('settings', 12)}
          </div>
        </div>
      `;

      popover.querySelector('#btn-popover-signin')?.addEventListener('click', () => {
        popover.remove();
        window.dispatchEvent(new CustomEvent('penclone:open-auth'));
      });
      popover.querySelector('#btn-popover-settings')?.addEventListener('click', () => {
        popover.remove();
        window.dispatchEvent(new CustomEvent('penclone:open-settings'));
      });
      return;
    }

    const user = state.user;
    const planClass = user.plan === 'pro' ? 'pro' : 'free';

    popover.innerHTML = `
      <div class="pen-account-header">
        <div class="pen-account-name-row">
          <span class="pen-account-name">${user.name || user.email}</span>
          <span class="pen-plan-badge ${planClass}">${user.plan}</span>
        </div>
        <span class="pen-account-email">${user.email}</span>
      </div>

      <div id="popover-usage-slot"></div>

      <div style="padding: 4px; display: flex; flex-direction: column; gap: 1px;">
        <div class="pen-menu-item" id="btn-popover-plan">
          <span>Manage Plan & Quota</span>
          ${svgIcon('sparkles', 12)}
        </div>
        <div class="pen-menu-item" id="btn-popover-settings">
          <span>Preferences...</span>
          ${svgIcon('settings', 12)}
        </div>
        <div class="pen-menu-separator"></div>
        <div class="pen-menu-item danger" id="btn-popover-signout">
          <span>Sign out</span>
          ${svgIcon('trash', 12)}
        </div>
      </div>
    `;

    const usageSlot = popover.querySelector('#popover-usage-slot');
    if (usageSlot) {
      usageSlot.appendChild(renderUsageMeter(state.usage));
    }

    popover.querySelector('#btn-popover-plan')?.addEventListener('click', () => {
      popover.remove();
      openUpgradeDialog();
    });

    popover.querySelector('#btn-popover-settings')?.addEventListener('click', () => {
      popover.remove();
      window.dispatchEvent(new CustomEvent('penclone:open-settings'));
    });

    popover.querySelector('#btn-popover-signout')?.addEventListener('click', async () => {
      popover.remove();
      const ok = await confirmDialog({
        title: 'Sign Out',
        message: 'Sign out of your cloud account? Local files will remain available.',
        confirmLabel: 'Sign Out',
      });
      if (ok) {
        await signOut();
        toast('Signed out successfully', 'info');
      }
    });
  }

  const onWindowClick = (e: MouseEvent) => {
    if (!popover.contains(e.target as Node) && (!anchor || !anchor.contains(e.target as Node))) {
      popover.remove();
      window.removeEventListener('pointerdown', onWindowClick);
    }
  };

  setTimeout(() => window.addEventListener('pointerdown', onWindowClick), 10);

  render();
  document.body.appendChild(popover);
}
