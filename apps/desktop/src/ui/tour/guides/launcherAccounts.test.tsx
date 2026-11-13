// @vitest-environment happy-dom
/* "Launcher accounts": a read-only walk over the real Launcher accounts page.
   It starts at the sidebar entry and its warning mark, reads a launcher's
   card and status line, its More menu (Check connection, Find installed
   games, Sign out), what to do when a sign-in ran out (Sign in again, Import
   games), several accounts, and where to forget a launcher's imported data.
   No click reaches a sign-in. On a fresh install no launcher is signed in,
   and every step still rings a control on the page: the texts are written
   for both states. */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TourStep } from "../tourTypes";
import { boldNames, stepOf } from "./guideRules.test.kit";
import { launcherAccountsGuide } from "./launcherAccounts";
import { a, NEXT_RELEASE } from "./shared";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  connect: vi.fn(),
  openImport: vi.fn(),
  logins: [] as { service: string; name: string | null; savedAt: number }[],
  /** Launchers whose sign-in ran out. */
  expired: [] as string[],
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  convertFileSrc: (value: string) => value,
}));
vi.mock("../../../library/importRequest", () => ({
  openLauncherImport: mocks.openImport,
}));
vi.mock("../../../library/epicAccount", () => ({
  signInEpicAccount: () => mocks.connect("epic"),
}));
vi.mock("../../../library/gogAccount", () => ({
  signInGogAccount: () => mocks.connect("gog"),
}));
vi.mock("../../../library/battlenetAccount", () => ({
  signInBattleNetAccount: () => mocks.connect("battlenet"),
}));
vi.mock("../../../library/playstationAccount", () => ({
  signInPlayStationAccount: () => mocks.connect("playstation"),
  signInPlayStationWithCode: () => mocks.connect("playstation"),
}));
vi.mock("../../../library/providers/xbox", () => ({
  signInXboxAccount: () => mocks.connect("xbox"),
}));
vi.mock("../../../library/providers", () => ({
  loadLibraryProvider: async (provider: string) => ({
    detect: async () => ({ provider, available: true, checkedPaths: [] }),
    listAccounts: async () => [
      {
        accountId: 42,
        personaName: "Local Player",
        mostRecent: true,
        gamesWithPlaytime: 5,
      },
    ],
  }),
}));

const guide = launcherAccountsGuide();

/** Every English text the app can show. */
const englishTexts = new Set(
  Object.values(
    import.meta.glob<Record<string, string>>("../../../locales/en/*.json", {
      eager: true,
      import: "default",
    }),
  ).flatMap((area) => Object.values(area)),
);

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("navigator", {
    userAgent: "Windows NT 10.0",
    platform: "Win32",
    clipboard: { writeText: vi.fn() },
  });
  mocks.logins = [];
  mocks.expired = [];
  mocks.invoke.mockImplementation(
    async (command: string, args?: { service: string }) => {
      if (command === "logins_list") return mocks.logins;
      if (command === "logins_check")
        return mocks.expired.includes(args?.service ?? "")
          ? "needsSignIn"
          : "valid";
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/** The real page, with the guide running over it. */
async function showPage() {
  const { LauncherAccountsView } =
    await import("../../views/LauncherAccountsView");
  const { TourOverlay } = await import("../TourUI");
  const { useAppStore } = await import("../../../store");
  await act(() =>
    root.render(
      createElement(
        "div",
        null,
        createElement(LauncherAccountsView),
        createElement(TourOverlay),
      ),
    ),
  );
  await act(async () => {});
  await act(async () => {});
  return useAppStore;
}

async function ring(step: TourStep) {
  const { findTourTarget } = await import("../tourTargetRect");
  return findTourTarget(step);
}

/** The steps that ring something on the page itself. */
const pageSteps = ["card", "more", "sign-in-again", "accounts"];

const card = (provider: string) =>
  container.querySelector<HTMLElement>(
    `section[aria-labelledby="launcher-account-${provider}"]`,
  )!;

describe("the guide", () => {
  it("is new for the next release and leads to the import", () => {
    expect(guide.version).toBe(1);
    expect(guide.release).toBe(NEXT_RELEASE);
    expect(guide.nextTourId).toBe("import-library");
  });

  it("walks the page from the sidebar to forgetting imported data", () => {
    expect(guide.steps.map((step) => step.id)).toEqual([
      "nav",
      "card",
      "more",
      "sign-in-again",
      "accounts",
      "forget",
    ]);
    expect(guide.steps.every((step) => step.view === "accounts")).toBe(true);
  });

  it("follows the step rules", () => {
    for (const step of guide.steps) {
      const at = step.id;
      expect(step.title.length, at).toBeLessThanOrEqual(40);
      expect(step.body.length, at).toBeLessThanOrEqual(220);
      // The first step is for reading and rings nothing.
      if (step !== guide.steps[0])
        expect(step.anchor, `${at} rings something`).toBeTruthy();
      expect(`${step.title} ${step.body}`, at).not.toMatch(
        /\b(providers?|wizard|executables?)\b/i,
      );
      for (const name of boldNames(step.body))
        expect(englishTexts.has(name), `${at} names "${name}"`).toBe(true);
    }
  });

  it("only looks: no step lets a click through to the page", () => {
    for (const step of guide.steps) {
      expect(step.task, step.id).toBeUndefined();
      expect(step.interactive, step.id).toBeFalsy();
      expect(step.allow ?? [], step.id).toEqual([]);
    }
    expect(stepOf(guide, "nav").body).toMatch(/nothing is clicked or changed/);
  });

  it("starts by naming the sidebar entry and its warning mark", () => {
    const step = stepOf(guide, "nav");
    expect(step.anchor).toBeUndefined();
    expect(boldNames(step.body)).toContain("Launcher accounts");
    expect(step.body).toMatch(/number/);
    expect(step.body).toMatch(/sign-in/);
  });

  it("names what a card's line says, signed in or not", () => {
    const names = boldNames(stepOf(guide, "card").body);
    expect(names).toContain("Not signed in");
    expect(names).toContain("Needs sign-in");
  });

  it("names the actions behind More", () => {
    const names = boldNames(stepOf(guide, "more").body);
    for (const label of [
      "More",
      "Check connection",
      "Find installed games",
      "Sign out",
    ])
      expect(names).toContain(label);
  });

  it("tells what to do when a sign-in ran out", () => {
    const names = boldNames(stepOf(guide, "sign-in-again").body);
    expect(names).toContain("Sign in again");
    expect(names).toContain("Import games");
  });

  it("tells how a second account of a launcher comes in", () => {
    const { body } = stepOf(guide, "accounts");
    expect(body).toMatch(/sign out/i);
    expect(body).toMatch(/import again/);
    expect(body).toMatch(/added/);
  });

  it("ends with both places to forget a launcher's imported data", () => {
    const step = stepOf(guide, "forget");
    expect(boldNames(step.body)).toEqual([
      "Forget imported data",
      "Library import",
    ]);
    expect(step.body).toMatch(/right-click a launcher/i);
    expect(step.body).toMatch(/sidebar/);
    // The launcher under My Games when it is there, Settings otherwise.
    expect(step.anchor).toBe(a("nav-settings"));
    expect(step.anchorTargets).toHaveLength(1);
  });
});

describe("on the real page", () => {
  it("has something to ring in every step on a fresh install", async () => {
    await showPage();
    expect(card("xbox").textContent).toContain("Not signed in");
    for (const id of pageSteps)
      expect(await ring(stepOf(guide, id)), id).not.toBeNull();
    expect((await ring(stepOf(guide, "card")))?.textContent).toContain(
      "Steam account: Local Player",
    );
    // Only Battle.net, Epic Games and GOG have More before a sign-in.
    expect(
      (await ring(stepOf(guide, "more")))?.getAttribute("aria-label"),
    ).toBe("More");
    expect(
      (await ring(stepOf(guide, "sign-in-again")))?.textContent?.trim(),
    ).toMatch(/^(Import games|Sign in)$/);
  });

  it("rings a signed-in card's More, and Sign in again where a sign-in ran out", async () => {
    mocks.logins = [
      { service: "gog", name: "zesarex", savedAt: 1 },
      { service: "epic", name: "Epic Player", savedAt: 2 },
    ];
    mocks.expired = ["epic"];
    await showPage();
    expect(card("epic").textContent).toContain("Needs sign-in");
    const more = await ring(stepOf(guide, "more"));
    expect(card("gog").contains(more)).toBe(true);
    const again = await ring(stepOf(guide, "sign-in-again"));
    expect(again?.textContent?.trim()).toBe("Sign in again");
    expect(card("epic").contains(again)).toBe(true);
    const account = await ring(stepOf(guide, "accounts"));
    expect(account?.textContent).toMatch(/Signed in as zesarex|Steam account/);
  });

  it("rings a launcher under My Games for forgetting, Settings when there is none", async () => {
    const { SidebarSources } = await import("../../shell/SidebarSources");
    const { useLibrarySources } = await import("../../librarySources");
    const nav = () =>
      createElement("button", { "data-tour": "nav-settings" }, "Settings");
    await act(() => root.render(createElement("div", null, nav())));
    const forget = stepOf(guide, "forget");
    expect((await ring(forget))?.textContent).toBe("Settings");

    useLibrarySources.setState({
      visible: true,
      tabs: [
        { id: "all", kind: "all", label: "All games", count: 3 },
        {
          id: "unimported",
          kind: "unimported",
          label: "PlayCounter",
          count: 1,
        },
        { id: "steam", kind: "provider", label: "Steam", count: 2 },
      ],
    });
    await act(() =>
      root.render(
        createElement("div", null, createElement(SidebarSources), nav()),
      ),
    );
    expect((await ring(forget))?.id).toBe("library-tab-steam");
  });

  it("lets no click reach a sign-in while the guide runs", async () => {
    const store = await showPage();
    await act(() => store.getState().startTour(guide.id));
    for (let index = 0; index < guide.steps.length; index++) {
      await act(() => store.getState().goToTourStep(index));
      const signIn = [...card("xbox").querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Sign in",
      )!;
      await act(async () => signIn.click());
    }
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.openImport).not.toHaveBeenCalled();
  });
});

describe("the page", () => {
  it('offers "Show me how" for this guide', async () => {
    const store = await showPage();
    const link = container.querySelector<HTMLButtonElement>(
      '[data-guide-link="launcher-accounts"]',
    );
    expect(link).not.toBeNull();
    await act(async () => link!.click());
    expect(store.getState().activeTour?.tourId).toBe("launcher-accounts");
  });
});
