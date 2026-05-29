import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const root = process.cwd();
const deployRoot = resolve(root, ".deploy/api");
const stagingDir = join(deployRoot, "package");
const zipPath = join(deployRoot, "playcounter-api.zip");

await rm(deployRoot, { recursive: true, force: true });
await mkdir(stagingDir, { recursive: true });

const rootPackage = require(resolve(root, "package.json"));
const apiPackage = require(resolve(root, "apps/api/package.json"));

await copyRequired("apps/api/dist");
await copyRequired("apps/api/package.json");
await copyRequired("packages/shared/dist");
await copyRequired("packages/shared/package.json");
await copyRequired("pnpm-lock.yaml");

await writeFile(
  join(stagingDir, "package.json"),
  `${JSON.stringify(
    {
      name: "playcounter-api-deploy",
      version: apiPackage.version,
      private: true,
      type: "module",
      packageManager: rootPackage.packageManager,
      scripts: {
        start: "node apps/api/dist/server.js",
      },
      dependencies: {
        ...apiPackage.dependencies,
        "@playcounter/shared": "file:packages/shared",
      },
      engines: {
        node: ">=22",
      },
    },
    null,
    2,
  )}\n`,
);

await writeFile(
  join(stagingDir, "pnpm-workspace.yaml"),
  'packages:\n  - "apps/*"\n  - "packages/*"\n',
);

runPnpmInstall(stagingDir);
await createZip(stagingDir, zipPath);
process.stdout.write(`Created ${zipPath}\n`);

async function copyRequired(relativePath) {
  const source = resolve(root, relativePath);
  const destination = join(stagingDir, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
}

async function createZip(sourceDir, destination) {
  await rm(destination, { force: true });

  const result =
    process.platform === "win32"
      ? spawnSync(
          "powershell",
          [
            "-NoProfile",
            "-Command",
            "Compress-Archive -Path * -DestinationPath $env:PLAYCOUNTER_ZIP_DESTINATION -Force",
          ],
          {
            cwd: sourceDir,
            env: {
              ...process.env,
              PLAYCOUNTER_ZIP_DESTINATION: destination,
            },
            stdio: "inherit",
          },
        )
      : spawnSync("zip", ["-qr", destination, "."], {
          cwd: sourceDir,
          stdio: "inherit",
        });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Zip command failed with status ${result.status}`);
  }
}

function runPnpmInstall(directory) {
  const args = [
    "--prod",
    "--frozen-lockfile=false",
    "--config.node-linker=hoisted",
  ];
  const result =
    process.platform === "win32"
      ? spawnSync("cmd.exe", ["/d", "/c", "pnpm", "install", ...args], {
          cwd: directory,
          stdio: "inherit",
        })
      : spawnSync("pnpm", ["install", ...args], {
          cwd: directory,
          stdio: "inherit",
        });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`pnpm install failed with status ${result.status}`);
  }
}
