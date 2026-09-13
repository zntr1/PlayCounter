import {
  basename,
  isShareableToken,
  normalizeToken,
  stripQuotes,
} from "./signals";
import type {
  EmulatorAdapter,
  EmulatorContentSignal,
  EmulatorDetectionSource,
  EmulatorLaunchDiscovery,
  EmulatorReadContext,
  RawEmulatorSignals,
} from "./types";

export const PCSX2_EXE_NAMES = [
  "pcsx2-qt.exe",
  "pcsx2-qtx64.exe",
  "pcsx2-qtx64-avx2.exe",
  "pcsx2.exe",
];

const CONTENT_EXTENSION =
  /\.(?:(?:iso\.)?gz|iso|bin|img|mdf|chd|cso|zso|elf)$/i;
const SERIAL =
  /\b((?:SCES|SCUS|SCPS|SLES|SLUS|SLPS|SLPM|SCAJ|SLAJ|SCKA|SLKA|SCCS|SLCS|PAPX|PBPX))[-_ ]?(\d{3})\.?(\d{2})(?!\d)/gi;
const VALUE_OPTIONS = new Set([
  "-datapath",
  "-state",
  "-statefile",
  "-gameargs",
  "-logfile",
  // Older wx builds use double-dash configuration options.
  "--cfgpath",
  "--cfg",
  "--gs",
  "--pad",
  "--spu2",
  "--cdvd",
]);
const FLAGS = new Set([
  "-batch",
  "-nogui",
  "-portable",
  "-fastboot",
  "-slowboot",
  "-fullscreen",
  "-nofullscreen",
  "-bigpicture",
  "-earlyconsolelog",
  "-debugger",
  "-turbo",
  "-unlimited",
  "-raintegration",
  "--nogui",
  "--portable",
  "--fullscreen",
  "--windowed",
  "--fullboot",
  "--console",
]);

function isContentFile(raw: string) {
  const name = basename(raw);
  // BIOS, memory cards and renderer caches can also be .bin files. Renderer
  // cache names are excluded even when users move the cache directory.
  return (
    CONTENT_EXTENSION.test(name) &&
    !/(?:^|[\\/])(?:bios|memcards|savestates|cache|\.cache)(?:[\\/]|$)/i.test(
      raw,
    ) &&
    !/^(?:d3d\d*|vulkan|opengl|metal)[_-](?:shaders|pipelines)(?:[_.-]|$)/i.test(
      name,
    ) &&
    !/^(?:scph[-_ ]?\d|ps2[-_ ]?bios|bios(?:[._ -]|$)|rom[012](?:\.|$))/i.test(
      name,
    )
  );
}

function launchArgument(args: string[]) {
  const positional: string[] = [];
  let elf: string | null = null;
  let noMoreOptions = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = stripQuotes(args[index]);
    if (!noMoreOptions && arg === "--") {
      noMoreOptions = true;
      continue;
    }
    if (!noMoreOptions && arg.startsWith("-")) {
      const [option] = arg.split("=", 1);
      // BIOS, physical drives, configuration and diagnostics are not filenames.
      if (
        [
          "-bios",
          "--nodisc",
          "-disc",
          "--usecd",
          "-help",
          "-version",
          "-testconfig",
          "-setupwizard",
          "--help",
        ].includes(option)
      )
        return null;
      if (
        option === "-elf" ||
        option === "--elf" ||
        VALUE_OPTIONS.has(option)
      ) {
        const value = arg.includes("=")
          ? arg.slice(arg.indexOf("=") + 1)
          : args[++index];
        if (!value || value.startsWith("-")) return null;
        if (option === "-elf" || option === "--elf") elf = stripQuotes(value);
        continue;
      }
      // Unknown options might consume a path. Never guess which argument is a game.
      if (!FLAGS.has(arg)) return null;
      continue;
    }
    positional.push(arg);
  }
  if (positional.slice(0, -1).some(isContentFile)) return null;
  const path = elf ?? positional.join(" ");
  return path && isContentFile(path) ? path : null;
}

export function isPcsx2IdleTitle(title: string | null) {
  return /^(?:PCSX2(?:\s+v?\d+(?:\.[\w-]+)*(?:\s+(?:Nightly|Stable))?)?|PS2 BIOS(?:\s*\([^)]*\))?)(?:\s+\[(?:Debug|Devel)\])?$/i.test(
    title?.trim() ?? "",
  );
}

/** A successful empty handle scan is distinct from unavailable handle access. */
export function discoverPcsx2LaunchTarget(
  signals: Pick<RawEmulatorSignals, "args" | "openFiles" | "windowTitle">,
): EmulatorLaunchDiscovery | null {
  if (/^PS2 BIOS(?:\s|$)/i.test(signals.windowTitle?.trim() ?? "")) return null;
  if (signals.openFiles !== undefined) {
    const files = [
      ...new Map(
        signals.openFiles
          .filter(isContentFile)
          .map((path) => [path.toLowerCase(), path]),
      ).values(),
    ];
    // Current handles win over immutable start-up arguments, including after a
    // game change or shutdown. Multiple images can also be a library scan.
    return files.length === 1
      ? {
          target: { kind: "file", filePath: files[0] },
          source: "open_file_handle",
        }
      : null;
  }
  if (isPcsx2IdleTitle(signals.windowTitle)) return null;
  const path = launchArgument(signals.args);
  return path
    ? { target: { kind: "file", filePath: path }, source: "launch_arguments" }
    : null;
}

function identifyFile(
  path: string,
  context: EmulatorReadContext,
  detectionSource: EmulatorDetectionSource,
): EmulatorContentSignal | null {
  if (!isContentFile(path)) return null;
  const fileName = basename(path).normalize("NFKC");
  const serials = [...fileName.matchAll(SERIAL)];
  const serial =
    serials.length === 1
      ? `${serials[0][1]}-${serials[0][2]}${serials[0][3]}`.toLowerCase()
      : null;
  const normalized = normalizeToken(fileName, "rom");
  if (
    (!serial && !normalized) ||
    context.denylist.has(
      fileName.replace(CONTENT_EXTENSION, "").toLowerCase(),
    ) ||
    /[\u0000-\u001f\u007f]/.test(fileName)
  )
    return null;
  const kind = serial ? "title_id" : "rom";
  const value = serial ?? normalized!;
  const searchHint = fileName
    .replace(CONTENT_EXTENSION, "")
    .replace(SERIAL, "")
    .replace(/[[(]\s*[\])]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const shareable =
    /^[\p{L}\p{N}]/u.test(value) &&
    isShareableToken({
      value,
      kind,
      trust: "recognized",
      privateTokens: context.privateTokens,
    });
  return {
    kind,
    value,
    display: fileName,
    trust: "recognized",
    shareable,
    volatile: detectionSource === "open_file_handle",
    detectionSource,
    searchHint: searchHint || undefined,
    shareableSearchHint: Boolean(
      serial &&
      shareable &&
      searchHint.length >= 2 &&
      searchHint.length <= 120 &&
      !/[\\/:\u0000-\u001f\u007f]/.test(searchHint) &&
      isShareableToken({
        value: searchHint.toLowerCase(),
        kind,
        trust: "recognized",
        privateTokens: context.privateTokens,
      }),
    ),
  };
}

export const pcsx2Adapter: EmulatorAdapter = {
  id: "pcsx2",
  label: "PCSX2",
  launch: {
    targetKinds: ["file"],
    fileExtensions: [
      "iso",
      "bin",
      "img",
      "mdf",
      "chd",
      "cso",
      "zso",
      "gz",
      "elf",
    ],
    isValidContentFile: isContentFile,
    identifyTarget: (target, context) =>
      identifyFile(target.filePath, context, "launch_arguments"),
    discoverTarget: discoverPcsx2LaunchTarget,
    validateTargetForMapping: (mapping, target) => {
      const content = identifyFile(
        target.filePath,
        { denylist: new Set(), privateTokens: [] },
        "launch_arguments",
      );
      return content &&
        content.kind === mapping.contentKind &&
        content.value === mapping.contentValue
        ? { valid: true, association: "proven" }
        : { valid: false, reason: "content-name-mismatch" };
    },
  },
  read(signals, context) {
    const discovery = discoverPcsx2LaunchTarget(signals);
    const content =
      discovery &&
      identifyFile(discovery.target.filePath, context, discovery.source);
    if (content) return { state: "content", content };
    if (isPcsx2IdleTitle(signals.windowTitle) && !discovery)
      return { state: "idle" };
    // Qt game names are customizable bare titles. Keep them out of identities
    // and API search hints; without a disc signal the existing picker explains
    // that the game could not be identified.
    return {
      state: "unidentified",
      reason: signals.windowTitle ? "title-not-parsable" : "no-signal",
    };
  },
};
