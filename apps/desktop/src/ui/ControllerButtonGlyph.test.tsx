// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setControllerKind } from "../controllerKind";
import {
  ControllerButtonGlyph,
  controllerButtonName,
} from "./ControllerButtonGlyph";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setControllerKind("xbox");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setControllerKind("xbox");
  vi.unstubAllGlobals();
});

it("shows the art of the pad that sent the last input", () => {
  act(() => root.render(<ControllerButtonGlyph button="A" />));
  const image = () => container.querySelector("img")?.getAttribute("src");
  expect(image()).toContain("T_X_A_Color_Alt");

  act(() => setControllerKind("ps5"));
  expect(image()).toContain("T_P5_Cross_Color_Alt");

  act(() => setControllerKind("ps4"));
  expect(image()).toContain("T_P4_Cross_Color_Alt");
});

it("names each button the way its pad labels it", () => {
  expect(controllerButtonName("xbox", "VIEW")).toBe("View");
  expect(controllerButtonName("ps5", "VIEW")).toBe("Create");
  expect(controllerButtonName("ps4", "VIEW")).toBe("Share");
  expect(controllerButtonName("ps5", "A")).toBe("Cross");
  expect(controllerButtonName("ps4", "B")).toBe("Circle");
  expect(controllerButtonName("ps5", "RB")).toBe("R1");
});
