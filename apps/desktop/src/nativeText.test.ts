import i18next from "i18next";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "./i18n";
import { nativeText } from "./nativeText";

// A made-up language, so a translated text differs from the English one.
beforeAll(() => {
  i18next.addResourceBundle("xx", "native", {
    "Battle.net sign-in timed out. Please try again.": "XX timed out",
    "Could not open Steam: {{error}}": "XX Steam ({{error}})",
    "Could not read {{path}}: {{error}}": "XX read {{path}} ({{error}})",
    "Could not read {{file}}.": "XX read file {{file}}",
    "PlayCounter no longer finds {{path}}.": "XX missing {{path}}",
  });
  void i18next.changeLanguage("xx");
});

afterAll(() => {
  void i18next.changeLanguage("en");
});

describe("Rust texts", () => {
  it("translates a fixed text", () => {
    expect(nativeText("Battle.net sign-in timed out. Please try again.")).toBe(
      "XX timed out",
    );
  });

  it("keeps the values of a text with values", () => {
    expect(
      nativeText("Could not open Steam: Access is denied. (os error 5)"),
    ).toBe("XX Steam (Access is denied. (os error 5))");
    expect(
      nativeText("PlayCounter no longer finds C:\\$Recycle.Bin\\$1\\a.exe."),
    ).toBe("XX missing C:\\$Recycle.Bin\\$1\\a.exe");
  });

  it("prefers the text with more fixed words", () => {
    expect(
      nativeText("Could not read C:\\Games\\a.exe: Access is denied."),
    ).toBe("XX read C:\\Games\\a.exe (Access is denied.)");
    expect(nativeText("Could not read localconfig.vdf.")).toBe(
      "XX read file localconfig.vdf",
    );
  });

  it("leaves unexpected errors in English", () => {
    expect(nativeText("Invalid cover key.")).toBe("Invalid cover key.");
  });
});
