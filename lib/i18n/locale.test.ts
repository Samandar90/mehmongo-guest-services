import { describe, expect, it } from 'vitest';
import { isLocale, localeCookie, localeFromAcceptLanguage, localeInfo, locales, resolveLocale } from './locale';

describe('locale', () => {
  it('knows exactly the four guest languages', () => {
    expect(locales).toEqual(['en', 'ru', 'uz', 'zh']);
    expect(isLocale('ru')).toBe(true);
    expect(isLocale('de')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it('names every language in itself and in English', () => {
    for (const locale of locales) {
      expect(localeInfo[locale].native).not.toBe('');
      expect(localeInfo[locale].english).not.toBe('');
      expect(localeInfo[locale].code).toHaveLength(2);
    }
    expect(localeInfo.zh.tag).toBe('zh-Hans');
    expect(localeInfo.uz.tag).toBe('uz-Latn');
  });
});

describe('localeFromAcceptLanguage', () => {
  it('maps regional variants onto their language', () => {
    expect(localeFromAcceptLanguage('ru-KZ,ru;q=0.9,en;q=0.8')).toBe('ru');
    expect(localeFromAcceptLanguage('zh-TW,zh;q=0.9')).toBe('zh');
    expect(localeFromAcceptLanguage('uz-Latn-UZ')).toBe('uz');
  });

  it('follows the browser weights rather than the list order', () => {
    expect(localeFromAcceptLanguage('en;q=0.5, zh-CN;q=0.9')).toBe('zh');
  });

  it('skips languages the site does not speak', () => {
    expect(localeFromAcceptLanguage('de-DE,de;q=0.9,fr;q=0.8')).toBeNull();
    expect(localeFromAcceptLanguage('de-DE,de;q=0.9,ru;q=0.2')).toBe('ru');
    expect(localeFromAcceptLanguage('')).toBeNull();
    expect(localeFromAcceptLanguage(null)).toBeNull();
    expect(localeFromAcceptLanguage('*')).toBeNull();
  });
});

describe('resolveLocale', () => {
  it('lets the link override the cookie, and the cookie override the browser', () => {
    expect(resolveLocale({ param: 'zh', cookie: 'ru', acceptLanguage: 'uz' })).toBe('zh');
    expect(resolveLocale({ cookie: 'ru', acceptLanguage: 'uz' })).toBe('ru');
    expect(resolveLocale({ acceptLanguage: 'uz' })).toBe('uz');
    expect(resolveLocale({})).toBe('en');
  });

  it('ignores values it does not recognise', () => {
    expect(resolveLocale({ param: 'fr', cookie: 'nope', acceptLanguage: 'de' })).toBe('en');
    expect(resolveLocale({ param: ['ru', 'zh'] })).toBe('ru');
  });
});

describe('localeCookie', () => {
  it('keeps the choice for a year on the whole site', () => {
    expect(localeCookie('uz', true)).toBe('mg_lang=uz; Path=/; Max-Age=31536000; SameSite=Lax; Secure');
    expect(localeCookie('en', false)).not.toContain('Secure');
  });
});
