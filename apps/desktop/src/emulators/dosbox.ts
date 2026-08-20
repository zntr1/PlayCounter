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

export function readDosboxCommandLine(args: string[]): ParsedSignal | null {
  const confs: Array<{ raw: string; secondary: boolean }> = [];
  for (let index = 0; index < args.length - 1; index += 1) {
    if (args[index]?.toLowerCase() !== "-conf") continue;
    const raw = basename(args[index + 1] ?? "");
    confs.push({
      raw,
      secondary:
        /(?:[_-](?:single|settings|base))?\.conf$/i.test(raw) &&
        /[_-](?:single|settings|base)\.conf$/i.test(raw),
    });
  }
  for (const conf of [...confs].sort(
    (left, right) => Number(left.secondary) - Number(right.secondary),
  )) {
    const value = conf.raw
      .replace(/\.conf$/i, "")
      .replace(/^dosbox[_-]/i, "")
      .replace(/[_-](?:single|settings|base)$/i, "");
    const parsed = parsedSignal(
      value,
      "conf",
      "recognized",
      false,
      "launch_arguments",
    );
    if (parsed) return parsed;
  }

  for (const arg of args) {
    if (!/\.(?:exe|com|bat)$/i.test(stripQuotes(arg))) continue;
    const parsed = parsedSignal(
      arg,
      "program",
      "recognized",
      false,
      "launch_arguments",
    );
    if (parsed) return parsed;
  }

  const commands: string[] = [];
  for (let index = 0; index < args.length - 1; index += 1) {
    if (args[index]?.toLowerCase() === "-c")
      commands.push(args[index + 1] ?? "");
  }
  for (const command of commands.reverse()) {
    const trimmed = stripQuotes(command).trim();
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
    const parsed = parsedSignal(
      first,
      "program",
      "recognized",
      false,
      "launch_arguments",
    );
    if (parsed) return parsed;
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
  return parsedSignal(
    survivors[0],
    "program",
    "weak",
    true,
    "window_title",
  );
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
