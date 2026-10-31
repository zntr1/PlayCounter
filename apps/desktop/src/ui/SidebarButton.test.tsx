// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ListChecks, Users } from "lucide-react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SidebarButton } from "./SidebarButton";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function railTooltip(props: ComponentProps<typeof SidebarButton>) {
  await act(() => root.render(createElement(SidebarButton, props)));
  await act(() => container.querySelector("button")!.focus());
  return document.body.querySelector('[role="tooltip"]')?.textContent;
}

it("names a sign-in warning on the collapsed rail, not a review count", async () => {
  const tooltip = await railTooltip({
    icon: Users,
    label: "Launcher accounts",
    active: false,
    collapsed: true,
    badge: 1,
    warn: true,
    onClick: () => {},
  });
  expect(tooltip).toBe("Launcher accountsNeeds your attention");
});

it("keeps the review count for Discovered on the collapsed rail", async () => {
  const tooltip = await railTooltip({
    icon: ListChecks,
    label: "Discovered",
    active: false,
    collapsed: true,
    badge: 3,
    onClick: () => {},
  });
  expect(tooltip).toBe("Discovered3 waiting for review");
});
