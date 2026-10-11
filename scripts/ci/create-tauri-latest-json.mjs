import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { verifyUpdaterSignature } from "./updater-signature.mjs";

const bundleRootsArg =
  process.argv[2] ?? "apps/desktop/src-tauri/target/release/bundle";
const bundleRoots = bundleRootsArg
  .split(",")
  .map((root) => resolve(process.cwd(), root.trim()))
  .filter(Boolean);
const releaseBaseUrl =
  process.argv[3] ?? "https://stplaycountereuw.blob.core.windows.net/releases";
const latestPath = resolve(
  process.cwd(),
  process.argv[4] ?? join(bundleRoots[0], "latest.json"),
);

const tauriConfigPath = resolve(
  process.cwd(),
  process.env.PLAYCOUNTER_TAURI_CONFIG ??
    "apps/desktop/src-tauri/tauri.conf.json",
);
const tauriConfig = JSON.parse(await readFile(tauriConfigPath, "utf8"));
const version = tauriConfig.version;
const updaterPubkey = tauriConfig.plugins?.updater?.pubkey;
const releaseNotesPath = resolve(
  process.cwd(),
  process.env.PLAYCOUNTER_RELEASE_NOTES ?? "apps/desktop/src/releaseNotes.json",
);

if (!version || typeof version !== "string") {
  throw new Error(`Missing version in ${tauriConfigPath}`);
}
if (!updaterPubkey || typeof updaterPubkey !== "string") {
  throw new Error(`Missing updater pubkey in ${tauriConfigPath}`);
}

const files = (await Promise.all(bundleRoots.map(listFiles))).flat();
const platforms = {};
await addUpdaterPlatform(
  platforms,
  "windows-x86_64",
  findWindowsUpdaterArtifact(files),
);

const macOsX64Artifact = findMacOsUpdaterArtifact(files, "x86_64");
if (macOsX64Artifact) {
  await addUpdaterPlatform(platforms, "darwin-x86_64", macOsX64Artifact);
}

const macOsArm64Artifact = findMacOsUpdaterArtifact(files, "aarch64");
if (macOsArm64Artifact) {
  await addUpdaterPlatform(platforms, "darwin-aarch64", macOsArm64Artifact);
}

const releaseNotes = await readReleaseNotes(version);
const manifest = {
  version,
  // Every app version reads the English "notes"; versions with languages
  // also read "notes_translations" (language -> notes in the same format).
  notes: releaseNotes.notes,
  ...(releaseNotes.translations
    ? { notes_translations: releaseNotes.translations }
    : {}),
  pub_date: new Date().toISOString(),
  platforms,
};

await mkdir(dirname(latestPath), { recursive: true });
await writeFile(latestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const noteLanguages = [
  "en",
  ...Object.keys(manifest.notes_translations ?? {}),
].join(", ");
process.stdout.write(
  `Created ${latestPath} for ${Object.keys(platforms).join(", ")} (${manifest.notes ? `release notes in ${noteLanguages}` : "no release notes"})\n`,
);

async function readReleaseNotes(releaseVersion) {
  try {
    const catalog = JSON.parse(await readFile(releaseNotesPath, "utf8"));
    if (!Array.isArray(catalog)) return { notes: "" };
    const entry = catalog.find(
      (candidate) =>
        candidate &&
        typeof candidate === "object" &&
        candidate.version === releaseVersion,
    );
    const notes = formatReleaseNotes(entry);
    if (!notes) return { notes: "" };
    const rawTranslations =
      entry.translations && typeof entry.translations === "object"
        ? entry.translations
        : {};
    const translations = Object.fromEntries(
      Object.entries(rawTranslations)
        .map(([language, text]) => [language, formatReleaseNotes(text)])
        .filter(([, text]) => text),
    );
    return Object.keys(translations).length > 0
      ? { notes, translations }
      : { notes };
  } catch {
    return { notes: "" };
  }
}

function formatReleaseNotes(text) {
  if (
    !text ||
    typeof text !== "object" ||
    typeof text.headline !== "string" ||
    !text.headline.trim() ||
    !Array.isArray(text.highlights)
  ) {
    return "";
  }
  const highlights = text.highlights
    .filter((highlight) => typeof highlight === "string" && highlight.trim())
    .map((highlight) => `• ${highlight.trim()}`);
  if (highlights.length === 0) return "";
  return [text.headline.trim(), ...highlights].join("\n").slice(0, 4_000);
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : path;
    }),
  );

  return nested.flat();
}

function findWindowsUpdaterArtifact(files) {
  const installers = files
    .filter((file) => [".exe", ".msi"].includes(extname(file).toLowerCase()))
    .filter((file) => files.includes(`${file}.sig`));

  const nsisInstaller = installers.find((file) => extname(file) === ".exe");
  const installer = nsisInstaller ?? installers[0];

  if (!installer) {
    throw new Error(
      `Could not find a signed Windows updater artifact under ${bundleRoots.join(", ")}`,
    );
  }

  return installer;
}

function findMacOsUpdaterArtifact(files, arch) {
  const archFiles = files.filter((file) => file.includes(arch));
  const dmg = archFiles.find(
    (file) =>
      extname(file).toLowerCase() === ".dmg" && files.includes(`${file}.sig`),
  );

  if (!dmg) {
    return null;
  }

  return dmg;
}

async function addUpdaterPlatform(platforms, platform, artifact) {
  const signaturePath = `${artifact}.sig`;
  const signature = (await readFile(signaturePath, "utf8")).trim();
  if (!signature) {
    throw new Error(`Empty updater signature: ${signaturePath}`);
  }
  try {
    verifyUpdaterSignature(await readFile(artifact), signature, updaterPubkey);
  } catch (error) {
    throw new Error(`${basename(artifact)}: ${error.message}`);
  }

  const artifactName = releaseArtifactName(artifact);
  platforms[platform] = {
    signature,
    url: `${releaseBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(artifactName)}`,
  };
}

function releaseArtifactName(artifact) {
  if (artifact.includes("desktop-macos-x86_64-bundle")) {
    return `macos-x86_64-${basename(artifact)}`;
  }
  if (artifact.includes("desktop-macos-aarch64-bundle")) {
    return `macos-aarch64-${basename(artifact)}`;
  }
  return basename(artifact);
}
