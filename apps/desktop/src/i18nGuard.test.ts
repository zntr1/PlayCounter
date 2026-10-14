import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/* Translation guards ─────────────────────────────────────────────────────────
   Every text a user can see lives in src/locales, in every language. These
   tests fail when:
   - a language misses a text, a plural form or a {{placeholder}};
   - a release note (src/releaseNotes.json) misses a language;
   - a language file keeps a text the code no longer uses;
   - UI code shows raw English instead of t("…") (brand names excepted);
   - a toLocale…() call or an Intl formatter ignores the app's language;
   - a Rust message is neither translated (locales/<lang>/native.json) nor
     listed in RUST_ENGLISH_ON_PURPOSE.
   English that is meant to stay English carries an "i18n-exempt" comment on
   its line or the line above, with the reason. */

const src = fileURLToPath(new URL(".", import.meta.url));
const localesDir = join(src, "locales");
const rustDir = fileURLToPath(new URL("../src-tauri/src", import.meta.url));

/* Language files ────────────────────────────────────────────────────────── */

const PLURAL = /_(zero|one|two|few|many|other)$/;
// Texts looked up at runtime instead of through t("…") literals.
const LOOKUP_NAMESPACES = new Set(["boot", "igdb", "native"]);

type Texts = Record<string, string>;

const languages = readdirSync(localesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const otherLanguages = languages.filter((language) => language !== "en");
const englishFiles = jsonFiles("en");

function jsonFiles(language: string) {
  return readdirSync(join(localesDir, language)).filter((file) =>
    file.endsWith(".json"),
  );
}

function texts(language: string, file: string): Texts {
  return JSON.parse(readFileSync(join(localesDir, language, file), "utf8"));
}

const baseKey = (key: string) => key.replace(PLURAL, "");

// Placeholders and markup a translation has to keep: {{value}}, {exe}, <tag>.
const tokens = (text: string) =>
  [...text.matchAll(/\{\{[^}]+\}\}|\{[a-z]+\}|<\/?[A-Za-z0-9]+\s*\/?>/g)]
    .map((match) => match[0].replace(/\s+/g, ""))
    .sort();

describe("language files", () => {
  it("has every English text in every language", () => {
    const problems: string[] = [];
    for (const language of otherLanguages) {
      for (const file of jsonFiles(language)) {
        if (!englishFiles.includes(file)) {
          problems.push(`${language}/${file} has no English file`);
        }
      }
      for (const file of englishFiles) {
        if (!jsonFiles(language).includes(file)) {
          problems.push(`${language}/${file} is missing`);
          continue;
        }
        const english = new Set(Object.keys(texts("en", file)).map(baseKey));
        const other = new Set(Object.keys(texts(language, file)).map(baseKey));
        for (const key of english) {
          if (!other.has(key)) problems.push(`${language}/${file}: "${key}"`);
        }
        for (const key of other) {
          if (!english.has(key)) {
            problems.push(`${language}/${file}: "${key}" is not English`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("has every plural form each language needs", () => {
    const problems: string[] = [];
    for (const language of languages) {
      const categories = new Intl.PluralRules(language).resolvedOptions()
        .pluralCategories;
      for (const file of englishFiles) {
        const english = Object.keys(texts("en", file));
        const plural = new Set(
          english.filter((key) => PLURAL.test(key)).map(baseKey),
        );
        const translated = texts(language, file);
        for (const key of plural) {
          for (const category of categories) {
            if (!(`${key}_${category}` in translated)) {
              problems.push(`${language}/${file}: "${key}_${category}"`);
            }
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("keeps the English placeholders and markup", () => {
    const problems: string[] = [];
    for (const language of otherLanguages) {
      for (const file of englishFiles) {
        const english = texts("en", file);
        for (const [key, value] of Object.entries(texts(language, file))) {
          if (!value.trim())
            problems.push(`${language}/${file}: "${key}" is empty`);
          const source =
            english[key] ??
            english[`${baseKey(key)}_other`] ??
            english[baseKey(key)];
          if (source === undefined) continue;
          // A singular form may spell the number out instead of {{count}}.
          const singular =
            PLURAL.exec(key)?.[1] !== "other" && PLURAL.test(key);
          const keep = (list: string[]) =>
            singular
              ? list.filter((token) => !token.startsWith("{{count"))
              : list;
          const want = keep(tokens(source)).join(" ");
          const got = keep(tokens(value)).join(" ");
          if (want !== got) {
            problems.push(
              `${language}/${file}: "${key}" has [${got}], English has [${want}]`,
            );
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("only keeps texts the code uses", () => {
    const problems: string[] = [];
    for (const file of englishFiles) {
      const namespace = file.replace(/\.json$/, "");
      if (LOOKUP_NAMESPACES.has(namespace)) continue;
      const used = new Set<string>();
      for (const source of sources()) {
        if (!source.text.includes(`getT("${namespace}")`)) continue;
        for (const literal of source.literals) used.add(literal);
      }
      for (const key of Object.keys(texts("en", file))) {
        if (!used.has(baseKey(key))) problems.push(`en/${file}: "${key}"`);
      }
    }
    expect(problems).toEqual([]);
  });
});

/* Release notes ─────────────────────────────────────────────────────────── */

type NoteText = { headline?: unknown; highlights?: unknown };

describe("release notes", () => {
  it("has every release in every language, point for point", () => {
    const notes = JSON.parse(
      readFileSync(join(src, "releaseNotes.json"), "utf8"),
    ) as Array<NoteText & { version: string; translations?: unknown }>;
    const problems: string[] = [];
    for (const note of notes) {
      const english = Array.isArray(note.highlights) ? note.highlights : [];
      const translations = (note.translations ?? {}) as Record<
        string,
        NoteText | undefined
      >;
      for (const language of otherLanguages) {
        const text = translations[language];
        const highlights = Array.isArray(text?.highlights)
          ? text.highlights
          : [];
        if (typeof text?.headline !== "string" || !text.headline.trim()) {
          problems.push(`${note.version}: no ${language} headline`);
        }
        if (
          highlights.length !== english.length ||
          highlights.some((line) => typeof line !== "string" || !line.trim())
        ) {
          problems.push(
            `${note.version}: ${highlights.length} ${language} highlights, English has ${english.length}`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

/* UI code ───────────────────────────────────────────────────────────────── */

// Developer tools stay English on purpose.
const ENGLISH_FILES = new Set(["ui/views/DevToolsView.tsx"]);

const BRANDS = new Set([
  "PlayCounter",
  "Steam",
  "Xbox",
  "Battle.net",
  "Epic Games",
  "IGDB",
  "Discord",
  "Spotify",
  "SteamGridDB",
  "Dolphin",
  "DOSBox",
  "PCSX2",
  "mGBA",
  "Cemu",
  "Windows",
  "macOS",
  "Linux",
  "PC",
]);

const UI_ATTRIBUTES = new Set([
  "title",
  "alt",
  "placeholder",
  "label",
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "description",
  "heading",
  "subtitle",
  "message",
  "tooltip",
  "hint",
  "emptyText",
  "confirmLabel",
  "cancelLabel",
  "actionLabel",
  "text",
  "kicker",
  "detail",
  "caption",
  "eyebrow",
  "ariaLabel",
  "unit",
]);

const UI_PROPERTIES = new Set([
  "title",
  "label",
  "detail",
  "description",
  "message",
  "body",
  "hint",
  "tooltip",
  "placeholder",
  "subtitle",
  "kicker",
  "headline",
  "caption",
  "actionLabel",
  "confirmLabel",
  "cancelLabel",
  "emptyText",
  "ariaLabel",
  "help",
  "short",
  "eyebrow",
  "heading",
  "text",
]);

// Calls whose first argument is shown to the user.
const TEXT_CALLS =
  /^(alert|confirm|prompt|set(Error|Message|Notice|Warning|Hint|Label|Title|Detail|Text|Caption|Description))$/;

const LOCALE_METHODS = new Set([
  "toLocaleString",
  "toLocaleDateString",
  "toLocaleTimeString",
]);
const INTL_FORMATTERS = new Set([
  "DateTimeFormat",
  "NumberFormat",
  "RelativeTimeFormat",
  "ListFormat",
  "PluralRules",
  "DisplayNames",
]);

type Source = {
  file: string;
  text: string;
  lines: string[];
  sourceFile: ts.SourceFile;
  literals: Set<string>;
};

let cachedSources: Source[] | undefined;

function sources(): Source[] {
  if (cachedSources) return cachedSources;
  cachedSources = sourceFiles(src).map((path) => {
    const text = readFileSync(path, "utf8");
    const sourceFile = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
      path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const literals = new Set<string>();
    const collect = (node: ts.Node) => {
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node)
      ) {
        literals.add(node.text);
      }
      ts.forEachChild(node, collect);
    };
    collect(sourceFile);
    return {
      file: relative(src, path).replace(/\\/g, "/"),
      text,
      lines: text.split("\n"),
      sourceFile,
      literals,
    };
  });
  return cachedSources;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory())
      return entry.name === "locales" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$|\.d\.ts$/.test(entry.name)
      ? [path]
      : [];
  });
}

/** Words a user would read, not code: class lists, ids, paths, units. */
function isText(raw: string) {
  const value = raw
    .replace(/\{\{[^}]*\}\}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const withoutBrands = [...BRANDS]
    .sort((a, b) => b.length - a.length)
    .reduce((rest, brand) => rest.split(brand).join(" "), value);
  if (!/[A-Za-z]{2,}/.test(withoutBrands)) return false;
  if (!/\s/.test(value) && /[-_./:#@=]|[a-z][A-Z]|\d/.test(value)) return false;
  return !value
    .split(" ")
    .every((token) => /^!?[a-z0-9]+(-[a-z0-9[\]#/.%:]+)+$/.test(token));
}

// The literals a UI expression can end up showing, through ?:, ||, ?? and +.
function shownLiterals(node: ts.Expression, out: ts.Node[]) {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    shownLiterals(node.expression, out);
  } else if (ts.isConditionalExpression(node)) {
    shownLiterals(node.whenTrue, out);
    shownLiterals(node.whenFalse, out);
  } else if (
    ts.isBinaryExpression(node) &&
    [
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.PlusToken,
    ].includes(node.operatorToken.kind)
  ) {
    if (node.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) {
      shownLiterals(node.left, out);
    }
    shownLiterals(node.right, out);
  } else if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node)
  ) {
    if (isText(node.text)) out.push(node);
  } else if (ts.isTemplateExpression(node)) {
    const fixed = [
      node.head.text,
      ...node.templateSpans.map((span) => span.literal.text),
    ];
    if (isText(fixed.join(" "))) out.push(node);
  }
}

function insideTrans(node: ts.Node) {
  for (let current = node.parent; current; current = current.parent) {
    if (
      ts.isJsxElement(current) &&
      current.openingElement.tagName.getText() === "Trans"
    ) {
      return true;
    }
  }
  return false;
}

function exempt(source: Source, node: ts.Node) {
  const line = source.sourceFile.getLineAndCharacterOfPosition(
    node.getStart(source.sourceFile),
  ).line;
  return [line, line - 1].some((index) =>
    /i18n-exempt/.test(source.lines[index] ?? ""),
  );
}

function report(source: Source, node: ts.Node, problems: string[]) {
  if (exempt(source, node)) return;
  const line = source.sourceFile.getLineAndCharacterOfPosition(
    node.getStart(source.sourceFile),
  ).line;
  problems.push(
    `${source.file}:${line + 1} ${node.getText(source.sourceFile).replace(/\s+/g, " ").slice(0, 100)}`,
  );
}

// An object literal passed straight to a log call (addApiRequestLogEntry, …).
function loggedObject(property: ts.PropertyAssignment) {
  const object = property.parent;
  const call = object.parent;
  return (
    ts.isObjectLiteralExpression(object) &&
    ts.isCallExpression(call) &&
    /log/i.test(calleeName(call))
  );
}

function calleeName(call: ts.CallExpression | ts.NewExpression) {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return "";
}

describe("UI code", () => {
  it("shows no raw English", () => {
    const problems: string[] = [];
    for (const source of sources()) {
      if (ENGLISH_FILES.has(source.file)) continue;
      const shown = (expression: ts.Expression) => {
        const found: ts.Node[] = [];
        shownLiterals(expression, found);
        for (const node of found) report(source, node, problems);
      };
      const visit = (node: ts.Node) => {
        if (ts.isJsxText(node)) {
          if (isText(node.text) && !insideTrans(node))
            report(source, node, problems);
        } else if (
          ts.isJsxExpression(node) &&
          node.expression &&
          (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
        ) {
          shown(node.expression);
        } else if (
          ts.isJsxAttribute(node) &&
          UI_ATTRIBUTES.has(node.name.getText())
        ) {
          const value = node.initializer;
          if (value && ts.isStringLiteral(value)) {
            if (isText(value.text)) report(source, value, problems);
          } else if (value && ts.isJsxExpression(value) && value.expression) {
            shown(value.expression);
          }
        } else if (
          ts.isPropertyAssignment(node) &&
          UI_PROPERTIES.has(node.name.getText().replace(/["']/g, "")) &&
          !loggedObject(node)
        ) {
          shown(node.initializer);
        } else if (
          (ts.isCallExpression(node) && TEXT_CALLS.test(calleeName(node))) ||
          (ts.isNewExpression(node) && calleeName(node) === "Error")
        ) {
          const first = node.arguments?.[0];
          if (first) shown(first);
        }
        ts.forEachChild(node, visit);
      };
      visit(source.sourceFile);
    }
    expect(problems).toEqual([]);
  });

  it("formats dates and numbers in the app's language", () => {
    const problems: string[] = [];
    const missingLocale = (args: readonly ts.Expression[] | undefined) => {
      const first = args?.[0];
      return !first || (ts.isIdentifier(first) && first.text === "undefined");
    };
    for (const source of sources()) {
      const visit = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          LOCALE_METHODS.has(node.expression.name.text) &&
          missingLocale(node.arguments)
        ) {
          report(source, node, problems);
        } else if (
          ts.isNewExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.expression.getText() === "Intl" &&
          INTL_FORMATTERS.has(node.expression.name.text) &&
          missingLocale(node.arguments)
        ) {
          report(source, node, problems);
        }
        ts.forEachChild(node, visit);
      };
      visit(source.sourceFile);
    }
    expect(problems).toEqual([]);
  });
});

/* Rust ──────────────────────────────────────────────────────────────────── */

// Messages that stay English: invariants, parse errors of launcher files,
// paths, and the tray's defaults until the main window sends its texts.
const RUST_ENGLISH_ON_PURPOSE = new Set([
  "A PlayCounter data path points outside its app folder.",
  "Battle.net sign-in must be cancelled from PlayCounter.",
  "Could not close the idle emulator window: {error}",
  "Could not create the Xbox app activator: {error}",
  "Could not create the Xbox package family name ({result}).",
  "Could not initialize Xbox app activation: {error}",
  "Could not size the Xbox package family name ({result}).",
  "Could not verify whether the emulator closed: {error}",
  "Could not verify whether the emulator is already running: {error}",
  "Cover path is not valid UTF-8.",
  "Epic Games sign-in must be cancelled from PlayCounter.",
  "Epic Games/Launcher/Portal/Binaries/{arch}/EpicGamesLauncher.exe",
  "Executable not found.",
  "Icon extraction failed: {error:?}",
  "Install UUID cache is unavailable.",
  "Invalid Battle.net database field.",
  "Invalid Battle.net database integer.",
  "Invalid Battle.net open request.",
  "Invalid Battle.net product catalogue.",
  "Invalid Battle.net sign-in request.",
  "Invalid Epic Games app name.",
  "Invalid Epic Games launch mode.",
  "Invalid Epic Games sign-in request.",
  "Invalid Steam AppID.",
  "Invalid Steam launch mode.",
  "Invalid Xbox launch mode.",
  "Invalid Xbox title ID.",
  "Invalid cover key.",
  "Invalid field size.",
  "Invalid install UUID.",
  "Missing value for VDF key {key}.",
  "No game active",
  "No monitor is available for the notification overlay.",
  "Open PlayCounter",
  "PlayCounter cannot import from this launcher.",
  "PlayCounter cannot list games for this launcher.",
  "PlayCounter notification",
  "PlayCounter requires a full Windows path without traversal segments.",
  "Quit PlayCounter",
  "Reset is only available in the main PlayCounter window.",
  "Some executable folders",
  "Steam localconfig has no Software section.",
  "Steam localconfig has no Steam section.",
  "Steam localconfig has no Valve section.",
  "Steam localconfig has no apps section.",
  "System Volume Information",
  "The emulator program has no usable parent directory.",
  "The shell could not open the link ({code}).",
  "This emulator does not provide a launch adapter yet.",
  "Too many Battle.net database fields.",
  "Too many Battle.net products.",
  "Truncated Battle.net database field.",
  "Truncated Battle.net database.",
  "Unclosed object in VDF file.",
  "Unclosed quoted string in VDF file.",
  "Unexpected character in VDF file at {cursor}.",
  "Unexpected closing brace in VDF file.",
  "Unknown hotkey action",
  "Unsupported Battle.net database field.",
  "Unsupported Microsoft sign-in URL.",
  "Unsupported external URL.",
  "User ignored processes folder is unavailable.",
  "VDF nesting exceeds the supported depth.",
]);

const RUST_LOG =
  /\b(log::|eprintln!|println!|debug!|info!|warn!|error!|trace!)/;

function rustFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return rustFiles(path);
    return entry.name.endsWith(".rs") ? [path] : [];
  });
}

// Sentence-like literals outside tests, comments and log lines.
function rustSentences() {
  const found: { at: string; text: string }[] = [];
  for (const path of rustFiles(rustDir)) {
    let code = readFileSync(path, "utf8");
    const tests = /#\[cfg\(test\)\]\s*mod\s+\w+/.exec(code);
    if (tests) code = code.slice(0, tests.index);
    const lines = code.split("\n");
    lines.forEach((line, index) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (RUST_LOG.test(line) || RUST_LOG.test(lines[index - 1] ?? "")) return;
      for (const match of line.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
        const text = match[1];
        if (
          /^[A-Z{]/.test(text) &&
          /\s/.test(text) &&
          /[a-z]{2,}\s+[a-z{]/i.test(text)
        ) {
          found.push({
            at: `${relative(rustDir, path).replace(/\\/g, "/")}:${index + 1}`,
            text,
          });
        }
      }
    });
  }
  return found;
}

// native.json keys as patterns over the Rust format strings; "{{x}}" stands
// for any {x}. The emulator sentences are built from "{label}".
function nativePatterns() {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Object.keys(texts("en", "native.json")).map((key) => ({
    key,
    pattern: new RegExp(
      `^${key
        .split(/\{\{\w+\}\}/)
        .map(escape)
        .join("\\{[^}]*\\}")
        .replace(
          /emulator (program|content)/,
          "(?:emulator $1|\\{label\\})",
        )}$`,
    ),
  }));
}

describe("Rust messages", () => {
  it("are translated or English on purpose", () => {
    const patterns = nativePatterns();
    const problems = rustSentences()
      .filter(({ text }) => !RUST_ENGLISH_ON_PURPOSE.has(text))
      .filter(({ text }) => !patterns.some(({ pattern }) => pattern.test(text)))
      .map(({ at, text }) => `${at} "${text}"`);
    expect(problems).toEqual([]);
  });

  it("still exist for every translated one", () => {
    const sentences = rustSentences().map(({ text }) => text);
    const missing = nativePatterns()
      .filter(({ pattern }) => !sentences.some((text) => pattern.test(text)))
      .map(({ key }) => key);
    expect(missing).toEqual([]);
  });
});
