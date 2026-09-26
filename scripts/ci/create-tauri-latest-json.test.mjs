import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { verifyUpdaterSignature } from "./updater-signature.mjs";

const run = promisify(execFile);
const script = fileURLToPath(
  new URL("./create-tauri-latest-json.mjs", import.meta.url),
);
const fixture = (name) =>
  readFileSync(new URL(`./fixtures/updater/${name}`, import.meta.url));
// Signed by `tauri signer sign` with a throwaway key, not the release key.
const installer = fixture("installer.bin");
const signature = fixture("installer.bin.minisig").toString().trim();
const testPubkey = fixture("test-key.pub").toString().trim();
const releasePubkey = JSON.parse(
  readFileSync(
    new URL("../../apps/desktop/src-tauri/tauri.conf.json", import.meta.url),
    "utf8",
  ),
).plugins.updater.pubkey;

describe("updater signature", () => {
  it("accepts a signature made by the Tauri CLI", () => {
    verifyUpdaterSignature(installer, signature, testPubkey);
  });

  it("rejects a changed file", () => {
    assert.throws(
      () =>
        verifyUpdaterSignature(
          Buffer.concat([installer, Buffer.from("x")]),
          signature,
          testPubkey,
        ),
      /does not match the file/,
    );
  });

  it("rejects a file signed with a key installed apps do not trust", () => {
    assert.throws(
      () => verifyUpdaterSignature(installer, signature, releasePubkey),
      /does not match the app's public key/,
    );
  });

  it("rejects a changed trusted comment", () => {
    const lines = Buffer.from(signature, "base64").toString().split("\n");
    lines[2] = `${lines[2]}-changed`;
    assert.throws(
      () =>
        verifyUpdaterSignature(
          installer,
          Buffer.from(lines.join("\n")).toString("base64"),
          testPubkey,
        ),
      /comment was changed/,
    );
  });
});

describe("latest.json", () => {
  let root;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "playcounter-latest-json-"));
    await mkdir(join(root, "bundle", "nsis"), { recursive: true });
    await writeInstaller(installer);
    await writeFile(
      join(root, "bundle", "nsis", "PlayCounter_9.9.9_x64-setup.exe.sig"),
      signature,
    );
    await writeConfig(testPubkey);
    await writeFile(
      join(root, "releaseNotes.json"),
      JSON.stringify([
        { version: "9.9.9", headline: "Headline", highlights: ["One"] },
      ]),
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const writeInstaller = (bytes) =>
    writeFile(
      join(root, "bundle", "nsis", "PlayCounter_9.9.9_x64-setup.exe"),
      bytes,
    );
  const writeConfig = (pubkey) =>
    writeFile(
      join(root, "tauri.conf.json"),
      JSON.stringify({ version: "9.9.9", plugins: { updater: { pubkey } } }),
    );
  const createManifest = () =>
    run(
      process.execPath,
      [script, "bundle", "https://example.test/releases/", "out/latest.json"],
      {
        cwd: root,
        env: {
          ...process.env,
          PLAYCOUNTER_TAURI_CONFIG: join(root, "tauri.conf.json"),
          PLAYCOUNTER_RELEASE_NOTES: join(root, "releaseNotes.json"),
        },
      },
    );
  const manifestPath = () => join(root, "out", "latest.json");

  it("describes the signed Windows installer for the configured version", async () => {
    await createManifest();
    const manifest = JSON.parse(await readFile(manifestPath(), "utf8"));
    assert.equal(manifest.version, "9.9.9");
    assert.equal(manifest.notes, "Headline\n• One");
    assert.ok(!Number.isNaN(Date.parse(manifest.pub_date)));
    assert.deepEqual(manifest.platforms, {
      "windows-x86_64": {
        signature,
        url: "https://example.test/releases/PlayCounter_9.9.9_x64-setup.exe",
      },
    });
  });

  it("refuses an installer that changed after signing", async () => {
    await writeInstaller(Buffer.concat([installer, Buffer.from("x")]));
    await assert.rejects(createManifest(), /does not match the file/);
    assert.equal(existsSync(manifestPath()), false);
  });

  it("refuses a signature from another key than the app trusts", async () => {
    await writeConfig(releasePubkey);
    await assert.rejects(
      createManifest(),
      /does not match the app's public key/,
    );
    assert.equal(existsSync(manifestPath()), false);
  });

  it("refuses to publish without a signed installer", async () => {
    await rm(
      join(root, "bundle", "nsis", "PlayCounter_9.9.9_x64-setup.exe.sig"),
    );
    await assert.rejects(
      createManifest(),
      /Could not find a signed Windows updater artifact/,
    );
    assert.equal(existsSync(manifestPath()), false);
  });
});
