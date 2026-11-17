import { invoke } from "@tauri-apps/api/core";

/** "steam" when PlayCounter runs from a Steam library folder. Steam then
 *  delivers its updates (docs/steam-release-plan.md). */
export type InstallSource = "steam" | "direct";

export async function readInstallSource(): Promise<InstallSource> {
  try {
    const source = await invoke<string>("install_source");
    return source === "steam" ? "steam" : "direct";
  } catch {
    return "direct";
  }
}
