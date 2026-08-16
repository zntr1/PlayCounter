import { describe, expect, it } from "vitest";
import {
  communityMetadataSearchUrl,
  mergeCommunityMetadataCandidates,
} from "./communityMetadataSearch";

describe("community metadata pagination", () => {
  it("adds an offset only for subsequent pages", () => {
    expect(
      communityMetadataSearchUrl("https://api.example", "Need for Speed"),
    ).toBe("https://api.example/api/community/metadata?query=Need+for+Speed");
    expect(
      communityMetadataSearchUrl("https://api.example", "Need for Speed", 40),
    ).toBe(
      "https://api.example/api/community/metadata?query=Need+for+Speed&offset=40",
    );
  });

  it("includes release-year filtering and sorting when requested", () => {
    expect(
      communityMetadataSearchUrl("https://api.example", "Need for Speed", 0, {
        releaseYear: 2015,
        sort: "release-desc",
      }),
    ).toBe(
      "https://api.example/api/community/metadata?query=Need+for+Speed&releaseYear=2015&sort=release-desc",
    );
  });

  it("appends pages without duplicating IGDB games", () => {
    expect(
      mergeCommunityMetadataCandidates(
        [{ igdbId: 1, name: "First", coverUrl: "" }],
        [
          { igdbId: 1, name: "First updated", coverUrl: "cover" },
          { igdbId: 2, name: "Second", coverUrl: "" },
        ],
      ),
    ).toEqual([
      { igdbId: 1, name: "First updated", coverUrl: "cover" },
      { igdbId: 2, name: "Second", coverUrl: "" },
    ]);
  });
});
