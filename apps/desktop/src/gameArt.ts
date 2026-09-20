import type {
  ArtAssetsResponse,
  ArtSearchGame,
  ArtSearchResponse,
} from "@playcounter/shared";
import { requestJson, requestWithTimeout } from "./requestJson";
import { responseError } from "./rateLimitedFetch";
import { useAppStore } from "./store";

/* Artwork picker requests. SteamGridDB sits behind the API (the key never
   reaches the desktop), and a chosen cover is downloaded through the API
   too, because the CDN does not answer cross-origin requests from the app. */

function endpoint() {
  return useAppStore.getState().settings.apiEndpoint;
}

export async function searchArt(query: string): Promise<ArtSearchGame[]> {
  const params = new URLSearchParams({ query });
  const body = await requestJson<ArtSearchResponse>(
    `${endpoint()}/api/art/search?${params.toString()}`,
    { rateLimitScope: "endpoint" },
  );
  return body.games ?? [];
}

export async function artForGame(
  steamGridDbGameId: number,
): Promise<ArtAssetsResponse> {
  const body = await requestJson<ArtAssetsResponse>(
    `${endpoint()}/api/art/game/${steamGridDbGameId}`,
    { rateLimitScope: "endpoint" },
  );
  return { covers: body.covers ?? [], heroes: body.heroes ?? [] };
}

/** The image bytes for a picked asset, ready for the custom cover pipeline. */
export async function downloadArtImage(url: string): Promise<Blob> {
  const params = new URLSearchParams({ url });
  return requestWithTimeout(
    `${endpoint()}/api/art/image?${params.toString()}`,
    { timeoutMs: 20_000 },
    async (response) => {
      if (!response.ok) throw responseError(response);
      return response.blob();
    },
  );
}
