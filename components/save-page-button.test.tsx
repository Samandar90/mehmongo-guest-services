import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n/context';
import { SavePageButton } from './save-page-button';

/** jsdom has no share sheet; one is defined per test and removed again. */
function stubShare(share: ((data: ShareData) => Promise<void>) | undefined) {
  Object.defineProperty(window.navigator, 'share', { value: share, configurable: true, writable: true });
}

afterEach(() => {
  delete (window.navigator as { share?: unknown }).share;
});

describe('SavePageButton', () => {
  it('opens the share sheet with the room link in the current language', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubShare(share);
    window.history.replaceState(null, '', '/r/20000000-0000-4000-8000-000000000205');
    const user = userEvent.setup();
    render(
      <I18nProvider locale="ru" setLocale={() => {}}>
        <SavePageButton title="MehmonGo · Kamilovs Hotel" />
      </I18nProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Сохранить страницу' }));

    expect(share).toHaveBeenCalledWith({
      title: 'MehmonGo · Kamilovs Hotel',
      url: `${window.location.origin}/r/20000000-0000-4000-8000-000000000205?lang=ru`,
    });
  });

  it('copies the link where there is no share sheet and says so', async () => {
    stubShare(undefined);
    // user-event installs its own clipboard on setup; the spy goes on that one.
    const user = userEvent.setup();
    const writeText = vi.spyOn(window.navigator.clipboard, 'writeText');
    render(<SavePageButton title="MehmonGo" />);

    await user.click(screen.getByRole('button', { name: 'Save this page' }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('lang=en'));
    expect(await screen.findByRole('button', { name: /Link copied/ })).toBeInTheDocument();
  });

  it('stays quiet when the guest closes the sheet', async () => {
    stubShare(vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')));
    const user = userEvent.setup();
    const writeText = vi.spyOn(window.navigator.clipboard, 'writeText');
    render(<SavePageButton title="MehmonGo" />);

    await user.click(screen.getByRole('button', { name: 'Save this page' }));

    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save this page' })).toBeInTheDocument();
  });
});
