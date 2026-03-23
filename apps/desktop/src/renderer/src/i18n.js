import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import en from './locales/en';
import zhCN from './locales/zh-CN';

const STORAGE_KEY = 'memoq-ai-hub.locale';

const resources = {
  en,
  'zh-CN': zhCN
};

function resolveMessage(locale, key) {
  const fallbackLocales = [locale, 'en'];
  for (const currentLocale of fallbackLocales) {
    const segments = String(key || '').split('.');
    let cursor = resources[currentLocale];
    for (const segment of segments) {
      cursor = cursor?.[segment];
      if (cursor == null) {
        break;
      }
    }
    if (typeof cursor === 'string') {
      return cursor;
    }
  }
  return key;
}

function interpolate(template, values = {}) {
  return Object.entries(values).reduce(
    (output, [key, value]) => output.replaceAll(`{{${key}}}`, String(value)),
    template
  );
}

const I18nContext = createContext({
  locale: 'en',
  setLocale: () => {},
  t: (key) => key
});

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(() => {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    return stored && resources[stored] ? stored : 'en';
  });

  useEffect(() => {
    globalThis.localStorage?.setItem(STORAGE_KEY, locale);
  }, [locale]);

  const value = useMemo(() => ({
    locale,
    setLocale(nextLocale) {
      setLocaleState(resources[nextLocale] ? nextLocale : 'en');
    },
    t(key, values) {
      return interpolate(resolveMessage(locale, key), values);
    }
  }), [locale]);

  return React.createElement(I18nContext.Provider, { value }, children);
}

export function useI18n() {
  return useContext(I18nContext);
}
