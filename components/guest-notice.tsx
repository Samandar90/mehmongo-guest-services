import type { ReactNode } from 'react';
import { BrandLockup } from '@/components/brand-lockup';

/**
 * The screen a guest sees when there is nothing to order: a room QR that is no
 * longer active, or the site root opened without a room link. A guest reaches
 * these from a printed code in a hotel room, so the page keeps the brand and
 * says what to do next instead of leaving one unstyled sentence on a blank page.
 */
export function GuestNotice({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <main className="guest-shell">
      <header className="site-header">
        <BrandLockup />
      </header>
      <section className="welcome-panel notice-panel">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <div className="intro">{children}</div>
      </section>
    </main>
  );
}
