import { expect, it, vi } from "vitest";
import { notifyFolderIgnored } from "./folderIgnoredToast";

it("says only the file was ignored and the rest of its folder stays tracked", () => {
  const addToast = vi.fn();
  notifyFolderIgnored("Launcher.exe", String.raw`D:\Games`, addToast);
  const { title, detail } = addToast.mock.calls[0][0];
  expect(title).toBe("Launcher.exe ignored in Games");
  expect(detail).toContain("Only this file, only on this PC.");
  expect(detail).toContain(
    "The rest of the folder stays tracked, and so do other games with this file name.",
  );
  expect(detail).not.toContain("Only this folder");
});
