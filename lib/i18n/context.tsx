'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { defaultLocale, type Locale } from './locale';
import { messages, type Messages } from './messages';

type I18n = {
  locale: Locale;
  t: Messages;
  setLocale: (locale: Locale) => void;
};

/**
 * English with a no-op setter, so a component rendered on its own — in a
 * test, or on a screen that has no switcher — reads exactly as it did
 * before the site learned other languages.
 */
const I18nContext = createContext<I18n>({ locale: defaultLocale, t: messages[defaultLocale], setLocale: () => {} });

export function I18nProvider({ locale, setLocale, children }: {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  children: ReactNode;
}) {
  return <I18nContext.Provider value={{ locale, t: messages[locale], setLocale }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}
