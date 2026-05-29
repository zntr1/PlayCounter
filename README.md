# PlayCounter

**Every game. Any launcher. One playtime.**

PlayCounter is a launcher-agnostic desktop app that tracks how long you play your
games — no matter whether they launch from Steam, Epic, GOG, Xbox, or a plain
`.exe`. It detects running games by matching executables against a community game
database, tracks your local play sessions, and shows your history and live
activity in one place.

## Why it's open source

PlayCounter watches your running processes to know when a game starts and stops.
That only works if you trust it. So the entire client **and** the server are open:
you can read exactly what is collected, what leaves your machine, and what does
not. Nothing is hidden.

## Privacy

- Play tracking happens **locally** on your machine.
- Data is only sent to the PlayCounter API when you **explicitly enable anonymous
  sharing** in Settings. When enabled, only anonymous game activity (heartbeats
  and session events) is shared — no personal identifiers.
- A blacklist lets you exclude any executable from tracking.
- You can point the app at your own API endpoint via Dev Tools.

## Features

- Launcher-independent game detection via running-process scanning (Windows,
  macOS, Linux)
- Automatic executable-to-game matching against the API
- Local play-session tracking with history
- Live activity feed (opt-in, anonymous)
- Configurable polling/heartbeat intervals and a per-executable blacklist
- Built-in auto-updater

## Project structure

This is a pnpm + Turborepo monorepo:

| Path | Description |
|------|-------------|
| `apps/desktop` | Tauri 2 + React 19 + TypeScript desktop app (Rust process scanner) |
| `apps/api` | Fastify API: executable matching, heartbeat/session endpoints, live WebSocket |
| `packages/shared` | Shared TypeScript API and model contracts |
| `scripts/igdb-seed` | IGDB-based game/executable seeding scripts |
| `landing` | Marketing landing page |

## Getting started

Requires [Node.js](https://nodejs.org/), [pnpm](https://pnpm.io/) (via Corepack),
and the [Rust toolchain](https://www.rust-lang.org/tools/install) plus the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
corepack enable
pnpm install
```

Run the desktop app in dev mode:

```bash
pnpm desktop:dev
```

Run the API in dev mode:

```bash
pnpm api:dev
```

Build the desktop app:

```bash
pnpm desktop:build
```

> The API uses an in-memory sample catalog unless `DATABASE_URL` (Postgres) is
> set. See `apps/api` for environment configuration.

## License

[MIT](./LICENSE) © zntr1
