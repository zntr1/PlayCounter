import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import type {
  CommunityGameSuggestionPayload,
  FeedbackPayload,
  GameMetadataResponse,
  HeartbeatPayload,
  MatchProcessesRequest,
  SessionEndPayload,
} from "@playcounter/shared";
import Fastify from "fastify";
import { z, ZodError } from "zod";
import { loadDotEnv } from "./env.js";
import { logger } from "./logger.js";
import { createRepository } from "./repository.js";

loadDotEnv();

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
const heartbeatSchema = z.object({
  installUuid: z.string().uuid(),
  gameId: z.number().int().positive(),
  source: z.enum(["igdb", "community"]),
});
const communityMetadataQuerySchema = z.object({
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
  installUuid: z.string().uuid().optional(),
});

// Use our shared pretty logger and turn off Fastify's built-in request logging;
// the onResponse hook below logs one tidy line per request instead of the two
// raw-JSON lines (incoming + completed) Fastify emits by default.
const app = Fastify({ loggerInstance: logger, disableRequestLogging: true });
const repository = createRepository();

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

// Routes that fire constantly (health probes, CORS preflight, client
// heartbeats) would otherwise drown the log. Skip them while everything is
// fine, but still surface them if they ever fail with a 5xx.
const QUIET_PATHS = ["/health", "/api/heartbeat", "/api/session-end"];

app.addHook("onResponse", (request, reply, done) => {
  const isQuiet =
    request.method === "OPTIONS" ||
    QUIET_PATHS.some((path) => request.url.startsWith(path));
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
await app.register(rateLimit, {
  max: 120,
  timeWindow: "1 minute",
});
await app.register(websocket);

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
      };
    }),
  };
});

app.get("/api/community/metadata", async (request) => {
  const query = communityMetadataQuerySchema.parse(request.query);
  return {
    candidates: await repository.searchCommunityMetadata(query.query),
  };
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

app.post(
  "/api/heartbeat",
  { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
  async (request, reply) => {
    const body = heartbeatSchema.parse(request.body) satisfies HeartbeatPayload;
    await repository.heartbeat(body.installUuid, body.gameId, body.source);
    return reply.code(204).send();
  },
);

app.post("/api/session-end", async (request, reply) => {
  const body = heartbeatSchema.parse(request.body) satisfies SessionEndPayload;
  await repository.endSession(body.installUuid, body.gameId, body.source);
  return reply.code(204).send();
});

const liveSockets = new Set<import("@fastify/websocket").WebSocket>();
const MAX_LIVE_CONNECTIONS =
  Number.parseInt(process.env.LIVE_MAX_CONNECTIONS ?? "", 10) || 10_000;
let lastLiveSnapshot = "[]";

async function broadcastLiveSnapshot() {
  try {
    lastLiveSnapshot = JSON.stringify(await repository.liveSnapshot());
  } catch (error) {
    app.log.error({ error }, "live snapshot failed");
    return;
  }
  for (const socket of liveSockets) {
    if (socket.readyState === socket.OPEN) socket.send(lastLiveSnapshot);
  }
}

void broadcastLiveSnapshot();
setInterval(() => void broadcastLiveSnapshot(), 10_000);

app.get("/api/live", { websocket: true }, (socket) => {
  if (liveSockets.size >= MAX_LIVE_CONNECTIONS) {
    socket.close(1013, "Too many connections");
    return;
  }

  liveSockets.add(socket);
  socket.send(lastLiveSnapshot);
  socket.on("close", () => liveSockets.delete(socket));
});

app.get("/api/stats/today", async () => repository.statsToday());
app.get("/api/stats/week", async () => repository.statsWeek());

setInterval(() => void repository.purgeStaleSessions(120_000), 120_000);

const port = Number(process.env.PORT ?? 4000);
await app.listen({ host: "0.0.0.0", port });
