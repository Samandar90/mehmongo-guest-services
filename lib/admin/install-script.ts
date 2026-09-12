/** Where the captured prompt waits for the button to mount and collect it. */
export const INSTALL_PROMPT_KEY = '__mehmongoInstallPrompt';

type PromptHolder = Record<string, Event | null>;

/**
 * The two things that cannot wait for React on an /admin page:
 *
 * - Registering the service worker. The install button sits in the admin
 *   navigation, which only appears once the identity check passes; the worker
 *   has no reason to wait for that, and Chrome wants it registered before it
 *   will consider the page installable at all.
 * - Catching beforeinstallprompt. Chrome fires it once, early, and a listener
 *   attached later simply never hears it — which is how an install button ends
 *   up never appearing. Caught here, it waits on window for the button, which
 *   is told about it by the event this dispatches.
 *
 * Written as a real function so it is type-checked and can be run in a test,
 * then serialised below to be inlined in the page. Everything it touches is a
 * global or a string literal, so nothing here depends on module scope
 * surviving into the browser.
 */
/**
 * @returns a teardown that detaches the listeners again. The page never calls
 * it — a page load is the only lifetime this has — but a test needs to leave
 * the window as it found it.
 */
export function installBootstrap(): () => void {
  // Runs once per page load. The guard is cheap insurance against the script
  // being inlined twice: a second set of listeners would announce every prompt
  // twice over.
  const guard = window as unknown as Record<string, boolean>;
  if (guard['__mehmongoInstallBootstrapped']) return () => undefined;
  guard['__mehmongoInstallBootstrapped'] = true;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/admin-sw.js', { scope: '/admin' }).catch(() => undefined);
  }

  const onPrompt = (event: Event) => {
    event.preventDefault();
    (window as unknown as PromptHolder)['__mehmongoInstallPrompt'] = event;
    window.dispatchEvent(new Event('mehmongo:installable'));
  };
  const onInstalled = () => {
    (window as unknown as PromptHolder)['__mehmongoInstallPrompt'] = null;
  };

  window.addEventListener('beforeinstallprompt', onPrompt);
  window.addEventListener('appinstalled', onInstalled);

  return () => {
    window.removeEventListener('beforeinstallprompt', onPrompt);
    window.removeEventListener('appinstalled', onInstalled);
    guard['__mehmongoInstallBootstrapped'] = false;
  };
}

/**
 * The same function, ready to inline in the document so it runs while the HTML
 * is still parsing rather than whenever a chunk happens to load.
 */
export const installBootstrapScript = `(${installBootstrap.toString()})();`;
