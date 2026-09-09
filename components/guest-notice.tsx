import type { ReactNode } from 'react';
import { BrandLockup } from '@/components/brand-lockup';
import { NoticeLanguageMenu } from '@/components/language-menu';
import { defaultLocale, localeInfo, type Locale } from '@/lib/i18n/locale';

/**
 * The screen a guest sees when there is nothing to order: a room QR that is no
 * longer active, or the site root opened without a room link. A guest reaches
 * these from a printed code in a hotel room, so the page keeps the brand and
 * says what to do next instead of leaving one unstyled sentence on a blank page.
 */
export function GuestNotice({
  eyebrow,
  title,
  locale = defaultLocale,
  children,
}: {
  eyebrow: string;
  title: string;
  /** The language the caller wrote the notice in; the switcher reloads in another. */
  locale?: Locale;
  children?: ReactNode;
}) {
  return (
    <main className="guest-shell" lang={localeInfo[locale].tag}>
      <header className="site-header">
        <BrandLockup />
        <NoticeLanguageMenu locale={locale} />
      </header>
      <section className="welcome-panel notice-panel">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <div className="intro">{children}</div>
      </section>
    </main>
  );
}
