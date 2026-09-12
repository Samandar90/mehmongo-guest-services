import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallApp } from './install-app';
import { INSTALL_PROMPT_KEY } from '@/lib/admin/install-script';

function stubMatchMedia(standalone: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches: standalone,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function stubUserAgent(userAgent: string, maxTouchPoints = 0) {
  Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });
  Object.defineProperty(window.navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
}

/** What the bootstrap script leaves on window once the browser offers to install. */
function browserOffersInstall() {
  const event = new Event('beforeinstallprompt') as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: 'accepted' }>;
  };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome: 'accepted' as const });
  (window as unknown as Record<string, unknown>)[INSTALL_PROMPT_KEY] = event;
  window.dispatchEvent(new Event('mehmongo:installable'));
  return event;
}

beforeEach(() => {
  delete (window as unknown as Record<string, unknown>)[INSTALL_PROMPT_KEY];
  stubMatchMedia(false);
  stubUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0');
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>)[INSTALL_PROMPT_KEY];
});

describe('InstallApp', () => {
  it('offers nothing until the browser says it can install', () => {
    render(<InstallApp />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('picks up a prompt the bootstrap script caught before React mounted', () => {
    browserOffersInstall();
    render(<InstallApp />);

    expect(screen.getByRole('button', { name: 'Установить приложение' })).toBeInTheDocument();
  });

  it('appears when the browser offers later, and installs on click', async () => {
    const user = userEvent.setup();
    render(<InstallApp />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    const event = browserOffersInstall();

    const button = await screen.findByRole('button', { name: 'Установить приложение' });
    await user.click(button);

    expect(event.prompt).toHaveBeenCalledTimes(1);
    // The event fires once: a second tap must not be possible.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Установить приложение' })).not.toBeInTheDocument());
  });

  it('stops offering once the app is installed', async () => {
    browserOffersInstall();
    render(<InstallApp />);
    await screen.findByRole('button', { name: 'Установить приложение' });

    // What the bootstrap script does on appinstalled.
    (window as unknown as Record<string, unknown>)[INSTALL_PROMPT_KEY] = null;
    window.dispatchEvent(new Event('appinstalled'));

    await waitFor(() => expect(screen.queryByRole('button')).not.toBeInTheDocument());
  });

  it('says nothing when the admin already runs as an app', () => {
    stubMatchMedia(true);
    browserOffersInstall();
    render(<InstallApp />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('tells an iPhone where its own button is, since Safari offers no prompt', async () => {
    const user = userEvent.setup();
    stubUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1');
    render(<InstallApp />);

    await user.click(screen.getByRole('button', { name: 'Установить' }));

    expect(screen.getByRole('status')).toHaveTextContent('«Поделиться»');
    expect(screen.getByRole('status')).toHaveTextContent('На экран „Домой“');
  });

  it('treats an iPad reporting itself as a Mac as an iPad', () => {
    stubUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1', 5);
    render(<InstallApp />);

    expect(screen.getByRole('button', { name: 'Установить' })).toBeInTheDocument();
  });
});
