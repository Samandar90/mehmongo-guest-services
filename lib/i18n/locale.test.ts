import { describe, expect, it } from 'vitest';
import { isLocale, localeCookie, localeInfo, locales, resolveLocale } from './locale';

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

describe('resolveLocale', () => {
  it('lets the link override the cookie', () => {
    expect(resolveLocale({ param: 'zh', cookie: 'ru' })).toBe('zh');
    expect(resolveLocale({ cookie: 'ru' })).toBe('ru');
    expect(resolveLocale({})).toBe('en');
  });

  // A scanned plaque opens the same way for everyone; the phone's own
  // language is not consulted, only what the guest has chosen here before.
  it('opens in English whatever the phone is set to', () => {
    expect(resolveLocale({})).toBe('en');
    expect(resolveLocale({ cookie: null })).toBe('en');
  });

  it('ignores values it does not recognise', () => {
    expect(resolveLocale({ param: 'fr', cookie: 'nope' })).toBe('en');
    expect(resolveLocale({ param: ['ru', 'zh'] })).toBe('ru');
  });
});

describe('localeCookie', () => {
  it('keeps the choice for a year on the whole site', () => {
    expect(localeCookie('uz', true)).toBe('mg_lang=uz; Path=/; Max-Age=31536000; SameSite=Lax; Secure');
    expect(localeCookie('en', false)).not.toContain('Secure');
  });
});
