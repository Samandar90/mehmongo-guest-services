import { GUEST_LOCALES, type GuestLocale } from '../../supabase/functions/_shared/contracts';

/**
 * The languages the guest site speaks. English is the fallback: the room
 * plaques, the older links and every request written before the switch
 * all assume it. The list itself lives in the contracts the server checks.
 */
export const locales = GUEST_LOCALES;
export type Locale = GuestLocale;

export const defaultLocale: Locale = 'en';

/** Cookie that remembers the guest's choice between visits. */
export const LOCALE_COOKIE = 'mg_lang';
export const LOCALE_PARAM = 'lang';

/** A year: a guest who picks Chinese on arrival should not pick it again at breakfast. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type LocaleInfo = {
  /** Two letters shown in the header pill. */
  code: string;
  /** The language in itself: what its own speakers scan for. */
  native: string;
  /** The same in English, for everyone else. */
  english: string;
  /** BCP 47 tag for the <html lang> attribute. */
  tag: string;
};

export const localeInfo: Record<Locale, LocaleInfo> = {
  en: { code: 'EN', native: 'English', english: 'English', tag: 'en' },
  ru: { code: 'RU', native: 'Русский', english: 'Russian', tag: 'ru' },
  uz: { code: 'UZ', native: 'Oʻzbekcha', english: 'Uzbek', tag: 'uz-Latn' },
  // zh-Hans, not zh: browsers pick Simplified rather than Japanese glyph
  // forms for the shared Han characters when the script is spelled out.
  zh: { code: 'ZH', native: '中文', english: 'Chinese', tag: 'zh-Hans' },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

/**
 * Which language to render, in order of how deliberate each signal is: a
 * ?lang= in the link the guest opened, the cookie from an earlier choice,
 * then English.
 *
 * A scanned plaque always opens in English, whatever the phone is set to.
 * The owner's decision, on 2026-09-12: a hotel wants one predictable first
 * screen, and a phone's language is a poor guess at the language its owner
 * reads. The guest changes it once from the header and the cookie remembers.
 */
export function resolveLocale(input: {
  param?: string | string[] | null;
  cookie?: string | null;
}): Locale {
  const param = Array.isArray(input.param) ? input.param[0] : input.param;
  if (isLocale(param)) return param;
  if (isLocale(input.cookie)) return input.cookie;
  return defaultLocale;
}

/** Serialised Set-Cookie value for document.cookie. */
export function localeCookie(locale: Locale, secure: boolean): string {
  return `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${secure ? '; Secure' : ''}`;
}
