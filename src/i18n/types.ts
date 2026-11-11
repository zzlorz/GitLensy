export type SupportedLocale = "zh-CN" | "en-US" | "ja-JP" | "ko-KR";

export interface LocaleInfo {
  id: SupportedLocale;
  label: string;
  nativeName: string;
  englishName: string;
}

export const SUPPORTED_LOCALES: LocaleInfo[] = [
  {
    id: "zh-CN",
    label: "简体中文",
    nativeName: "简体中文",
    englishName: "Chinese (Simplified)",
  },
  {
    id: "en-US",
    label: "English",
    nativeName: "English",
    englishName: "English (US)",
  },
  {
    id: "ja-JP",
    label: "日本語",
    nativeName: "日本語",
    englishName: "Japanese",
  },
  {
    id: "ko-KR",
    label: "한국어",
    nativeName: "한국어",
    englishName: "Korean",
  },
];
