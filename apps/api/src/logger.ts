import { pino } from "pino";

const level = process.env.LOG_LEVEL ?? "info";

/**
 * Shared application logger. Renders human-readable, single-line output via
 * pino-pretty so the server log stays easy to scan. The same instance is
 * handed to Fastify (see server.ts) and used directly by the repository, so
 * request logs and domain logs share one consistent format.
 */
export const logger = pino({
  level,
  transport: {
    target: "pino-pretty",
    options: {
      // Colors only when attached to a real terminal. Azure App Service
      // (and any non-TTY stdout, e.g. piped to a file) gets clean plain text
      // instead of raw ANSI escape codes in Log Stream / downloaded logs.
      colorize: process.stdout.isTTY ?? false,
      translateTime: "SYS:HH:MM:ss",
      ignore: "pid,hostname,reqId",
    },
  },
});

/**
 * Formats a count with the right singular/plural noun, e.g. `count(1, "process",
 * "processes")` -> "1 process" and `count(3, "hit")` -> "3 hits". Keeps log
 * lines readable instead of the awkward "1 process(es)" style.
 */
export function count(
  value: number,
  singular: string,
  plural = `${singular}s`,
) {
  return `${value} ${value === 1 ? singular : plural}`;
}
