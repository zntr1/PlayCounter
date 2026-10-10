import { afterEach, describe, expect, it } from "vitest";
import { resolveLanguage } from "./appLanguages";
import {
  appLanguage,
  appLocale,
  applyLanguage,
  formattingLocale,
  getT,
} from "./i18n";

afterEach(() => applyLanguage("en"));

describe("language selection", () => {
  it.each([
    ["pt-BR", "pt-BR"],
    ["pt-PT", "pt-BR"],
    ["es-MX", "es"],
    ["es-ES", "es"],
    ["zh-CN", "zh-CN"],
    ["zh-SG", "zh-CN"],
    ["zh-Hans", "zh-CN"],
    ["zh-Hans-TW", "zh-CN"],
    ["zh", "zh-CN"],
  ])("resolves system locale %s to %s", (locale, language) => {
    expect(resolveLanguage("system", [locale])).toBe(language);
  });

  it.each(["zh-TW", "zh-HK", "zh-MO", "zh-Hant", "zh-Hant-CN"])(
    "continues to the next preferred language for %s",
    (locale) => {
      expect(resolveLanguage("system", [locale, "es-MX"])).toBe("es");
      expect(resolveLanguage("system", [locale])).toBe("en");
    },
  );

  it("honors a saved choice over the system language", () => {
    expect(resolveLanguage("pt-BR", ["de-DE"])).toBe("pt-BR");
    expect(resolveLanguage("zh-CN", ["zh-TW"])).toBe("zh-CN");
  });

  it("keeps regional language choices in date and number formatting", () => {
    expect(formattingLocale("pt-BR", "pt-PT")).toBe("pt-BR");
    expect(formattingLocale("zh-CN", "zh-TW")).toBe("zh-CN");
    expect(formattingLocale("es", "es-MX")).toBe("es-MX");
    expect(formattingLocale("en", "de-DE")).toBe("en-DE");
  });
});

describe("registered translations", () => {
  it.each([
    ["pt-BR", "Meus jogos"],
    ["zh-CN", "我的游戏"],
    ["es", "Mis juegos"],
  ] as const)("switches the app to %s", (language, label) => {
    applyLanguage(language);
    expect(appLanguage()).toBe(language);
    expect(getT("shell")("My Games")).toBe(label);
  });

  it("uses Brazilian Portuguese singular, plural and million forms", () => {
    applyLanguage("pt-BR");
    const t = getT("common");
    expect(t("{{count}} sessions", { count: 1 })).toBe("1 sessão");
    expect(t("{{count}} sessions", { count: 2 })).toBe("2 sessões");
    expect(t("{{count}} sessions", { count: 1_000_000 })).toBe(
      "1000000 sessões",
    );
    expect(appLocale()).toBe("pt-BR");
  });

  it("uses Spanish singular, plural and million forms", () => {
    applyLanguage("es");
    const t = getT("common");
    expect(t("{{count}} sessions", { count: 1 })).toBe("1 sesión");
    expect(t("{{count}} sessions", { count: 2 })).toBe("2 sesiones");
    expect(t("{{count}} sessions", { count: 1_000_000 })).toBe(
      "1000000 sesiones",
    );
  });

  it("uses the Chinese form for every count and retains interpolation", () => {
    applyLanguage("zh-CN");
    const t = getT("common");
    for (const count of [0, 1, 2, 1_000_000]) {
      expect(t("{{count}} sessions", { count })).toBe(`${count} 次游玩`);
    }
    expect(
      getT("native")("Could not open Epic Games: {{error}}", {
        error: "test error",
      }),
    ).toContain("test error");
    expect(appLocale()).toBe("zh-CN");
  });
});
