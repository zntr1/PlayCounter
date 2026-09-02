import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  canImportExistingLibraryEntry,
  hasImportableActivity,
  XboxMatchControls,
} from "./ImportLibraryView";

describe("library importer eligibility", () => {
  it("allows Xbox imports to refresh existing playtime without changing Steam behavior", () => {
    expect(canImportExistingLibraryEntry("xbox", true)).toBe(true);
    expect(canImportExistingLibraryEntry("steam", true)).toBe(false);
    expect(canImportExistingLibraryEntry("xbox", false)).toBe(true);
  });

  it("keeps unknown Xbox duration importable but rejects an untouched zero", () => {
    expect(
      hasImportableActivity({
        externalId: "42",
        playtimeSeconds: null,
        installed: false,
        executables: [],
      }),
    ).toBe(true);
    expect(
      hasImportableActivity({
        externalId: "42",
        playtimeSeconds: 0,
        installed: false,
        executables: [],
      }),
    ).toBe(false);
    expect(
      hasImportableActivity({
        externalId: "42",
        playtimeSeconds: 0,
        lastPlayedUnix: 1_700_000_000,
        installed: false,
        executables: [],
      }),
    ).toBe(true);
  });

  it("renders the selected Xbox candidate cover", () => {
    const html = renderToStaticMarkup(
      createElement(XboxMatchControls, {
        apiEndpoint: "https://api.example",
        candidates: [
          {
            id: 42,
            igdbId: 133430,
            name: "Forza Horizon 5",
            coverUrl: "https://images.example/forza.jpg",
            releaseYear: 2021,
            source: "igdb",
          },
        ],
        title: "Forza Horizon 5",
        importing: false,
        onConfirm: async () => undefined,
      }),
    );

    expect(html).toContain('src="https://images.example/forza.jpg"');
    expect(html).toContain('alt="Forza Horizon 5 cover"');
    expect(html).toContain("2021");
    expect(html).not.toContain("Released 2021");
    expect(html).toContain("Confirm and Import");
  });
});
