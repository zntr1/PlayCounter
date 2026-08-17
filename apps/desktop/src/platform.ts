import type { Platform } from "@playcounter/shared";

export function detectPlatformFrom(
  userAgent: string,
  navigatorPlatform: string,
): Platform {
  const value = `${userAgent} ${navigatorPlatform}`.toLowerCase();
  if (/mac|darwin|iphone|ipad/.test(value)) return "macos";
  if (/windows|win32|win64|wow64/.test(value)) return "windows";
  return "linux";
}

export function currentPlatform(): Platform {
  return detectPlatformFrom(navigator.userAgent, navigator.platform);
}
