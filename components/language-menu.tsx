'use client';

import { Check, Globe } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { localeCookie, localeInfo, locales, LOCALE_PARAM, type Locale } from '@/lib/i18n/locale';
import { messages } from '@/lib/i18n/messages';

/**
 * The language pill in the guest header and the menu it opens.
 *
 * Every language is written in itself, because a guest looking for their own
 * language scans for the word they know, and in English underneath, because
 * the person helping them at reception may not read it. The stored choice is
 * the guest's, so it is kept in a cookie for a year rather than for one visit.
 */
export function LanguageMenu({ locale, onChange }: {
  locale: Locale;
  onChange: (locale: Locale) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const t = messages[locale].language;
  const current = localeInfo[locale];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Focus lands on the language already in use, so an arrow key moves from
  // a known place and Enter with no change closes the menu harmlessly.
  useEffect(() => {
    if (open) itemRefs.current[locales.indexOf(locale)]?.focus();
  }, [open, locale]);

  const choose = (next: Locale) => {
    setOpen(false);
    buttonRef.current?.focus();
    if (next !== locale) onChange(next);
  };

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null);
    const index = items.findIndex((item) => item === document.activeElement);
    const moveTo = (target: number) => {
      event.preventDefault();
      items[(target + items.length) % items.length]?.focus();
    };
    if (event.key === 'ArrowDown') moveTo(index + 1);
    else if (event.key === 'ArrowUp') moveTo(index - 1);
    else if (event.key === 'Home') moveTo(0);
    else if (event.key === 'End') moveTo(items.length - 1);
    else if (event.key === 'Tab') setOpen(false);
  };

  return (
    <div className="language-menu" ref={rootRef}>
      <button
        type="button"
        className="language-pill"
        ref={buttonRef}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${t.button}: ${current.native}`}
        onClick={() => setOpen((value) => !value)}
      >
        <Globe aria-hidden="true" />
        <span>{current.code}</span>
      </button>

      {open ? (
        <div className="language-popover" id={menuId} role="menu" aria-label={t.title} tabIndex={-1} onKeyDown={onMenuKeyDown}>
          <p className="language-popover-title" aria-hidden="true">{t.title}</p>
          {locales.map((entry, index) => {
            const info = localeInfo[entry];
            const selected = entry === locale;
            return (
              <button
                key={entry}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className="language-option"
                lang={info.tag}
                tabIndex={selected ? 0 : -1}
                ref={(element) => { itemRefs.current[index] = element; }}
                onClick={() => choose(entry)}
              >
                <span className="language-option-code" aria-hidden="true">{info.code}</span>
                <span className="language-option-names">
                  <strong>{info.native}</strong>
                  {info.native !== info.english ? <small lang="en">{info.english}</small> : null}
                </span>
                {selected ? <Check className="language-option-check" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** Remembers the choice in the cookie the server reads on the next request. */
export function rememberLocale(locale: Locale) {
  document.cookie = localeCookie(locale, window.location.protocol === 'https:');
}

/**
 * For the screens with nothing to keep — the site root and a dead room code —
 * a choice is stored and the page is fetched again in that language. Changing
 * the query only when the link already carried one keeps a plain room link
 * plain, and lets a ?lang= the owner sent follow the guest's choice.
 */
export function NoticeLanguageMenu({ locale }: { locale: Locale }) {
  return (
    <LanguageMenu
      locale={locale}
      onChange={(next) => {
        rememberLocale(next);
        const url = new URL(window.location.href);
        if (url.searchParams.has(LOCALE_PARAM)) url.searchParams.set(LOCALE_PARAM, next);
        window.location.assign(url.toString());
      }}
    />
  );
}
