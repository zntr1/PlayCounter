import type { Platform } from "@playcounter/shared";
import { currentPlatform } from "./platform";

/** The platform an executable name belongs to. A .exe is a Windows file, also
 *  when it runs under Wine or CrossOver; any other name runs natively. */
export function executablePlatform(exeName: string): Platform {
  return /\.exe$/i.test(exeName) ? "windows" : currentPlatform();
}

/** The `platform` field of community suggestions, cancellations and reports.
 *  Left out for Windows files: absent means Windows, and API instances from
 *  before Mac support refuse unknown fields on some of these routes. */
export function communityPlatformField(exeName: string): {
  platform?: Platform;
} {
  const platform = executablePlatform(exeName);
  return platform === "windows" ? {} : { platform };
}
