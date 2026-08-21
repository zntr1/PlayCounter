import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const files = {
  desktopPackage: "apps/desktop/package.json",
  tauriConfig: "apps/desktop/src-tauri/tauri.conf.json",
  cargoManifest: "apps/desktop/src-tauri/Cargo.toml",
};

const [desktopPackage, tauriConfig, cargoManifest] = await Promise.all([
  readJson(files.desktopPackage),
  readJson(files.tauriConfig),
  readFile(files.cargoManifest, "utf8"),
]);

const cargoVersion = cargoManifest.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const versions = new Map([
  [files.desktopPackage, desktopPackage.version],
  [files.tauriConfig, tauriConfig.version],
  [files.cargoManifest, cargoVersion],
]);

const missing = [...versions].filter(([, version]) => !version);
if (missing.length > 0) {
  throw new Error(
    `Missing version in ${missing.map(([file]) => file).join(", ")}`,
  );
}

const uniqueVersions = new Set(versions.values());
if (uniqueVersions.size > 1) {
  const details = [...versions]
    .map(([file, version]) => `  ${file}: ${version}`)
    .join("\n");

  throw new Error(`Desktop version files are out of sync:\n${details}`);
}

const releaseNotesPath = resolve(
  process.cwd(),
  process.env.PLAYCOUNTER_RELEASE_NOTES ?? "apps/desktop/src/releaseNotes.json",
);
let releaseNotes;
try {
  releaseNotes = await readJson(releaseNotesPath);
} catch (error) {
  throw new Error(
    `Could not read desktop release notes at ${releaseNotesPath}: ${error instanceof Error ? error.message : String(error)}`,
  );
}

const releaseNote = Array.isArray(releaseNotes)
  ? releaseNotes.find((entry) => entry?.version === tauriConfig.version)
  : undefined;
const usableHighlights =
  Array.isArray(releaseNote?.highlights) &&
  releaseNote.highlights.length > 0 &&
  releaseNote.highlights.every(
    (highlight) => typeof highlight === "string" && highlight.trim(),
  );
if (
  !releaseNote ||
  typeof releaseNote.headline !== "string" ||
  !releaseNote.headline.trim() ||
  !usableHighlights
) {
  throw new Error(
    `Release notes at ${releaseNotesPath} have no usable entry for version ${tauriConfig.version}. Add one (see docs/release-notes.md) before releasing.`,
  );
}

process.stdout.write(`Desktop version ${tauriConfig.version} is in sync.\n`);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
