/* Which languages PlayCounter has, and which one a setting stands for. No
   imports: the startup screen needs it before the app has loaded. */

/** Languages PlayCounter has texts for. */
export const APP_LANGUAGES = ["en"] as const;
export type AppLanguage = (typeof APP_LANGUAGES)[number];

export function isAppLanguage(value: unknown): value is AppLanguage {
  return APP_LANGUAGES.some((language) => language === value);
}

/** "system", or a language PlayCounter doesn't have, becomes the first of the
 *  computer's languages PlayCounter has, else English. */
export function resolveLanguage(
  setting: string | undefined,
  systemLocales: readonly string[],
): AppLanguage {
  if (isAppLanguage(setting)) return setting;
  for (const locale of systemLocales) {
    const match =
      APP_LANGUAGES.find(
        (language) => language.toLowerCase() === locale.toLowerCase(),
      ) ??
      APP_LANGUAGES.find(
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
