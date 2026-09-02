import { describe, expect, it } from "vitest";
import { isBuiltinImportProvider } from "../library/importProviders";
import {
  importableProviderTabs,
  PROVIDER_TAB_CONFIGS,
} from "./libraryProviderTabs";

describe("library provider tab registry", () => {
  it("only advertises importers that exist on the current platform", () => {
    for (const config of PROVIDER_TAB_CONFIGS) {
      if (config.import.kind === "builtin") {
        expect(isBuiltinImportProvider(config.id)).toBe(true);
      }
    }
    expect(
      importableProviderTabs("windows").map((config) => config.id),
    ).toEqual(["steam", "xbox"]);
    expect(importableProviderTabs("macos").map((config) => config.id)).toEqual([
      "xbox",
    ]);
    expect(importableProviderTabs("linux").map((config) => config.id)).toEqual([
      "xbox",
    ]);
  });
});
