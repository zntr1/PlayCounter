import { readFile, writeFile } from "node:fs/promises";

const files = {
  desktopPackage: "apps/desktop/package.json",
  tauriConfig: "apps/desktop/src-tauri/tauri.conf.json",
  cargoManifest: "apps/desktop/src-tauri/Cargo.toml",
  cargoLock: "apps/desktop/src-tauri/Cargo.lock",
};

const tauriConfig = await readJson(files.tauriConfig);
const requestedVersion = process.argv[2];
const currentVersion = tauriConfig.version;

if (!currentVersion || typeof currentVersion !== "string") {
  throw new Error(`Missing desktop version in ${files.tauriConfig}`);
}

const version = requestedVersion
  ? resolveVersion(currentVersion, requestedVersion)
  : currentVersion;

if (requestedVersion) {
  tauriConfig.version = version;
  await writeJson(files.tauriConfig, tauriConfig);
}

await syncDesktopPackage(version);
await syncCargoManifest(version);
await syncCargoLock(version);

process.stdout.write(
  requestedVersion
    ? `Bumped desktop version from ${currentVersion} to ${version}.\n`
    : `Synced desktop version metadata to ${version}.\n`,
);

async function syncDesktopPackage(version) {
  const desktopPackage = await readJson(files.desktopPackage);
  desktopPackage.version = version;
  await writeJson(files.desktopPackage, desktopPackage);
}

async function syncCargoManifest(version) {
  const cargoManifest = await readFile(files.cargoManifest, "utf8");
  const updated = replaceFirstPackageVersion(
    cargoManifest,
    version,
    files.cargoManifest,
  );
  await writeFile(files.cargoManifest, updated);
}

async function syncCargoLock(version) {
  let cargoLock;
  try {
    cargoLock = await readFile(files.cargoLock, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }

    throw error;
  }

  const updated = cargoLock.replace(
    /(\[\[package\]\]\r?\nname = "playcounter"\r?\nversion = ")[^"]+(")/,
    `$1${version}$2`,
  );

  if (
    !/\[\[package\]\]\r?\nname = "playcounter"\r?\nversion = "[^"]+"/.test(
      cargoLock,
    )
  ) {
    throw new Error(`Could not find playcounter package in ${files.cargoLock}`);
  }

  await writeFile(files.cargoLock, updated);
}

function replaceFirstPackageVersion(contents, version, path) {
  const updated = contents.replace(
    /^version\s*=\s*"[^"]+"/m,
    `version = "${version}"`,
  );

  if (!/^version\s*=\s*"[^"]+"/m.test(contents)) {
    throw new Error(`Could not find package version in ${path}`);
  }

  return updated;
}

function resolveVersion(currentVersion, requestedVersion) {
  if (/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(requestedVersion)) {
    return requestedVersion;
  }

  const match = currentVersion.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(
      `Cannot auto-bump non-standard desktop version ${currentVersion}`,
    );
  }

  const [, majorText, minorText, patchText] = match;
  let major = Number(majorText);
  let minor = Number(minorText);
  let patch = Number(patchText);

  switch (requestedVersion) {
    case "major":
      major += 1;
      minor = 0;
      patch = 0;
      break;
    case "minor":
      minor += 1;
      patch = 0;
      break;
    case "patch":
      patch += 1;
      break;
    default:
      throw new Error(
        `Expected patch, minor, major, or an explicit x.y.z version. Received: ${requestedVersion}`,
      );
  }

  return `${major}.${minor}.${patch}`;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
