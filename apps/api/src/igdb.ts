import { z } from "zod";
import { count, logger } from "./logger.js";

const twitchTokenSchema = z.object({
  access_token: z.string().min(1),
});

export type IgdbGame = {
  id: number;
  name: string;
  platforms?: number[];
  alternative_names?: Array<{ name?: string }>;
  cover?: { image_id?: string };
  first_release_date?: number;
};

export type IgdbExecutableMatch = {
  executableName: string;
  game: IgdbGame;
  ambiguousGames?: IgdbGame[];
};

export type IgdbClientOptions = {
  clientId?: string;
  accessToken?: string;
  clientSecret?: string;
};

export type IgdbGameSearchOptions = {
  releaseYear?: number;
  sort?: "relevance" | "release-desc" | "release-asc";
};

export class IgdbClient {
  private accessToken?: string;

  constructor(private readonly options: IgdbClientOptions) {
    this.accessToken = options.accessToken;
  }

  get configured() {
    return Boolean(
      this.options.clientId && (this.accessToken || this.options.clientSecret),
    );
  }

  async findWindowsGameByAlternativeName(
    name: string,
    requestedBy: string[] = [],
  ): Promise<IgdbExecutableMatch | null> {
    if (!this.configured || !this.options.clientId) return null;

    const accessToken = await this.getAccessToken();
    const response = await fetch("https://api.igdb.com/v4/alternative_names", {
      method: "POST",
      headers: {
        "Client-ID": this.options.clientId,
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      body: [
        "fields name,comment,game.name,game.cover.image_id,game.platforms,game.first_release_date;",
        `where name ~ "${escapeIgdbString(name)}";`,
        // IGDB's maximum page size; exe names shared by more than 500 games
        // do not exist in practice, so this never truncates candidates.
        "limit 500;",
      ].join(" "),
    });

    if (!response.ok) {
      throw new Error(
        `IGDB alternative name lookup failed: ${response.status} ${await response.text()}`,
      );
    }

    const alternativeNames = (await response.json()) as Array<{
      name?: string;
      comment?: string;
      game?: IgdbGame;
    }>;
    const normalizedName = name.toLowerCase();
    const matches = alternativeNames.filter(
      (alternativeName) =>
        alternativeName.name?.toLowerCase() === normalizedName &&
        alternativeName.comment?.toLowerCase() === "windows executable" &&
        alternativeName.game?.platforms?.includes(6),
    );
    const distinctGames = new Map(
      matches
        .filter((match) => match.game)
        .map((match) => [match.game!.id, match.game!]),
    );
    if (distinctGames.size > 1) {
      const requester = requestedBy.length
        ? ` requested by ${[...new Set(requestedBy)].join(", ")}`
        : "";
      logger.warn(
        `[match] Ambiguous IGDB Windows executable ${JSON.stringify(name)}${requester} matched ${count(distinctGames.size, "game")}: ${[
          ...distinctGames.values(),
        ]
          .map((game) => `${game.name} (#${game.id})`)
          .join(", ")}.`,
      );
      return {
        executableName: matches[0]?.name ?? name,
        game: [...distinctGames.values()][0],
        ambiguousGames: [...distinctGames.values()],
      };
    }

    const match = matches[0];
    if (!match?.name || !match.game) return null;
    return { executableName: match.name, game: match.game };
  }

  async searchGames(
    query: string,
    limit = 5,
    offset = 0,
    options: IgdbGameSearchOptions = {},
  ): Promise<IgdbGame[]> {
    if (!this.configured || !this.options.clientId) return [];

    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];

    const where = ["name != null"];
    if (options.releaseYear !== undefined) {
      const start = Date.UTC(options.releaseYear, 0, 1) / 1000;
      const end = Date.UTC(options.releaseYear + 1, 0, 1) / 1000;
      where.push(`first_release_date >= ${start}`);
      where.push(`first_release_date < ${end}`);
    }
    const requestedLimit = Math.max(1, Math.min(500, limit));
    const releaseSort =
      options.sort === "release-desc" || options.sort === "release-asc"
        ? options.sort
        : undefined;
    // IGDB rejects queries that combine `search` and `sort`. To provide a
    // deterministic release-date order across pages, fetch the complete
    // searchable result window, sort it locally, then apply the requested
    // offset and limit.
    const igdbLimit = releaseSort ? 500 : requestedLimit;
    const igdbOffset = releaseSort ? 0 : Math.max(0, Math.min(10_000, offset));

    const accessToken = await this.getAccessToken();
    const response = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Client-ID": this.options.clientId,
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      body: [
        `search "${escapeIgdbString(normalizedQuery)}";`,
        "fields name,cover.image_id,platforms,first_release_date;",
        `where ${where.join(" & ")};`,
        `limit ${igdbLimit};`,
        `offset ${igdbOffset};`,
      ].join(" "),
    });

    if (!response.ok) {
      throw new Error(
        `IGDB game search failed: ${response.status} ${await response.text()}`,
      );
    }

    const games = (await response.json()) as IgdbGame[];
    if (!releaseSort) return games;

    games.sort((left, right) => {
      const leftDate = left.first_release_date;
      const rightDate = right.first_release_date;
      if (leftDate === undefined) return rightDate === undefined ? 0 : 1;
      if (rightDate === undefined) return -1;
      return releaseSort === "release-desc"
        ? rightDate - leftDate
        : leftDate - rightDate;
    });
    return games.slice(offset, offset + requestedLimit);
  }

  async findDosGames(query: string, limit = 50): Promise<IgdbGame[]> {
    return this.findGamesForPlatforms(query, [13], limit);
  }

  async findGamesForPlatforms(
    query: string,
    platformIds: readonly number[],
    limit = 50,
  ): Promise<IgdbGame[]> {
    if (!this.configured || !this.options.clientId) return [];

    const normalizedQuery = query.trim();
    const normalizedPlatformIds = [
      ...new Set(
        platformIds.filter(
          (platformId) => Number.isInteger(platformId) && platformId > 0,
        ),
      ),
    ];
    if (!normalizedQuery || normalizedPlatformIds.length === 0) return [];

    const accessToken = await this.getAccessToken();
    const response = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Client-ID": this.options.clientId,
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      body: [
        `search "${escapeIgdbString(normalizedQuery)}";`,
        "fields name,alternative_names.name,cover.image_id,platforms,first_release_date;",
        `where platforms = (${normalizedPlatformIds.join(",")});`,
        `limit ${Math.max(1, Math.min(100, limit))};`,
      ].join(" "),
    });

    if (!response.ok) {
      throw new Error(
        `IGDB platform game search failed: ${response.status} ${await response.text()}`,
      );
    }

    return (await response.json()) as IgdbGame[];
  }

  private async getAccessToken() {
    if (this.accessToken) return this.accessToken;
    if (!this.options.clientId || !this.options.clientSecret) {
      throw new Error("Set IGDB_ACCESS_TOKEN or TWITCH_CLIENT_SECRET.");
    }

    const params = new URLSearchParams({
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      grant_type: "client_credentials",
    });
    const response = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      body: params,
    });

    if (!response.ok) {
      throw new Error(
        `Twitch token request failed: ${response.status} ${await response.text()}`,
      );
    }

    this.accessToken = twitchTokenSchema.parse(
      await response.json(),
    ).access_token;
    return this.accessToken;
  }
}

export function createIgdbClientFromEnv() {
  const clientId = process.env.IGDB_CLIENT_ID ?? process.env.TWITCH_CLIENT_ID;
  return new IgdbClient({
    clientId,
    accessToken: process.env.IGDB_ACCESS_TOKEN,
    clientSecret: process.env.TWITCH_CLIENT_SECRET,
  });
}

function escapeIgdbString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
