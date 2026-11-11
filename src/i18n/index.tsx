import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import type { SupportedLocale, LocaleInfo } from "./types";
import { SUPPORTED_LOCALES } from "./types";
import { zhCN } from "./locales/zh-CN";
import { enUS } from "./locales/en-US";
import { jaJP } from "./locales/ja-JP";
import { koKR } from "./locales/ko-KR";
import type { TranslationSchema } from "./locales/zh-CN";

export type { SupportedLocale, LocaleInfo, TranslationSchema };
export { SUPPORTED_LOCALES };

const LANGUAGE_KEY = "gitlensy:language";

const TRANSLATIONS: Record<SupportedLocale, TranslationSchema> = {
  "zh-CN": zhCN,
  "en-US": enUS,
  "ja-JP": jaJP,
  "ko-KR": koKR,
};

function detectInitialLocale(): SupportedLocale {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (saved === "zh-CN" || saved === "en-US" || saved === "ja-JP" || saved === "ko-KR") {
      return saved;
    }
  } catch {
    // ignore
  }

  try {
    const navLang = navigator.language?.toLowerCase() || "";
    if (navLang.startsWith("zh")) return "zh-CN";
    if (navLang.startsWith("ja")) return "ja-JP";
    if (navLang.startsWith("ko")) return "ko-KR";
    if (navLang.startsWith("en")) return "en-US";
  } catch {
    // ignore
  }

  return "zh-CN";
}

function getNestedValue(obj: unknown, path: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = path.split(".");
  let current: any = obj;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return typeof current === "string" ? current : undefined;
}

export type TranslateParams = Record<string, string | number | undefined | null>;

export interface I18nContextValue {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: (path: string, params?: TranslateParams) => string;
  locales: LocaleInfo[];
  formatDate: (iso: string) => string;
  formatRelativeTime: (iso: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>(detectInitialLocale);

  const setLocale = useCallback((newLocale: SupportedLocale) => {
    setLocaleState(newLocale);
    try {
      localStorage.setItem(LANGUAGE_KEY, newLocale);
    } catch {
      // ignore
    }
    document.documentElement.lang = newLocale;
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback(
    (path: string, params?: TranslateParams): string => {
      const activeDict = TRANSLATIONS[locale];
      const fallbackDict = TRANSLATIONS["zh-CN"];

      let template = getNestedValue(activeDict, path);
      if (template === undefined) {
        template = getNestedValue(fallbackDict, path);
      }
      if (template === undefined) {
        return path;
      }

      if (!params) return template;

      return template.replace(/\{(\w+)\}/g, (match, key) => {
        const val = params[key];
        return val !== undefined && val !== null ? String(val) : match;
      });
    },
    [locale]
  );

  const formatDate = useCallback(
    (iso: string): string => {
      try {
        return new Date(iso).toLocaleDateString(locale, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      } catch {
        return iso;
      }
    },
    [locale]
  );

  const formatRelativeTime = useCallback(
    (iso: string): string => {
      try {
        const date = new Date(iso);
        const now = new Date();
        const diffMs = date.getTime() - now.getTime();
        const diffSec = Math.round(diffMs / 1000);
        const diffMin = Math.round(diffSec / 60);
        const diffHour = Math.round(diffMin / 60);
        const diffDay = Math.round(diffHour / 24);

        const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

        if (Math.abs(diffSec) < 45) {
          return rtf.format(diffSec, "second");
        }
        if (Math.abs(diffMin) < 55) {
          return rtf.format(diffMin, "minute");
        }
        if (Math.abs(diffHour) < 24) {
          return rtf.format(diffHour, "hour");
        }
        if (Math.abs(diffDay) < 30) {
          return rtf.format(diffDay, "day");
        }
        const diffMonth = Math.round(diffDay / 30);
        if (Math.abs(diffMonth) < 12) {
          return rtf.format(diffMonth, "month");
        }
        const diffYear = Math.round(diffDay / 365);
        return rtf.format(diffYear, "year");
      } catch {
        return iso;
      }
    },
    [locale]
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t,
      locales: SUPPORTED_LOCALES,
      formatDate,
      formatRelativeTime,
    }),
    [locale, setLocale, t, formatDate, formatRelativeTime]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return ctx;
}
