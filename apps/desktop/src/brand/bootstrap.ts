// Wire the splash controls independently of React, including failed startups.
const windowControlsReady = setupBootWindowControls();

// Start the existing application immediately. No minimum splash duration.
// The early reveal uses PlayCounter's existing idempotent native
// command, which preserves its autostart-to-tray behaviour.
void import("../main").catch((error: unknown) => {
  console.error("PlayCounter startup failed", error);
  document.documentElement.setAttribute("data-pc-boot-failed", "true");
  const label = document.querySelector<HTMLElement>(".pc-boot-status");
  if (label)
    label.textContent = "PlayCounter couldn't start. Please try again.";
  const retry = document.querySelector<HTMLButtonElement>("#pc-boot-retry");
  if (retry) {
    retry.hidden = false;
    retry.addEventListener("click", () => window.location.reload(), {
      once: true,
    });
  }
});

async function setupBootWindowControls() {
  const controls = document.getElementById("pc-boot-window-controls");
  if (!controls || !("__TAURI_INTERNALS__" in window)) return;

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    const actions = {
      "pc-boot-minimize": () => win.minimize(),
      // Use the same close request as the app; Rust handles hiding to the tray.
      "pc-boot-close": () => win.close(),
    };
    for (const [id, action] of Object.entries(actions)) {
      document.getElementById(id)?.addEventListener("click", () => {
        void action().catch((error: unknown) =>
          console.warn("window control failed", error),
        );
      });
    }
    controls.hidden = false;
  } catch (error) {
    console.warn("startup window controls unavailable", error);
  }
}

async function revealPaintedLoader() {
  await windowControlsReady;
  const logo = document.querySelector<HTMLImageElement>("#initial-loader img");
  // A failed image must never prevent the native window from opening.
  if (logo) await logo.decode().catch(() => {});
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  try {
    const { invoke, isTauri } = await import("@tauri-apps/api/core");
    if (isTauri()) await invoke("main_window_ready");
  } catch {
    // main.tsx also reveals after painting if the app wins the startup race.
  }
}

void revealPaintedLoader();
export {};
