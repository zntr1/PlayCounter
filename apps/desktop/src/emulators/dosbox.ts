import type {
  EmulatorContentKind,
  EmulatorSignalTrust,
} from "@playcounter/shared";
import {
  basename,
  isShareableToken,
  normalizeToken,
  prettyDisplay,
  stripQuotes,
} from "./signals";
import type {
  EmulatorAdapter,
  EmulatorContentSignal,
  EmulatorDetectionSource,
  EmulatorLaunchDiscovery,
  EmulatorReadContext,
  EmulatorReading,
  RawEmulatorSignals,
} from "./types";

type ParsedSignal = {
  kind: EmulatorContentKind;
  value: string;
  display: string;
  trust: EmulatorSignalTrust;
  volatile: boolean;
  detectionSource: EmulatorDetectionSource;
  searchHint?: string;
};

const DOSBOX_PROGRAM_EXTENSION = /\.(?:exe|com|bat)$/i;
const DOSBOX_CONF_EXTENSION = /\.conf$/i;

function parsedSignal(
  raw: string,
  kind: EmulatorContentKind,
  trust: EmulatorSignalTrust,
  volatile: boolean,
  detectionSource: EmulatorDetectionSource,
): ParsedSignal | null {
  const value = normalizeToken(raw, kind);
  if (!value) return null;
  return {
    kind,
    value,
    display: prettyDisplay(basename(raw) || value),
    trust,
    volatile,
    detectionSource,
  };
}

function parseDosboxConf(raw: string): ParsedSignal | null {
  const value = basename(raw)
    .replace(/\.conf$/i, "")
    .replace(/^dosbox[_-]/i, "")
    .replace(/[_-](?:single|settings|base)$/i, "");
  return parsedSignal(value, "conf", "recognized", false, "launch_arguments");
}

function parseDosboxProgram(raw: string): ParsedSignal | null {
  if (!DOSBOX_PROGRAM_EXTENSION.test(stripQuotes(raw))) return null;
  return parsedSignal(raw, "program", "recognized", false, "launch_arguments");
}

function dosboxConfArguments(args: string[]) {
  const confs: Array<{ path: string; secondary: boolean }> = [];
  for (let index = 0; index < args.length - 1; index += 1) {
    if (args[index]?.toLowerCase() !== "-conf") continue;
    const path = stripQuotes(args[index + 1] ?? "").trim();
    const fileName = basename(path);
    if (!DOSBOX_CONF_EXTENSION.test(fileName)) continue;
    confs.push({
      path,
      secondary: /[_-](?:single|settings|base)\.conf$/i.test(fileName),
    });
  }
  return confs.sort(
    (left, right) => Number(left.secondary) - Number(right.secondary),
  );
}

function dosboxCommandPrograms(args: string[]) {
  const programs: string[] = [];
  for (let index = 0; index < args.length - 1; index += 1) {
    if (args[index]?.toLowerCase() !== "-c") continue;
    const trimmed = stripQuotes(args[index + 1] ?? "").trim();
    const first = /^"([^"]+)"|^([^\s;&|]+)/
      .exec(trimmed)
      ?.slice(1)
      .find(Boolean);
    if (!first) continue;
    const lower = first.toLowerCase();
    if (
      /^(?:mount|imgmount|config|keyb|loadfix|cls|exit|boot|echo)$/.test(
        lower,
      ) ||
      /^[a-z]:$/i.test(lower) ||
      /^(?:cd|chdir)$/i.test(lower)
    ) {
      continue;
    }
    if (parseDosboxProgram(first)) programs.push(first);
  }
  return programs;
}

function positionalDosboxPrograms(args: string[]) {
  return args
    .map((arg) => stripQuotes(arg).trim())
    .filter((arg) => !arg.startsWith("-") && Boolean(parseDosboxProgram(arg)));
}

function resolveWindowsLaunchPath(
  raw: string,
  workingDirectory?: string | null,
) {
  const path = stripQuotes(raw).trim().replaceAll("/", "\\");
  if (/^(?:[a-z]:\\|\\\\)/i.test(path)) return path;
  const cwd = workingDirectory?.trim().replaceAll("/", "\\");
  if (!cwd || !/^[a-z]:\\/i.test(cwd)) return null;
  const combined = path.startsWith("\\")
    ? `${cwd.slice(0, 2)}${path}`
    : `${cwd.replace(/\\+$/, "")}\\${path}`;
  const drive = combined.slice(0, 2);
  const segments: string[] = [];
  for (const segment of combined.slice(2).split(/\\+/)) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `${drive}\\${segments.join("\\")}`;
}

export function discoverDosboxLaunchTarget(
  args: string[],
  workingDirectory?: string | null,
): EmulatorLaunchDiscovery | null {
  const program = [
    ...positionalDosboxPrograms(args),
    ...dosboxCommandPrograms(args),
  ]
    .map((path) => resolveWindowsLaunchPath(path, workingDirectory))
    .find((path): path is string => Boolean(path));
  if (program) {
    return {
      target: { kind: "file", filePath: program },
      source: "launch_arguments",
    };
  }
  const conf = dosboxConfArguments(args)
    .map((item) => ({
      ...item,
      path: resolveWindowsLaunchPath(item.path, workingDirectory),
    }))
    .find((item): item is typeof item & { path: string } => Boolean(item.path));
  return conf
    ? {
        target: { kind: "file", filePath: conf.path },
        source: "launch_arguments",
      }
    : null;
}

export function readDosboxCommandLine(args: string[]): ParsedSignal | null {
  for (const arg of positionalDosboxPrograms(args)) {
    const parsed = parseDosboxProgram(arg);
    if (parsed) return parsed;
  }

  const commandPrograms = dosboxCommandPrograms(args);
  for (const program of [...commandPrograms].reverse()) {
    const parsed = parseDosboxProgram(program);
    if (parsed) return parsed;
  }

  for (const conf of dosboxConfArguments(args)) {
    const parsed = parseDosboxConf(conf.path);
    if (parsed) return parsed;
  }

  const commands: string[] = [];
  for (let index = 0; index < args.length - 1; index += 1) {
    if (args[index]?.toLowerCase() === "-c")
      commands.push(args[index + 1] ?? "");
  }
  for (const command of commands) {
    const mount = /^\s*mount\s+[a-z]\s+(.+)$/i.exec(stripQuotes(command));
    if (!mount) continue;
    const parsed = parsedSignal(
      mount[1],
      "folder",
      "recognized",
      false,
      "launch_arguments",
    );
    if (parsed) return { ...parsed, searchHint: parsed.value };
  }
  for (const arg of args) {
    const value = stripQuotes(arg);
    if (
      value.startsWith("-") ||
      !/[\\/]/.test(value) ||
      /\.[a-z0-9]{1,5}$/i.test(value)
    ) {
      continue;
    }
    const parsed = parsedSignal(
      value,
      "folder",
      "recognized",
      false,
      "launch_arguments",
    );
    if (parsed) return { ...parsed, searchHint: parsed.value };
  }
  return null;
}

export function dosboxVariant(exeName: string) {
  const normalized = exeName.toLowerCase();
  if (normalized.includes("staging")) return "staging" as const;
  if (normalized.includes("dosbox-x") || normalized.includes("dosbox_x")) {
    return "dosbox-x" as const;
  }
  return "classic" as const;
}

export function readDosboxTitle(
  title: string | null,
): ParsedSignal | { idle: true } | null {
  const trimmed = title?.trim();
  if (!trimmed) return null;

  const classic = /(?:^|,\s*)program:\s*([A-Za-z0-9_-]{1,8})\s*$/i.exec(
    trimmed,
  );
  if (classic) {
    if (classic[1].toLowerCase() === "dosbox") return { idle: true };
    return parsedSignal(
      classic[1],
      "program",
      "recognized",
      true,
      "window_title",
    );
  }

  const survivors = trimmed
    .split(/\s(?:-|-|\|)\s/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter(
      (segment) =>
        !/dosbox|staging/i.test(segment) &&
        !/\bv?\d+\.\d+/i.test(segment) &&
        !/cycles|cpu|frameskip|fps|paused|mouse|fullscreen|capture|%/i.test(
          segment,
        ),
    );
  if (survivors.length !== 1) return null;
  return parsedSignal(survivors[0], "program", "weak", true, "window_title");
}

function finalizeSignal(
  parsed: ParsedSignal,
  context: EmulatorReadContext,
): EmulatorContentSignal {
  return {
    ...parsed,
    shareable: isShareableToken({
      value: parsed.value,
      kind: parsed.kind,
      trust: parsed.trust,
      privateTokens: context.privateTokens,
    }),
  };
}

export const dosboxAdapter: EmulatorAdapter = {
  id: "dosbox",
  label: "DOSBox",
  launch: {
    targetKinds: ["file"],
    fileExtensions: ["conf", "exe", "com", "bat"],
    isValidContentFile: (fileName) =>
      DOSBOX_CONF_EXTENSION.test(fileName) ||
      DOSBOX_PROGRAM_EXTENSION.test(fileName),
    identifyTarget: (target, context) => {
      const parsed = DOSBOX_CONF_EXTENSION.test(target.filePath)
        ? parseDosboxConf(target.filePath)
        : parseDosboxProgram(target.filePath);
      return parsed ? finalizeSignal(parsed, context) : null;
    },
    discoverTarget: (signals) =>
      discoverDosboxLaunchTarget(signals.args, signals.workingDirectory),
    validateTargetForMapping: (_mapping, target) =>
      DOSBOX_CONF_EXTENSION.test(target.filePath) ||
      DOSBOX_PROGRAM_EXTENSION.test(target.filePath)
        ? { valid: true, association: "proven" }
        : { valid: false, reason: "unsupported-content-file" },
  },
  read(
    signals: RawEmulatorSignals,
    context: EmulatorReadContext,
  ): EmulatorReading {
    const launch = readDosboxCommandLine(signals.args);
    const title = readDosboxTitle(signals.windowTitle);
    if (title && "idle" in title) return { state: "idle" };
    if (title?.trust === "recognized" && title.value !== launch?.value) {
      return { state: "content", content: finalizeSignal(title, context) };
    }
    if (title?.trust === "weak" && launch) {
      return {
        state: "content",
        content: finalizeSignal(
          { ...launch, searchHint: title.value },
          context,
        ),
      };
    }
    if (title)
      return { state: "content", content: finalizeSignal(title, context) };
    if (launch)
      return { state: "content", content: finalizeSignal(launch, context) };
    return {
      state: "unidentified",
      reason: signals.windowTitle ? "title-not-parsable" : "no-signal",
    };
  },
};
