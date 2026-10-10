/* Which languages PlayCounter has, and which one a setting stands for. No
   imports: the startup screen needs it before the app has loaded. */

/** Languages PlayCounter has texts for. */
export const APP_LANGUAGES = ["en", "de"] as const;
export type AppLanguage = (typeof APP_LANGUAGES)[number];

// Production builds only use languages that are released; dev and test builds
// use every language, so translations can be tried before they ship.
const RELEASED_LANGUAGES: readonly AppLanguage[] = ["en"];

/** The languages this build uses. */
export function availableLanguages(): readonly AppLanguage[] {
  return import.meta.env.VITE_PLAYCOUNTER_STAGE === "prod"
    ? RELEASED_LANGUAGES
    : APP_LANGUAGES;
}

export function isAppLanguage(value: unknown): value is AppLanguage {
  return APP_LANGUAGES.some((language) => language === value);
}

/** "system", or a language this build doesn't use, becomes the first of the
 *  computer's languages it uses, else English. */
export function resolveLanguage(
  setting: string | undefined,
  systemLocales: readonly string[],
): AppLanguage {
  const languages = availableLanguages();
  const chosen = languages.find((language) => language === setting);
  if (chosen) return chosen;
  for (const locale of systemLocales) {
    const match =
      languages.find(
        (language) => language.toLowerCase() === locale.toLowerCase(),
      ) ??
      languages.find(
        (language) => baseLanguage(language) === baseLanguage(locale),
      );
    if (match) return match;
  }
  return "en";
}

/** The computer's languages, most preferred first. */
export function systemLocales(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  if (navigator.languages?.length) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}

function baseLanguage(locale: string) {
  return locale.split("-")[0].toLowerCase();
}
