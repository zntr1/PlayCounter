import {
  resolveLanguage,
  systemLocales,
  type AppLanguage,
} from "../appLanguages";
import deBoot from "../locales/de/boot.json";
import enBoot from "../locales/en/boot.json";
import ptBRBoot from "../locales/pt-BR/boot.json";
import zhCNBoot from "../locales/zh-CN/boot.json";
import esBoot from "../locales/es/boot.json";
import frBoot from "../locales/fr/boot.json";
import plBoot from "../locales/pl/boot.json";
import ruBoot from "../locales/ru/boot.json";

// The startup screen shows before the app and its language files load, so it
// carries its own few texts. Set them before the window is revealed.
const BOOT_TEXTS: Record<AppLanguage, Record<keyof typeof enBoot, string>> = {
  en: enBoot,
  de: deBoot,
  "pt-BR": ptBRBoot,
  "zh-CN": zhCNBoot,
  es: esBoot,
  fr: frBoot,
  pl: plBoot,
  ru: ruBoot,
};
const bootLanguage = resolveLanguage(savedLanguageSetting(), systemLocales());
const bootTexts = BOOT_TEXTS[bootLanguage];
showBootTexts();

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
    label.textContent =
      bootTexts["PlayCounter couldn't start. Please try again."];
  const retry = document.querySelector<HTMLButtonElement>("#pc-boot-retry");
  if (retry) {
    retry.hidden = false;
    retry.addEventListener("click", () => window.location.reload(), {
      once: true,
    });
  }
});

function savedLanguageSetting() {
  try {
    const saved = JSON.parse(
      localStorage.getItem("playcounter:v1") || "null",
    ) as { settings?: { language?: unknown } } | null;
    const language = saved?.settings?.language;
    return typeof language === "string" ? language : undefined;
  } catch {
    return undefined;
  }
}

function showBootTexts() {
  // Also picks the right font, e.g. for Chinese.
  document.documentElement.lang = bootLanguage;
  const status = document.querySelector<HTMLElement>(".pc-boot-status");
  if (status) status.textContent = bootTexts["Loading your games.."];
  const retry = document.getElementById("pc-boot-retry");
  if (retry) retry.textContent = bootTexts["Try again"];
  document
    .getElementById("pc-boot-window-controls")
    ?.setAttribute("aria-label", bootTexts["Window controls"]);
  const minimize = document.getElementById("pc-boot-minimize");
  minimize?.setAttribute("aria-label", bootTexts["Minimize window"]);
  minimize?.setAttribute("title", bootTexts["Minimize"]);
  const close = document.getElementById("pc-boot-close");
  close?.setAttribute("aria-label", bootTexts["Close to tray"]);
  close?.setAttribute("title", bootTexts["Close to tray"]);
}

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
