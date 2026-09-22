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

async function revealPaintedLoader() {
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
