import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import enAchievements from "./locales/en/achievements.json";
import enCommon from "./locales/en/common.json";
import enDialogs from "./locales/en/dialogs.json";
import enDiscovered from "./locales/en/discovered.json";
import enEmulators from "./locales/en/emulators.json";
import enGames from "./locales/en/games.json";
import enHistory from "./locales/en/history.json";
import enIgdb from "./locales/en/igdb.json";
import enImport from "./locales/en/import.json";
import enMyGames from "./locales/en/myGames.json";
import enNative from "./locales/en/native.json";
import enNowPlaying from "./locales/en/nowPlaying.json";
import enOverlays from "./locales/en/overlays.json";
import enSettings from "./locales/en/settings.json";
import enShell from "./locales/en/shell.json";
import enSoftware from "./locales/en/software.json";
import enTour from "./locales/en/tour.json";
import enTracker from "./locales/en/tracker.json";
import deAchievements from "./locales/de/achievements.json";
import deCommon from "./locales/de/common.json";
import deDialogs from "./locales/de/dialogs.json";
import deDiscovered from "./locales/de/discovered.json";
import deEmulators from "./locales/de/emulators.json";
import deGames from "./locales/de/games.json";
import deHistory from "./locales/de/history.json";
import deIgdb from "./locales/de/igdb.json";
import deImport from "./locales/de/import.json";
import deMyGames from "./locales/de/myGames.json";
import deNative from "./locales/de/native.json";
import deNowPlaying from "./locales/de/nowPlaying.json";
import deOverlays from "./locales/de/overlays.json";
import deSettings from "./locales/de/settings.json";
import deShell from "./locales/de/shell.json";
import deSoftware from "./locales/de/software.json";
import deTour from "./locales/de/tour.json";
import deTracker from "./locales/de/tracker.json";
import ptBRAchievements from "./locales/pt-BR/achievements.json";
import ptBRCommon from "./locales/pt-BR/common.json";
import ptBRDialogs from "./locales/pt-BR/dialogs.json";
import ptBRDiscovered from "./locales/pt-BR/discovered.json";
import ptBREmulators from "./locales/pt-BR/emulators.json";
import ptBRGames from "./locales/pt-BR/games.json";
import ptBRHistory from "./locales/pt-BR/history.json";
import ptBRIgdb from "./locales/pt-BR/igdb.json";
import ptBRImport from "./locales/pt-BR/import.json";
import ptBRMyGames from "./locales/pt-BR/myGames.json";
import ptBRNative from "./locales/pt-BR/native.json";
import ptBRNowPlaying from "./locales/pt-BR/nowPlaying.json";
import ptBROverlays from "./locales/pt-BR/overlays.json";
import ptBRSettings from "./locales/pt-BR/settings.json";
import ptBRShell from "./locales/pt-BR/shell.json";
import ptBRSoftware from "./locales/pt-BR/software.json";
import ptBRTour from "./locales/pt-BR/tour.json";
import ptBRTracker from "./locales/pt-BR/tracker.json";
import zhCNAchievements from "./locales/zh-CN/achievements.json";
import zhCNCommon from "./locales/zh-CN/common.json";
import zhCNDialogs from "./locales/zh-CN/dialogs.json";
import zhCNDiscovered from "./locales/zh-CN/discovered.json";
import zhCNEmulators from "./locales/zh-CN/emulators.json";
import zhCNGames from "./locales/zh-CN/games.json";
import zhCNHistory from "./locales/zh-CN/history.json";
import zhCNIgdb from "./locales/zh-CN/igdb.json";
import zhCNImport from "./locales/zh-CN/import.json";
import zhCNMyGames from "./locales/zh-CN/myGames.json";
import zhCNNative from "./locales/zh-CN/native.json";
import zhCNNowPlaying from "./locales/zh-CN/nowPlaying.json";
import zhCNOverlays from "./locales/zh-CN/overlays.json";
import zhCNSettings from "./locales/zh-CN/settings.json";
import zhCNShell from "./locales/zh-CN/shell.json";
import zhCNSoftware from "./locales/zh-CN/software.json";
import zhCNTour from "./locales/zh-CN/tour.json";
import zhCNTracker from "./locales/zh-CN/tracker.json";
import esAchievements from "./locales/es/achievements.json";
import esCommon from "./locales/es/common.json";
import esDialogs from "./locales/es/dialogs.json";
import esDiscovered from "./locales/es/discovered.json";
import esEmulators from "./locales/es/emulators.json";
import esGames from "./locales/es/games.json";
import esHistory from "./locales/es/history.json";
import esIgdb from "./locales/es/igdb.json";
import esImport from "./locales/es/import.json";
import esMyGames from "./locales/es/myGames.json";
import esNative from "./locales/es/native.json";
import esNowPlaying from "./locales/es/nowPlaying.json";
import esOverlays from "./locales/es/overlays.json";
import esSettings from "./locales/es/settings.json";
import esShell from "./locales/es/shell.json";
import esSoftware from "./locales/es/software.json";
import esTour from "./locales/es/tour.json";
import esTracker from "./locales/es/tracker.json";
import {
  isAppLanguage,
  resolveLanguage,
  systemLocales,
  type AppLanguage,
} from "./appLanguages";

export {
  APP_LANGUAGES,
  isAppLanguage,
  resolveLanguage,
  type AppLanguage,
} from "./appLanguages";

/* PlayCounter's language. Texts live in src/locales/<language>/<area>.json,
   one file per area. The key is the English text itself, so code reads
   t("Ignore this app?"). English is the source: every language has the same
   keys, and a key a language lacks shows in English. Changing an English
   text changes its key, so every translation of it has to be redone.
   boot.json is the exception: the startup screen reads it directly. */

/** The Settings value: "system" follows the computer's language. */
export type LanguageSetting = "system" | AppLanguage;

/** Each language in its own language, so anyone finds theirs, even in an app
 *  they can't read. */
export const LANGUAGE_NAMES: Record<AppLanguage, string> = {
  en: "English",
  de: "Deutsch",
  "pt-BR": "Português (Brasil)",
  "zh-CN": "中文（简体）",
  es: "Español",
};

const resources = {
  en: {
    achievements: enAchievements,
    common: enCommon,
    dialogs: enDialogs,
    discovered: enDiscovered,
    emulators: enEmulators,
    games: enGames,
    history: enHistory,
    igdb: enIgdb,
    import: enImport,
    myGames: enMyGames,
    native: enNative,
    nowPlaying: enNowPlaying,
    overlays: enOverlays,
    settings: enSettings,
    shell: enShell,
    software: enSoftware,
    tour: enTour,
    tracker: enTracker,
  },
  de: {
    achievements: deAchievements,
    common: deCommon,
    dialogs: deDialogs,
    discovered: deDiscovered,
    emulators: deEmulators,
    games: deGames,
    history: deHistory,
    igdb: deIgdb,
    import: deImport,
    myGames: deMyGames,
    native: deNative,
    nowPlaying: deNowPlaying,
    overlays: deOverlays,
    settings: deSettings,
    shell: deShell,
    software: deSoftware,
    tour: deTour,
    tracker: deTracker,
  },
  "pt-BR": {
    achievements: ptBRAchievements,
    common: ptBRCommon,
    dialogs: ptBRDialogs,
    discovered: ptBRDiscovered,
    emulators: ptBREmulators,
    games: ptBRGames,
    history: ptBRHistory,
    igdb: ptBRIgdb,
    import: ptBRImport,
    myGames: ptBRMyGames,
    native: ptBRNative,
    nowPlaying: ptBRNowPlaying,
    overlays: ptBROverlays,
    settings: ptBRSettings,
    shell: ptBRShell,
    software: ptBRSoftware,
    tour: ptBRTour,
    tracker: ptBRTracker,
  },
  "zh-CN": {
    achievements: zhCNAchievements,
    common: zhCNCommon,
    dialogs: zhCNDialogs,
    discovered: zhCNDiscovered,
    emulators: zhCNEmulators,
    games: zhCNGames,
    history: zhCNHistory,
    igdb: zhCNIgdb,
    import: zhCNImport,
    myGames: zhCNMyGames,
    native: zhCNNative,
    nowPlaying: zhCNNowPlaying,
    overlays: zhCNOverlays,
    settings: zhCNSettings,
    shell: zhCNShell,
    software: zhCNSoftware,
    tour: zhCNTour,
    tracker: zhCNTracker,
  },
  es: {
    achievements: esAchievements,
    common: esCommon,
    dialogs: esDialogs,
    discovered: esDiscovered,
    emulators: esEmulators,
    games: esGames,
    history: esHistory,
    igdb: esIgdb,
    import: esImport,
    myGames: esMyGames,
    native: esNative,
    nowPlaying: esNowPlaying,
    overlays: esOverlays,
    settings: esSettings,
    shell: esShell,
    software: esSoftware,
    tour: esTour,
    tracker: esTracker,
  },
};

type Namespace = keyof (typeof resources)["en"];

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "settings";
    keySeparator: false;
    nsSeparator: false;
    resources: (typeof resources)["en"];
  }
}

void i18next.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  defaultNS: "settings",
  // Keys are English sentences: dots and colons are part of the key.
  keySeparator: false,
  nsSeparator: false,
  // React escapes text when it renders it.
  interpolation: { escapeValue: false },
  // Every text ships with the app, so the first render already has them.
  initAsync: false,
});

// {{count, number}} in a text formats like the rest of the app.
i18next.services.formatter?.add("number", (value, _language, options) =>
  Number(value).toLocaleString(appLocale(), options),
);

/** The text function for one area's file, e.g. `const t = getT("myGames")`
 *  at the top of a module. It reads the current language on every call. */
export function getT<N extends Namespace>(namespace: N) {
  return i18next.getFixedT(null, namespace);
}

let currentLocale = formattingLocale("en", systemLocales()[0]);

/** Locale for dates and numbers. Pass it to every toLocale…() and Intl call so
 *  they follow PlayCounter's language, not the computer's. */
export function appLocale() {
  return currentLocale;
}

/** The language the app's texts are in right now. */
export function appLanguage(): AppLanguage {
  return isAppLanguage(i18next.language) ? i18next.language : "en";
}

/** The language "system" stands for on this computer. */
export function systemLanguage() {
  return resolveLanguage("system", systemLocales());
}

/** The app language with the computer's region: English on a German PC is
 *  en-DE, so English words, but day first, a 24-hour clock and 1.234,5.
 *  Languages with an explicit region keep it, e.g. Brazilian Portuguese. */
export function formattingLocale(
  language: AppLanguage,
  systemLocale: string | undefined,
) {
  if (!systemLocale) return language;
  try {
    const app = new Intl.Locale(language);
    const system = new Intl.Locale(systemLocale);
    if (app.region) return language;
    if (system.language === app.language) return system.toString();
    if (!system.region) return language;
    const mixed = `${app.language}-${system.region}`;
    return new Intl.DateTimeFormat(mixed).resolvedOptions().locale === mixed
      ? mixed
      : language;
  } catch {
    return language;
  }
}

/** Monday to Sunday in the app's language: "Mon" or "Monday". */
export function weekdayNames(width: "short" | "long") {
  // 1 January 2024 was a Monday.
  return Array.from({ length: 7 }, (_, day) =>
    new Date(2024, 0, 1 + day).toLocaleDateString(appLocale(), {
      weekday: width,
    }),
  );
}

/** Switches texts, date and number formats and <html lang> to the setting. */
export function applyLanguage(setting: string | undefined) {
  const locales = systemLocales();
  const language = resolveLanguage(setting, locales);
  currentLocale = formattingLocale(language, locales[0]);
  if (typeof document !== "undefined") {
    document.documentElement.lang = language;
  }
  if (i18next.language !== language) void i18next.changeLanguage(language);
}
