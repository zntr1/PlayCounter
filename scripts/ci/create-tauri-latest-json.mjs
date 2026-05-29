import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";

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

const tauriConfig = JSON.parse(
  await readFile("apps/desktop/src-tauri/tauri.conf.json", "utf8"),
);
const version = tauriConfig.version;

if (!version || typeof version !== "string") {
  throw new Error("Missing version in apps/desktop/src-tauri/tauri.conf.json");
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

const manifest = {
  version,
  notes: "",
  pub_date: new Date().toISOString(),
  platforms,
};

await mkdir(dirname(latestPath), { recursive: true });
await writeFile(latestPath, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(
  `Created ${latestPath} for ${Object.keys(platforms).join(", ")}\n`,
);

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
