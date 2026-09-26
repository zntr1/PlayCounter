import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

// Tests replace invoke(), so a command renamed or unregistered in Rust would
// pass every other test and ship an app whose tracking silently does nothing.
const src = fileURLToPath(new URL(".", import.meta.url));
const libRs = readFileSync(
  new URL("../src-tauri/src/lib.rs", import.meta.url),
  "utf8",
);

function registeredCommands() {
  const handler = /generate_handler!\[([\s\S]*?)\]/.exec(libRs)?.[1] ?? "";
  return new Set(
    handler
      .split(",")
      .map((path) => path.trim().split("::").at(-1)!)
      .filter(Boolean),
  );
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

// The first argument of every invoke() and safeInvoke() call, up to the
// first top-level comma or closing parenthesis.
function invokedCommands() {
  const commands: { command: string; at: string }[] = [];
  const passthrough: string[] = [];
  for (const file of sourceFiles(src)) {
    const text = readFileSync(file, "utf8");
    for (const call of text.matchAll(
      /(?<!function\s+)\b(?:safeInvoke|invoke)\s*(?:<[^()]*?>)?\s*\(/g,
    )) {
      let depth = 0;
      let end = call.index + call[0].length;
      for (; end < text.length; end += 1) {
        const char = text[end];
        if ("([{".includes(char)) depth += 1;
        else if (")]}".includes(char)) {
          if (depth === 0) break;
          depth -= 1;
        } else if (char === "," && depth === 0) break;
      }
      const argument = text.slice(call.index + call[0].length, end).trim();
      const at = `${relative(src, file)}:${text.slice(0, call.index).split("\n").length}`;
      const literals = [...argument.matchAll(/["'`]([^"'`]+)["'`]/g)];
      if (literals.length === 0) {
        // A wrapper handing on its own `command` parameter; its callers are
        // checked themselves.
        if (argument !== "command") passthrough.push(`${at}: ${argument}`);
        continue;
      }
      for (const [, command] of literals) commands.push({ command, at });
    }
  }
  return { commands, passthrough };
}

it("registers every command the app invokes", () => {
  const registered = registeredCommands();
  const { commands, passthrough } = invokedCommands();

  // Guard the parsing itself.
  expect(registered.size).toBeGreaterThan(40);
  expect(registered).toContain("scan_processes");
  expect(commands.map(({ command }) => command)).toContain("scan_processes");

  expect(passthrough).toEqual([]);
  expect(
    commands
      .filter(({ command }) => !command.startsWith("plugin:"))
      .filter(({ command }) => !registered.has(command))
      .map(({ command, at }) => `${command} (${at})`),
  ).toEqual([]);
});
