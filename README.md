# PlayCounter

**Automatic playtime tracking for Windows, regardless of launcher.**

[![Latest release](https://img.shields.io/github/v/release/zntr1/PlayCounter?label=download&sort=semver)](https://github.com/zntr1/PlayCounter/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/t2nG3jaEEY)

PlayCounter watches what's actually running on your PC and records playtime for
recognized games, regardless of how they were launched (Steam, Epic, GOG, EA,
Ubisoft, Battle.net, a shortcut, or a plain `.exe`). Unknown games can be added
locally or submitted as community matches for review. Sessions and recent
history stay on the PC, and the free, open-source app does not require an
account.

Different AI models supported me in developing this application.

## Download

**[Download the latest release for Windows →](https://github.com/zntr1/PlayCounter/releases/latest)**

Every release ships the Windows installer together with its **SHA-256 checksum**
and an independent **VirusTotal scan**, so you can verify your download before you
install. macOS and Linux are planned.

## Screenshots

![PlayCounter recording Cyberpunk 2077](docs/screenshots/now-playing.png)

|                               Game library                                |                                   Session history                                   |
| :-----------------------------------------------------------------------: | :---------------------------------------------------------------------------------: |
| ![PlayCounter library with game cover art](docs/screenshots/my-games.png) | ![PlayCounter session history with game cover art](docs/screenshots/my-history.png) |

## Why it's open source

PlayCounter watches your running processes to know when a game starts and stops.
That only works if you trust it. So the entire client **and** the server it talks
to are open: you can read exactly what is collected, what leaves your machine, and
what does not. Nothing is hidden.

## Privacy

- Play tracking happens **locally** on your machine - your history stays there.
- Automatic game matching sends the required process identifier to the API. On
  Windows this is the executable filename, never its full path.
- Feedback and community game submissions are only sent when you choose those
  actions. No PlayCounter account is required.
- A blacklist lets you exclude any executable from tracking.

## Features

- Detects recognized games by watching running processes, with no per-launcher
  setup and no requirement to launch through PlayCounter
- Track anything you choose, not just games (any process on your PC)
- Automatic executable-to-game matching against the API
- Local play-session tracking with recent history and manual session entry
- Current / "now playing" view with a system-tray indicator
- Community suggestions and one-time local choices for unknown or ambiguous exes
- Configurable polling and unmatched-retry intervals plus an executable blacklist
- Built-in auto-updater

## Project structure

This is a pnpm + Turborepo monorepo:

| Path                | Description                                                                     |
| ------------------- | ------------------------------------------------------------------------------- |
| `apps/desktop`      | Tauri 2 + React 19 + TypeScript desktop app (Rust process scanner)              |
| `apps/api`          | Fastify API: executable matching, community suggestions, metadata, and feedback |
| `packages/shared`   | Shared TypeScript API and model contracts                                       |
| `scripts/igdb-seed` | IGDB-based game/executable seeding scripts                                      |
| `landing`           | Marketing landing page                                                          |

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

> The API uses an in-memory sample catalog unless `DATABASE_URL` (Postgres) is set.
> Copy `apps/.env.example` to `apps/.env` for environment configuration.

## License

[MIT](./LICENSE) © zntr1
