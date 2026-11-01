import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const script = fileURLToPath(
  new URL("./check-desktop-version-sync.mjs", import.meta.url),
);

describe("desktop version check", () => {
  let root;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "playcounter-version-sync-"));
    await mkdir(join(root, "apps", "desktop", "src-tauri"), {
      recursive: true,
    });
    await writeFile(
      join(root, "apps", "desktop", "package.json"),
      JSON.stringify({ version: "9.9.9" }),
    );
    await writeFile(
      join(root, "apps", "desktop", "src-tauri", "tauri.conf.json"),
      JSON.stringify({ version: "9.9.9" }),
    );
    await writeFile(
      join(root, "apps", "desktop", "src-tauri", "Cargo.toml"),
      '[package]\nname = "playcounter"\nversion = "9.9.9"\n',
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const check = async (highlights) => {
    await writeFile(
      join(root, "releaseNotes.json"),
      JSON.stringify([{ version: "9.9.9", headline: "Headline", highlights }]),
    );
    return run(process.execPath, [script], {
      cwd: root,
      env: {
        ...process.env,
        PLAYCOUNTER_RELEASE_NOTES: join(root, "releaseNotes.json"),
      },
    });
  };

  it("accepts a release whose points are written as title and text", async () => {
    await check([
      {
        title: "Your achievements",
        text: "See what you unlocked.",
        image: "achievements",
      },
      { title: "Less CPU", text: "About a sixth of the CPU." },
    ]);
  });

  it("accepts a release written the old way", async () => {
    await check(["One line"]);
  });

  it("refuses a release with a point that has no title or no text", async () => {
    for (const point of [
      { title: "", text: "No title" },
      { title: "No text", text: " " },
      "",
    ]) {
      await assert.rejects(
        check([point]),
        /no usable entry for version 9\.9\.9/,
      );
    }
  });
});
