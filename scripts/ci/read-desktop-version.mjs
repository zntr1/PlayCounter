import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const configPath = resolve(
  process.cwd(),
  process.argv[2] ?? "apps/desktop/src-tauri/tauri.conf.json",
);

const config = JSON.parse(await readFile(configPath, "utf8"));

if (!config.version || typeof config.version !== "string") {
  throw new Error(`Missing desktop version in ${configPath}`);
}

process.stdout.write(`${config.version}\n`);
