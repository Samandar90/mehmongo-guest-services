import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INSTALL_PROMPT_KEY, installBootstrap, installBootstrapScript } from './install-script';

const register = vi.fn().mockResolvedValue(undefined);
let teardown = () => undefined as void;

function storedPrompt(): Event | null | undefined {
  return (window as unknown as Record<string, Event | null | undefined>)[INSTALL_PROMPT_KEY];
}

beforeEach(() => {
  register.mockClear();
  Object.defineProperty(window.navigator, 'serviceWorker', { value: { register }, configurable: true });
  delete (window as unknown as Record<string, unknown>)[INSTALL_PROMPT_KEY];
  // Each test gets a fresh page as far as the bootstrap is concerned.
  delete (window as unknown as Record<string, unknown>)['__mehmongoInstallBootstrapped'];
});

afterEach(() => {
  teardown();
  delete (window as unknown as Record<string, unknown>)[INSTALL_PROMPT_KEY];
});

describe('installBootstrap', () => {
  it('registers the worker for the admin alone, so a guest page is untouched', () => {
    teardown = installBootstrap();

    // Not '/admin/': the dashboard itself lives at /admin exactly, and a
    // trailing slash would leave that one page uncontrolled.
    expect(register).toHaveBeenCalledWith('/admin-sw.js', { scope: '/admin' });
  });

  it('keeps the prompt instead of letting the browser show its own bar', () => {
    teardown = installBootstrap();
    const event = new Event('beforeinstallprompt', { cancelable: true });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(storedPrompt()).toBe(event);
  });

  it('announces the prompt so a button mounted later still finds it', () => {
    teardown = installBootstrap();
    const heard = vi.fn();
    window.addEventListener('mehmongo:installable', heard);

    window.dispatchEvent(new Event('beforeinstallprompt', { cancelable: true }));

    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener('mehmongo:installable', heard);
  });

  it('drops the stale prompt once the app is installed', () => {
    teardown = installBootstrap();
    window.dispatchEvent(new Event('beforeinstallprompt', { cancelable: true }));

    window.dispatchEvent(new Event('appinstalled'));

    expect(storedPrompt()).toBeNull();
  });

  it('survives a browser with no service worker support', () => {
    // An old browser has no such property at all, which is what the guard tests.
    delete (window.navigator as { serviceWorker?: unknown }).serviceWorker;

    expect(() => { teardown = installBootstrap(); }).not.toThrow();
    expect(register).not.toHaveBeenCalled();
  });

  it('ignores a second run, so no prompt is announced twice', () => {
    teardown = installBootstrap();
    // The second run is guarded and hands back a no-op, so the teardown that
    // actually detaches the listeners is the first one.
    installBootstrap();
    const heard = vi.fn();
    window.addEventListener('mehmongo:installable', heard);

    window.dispatchEvent(new Event('beforeinstallprompt', { cancelable: true }));

    expect(heard).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledTimes(1);
    window.removeEventListener('mehmongo:installable', heard);
  });
});

describe('installBootstrapScript', () => {
  it('is the same function, serialised and called', () => {
    expect(installBootstrapScript.startsWith('(function')).toBe(true);
    expect(installBootstrapScript.endsWith(')();')).toBe(true);
    expect(installBootstrapScript).toContain('/admin-sw.js');
    // The key the button reads must survive into the inlined copy; a module
    // constant would not, which is why the function spells it out.
    expect(installBootstrapScript).toContain(INSTALL_PROMPT_KEY);
  });

  it('carries nothing that would close the script element it is inlined in', () => {
    expect(installBootstrapScript).not.toContain('</script');
  });
});
