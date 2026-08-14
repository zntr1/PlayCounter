import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import type {
  CommunityGameSuggestionPayload,
  ContributionsResponse,
  EmulatorResolveRequest,
  FeedbackPayload,
  GameMetadataResponse,
  MatchProcessesRequest,
} from "@playcounter/shared";
import Fastify from "fastify";
import { z, ZodError } from "zod";
import { logger } from "./logger.js";
import type { PlayCounterRepository } from "./repository.js";
import {
  emulatorResolverDefinitions,
  supportsEmulatorContent,
} from "./emulatorResolvers.js";

const platformSchema = z.enum(["windows", "macos", "linux"]);
const identifierKindSchema = z.enum([
  "exe",
  "bundle_id",
  "app_bundle",
  "process_name",
  "steam_app_id",
  "executable_path",
  "executable_name",
  "desktop_id",
  "wine_exe",
]);
const matchProcessesSchema = z.object({
  processes: z
    .array(
      z.object({
        key: z.string().min(1).max(500),
        identifiers: z
          .array(
            z.object({
              platform: platformSchema,
              kind: identifierKindSchema,
              value: z.string().min(1).max(1000),
            }),
          )
          .min(1)
          .max(20),
      }),
    )
    .min(1)
    .max(200),
});
const emulatorContentValueSchema = z
  .string()
  .trim()
  .min(2)
  .max(96)
  .refine(
    (value) =>
      !/[\\/:\u0000-\u001f\u007f]/.test(value) && /^[\p{L}\p{N}]/u.test(value),
    "Content identifiers must be path-free normalized values.",
  );
const emulatorIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(
    (value) =>
      emulatorResolverDefinitions.some((definition) => definition.id === value),
    "Unsupported emulator identifier.",
  );
const emulatorContentKindSchema = z.enum([
  "conf",
  "program",
  "folder",
  "rom",
  "title_id",
]);
const emulatorResolveSchema = z.object({
  items: z
    .array(
      z
        .object({
          key: z.string().min(1).max(200),
          emulatorId: emulatorIdSchema,
          contentKind: emulatorContentKindSchema,
          contentValue: emulatorContentValueSchema,
          searchHint: z
            .string()
            .trim()
            .min(2)
            .max(120)
            .refine(
              (value) =>
                !value.includes("\\") && !/[\u0000-\u001f\u007f]/.test(value),
              "Search hints must be normalized title text.",
            )
            .optional(),
        })
        .refine(
          (item) => supportsEmulatorContent(item.emulatorId, item.contentKind),
          {
            path: ["contentKind"],
            message: "Unsupported content kind for this emulator.",
          },
        ),
    )
    .min(1)
    .max(20),
});
const communityMetadataQuerySchema = z.object({
  query: z.string().trim().min(2).max(120),
});
const emulatorGameSearchSchema = z.object({
  emulatorId: emulatorIdSchema,
  query: z.string().trim().min(2).max(120),
});
const gameMetadataQuerySchema = z.object({
  ids: z
    .string()
    .trim()
    .min(1)
    .transform((value) =>
      [...new Set(value.split(",").map((id) => Number(id.trim())))]
        .filter((id) => Number.isInteger(id) && id > 0)
        .slice(0, 100),
    ),
});
const feedbackSchema = z.object({
  type: z.enum(["bug", "feature", "other"]),
  message: z.string().trim().min(1).max(4000),
  appVersion: z.string().trim().max(50).optional().default(""),
  platform: z.string().trim().max(50).optional().default(""),
  installUuid: z.string().uuid().optional(),
});
const communityGameSuggestionSchema = z.object({
  exeName: z.string().trim().min(1).max(260),
  name: z.string().trim().min(1).max(200),
  coverUrl: z
    .string()
    .trim()
    .url()
    .max(1000)
    .refine(
      (value) => new URL(value).host === "images.igdb.com",
      "Cover image must be an IGDB image URL.",
    )
    .optional()
    .or(z.literal("")),
  igdbId: z.number().int().positive().optional(),
  installUuid: z.string().uuid().optional(),
});
const contributionsQuerySchema = z.object({
  installUuid: z.string().uuid(),
});

export async function buildApp(repository: PlayCounterRepository) {
  const app = Fastify({ loggerInstance: logger, disableRequestLogging: true });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      request.log.warn({ issues: error.issues }, "invalid request");
      return reply.code(400).send({
        error: "Bad Request",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    return reply.send(error);
  });

  const quietPaths = [
    "/health",
    "/api/heartbeat",
    "/api/session-end",
    "/api/stats",
    "/api/community/contributions",
  ];
  app.addHook("onResponse", (request, reply, done) => {
    const isQuiet =
      request.method === "OPTIONS" ||
      quietPaths.some((path) => request.url.startsWith(path));
    if (isQuiet && reply.statusCode < 500) {
      done();
      return;
    }
    const line = `${request.method} ${request.url} -> ${reply.statusCode} (${Math.round(reply.elapsedTime)}ms)`;
    if (reply.statusCode >= 500) request.log.error(line);
    else if (reply.statusCode >= 400) request.log.warn(line);
    else request.log.info(line);
    done();
  });

  await app.register(cors, { origin: true });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

  app.get("/health", async () => ({ ok: true }));
  app.post("/api/match-processes", async (request) => {
    const body = matchProcessesSchema.parse(
      request.body,
    ) satisfies MatchProcessesRequest;
    const matches = await repository.matchProcesses(body.processes);
    return {
      matches: body.processes.map((process) => {
        const match = matches.get(process.key);
        return {
          key: process.key,
          game: match?.game ?? null,
          matchedIdentifier: match?.identifier,
          ambiguousGames: match?.ambiguousGames,
          pendingCommunityGame: match?.pendingCommunityGame,
          pendingCommunityGames: match?.pendingCommunityGames ?? [],
          communityGameAliases: match?.communityGameAliases,
        };
      }),
    };
  });
  app.post("/api/emulator/resolve", async (request) => {
    const body = emulatorResolveSchema.parse(
      request.body,
    ) satisfies EmulatorResolveRequest;
    return { results: await repository.resolveEmulatorContent(body.items) };
  });
  app.get("/api/emulator/games/search", async (request) => {
    const query = emulatorGameSearchSchema.parse(request.query);
    return {
      games: await repository.searchEmulatorGames(
        query.emulatorId,
        query.query,
      ),
    } satisfies GameMetadataResponse;
  });
  app.get("/api/community/metadata", async (request) => {
    const query = communityMetadataQuerySchema.parse(request.query);
    return {
      candidates: await repository.searchCommunityMetadata(query.query),
    };
  });
  app.get("/api/community/contributions", async (request) => {
    const query = contributionsQuerySchema.parse(request.query);
    return repository.listContributions(
      query.installUuid,
    ) satisfies Promise<ContributionsResponse>;
  });
  app.get("/api/games/metadata", async (request) => {
    const query = gameMetadataQuerySchema.parse(request.query);
    return {
      games: await repository.gamesByIds(query.ids),
    } satisfies GameMetadataResponse;
  });
  app.get("/api/games/search", async (request) => {
    const query = communityMetadataQuerySchema.parse(request.query);
    return {
      games: await repository.searchIgdbGames(query.query),
    } satisfies GameMetadataResponse;
  });
  app.post("/api/community/suggestions", async (request) => {
    const body = communityGameSuggestionSchema.parse(
      request.body,
    ) satisfies CommunityGameSuggestionPayload;
    return repository.suggestCommunityGame(body);
  });
  app.post("/api/feedback", async (request) => {
    const body = feedbackSchema.parse(request.body) satisfies FeedbackPayload;
    return repository.createFeedback(body);
  });

  app.post("/api/heartbeat", async (_request, reply) => reply.code(204).send());
  app.post("/api/session-end", async (_request, reply) =>
    reply.code(204).send(),
  );
  app.get("/api/stats/today", async () => []);
  app.get("/api/stats/week", async () => []);

  return app;
}
