import type { CommunityMetadataCandidate } from "@playcounter/shared";

export type CommunityMetadataSort =
  | "relevance"
  | "release-desc"
  | "release-asc";

export type CommunityMetadataSearchOptions = {
  releaseYear?: number;
  sort: CommunityMetadataSort;
};

export function communityMetadataSearchUrl(
  apiEndpoint: string,
  query: string,
  offset = 0,
  options: CommunityMetadataSearchOptions = { sort: "relevance" },
) {
  const params = new URLSearchParams({ query });
  if (offset > 0) params.set("offset", String(offset));
  if (options.releaseYear !== undefined) {
    params.set("releaseYear", String(options.releaseYear));
  }
  if (options.sort !== "relevance") params.set("sort", options.sort);
  return `${apiEndpoint}/api/community/metadata?${params.toString()}`;
}

export function mergeCommunityMetadataCandidates(
  current: CommunityMetadataCandidate[],
  incoming: CommunityMetadataCandidate[],
) {
  const candidates = new Map(
    current.map((candidate) => [candidate.igdbId, candidate]),
  );
  for (const candidate of incoming) candidates.set(candidate.igdbId, candidate);
  return [...candidates.values()];
}
