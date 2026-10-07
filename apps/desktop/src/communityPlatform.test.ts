import { beforeEach, expect, it, vi } from "vitest";
const { platform } = vi.hoisted(() => ({
  platform: { current: "windows" as "windows" | "macos" | "linux" },
}));
vi.mock("./platform", () => ({ currentPlatform: () => platform.current }));
import {
  communityPlatformField,
  executablePlatform,
} from "./communityPlatform";

beforeEach(() => {
  platform.current = "windows";
});

it("sends no platform for Windows files, so requests stay unchanged", () => {
  expect(communityPlatformField("RimWorldWin64.exe")).toEqual({});
  expect(communityPlatformField("launcher")).toEqual({});
});

it("names the Mac platform for native Mac processes", () => {
  platform.current = "macos";
  expect(communityPlatformField("RimWorld by Ludeon Studios")).toEqual({
    platform: "macos",
  });
  expect(executablePlatform("RimWorld by Ludeon Studios")).toBe("macos");
});

it("treats a .exe on a Mac as a Windows file run through Wine", () => {
  platform.current = "macos";
  expect(executablePlatform("Game.EXE")).toBe("windows");
  expect(communityPlatformField("Game.exe")).toEqual({});
});
