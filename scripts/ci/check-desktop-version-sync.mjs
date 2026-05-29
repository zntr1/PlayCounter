import { readFile } from "node:fs/promises";

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

process.stdout.write(`Desktop version ${tauriConfig.version} is in sync.\n`);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
