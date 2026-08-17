import { describe, expect, it } from "vitest";
import { detectPlatformFrom } from "./platform";

describe("desktop platform detection", () => {
  it("detects Windows", () => {
    expect(detectPlatformFrom("Mozilla/5.0 (Windows NT 10.0)", "Win32")).toBe(
      "windows",
    );
  });

  it("does not mistake Darwin for Windows", () => {
    expect(
      detectPlatformFrom("Darwin Macintosh; Intel Mac OS X", "MacIntel"),
    ).toBe("macos");
  });

  it("falls back to Linux", () => {
    expect(detectPlatformFrom("Mozilla/5.0 (X11; Linux x86_64)", "Linux")).toBe(
      "linux",
    );
  });
});
