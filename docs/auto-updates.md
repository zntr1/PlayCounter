# Auto Updates

PlayCounter uses the Tauri v2 updater plugin. The app checks:

```text
https://stplaycountereuw.blob.core.windows.net/releases/latest.json
```

The updater trusts the signing key in `apps/desktop/src-tauri/tauri.conf.json`,
not the storage account. Keep the matching private key secret.

## Local Key

The current private key was generated at:

```text
apps/desktop/src-tauri/playcounter-updater.key
```

That file is ignored by git. Back it up in a password manager or CI secret
store. Losing it means existing installs cannot update to newly signed builds.

## Build A Signed Release

Increase both app versions before each release:

```text
apps/desktop/package.json
apps/desktop/src-tauri/tauri.conf.json
```

Then build from the repository root:

```powershell
scripts\build-desktop.cmd
```

The script sets `TAURI_SIGNING_PRIVATE_KEY_PATH` automatically when the local
private key exists. In CI, set one of these secrets instead:

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PATH
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

## Azure Blob Layout

Use a public-read container or public-read blobs:

```text
releases/
  latest.json
  PlayCounter_0.1.1_updater_artifact
```

Upload the installer first, then update `latest.json` last.

Example manifest:

```json
{
  "version": "0.1.1",
  "notes": "Bug fixes and tracking improvements.",
  "pub_date": "2026-05-22T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "SIGNATURE_FROM_BUILD_OUTPUT",
      "url": "https://stplaycountereuw.blob.core.windows.net/releases/UPDATER_ARTIFACT_FROM_TAURI_BUILD"
    }
  }
}
```

The signature is emitted by the Tauri build for the updater artifact. Upload
that exact artifact and paste the matching signature into the manifest.
