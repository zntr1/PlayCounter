import { z } from "zod";

const twitchTokenSchema = z.object({
  access_token: z.string().min(1),
});

export type IgdbGame = {
  id: number;
  name: string;
  platforms?: number[];
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
        "limit 25;",
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
      console.warn(
        `[match] Ambiguous IGDB Windows executable ${JSON.stringify(name)}${requester} matched ${distinctGames.size} games: ${[
          ...distinctGames.values(),
        ]
          .map((game) => `${game.name} (${game.id})`)
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

  async searchGames(query: string, limit = 5): Promise<IgdbGame[]> {
    if (!this.configured || !this.options.clientId) return [];

    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];

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
        "where name != null;",
        `limit ${Math.max(1, Math.min(10, limit))};`,
      ].join(" "),
    });

    if (!response.ok) {
      throw new Error(
        `IGDB game search failed: ${response.status} ${await response.text()}`,
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
