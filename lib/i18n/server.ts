import { cookies, headers } from 'next/headers';
import { LOCALE_COOKIE, LOCALE_PARAM, resolveLocale, type Locale } from './locale';

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The language to render a guest page in, decided on the server so the first
 * paint is already in it and the client starts from the same value. A ?lang=
 * on the link wins, then the cookie of an earlier choice, then the browser.
 */
export async function pageLocale(searchParams?: SearchParams | Promise<SearchParams>): Promise<Locale> {
  const [params, cookieStore, headerStore] = await Promise.all([
    Promise.resolve(searchParams ?? {}),
    cookies(),
    headers(),
  ]);
  return resolveLocale({
    param: params[LOCALE_PARAM],
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get('accept-language'),
  });
}
