import type {
  EmulatorContentKind,
  EmulatorSignalTrust,
} from "@playcounter/shared";
import {
  basename,
  isShareableToken,
  normalizeToken,
  stripQuotes,
} from "./signals";
import type {
  EmulatorAdapter,
  EmulatorContentSignal,
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
  searchHint?: string;
  shareableSearchHint?: boolean;
};

const DOLPHIN_CONTENT_EXTENSION =
  /\.(?:elf|dol|gcm|iso|tgc|wbfs|ciso|gcz|wad|dff|wia|rvz|json)$/i;
const NAND_TITLE_ID = /^[0-9a-f]{16}$/i;

function parseNandTitleId(raw: string): ParsedSignal | null {
  const value = stripQuotes(raw).trim().toLowerCase();
  if (!NAND_TITLE_ID.test(value)) return null;
  return {
    kind: "title_id",
    value,
    display: value.toUpperCase(),
    trust: "recognized",
    volatile: false,
  };
}

function parseContentFile(raw: string): ParsedSignal | null {
  const fileName = basename(raw);
  if (!DOLPHIN_CONTENT_EXTENSION.test(fileName)) return null;
  const value = normalizeToken(fileName, "rom");
  if (!value) return null;
  return {
    kind: "rom",
    value,
    display: fileName,
    trust: "recognized",
    volatile: false,
    searchHint: fileName.replace(DOLPHIN_CONTENT_EXTENSION, ""),
  };
}

function optionValue(
  args: string[],
  index: number,
  longNames: readonly string[],
  shortName: string,
) {
  const arg = args[index] ?? "";
  const lower = arg.toLowerCase();
  for (const name of longNames) {
    const prefix = `${name}=`;
    if (lower.startsWith(prefix)) return arg.slice(prefix.length);
    if (lower === name) return args[index + 1] ?? "";
  }
  if (lower === shortName) return args[index + 1] ?? "";
  return null;
}

export function readDolphinCommandLine(args: string[]): ParsedSignal | null {
  for (let index = 0; index < args.length; index += 1) {
    const raw = optionValue(
      args,
      index,
      ["--nand_title", "--nand-title"],
      "-n",
    );
    if (raw !== null) {
      const parsed = parseNandTitleId(raw);
      if (parsed) return parsed;
    }
  }

  for (let index = 0; index < args.length; index += 1) {
    const raw = optionValue(args, index, ["--exec"], "-e");
    if (raw === null) continue;
    const parsed = parseContentFile(raw);
    if (parsed) return parsed;
  }

  for (const arg of args) {
    if (arg.startsWith("-")) continue;
    const parsed = parseContentFile(arg);
    if (parsed) return parsed;
  }
  return null;
}

export function readDolphinTitle(
  title: string | null,
): ParsedSignal | { idle: true } | null {
  const trimmed = title?.trim();
  if (!trimmed) return null;
  if (/^dolphin(?:\s+(?:emulator\s+)?[\w.-]+)?$/i.test(trimmed)) {
    return { idle: true };
  }

  const segments = trimmed
    .split(/\s(?:-|—|\|)\s/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const dolphinIndex = segments.findIndex((segment) =>
    /^dolphin(?:\s|$)/i.test(segment),
  );
  if (dolphinIndex < 0) {
    return null;
  }

  const gameWithId = /^(.+?)\s+\(([a-z0-9]{6})\)$/i.exec(segments.at(-1) ?? "");
  if (dolphinIndex === 0 && gameWithId) {
    const gameTitle = gameWithId[1]
      .normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return {
      kind: "title_id",
      value: gameWithId[2].toLowerCase(),
      display: gameTitle,
      trust: "recognized",
      volatile: true,
      searchHint: gameTitle,
      shareableSearchHint:
        gameTitle.length >= 2 &&
        gameTitle.length <= 120 &&
        !/\\/.test(gameTitle),
    };
  }

  const candidates = segments.filter(
    (segment) =>
      !/^dolphin(?:\s|$)/i.test(segment) &&
      !/^(?:jit\w*(?:\s+(?:sc|dc))?|interpreter|vulkan|opengl|direct3d(?:\s+\d+)?|d3d\s*\d*|metal|hle|lle)$/i.test(
        segment,
      ) &&
      !/^(?:fps|vps|speed|resolution|latency)\s*[:=]/i.test(segment) &&
      !/^\d+(?:\.\d+)?\s*(?:fps|%|ms)$/i.test(segment),
  );
  if (candidates.length !== 1) return null;
  const value = normalizeToken(candidates[0]);
  if (!value) return null;
  return {
    kind: "rom",
    value,
    display: candidates[0],
    trust: "weak",
    volatile: true,
    searchHint: candidates[0],
  };
}

function finalizeSignal(
  parsed: ParsedSignal,
  context: EmulatorReadContext,
): EmulatorContentSignal {
  const shareable = isShareableToken({
    value: parsed.value,
    kind: parsed.kind,
    trust: parsed.trust,
    privateTokens: context.privateTokens,
  });
  const normalizedSearchHint = parsed.searchHint?.toLowerCase() ?? "";
  const searchHintContainsPrivateToken = context.privateTokens
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 2)
    .some((token) => normalizedSearchHint.includes(token));
  return {
    ...parsed,
    shareable,
    shareableSearchHint:
      shareable &&
      parsed.shareableSearchHint === true &&
      !searchHintContainsPrivateToken,
  };
}

export const dolphinAdapter: EmulatorAdapter = {
  id: "dolphin",
  label: "Dolphin",
  read(
    signals: RawEmulatorSignals,
    context: EmulatorReadContext,
  ): EmulatorReading {
    const launch = readDolphinCommandLine(signals.args);
    const title = readDolphinTitle(signals.windowTitle);
    if (
      title &&
      !("idle" in title) &&
      title.trust === "recognized" &&
      title.kind === "title_id"
    ) {
      return { state: "content", content: finalizeSignal(title, context) };
    }
    if (launch) {
      return {
        state: "content",
        content: finalizeSignal(
          title && !("idle" in title)
            ? { ...launch, searchHint: title.searchHint }
            : launch,
          context,
        ),
      };
    }
    if (title && "idle" in title) return { state: "idle" };
    if (title) {
      return { state: "content", content: finalizeSignal(title, context) };
    }
    return {
      state: "unidentified",
      reason: signals.windowTitle ? "title-not-parsable" : "no-signal",
    };
  },
};
