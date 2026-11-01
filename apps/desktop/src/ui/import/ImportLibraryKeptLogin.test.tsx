// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  scan: vi.fn(),
  logins: [] as { service: string; name: string | null; savedAt: number }[],
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  convertFileSrc: (v: string) => v,
}));
vi.mock("../../library/providers", () => ({
  loadLibraryProvider: async (provider: string) => ({
    accountMode: provider === "xbox" ? undefined : "none",
    detect: async () => ({ provider, available: true, checkedPaths: [] }),
    listAccounts: async () =>
      provider === "xbox"
        ? [{ accountId: 0, mostRecent: true, gamesWithPlaytime: 0 }]
        : [],
    scan: mocks.scan,
  }),
}));

let root: Root;
let container: HTMLDivElement;

function text() {
  return document.body.textContent ?? "";
}

function buttons() {
  return [...document.body.querySelectorAll("button")].map(
    (button) => button.textContent?.trim() ?? "",
  );
}

async function open(provider: "xbox" | "epic" | "battlenet") {
  const { useAppStore } = await import("../../store");
  const { ImportLibraryView } = await import("./ImportLibraryView");
  await act(() => useAppStore.setState({ libraryImportProvider: provider }));
  await act(() => root.render(createElement(ImportLibraryView)));
  // Detection and the kept sign-in list load after the first render.
  await act(async () => {});
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", {
    ...navigator,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    platform: "Win32",
  });
  mocks.logins = [];
  mocks.invoke.mockImplementation(async (command: string, args?: unknown) => {
    if (command === "logins_list") return mocks.logins;
    if (command === "logins_sign_out") {
      const { service } = args as { service: string };
      mocks.logins = mocks.logins.filter((login) => login.service !== service);
      return undefined;
    }
    return undefined;
  });
  // Loaded before the test, so a busy test run does not time it out.
  await import("./ImportLibraryView");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("with a kept Epic sign-in, the import shows who is signed in and needs no sign-in", async () => {
  mocks.logins = [{ service: "epic", name: "Player One", savedAt: 1 }];
  await open("epic");

  expect(text()).toContain("Signed in as Player One");
  expect(text()).toContain(
    "PlayCounter keeps you signed in on this PC until you sign out.",
  );
  expect(buttons()).toContain("Find games");
  expect(buttons()).not.toContain("Sign in and find games");
  expect(buttons()).toContain("Sign out");
});

it("Sign out deletes the kept sign-in and asks for a sign-in again", async () => {
  mocks.logins = [{ service: "epic", name: "Player One", savedAt: 1 }];
  await open("epic");

  const signOut = [...document.body.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Sign out",
  );
  await act(() => signOut!.click());
  await act(async () => {});

  expect(mocks.invoke).toHaveBeenCalledWith("logins_sign_out", {
    service: "epic",
  });
  expect(text()).not.toContain("Signed in as");
  expect(buttons()).toContain("Sign in and find games");
  expect(buttons()).not.toContain("Sign out");
});

it("without a kept sign-in, the import offers the sign-in as before", async () => {
  await open("battlenet");

  expect(text()).not.toContain("Signed in");
  expect(buttons()).toContain("Sign in and find games");
  expect(buttons()).not.toContain("Sign out");
});

it("Battle.net has no name to show, only that the sign-in is kept", async () => {
  mocks.logins = [{ service: "battlenet", name: null, savedAt: 1 }];
  await open("battlenet");

  expect(text()).toContain("Signed in");
  expect(text()).not.toContain("Signed in as");
  expect(buttons()).toContain("Sign out");
});

it("with a kept Xbox sign-in there is no sign-in link to copy", async () => {
  mocks.logins = [{ service: "xbox", name: "Master Chief", savedAt: 1 }];
  await open("xbox");

  expect(text()).toContain("Signed in as Master Chief");
  expect(text()).toContain(
    "keeps you signed in on this PC, so the next import needs no sign-in.",
  );
  expect(buttons()).not.toContain("Copy sign-in link");
  expect(buttons()).toContain("Find games");
});

it("an expired sign-in asks to sign in again, and the button opens the sign-in", async () => {
  mocks.logins = [{ service: "epic", name: "Player One", savedAt: 1 }];
  mocks.scan.mockReturnValue(new Promise(() => {}));
  const { useLoginHealth } = await import("../../library/loginHealth");
  useLoginHealth.setState({
    checks: {
      epic: { status: "needsSignIn", checkedAt: 1, lastSuccessAt: null },
    },
  });
  await open("epic");

  expect(text()).toContain("Needs sign-in");
  // The sign-in is still saved, so it can still be removed.
  expect(buttons()).toContain("Sign out");
  expect(buttons()).not.toContain("Find games");

  const signIn = [...document.body.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Sign in and find games",
  );
  await act(() => signIn!.click());

  expect(mocks.scan).toHaveBeenCalledWith(
    0,
    expect.objectContaining({ epicAccount: true }),
  );
  expect(text()).toContain(
    "Complete the Epic Games sign-in in the window that opened…",
  );
});

it("another launcher's kept sign-in does not count for this one", async () => {
  mocks.logins = [{ service: "xbox", name: "Master Chief", savedAt: 1 }];
  await open("epic");

  expect(text()).not.toContain("Master Chief");
  expect(buttons()).toContain("Sign in and find games");
});
