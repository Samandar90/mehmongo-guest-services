'use client';

import { Check, Share2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n/context';
import { LOCALE_PARAM, type Locale } from '@/lib/i18n/locale';

/** The room link with the current language on it, so it opens the same way on another device. */
export function savePageUrl(locale: Locale): string {
  const url = new URL(window.location.href);
  url.searchParams.set(LOCALE_PARAM, locale);
  return url.toString();
}

/**
 * The printed code stays on the wall of the room; this hands the guest the
 * link. On a phone it opens the system share sheet, so the guest sends it to
 * themselves in whatever they use. Where there is no sheet, the link is copied.
 */
export function SavePageButton({ title, variant = 'link' }: {
  title: string;
  variant?: 'link' | 'button';
}) {
  const { locale, t } = useI18n();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const save = async () => {
    const url = savePageUrl(locale);
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        // The guest closed the sheet: nothing to copy, nothing to announce.
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2400);
  };

  return (
    <button
      type="button"
      className={variant === 'button' ? 'save-page-button' : 'save-page-link'}
      onClick={() => { void save(); }}
    >
      {copied ? <Check aria-hidden="true" /> : <Share2 aria-hidden="true" />}
      <span>{copied ? t.common.linkCopied : t.common.savePage}</span>
      <span className="visually-hidden" aria-live="polite">{copied ? t.common.linkCopied : ''}</span>
    </button>
  );
}
