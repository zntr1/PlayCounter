import type { CommunityMetadataCandidate } from "@playcounter/shared";

export function communityMetadataSearchUrl(
  apiEndpoint: string,
  query: string,
  offset = 0,
) {
  const params = new URLSearchParams({ query });
  if (offset > 0) params.set("offset", String(offset));
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
