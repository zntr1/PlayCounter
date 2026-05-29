import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function findDotEnv(startDir: string) {
  let currentDir = startDir;

  while (true) {
    const candidates = [
      path.join(currentDir, ".env"),
      path.join(currentDir, "apps", ".env"),
    ];
    const found = candidates.find((candidate) => existsSync(candidate));
    if (found) return found;

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

export function loadDotEnv(filePath = findDotEnv(process.cwd())) {
  if (!filePath) return;

  let contents: string;
  try {
    contents = readFileSync(filePath, "utf8");
  } catch {
    return;
  }

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    process.env[key] = rawValue.replace(/^(['"])(.*)\1$/, "$2");
  }
}
