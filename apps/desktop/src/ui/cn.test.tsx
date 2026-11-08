// @vitest-environment happy-dom
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import ts from "typescript";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cn } from "./cn";
import { Button, IconButton } from "./primitives";

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

it("keeps the last of two classes that set the same thing, and both when they set different things", () => {
  expect(cn("text-text-muted", "text-danger")).toBe("text-danger");
  expect(cn("hover:bg-surface-hover", "hover:bg-accent")).toBe(
    "hover:bg-accent",
  );
  expect(cn("border-border", "border-bg")).toBe("border-bg");
  expect(cn("px-3 py-2", "px-2 py-1")).toBe("px-2 py-1");
  // A size and a colour are different things: the tier badge needs both.
  expect(cn("text-[13px]", "text-tier-s")).toBe("text-[13px] text-tier-s");
  expect(cn("text-xs", "text-text-faint")).toBe("text-xs text-text-faint");
  // Our own theme names from tailwind.config.ts.
  expect(cn("shadow-md", "shadow-raised")).toBe("shadow-raised");
  expect(cn("animate-pop", "animate-none")).toBe("animate-none");
  // Still clsx underneath: conditions, empty values, arrays.
  expect(cn("flex", false && "hidden", undefined, ["gap-2"])).toBe(
    "flex gap-2",
  );
});

it("lets the classes a screen gives IconButton and Button win over the buttons' own", async () => {
  await act(() =>
    root.render(
      <>
        {/* The list view's Stop button, as My Games asks for it. */}
        <IconButton
          aria-label="Stop"
          className="border-danger/50 bg-danger/10 text-danger hover:border-danger-solid hover:bg-danger-solid hover:text-white"
        />
        {/* The tour's "Maybe later". */}
        <Button
          variant="ghost"
          aria-label="Later"
          className="mx-auto px-2 py-1 text-xs text-text-faint"
        />
      </>,
    ),
  );
  const classes = (label: string) => [
    ...document.querySelector(`[aria-label="${label}"]`)!.classList,
  ];
  // Red, and solid red on hover: not the button's own grey.
  expect(classes("Stop")).toEqual(
    expect.arrayContaining([
      "text-danger",
      "border-danger/50",
      "hover:bg-danger-solid",
      "hover:text-white",
    ]),
  );
  for (const own of ["text-text-muted", "border-border", "hover:bg-surface-hover", "hover:text-text"])
    expect(classes("Stop"), own).not.toContain(own);

  expect(classes("Later")).toEqual(
    expect.arrayContaining(["text-text-faint", "px-2", "py-1"]),
  );
  for (const own of ["text-text-muted", "px-3", "py-2"])
    expect(classes("Later"), own).not.toContain(own);
});

// happy-dom's URL is not Node's, so no new URL() here.
const src = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name)
      ? [path]
      : [];
  });
}

/** `className`, `props.className`, `containerClassName`, `art.frameClassName`… */
function isClassNameReference(node: ts.Node) {
  const name = ts.isIdentifier(node)
    ? node.text
    : ts.isPropertyAccessExpression(node)
      ? node.name.text
      : null;
  return name !== null && /className$/i.test(name);
}

it("merges every className a component is given with its own classes through cn(), so the given ones win", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(src)) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node: ts.Node) => {
      if (
        ts.isJsxAttribute(node) &&
        node.name.getText(source) === "className" &&
        node.initializer &&
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression
      ) {
        const value = node.initializer.expression;
        let mentions = false;
        const find = (child: ts.Node) => {
          if (isClassNameReference(child)) mentions = true;
          else ts.forEachChild(child, find);
        };
        // A bare {className} hands the classes on without adding any.
        if (!isClassNameReference(value)) find(value);
        const throughCn =
          ts.isCallExpression(value) &&
          ts.isIdentifier(value.expression) &&
          value.expression.text === "cn";
        if (mentions && !throughCn) {
          const line =
            source.getLineAndCharacterOfPosition(node.getStart(source)).line +
            1;
          offenders.push(`${relative(src, file)}:${line}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(offenders).toEqual([]);
});
