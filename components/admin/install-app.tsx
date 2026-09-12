'use client';

import { useState, useSyncExternalStore } from 'react';
import { INSTALL_PROMPT_KEY } from '@/lib/admin/install-script';

/** What Chrome hands over in beforeinstallprompt. Not in lib.dom yet. */
type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

/** Already running as an app: Chrome reports the display mode, iOS its own flag. */
function isInstalled(): boolean {
  const standalone = (window.navigator as { standalone?: boolean }).standalone === true;
  // Optional call on purpose: this runs during render, and an environment
  // without matchMedia must not take the whole admin shell down with it.
  return standalone || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/**
 * iPhone and iPad. Safari never fires beforeinstallprompt and offers no API,
 * so the only thing left is to say where its own button is.
 */
function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; a touch screen is what gives it away.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

type Platform = 'server' | 'installed' | 'ios' | 'other';

/**
 * The platform does not change while the page is open, so this store has
 * nothing to subscribe to. It exists so the browser can be read during render
 * without an effect that sets state, and so the server gets a snapshot of its
 * own — which is what keeps hydration honest.
 */
const noSubscribe = () => () => undefined;
const clientPlatform = (): Platform => (isInstalled() ? 'installed' : isIos() ? 'ios' : 'other');
const serverPlatform = (): Platform => 'server';

/**
 * The prompt the bootstrap script caught before React was running. Read the
 * same way, for the same reason.
 */
function subscribeToPrompt(onChange: () => void): () => void {
  window.addEventListener('mehmongo:installable', onChange);
  window.addEventListener('appinstalled', onChange);
  return () => {
    window.removeEventListener('mehmongo:installable', onChange);
    window.removeEventListener('appinstalled', onChange);
  };
}

// Returns the same object, or null, so React sees a stable snapshot.
const readPrompt = (): InstallPrompt | null =>
  (window as unknown as Record<string, InstallPrompt | null>)[INSTALL_PROMPT_KEY] ?? null;
const noPrompt = (): InstallPrompt | null => null;

/**
 * Offers to install the admin as an app, using the prompt the browser handed
 * over. It shows nothing once installed, and nothing on a browser that cannot
 * install — an offer that does nothing when tapped is worse than no offer.
 *
 * The service worker and the prompt itself are handled by the bootstrap script
 * in the admin layout, which runs before this component exists.
 */
export function InstallApp() {
  const platform = useSyncExternalStore(noSubscribe, clientPlatform, serverPlatform);
  const prompt = useSyncExternalStore(subscribeToPrompt, readPrompt, noPrompt);
  const [spent, setSpent] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  if (platform === 'server' || platform === 'installed') return null;

  if (prompt && !spent) {
    const install = async () => {
      // The event fires once; mark it spent first so a second tap cannot ask
      // for a prompt that is already used up.
      setSpent(true);
      try {
        await prompt.prompt();
        await prompt.userChoice;
      } catch {
        // The browser withdrew the prompt; its own menu item still installs.
      }
    };

    return (
      <span className="admin-install">
        <button type="button" className="admin-install-button" onClick={() => { void install(); }}>
          Установить приложение
        </button>
      </span>
    );
  }

  if (platform === 'ios') {
    return (
      <span className="admin-install">
        <button type="button" className="admin-install-button" aria-expanded={showHelp} onClick={() => setShowHelp((open) => !open)}>
          Установить
        </button>
        {showHelp ? (
          <output className="admin-install-help">
            Нажмите «Поделиться» внизу экрана, затем «На экран „Домой“».
          </output>
        ) : null}
      </span>
    );
  }

  return null;
}
