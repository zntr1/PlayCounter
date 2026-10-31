// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LibraryScanOptions } from "../../library/provider";
import type { LibraryScanResult } from "../../library/types";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  scan: vi.fn(),
  connect: vi.fn(),
  openImport: vi.fn(),
  logins: [] as { service: string; name: string | null; savedAt: number }[],
  steamAvailable: true,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  convertFileSrc: (value: string) => value,
}));
vi.mock("../../library/importRequest", () => ({
  openLauncherImport: mocks.openImport,
}));
vi.mock("../../library/epicAccount", () => ({
  signInEpicAccount: (signal: AbortSignal) => mocks.connect("epic", { signal }),
}));
vi.mock("../../library/providers/xbox", () => ({
  signInXboxAccount: (options: LibraryScanOptions) =>
    mocks.connect("xbox", options),
}));
vi.mock("../../library/providers", () => ({
  loadLibraryProvider: async (provider: string) => ({
    detect: async () => ({
      provider,
      available: mocks.steamAvailable,
      checkedPaths: [],
    }),
    listAccounts: async () => [
      {
        accountId: 42,
        personaName: "Local Player",
        mostRecent: true,
        gamesWithPlaytime: 5,
      },
    ],
    scan: (_accountId: number, options: LibraryScanOptions) =>
      mocks.scan(provider, options),
  }),
}));

let root: Root;
let container: HTMLDivElement;
const emptyResult: LibraryScanResult = {
  games: [],
  partial: false,
  warnings: [],
};

async function render() {
  const { LauncherAccountsView } = await import("./LauncherAccountsView");
  await act(() => root.render(createElement(LauncherAccountsView)));
  await act(async () => {});
}

function card(provider: string) {
  return container.querySelector<HTMLElement>(
    `section[aria-labelledby="launcher-account-${provider}"]`,
  )!;
}

function button(scope: ParentNode, label: string) {
  const found = [...scope.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
}

function hasButton(scope: ParentNode, label: string) {
  return [...scope.querySelectorAll("button")].some(
    (item) => item.textContent?.trim() === label,
  );
}

/** The card's ⋯ button, or null when it has nothing more to offer. */
function moreButton(provider: string) {
  return card(provider).querySelector<HTMLButtonElement>(
    'button[aria-label="More"]',
  );
}

async function openMore(provider: string) {
  const more = moreButton(provider);
  if (!more) throw new Error(`No ⋯ for ${provider}`);
  await act(() => more.click());
}

function menuItems() {
  return [
    ...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ];
}

function menuItem(label: string) {
  const found = menuItems().find((item) => item.textContent?.startsWith(label));
  if (!found) throw new Error(`Menu item not found: ${label}`);
  return found;
}

/** The buttons a card shows, without its ⋯. */
function cardButtons(provider: string) {
  return [...card(provider).querySelectorAll("button")]
    .filter((item) => item.getAttribute("aria-label") !== "More")
    .map((item) => item.textContent?.trim());
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", {
    userAgent: "Windows NT 10.0",
    platform: "Win32",
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  mocks.logins = [];
  mocks.steamAvailable = true;
  mocks.invoke.mockImplementation(
    async (command: string, args?: { service: string }) => {
      if (command === "logins_list") return mocks.logins;
      if (command === "logins_check") return "valid";
      if (command === "logins_sign_out")
        mocks.logins = mocks.logins.filter(
          (login) => login.service !== args?.service,
        );
    },
  );
  mocks.scan.mockResolvedValue(emptyResult);
  mocks.connect.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("shows all launchers with saved connection status and a local Steam account", async () => {
  mocks.logins = [
    { service: "epic", name: "Epic Player", savedAt: 1 },
    { service: "battlenet", name: null, savedAt: 2 },
  ];
  await render();
  expect(container.querySelectorAll("section")).toHaveLength(4);
  expect(card("epic").textContent).toContain("Signed in as Epic Player");
  expect(card("battlenet").textContent).toContain("Signed in");
  expect(card("xbox").textContent).toContain("Not signed in");
  expect(card("steam").textContent).toContain("Steam account: Local Player");
  expect(card("steam").textContent).not.toContain("Sign out");
  expect(mocks.scan).not.toHaveBeenCalled();
});

it("shows one button per card, amber only where something needs you", async () => {
  mocks.logins = [
    { service: "battlenet", name: null, savedAt: 1 },
    { service: "epic", name: "Player", savedAt: 1 },
  ];
  mocks.invoke.mockImplementation(
    async (command: string, args?: { service: string }) => {
      if (command === "logins_list") return mocks.logins;
      if (command === "logins_check")
        return args?.service === "epic" ? "needsSignIn" : "valid";
    },
  );
  await render();
  expect(cardButtons("steam")).toEqual(["Import games"]);
  expect(cardButtons("battlenet")).toEqual(["Import games"]);
  expect(cardButtons("xbox")).toEqual(["Sign in"]);
  expect(cardButtons("epic")).toEqual(["Sign in again"]);
  const amber = (provider: string) =>
    button(card(provider), cardButtons(provider)[0]!).classList.contains(
      "bg-accent",
    );
  expect(amber("steam")).toBe(false);
  expect(amber("battlenet")).toBe(false);
  expect(amber("xbox")).toBe(true);
  expect(amber("epic")).toBe(true);
});

it("keeps Check connection, Find installed games and Sign out in the ⋯ menu", async () => {
  mocks.logins = [{ service: "epic", name: "Epic Player", savedAt: 1 }];
  await render();
  // The status shows once, under the name.
  expect(card("epic").textContent!.split("Signed in").length - 1).toBe(1);
  expect(hasButton(card("epic"), "Sign out")).toBe(false);
  expect(hasButton(card("epic"), "Check connection")).toBe(false);
  expect(hasButton(card("epic"), "Find installed games")).toBe(false);

  await openMore("epic");
  expect(menuItems().map((item) => item.textContent)).toEqual([
    expect.stringMatching(/^Check connectionLast checked /),
    "Find installed games",
    "Sign out",
  ]);
  await act(() => menuItem("Sign out").click());
  expect(mocks.invoke).toHaveBeenCalledWith("logins_sign_out", {
    service: "epic",
  });
  expect(card("epic").textContent).toContain("Not signed in");
});

it("has no ⋯ where there is nothing more to do", async () => {
  await render();
  expect(moreButton("steam")).toBeNull();
  expect(moreButton("xbox")).toBeNull();
  await openMore("epic");
  expect(menuItems().map((item) => item.textContent)).toEqual([
    "Find installed games",
  ]);
});

it("offers Retry when Steam is not found", async () => {
  mocks.steamAvailable = false;
  await render();
  expect(card("steam").textContent).toContain("Steam not found");
  expect(cardButtons("steam")).toEqual(["Retry"]);
});

it("shows a confirmed expired connection and only signs in again on an explicit click", async () => {
  mocks.logins = [{ service: "epic", name: "Player", savedAt: 1 }];
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "logins_list") return mocks.logins;
    if (command === "logins_check") return "needsSignIn";
  });
  await render();
  expect(card("epic").textContent).toContain("Needs sign-in");
  expect(card("epic").textContent).not.toContain("Signed in as");
  expect(mocks.connect).not.toHaveBeenCalled();
  await act(() => button(card("epic"), "Sign in again").click());
  expect(mocks.connect).toHaveBeenCalledOnce();
  expect(card("epic").textContent).toContain("Signed in as Player");
});

it("preserves saved accounts during check failures and offers a silent retry", async () => {
  mocks.logins = [{ service: "battlenet", name: null, savedAt: 1 }];
  let result = "unavailable";
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "logins_list") return mocks.logins;
    if (command === "logins_check") return result;
  });
  await render();
  expect(card("battlenet").textContent).toContain("Could not check connection");
  expect(button(card("battlenet"), "Import games")).toBeDefined();
  await openMore("battlenet");
  expect(menuItem("Sign out")).toBeDefined();
  result = "valid";
  await act(() => menuItem("Check connection").click());
  expect(card("battlenet").textContent).toContain("Signed in");
  expect(
    mocks.invoke.mock.calls.some(
      ([command]) => command === "library_battlenet_sign_in",
    ),
  ).toBe(false);
});

it("signs in without importing or altering library data, then offers an import separately", async () => {
  const { useAppStore } = await import("../../store");
  const initial = useAppStore.getState();
  mocks.connect.mockImplementation(async (service: string) => {
    mocks.logins = [{ service, name: "New Player", savedAt: 1 }];
    return emptyResult;
  });
  await render();
  await act(() => button(card("epic"), "Sign in").click());
  expect(mocks.connect).toHaveBeenCalledWith(
    "epic",
    expect.objectContaining({
      signal: expect.any(AbortSignal),
    }),
  );
  expect(mocks.scan).not.toHaveBeenCalled();
  expect(card("epic").textContent).toContain("Signed in as New Player");
  expect(useAppStore.getState().libraryImports).toBe(initial.libraryImports);
  expect(useAppStore.getState().libraryInstalls).toBe(initial.libraryInstalls);
  expect(mocks.openImport).not.toHaveBeenCalled();
  await act(() => button(card("epic"), "Import games").click());
  expect(mocks.openImport).toHaveBeenCalledWith("epic");
});

it("signs out just the selected account and leaves library data intact", async () => {
  const { useAppStore } = await import("../../store");
  const imports = useAppStore.getState().libraryImports;
  mocks.logins = [
    { service: "epic", name: "Epic Player", savedAt: 1 },
    { service: "xbox", name: "Xbox Player", savedAt: 1 },
  ];
  await render();
  await openMore("epic");
  await act(() => menuItem("Sign out").click());
  expect(mocks.invoke).toHaveBeenCalledWith("logins_sign_out", {
    service: "epic",
  });
  expect(card("epic").textContent).toContain("Not signed in");
  expect(card("xbox").textContent).toContain("Signed in as Xbox Player");
  expect(useAppStore.getState().libraryImports).toBe(imports);
});

it("requires Battle.net's playtime notice before starting its account connection", async () => {
  const { useAppStore } = await import("../../store");
  await render();
  await act(() => button(card("battlenet"), "Sign in").click());
  expect(mocks.scan).not.toHaveBeenCalled();
  const dialog = document.body.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain(
    "Battle.net does not provide historical playtime",
  );
  await act(() => button(dialog, "Sign in").click());
  expect(mocks.invoke).toHaveBeenCalledWith(
    "library_battlenet_sign_in",
    expect.objectContaining({ requestId: expect.any(String) }),
  );
  expect(mocks.scan).not.toHaveBeenCalled();
  // The importer and this page share the answer.
  expect(useAppStore.getState().battleNetPlaytimeNoticeSeen).toBe(true);
});

it("signs in to Battle.net without the notice once it was answered", async () => {
  const { useAppStore } = await import("../../store");
  useAppStore.setState({ battleNetPlaytimeNoticeSeen: true });
  await render();
  await act(() => button(card("battlenet"), "Sign in").click());
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  expect(mocks.invoke).toHaveBeenCalledWith(
    "library_battlenet_sign_in",
    expect.objectContaining({ requestId: expect.any(String) }),
  );
});

it("shows a Battle.net connection saved after leaving and returning to accounts", async () => {
  let complete!: () => void;
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "logins_list") return mocks.logins;
    if (command === "library_battlenet_sign_in")
      return new Promise<void>((resolve) => {
        complete = resolve;
      });
  });
  await render();
  await act(() => button(card("battlenet"), "Sign in").click());
  await act(() =>
    button(document.querySelector('[role="dialog"]')!, "Sign in").click(),
  );
  await act(() => root.render(null));
  expect(mocks.invoke).toHaveBeenCalledWith(
    "library_cancel_battlenet_account",
    expect.objectContaining({ requestId: expect.any(String) }),
  );
  await render();
  expect(card("battlenet").textContent).toContain("Not signed in");
  await act(async () => {
    mocks.logins = [{ service: "battlenet", name: null, savedAt: 3 }];
    complete();
  });
  expect(card("battlenet").textContent).toContain("Signed in");
  expect(button(card("battlenet"), "Import games")).toBeDefined();
  expect(mocks.scan).not.toHaveBeenCalled();
});

it("cancels the connection request and ignores a late result", async () => {
  let finish!: (value: LibraryScanResult) => void;
  mocks.connect.mockImplementation(
    () =>
      new Promise<LibraryScanResult>((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  await act(() => button(card("epic"), "Sign in").click());
  const options = mocks.connect.mock.calls[0][1] as LibraryScanOptions;
  expect(button(card("xbox"), "Sign in").disabled).toBe(true);
  await act(() => button(card("epic"), "Cancel").click());
  expect(options.signal?.aborted).toBe(true);
  await act(() => finish(emptyResult));
  expect(card("epic").textContent).not.toContain("Connected.");
  expect(card("epic").querySelector('[role="alert"]')).toBeNull();
  expect(button(card("xbox"), "Sign in").disabled).toBe(false);
});

it("shows a failure when the provider finishes without saving a connection", async () => {
  await render();
  await act(() => button(card("epic"), "Sign in").click());
  expect(card("epic").querySelector('[role="alert"]')?.textContent).toContain(
    "Sign-in was not saved",
  );
  expect(card("epic").textContent).toContain("Not signed in");
});

it("lets a failed connection retry and clears the previous error", async () => {
  mocks.connect.mockRejectedValueOnce(new Error("The service is unavailable"));
  await render();
  await act(() => button(card("epic"), "Sign in").click());
  expect(card("epic").querySelector('[role="alert"]')?.textContent).toContain(
    "The service is unavailable",
  );
  mocks.connect.mockImplementationOnce(async (service: string) => {
    mocks.logins = [{ service, name: "Recovered Player", savedAt: 1 }];
    return emptyResult;
  });
  await act(() => button(card("epic"), "Sign in").click());
  expect(card("epic").querySelector('[role="alert"]')).toBeNull();
  expect(card("epic").textContent).toContain("Signed in as Recovered Player");
});

it("aborts an active connection when leaving the accounts view", async () => {
  mocks.connect.mockImplementation(() => new Promise(() => {}));
  await render();
  await act(() => button(card("epic"), "Sign in").click());
  const options = mocks.connect.mock.calls[0][1] as LibraryScanOptions;
  await act(() => root.render(null));
  expect(options.signal?.aborted).toBe(true);
});

it("passes installed-only actions to the importer without signing in", async () => {
  await render();
  await openMore("epic");
  await act(() => menuItem("Find installed games").click());
  expect(mocks.openImport).toHaveBeenCalledWith("epic", "installed");
  expect(mocks.scan).not.toHaveBeenCalled();
});

it("offers Xbox per-import sign-in on other platforms and disables Windows-only launchers", async () => {
  vi.stubGlobal("navigator", { userAgent: "Macintosh", platform: "MacIntel" });
  await render();
  expect(card("xbox").textContent).toContain("Sign-in needed for each import");
  await act(() => button(card("xbox"), "Sign in and import").click());
  expect(mocks.openImport).toHaveBeenCalledWith("xbox");
  expect(button(card("epic"), "Sign in").disabled).toBe(true);
  expect(button(card("steam"), "Import games").disabled).toBe(true);
});

it("keeps Xbox's copy-link fallback available while the browser sign-in is pending", async () => {
  mocks.connect.mockImplementation(
    (_service: string, options: LibraryScanOptions) => {
      options.onAuthorizeUrl?.("https://login.live.com/test");
      return new Promise(() => {});
    },
  );
  await render();
  await act(() => button(card("xbox"), "Sign in").click());
  await act(() => button(card("xbox"), "Copy sign-in link").click());
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
    "https://login.live.com/test",
  );
  await act(() => button(card("xbox"), "Cancel").click());
});
