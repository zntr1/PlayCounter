import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { readEpicAccountLibrary, signInEpicAccount } from "./epicAccount";
import { useKeptLogins } from "./keptLogins";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  useKeptLogins.setState({ logins: [] });
});

it("connects Epic without scanning games and refreshes the saved account", async () => {
  const saved = [{ service: "epic", name: "Player One", savedAt: 1 }];
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "logins_list" ? saved : undefined,
  );
  await signInEpicAccount();
  expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
    "library_epic_sign_in",
    "logins_list",
  ]);
  expect(useKeptLogins.getState().logins).toEqual(saved);
});

it.each([
  ["sign-in", signInEpicAccount, "library_epic_sign_in"],
  ["library read", readEpicAccountLibrary, "library_epic_account_games"],
] as const)(
  "keeps the saved account visible when %s finishes after leaving the view",
  async (_, start, commandName) => {
    let complete!: () => void;
    const saved = [{ service: "epic", name: "Player One", savedAt: 2 }];
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === commandName) {
        return new Promise((resolve) => {
          complete = () => resolve(undefined);
        });
      }
      return Promise.resolve(command === "logins_list" ? saved : undefined);
    });
    const controller = new AbortController();
    const result = start(controller.signal);
    const cancelled = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await cancelled;
    const request = vi.mocked(invoke).mock.calls[0][1];
    expect(invoke).toHaveBeenCalledWith("library_cancel_epic_account", {
      requestId: (request as { requestId: string }).requestId,
    });
    expect(useKeptLogins.getState().logins).toEqual([]);
    complete();
    await vi.waitFor(() =>
      expect(useKeptLogins.getState().logins).toEqual(saved),
    );
    expect(invoke).not.toHaveBeenCalledWith("library_scan", expect.anything());
  },
);

it("retains saved status after a temporary library error", async () => {
  const saved = [{ service: "epic", name: "Player One", savedAt: 3 }];
  vi.mocked(invoke).mockImplementation((command) =>
    command === "library_epic_account_games"
      ? Promise.reject(new Error("Epic is temporarily unavailable"))
      : Promise.resolve(command === "logins_list" ? saved : undefined),
  );
  await expect(readEpicAccountLibrary()).rejects.toThrow(
    "temporarily unavailable",
  );
  expect(useKeptLogins.getState().logins).toEqual(saved);
});
