import type {
  EmulatorContentKind,
  EmulatorSignalTrust,
  Game,
  GameSource,
} from "@playcounter/shared";

export type RawEmulatorSignals = {
  emulatorId: string;
  exeName: string;
  pid: number;
  startedAtUnix: number;
  args: string[];
  windowTitle: string | null;
};

export type EmulatorContentSignal = {
  kind: EmulatorContentKind;
  value: string;
  display: string;
  trust: EmulatorSignalTrust;
  shareable: boolean;
  volatile: boolean;
  searchHint?: string;
  shareableSearchHint?: boolean;
};

export type EmulatorReading =
  | { state: "content"; content: EmulatorContentSignal }
  | { state: "idle" }
  | {
      state: "unidentified";
      reason: "no-signal" | "title-not-parsable";
    };

export type EmulatorReadContext = {
  denylist: ReadonlySet<string>;
  privateTokens: readonly string[];
};

export interface EmulatorAdapter {
  id: string;
  label: string;
  read(
    signals: RawEmulatorSignals,
    context: EmulatorReadContext,
  ): EmulatorReading;
}

export type EmulatorContentObservation = {
  kind: "content";
  key: string;
  emulatorId: string;
  label: string;
  hostExeName: string;
  contentKind: EmulatorContentKind;
  contentValue: string;
  display: string;
  trust: EmulatorSignalTrust;
  shareable: boolean;
  searchHint?: string;
  shareableSearchHint?: boolean;
  state: "resolving" | "ambiguous" | "unknown";
  /** False while the user is deliberately choosing a replacement game. */
  autoResolve?: boolean;
  candidates?: Game[];
  detectedAt: string;
  lastCheckedAt?: string;
  runningSince?: string;
  trackedSeconds?: number;
  endedAt?: string;
};

export type EmulatorHostNotice = {
  kind: "host-notice";
  key: string;
  emulatorId: string;
  label: string;
  hostExeName: string;
  reason: "no-signal" | "title-not-parsable";
  detectedAt: string;
  endedAt?: string;
  dismissedAt?: string;
};

export type EmulatorObservation =
  | EmulatorContentObservation
  | EmulatorHostNotice;

export type EmulatorMapping = {
  contentKey: string;
  emulatorId: string;
  label: string;
  contentKind: EmulatorContentKind;
  contentValue: string;
  display: string;
  trust: EmulatorSignalTrust;
  decision: "game" | "ignored";
  gameId?: number;
  igdbId?: number;
  gameName?: string;
  coverUrl?: string;
  source?: GameSource;
  confidence: "curated" | "probable" | "user";
  needsConfirmation?: boolean;
  decidedAt: string;
  lastSeenAt: string;
};

export type EmulatorRuntimeState = {
  idleCount: number;
  lastContentKey?: string;
};

export type KnownEmulator = {
  emulatorId: string;
  label: string;
  firstSeenAt: string;
  lastSeenAt: string;
  hostExeNames: string[];
};
