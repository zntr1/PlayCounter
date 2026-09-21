# PlayCounter Amber identity

Approved artwork from `PlayCounter-Amber-App-Kit`, delivered 2026-09-21.
The SVGs are copied from its Tauri adapter without modifying their geometry,
palette, motion, or outlined Bricolage Grotesque lettering.

- `playcounter-mark.svg`: normal sidebar, empty library, notification fallback.
- `playcounter-mark-small.svg`: small provider badges, collapsed sidebar, favicon.
- `playcounter-wordmark-on-*.svg`: lettering for dark and light surfaces.
- `playcounter-logo-on-*.svg`: complete static icon and wordmark lockups.
- `playcounter-loader.svg`: startup animation, only while work is pending.
- `playcounter-loader-static.svg`: reduced-motion alternative.

The matching ICO, ICNS and PNG exports live in `src-tauri/icons/`; `public/icon.png`
remains available as a raster fallback. Lettering attribution is included in
`Bricolage-Grotesque-OFL.txt`. React components and shared wordmark styles live in
`src/brand/`.

The startup bootstrap imports the application immediately and reveals the native
window after its first painted artwork. It uses the existing `main_window_ready`
command so saved geometry and startup-to-tray behavior remain native-owned.
There is no minimum animation duration. Failed module imports show a retry action.
