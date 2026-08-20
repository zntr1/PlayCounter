import type { EmulatorContentRef } from "@playcounter/shared";
import { contentKey } from "./signals";
import type {
  EmulatorContentObservation,
  EmulatorContentSignal,
  EmulatorMapping,
  EmulatorObservation,
  EmulatorReading,
  EmulatorRuntimeState,
} from "./types";

export type EmulatorIntent =
  | { type: "match"; mapping: EmulatorMapping }
  | { type: "resolve"; items: Array<{ key: string } & EmulatorContentRef> }
  | { type: "observe"; observation: EmulatorObservation }
  | { type: "drop-observation"; key: string };

type ReadingInput = {
  pid: number;
  startedAtUnix: number;
  exeName: string;
  emulatorId: string;
  label: string;
  reading: EmulatorReading;
};

type EffectiveContent = Omit<ReadingInput, "reading"> & {
  content: EmulatorContentSignal;
};

export function reconcileEmulatorReadings(input: {
  readings: ReadingInput[];
  observations: readonly EmulatorObservation[];
  mappings: ReadonlyMap<string, EmulatorMapping>;
  runtime: Map<string, EmulatorRuntimeState>;
  now: number;
  lookupEnabled: boolean;
  retryMs: number;
}) {
  const observationMap = new Map(
    input.observations.map((observation) => [observation.key, observation]),
  );
  const currentRuntimeKeys = new Set<string>();
  const effective: EffectiveContent[] = [];
  const unidentified: ReadingInput[] = [];

  const keepPrevious = (
    reading: Omit<ReadingInput, "reading">,
    key: string,
  ) => {
    const mapping = input.mappings.get(key);
    const observation = observationMap.get(key);
    if (mapping) {
      effective.push({
        ...reading,
        content: {
          kind: mapping.contentKind,
          value: mapping.contentValue,
          display: mapping.display,
          trust: mapping.trust,
          shareable:
            mapping.trust === "recognized" && mapping.contentKind !== "folder",
          volatile: true,
          detectionSource: mapping.detectionSource,
        },
      });
    } else if (observation?.kind === "content") {
      effective.push({
        ...reading,
        content: observationToSignal(observation),
      });
    }
  };

  for (const item of input.readings) {
    const runtimeKey = `${item.emulatorId}:${item.pid}:${item.startedAtUnix}`;
    currentRuntimeKeys.add(runtimeKey);
    const previous = input.runtime.get(runtimeKey);
    if (item.reading.state === "content") {
      const key = contentKey({
        emulatorId: item.emulatorId,
        contentKind: item.reading.content.kind,
        contentValue: item.reading.content.value,
      });
      input.runtime.set(runtimeKey, { idleCount: 0, lastContentKey: key });
      effective.push({ ...item, content: item.reading.content });
      continue;
    }

    const idleCount = (previous?.idleCount ?? 0) + 1;
    if (previous?.lastContentKey && idleCount < 2) {
      input.runtime.set(runtimeKey, { ...previous, idleCount });
      keepPrevious(item, previous.lastContentKey);
    } else {
      input.runtime.set(runtimeKey, { idleCount });
      if (item.reading.state === "unidentified") unidentified.push(item);
    }
  }

  for (const [runtimeKey, previous] of [...input.runtime]) {
    if (currentRuntimeKeys.has(runtimeKey)) continue;
    const idleCount = previous.idleCount + 1;
    if (previous.lastContentKey && idleCount < 2) {
      const [emulatorId, pidText, startedAtText] = runtimeKey.split(":");
      keepPrevious(
        {
          emulatorId,
          pid: Number(pidText),
          startedAtUnix: Number(startedAtText),
          exeName: "",
          label:
            input.mappings.get(previous.lastContentKey)?.label ?? "Emulator",
        },
        previous.lastContentKey,
      );
      input.runtime.set(runtimeKey, { ...previous, idleCount });
    } else {
      input.runtime.delete(runtimeKey);
    }
  }

  const groups = new Map<
    string,
    { item: EffectiveContent; pids: Set<number> }
  >();
  for (const item of effective) {
    const key = contentKey({
      emulatorId: item.emulatorId,
      contentKind: item.content.kind,
      contentValue: item.content.value,
    });
    const group = groups.get(key) ?? { item, pids: new Set<number>() };
    group.pids.add(item.pid);
    groups.set(key, group);
  }

  const intents: EmulatorIntent[] = [];
  const runningKeys = new Set(groups.keys());
  const resolveItems: Array<
    { key: string; searchHint?: string } & EmulatorContentRef
  > = [];
  const nowIso = new Date(input.now).toISOString();

  for (const [key, group] of groups) {
    const mapping = input.mappings.get(key);
    if (mapping?.decision === "ignored") {
      if (observationMap.delete(key))
        intents.push({ type: "drop-observation", key });
      continue;
    }
    if (
      mapping?.decision === "game" &&
      mapping.gameId !== undefined &&
      mapping.gameName
    ) {
      intents.push({
        type: "match",
        mapping: {
          ...mapping,
          detectionSource:
            group.item.content.detectionSource ?? mapping.detectionSource,
        },
      });
      if (observationMap.delete(key))
        intents.push({ type: "drop-observation", key });
      continue;
    }

    const existing = observationMap.get(key);
    const previous = existing?.kind === "content" ? existing : undefined;
    const searchHintBecameShareable = Boolean(
      group.item.content.shareableSearchHint &&
      group.item.content.searchHint &&
      (!previous?.shareableSearchHint ||
        previous.searchHint !== group.item.content.searchHint),
    );
    const observation: EmulatorContentObservation = {
      kind: "content",
      key,
      emulatorId: group.item.emulatorId,
      label: group.item.label,
      hostExeName: group.item.exeName,
      contentKind: group.item.content.kind,
      contentValue: group.item.content.value,
      display: group.item.content.display,
      trust: group.item.content.trust,
      shareable: group.item.content.shareable,
      detectionSource:
        group.item.content.detectionSource ?? previous?.detectionSource,
      searchHint: group.item.content.searchHint,
      shareableSearchHint: group.item.content.shareableSearchHint,
      state:
        previous?.state ??
        (group.item.content.shareable ? "resolving" : "unknown"),
      autoResolve: previous?.autoResolve,
      candidates: previous?.candidates,
      detectedAt: previous?.detectedAt ?? nowIso,
      lastCheckedAt: searchHintBecameShareable
        ? undefined
        : previous?.lastCheckedAt,
      runningSince: previous?.runningSince,
      trackedSeconds: previous?.trackedSeconds,
    };
    const checkedAt = observation.lastCheckedAt
      ? Date.parse(observation.lastCheckedAt)
      : Number.NEGATIVE_INFINITY;
    if (
      observation.shareable &&
      observation.autoResolve !== false &&
      input.lookupEnabled &&
      input.now - checkedAt >= input.retryMs
    ) {
      observation.state = "resolving";
      observation.lastCheckedAt = nowIso;
      resolveItems.push({
        key,
        emulatorId: observation.emulatorId,
        contentKind: observation.contentKind,
        contentValue: observation.contentValue,
        searchHint: observation.shareableSearchHint
          ? observation.searchHint
          : undefined,
      });
    }
    observationMap.set(key, observation);
    intents.push({ type: "observe", observation });
  }

  for (const item of unidentified) {
    const key = `${item.emulatorId}:host:${item.exeName}`.toLowerCase();
    const previous = observationMap.get(key);
    const notice: EmulatorObservation = {
      kind: "host-notice",
      key,
      emulatorId: item.emulatorId,
      label: item.label,
      hostExeName: item.exeName,
      reason:
        item.reading.state === "unidentified"
          ? item.reading.reason
          : "no-signal",
      detectedAt: previous?.detectedAt ?? nowIso,
      dismissedAt:
        previous?.kind === "host-notice" ? previous.dismissedAt : undefined,
    };
    observationMap.set(key, notice);
    intents.push({ type: "observe", observation: notice });
  }

  for (const [key, observation] of observationMap) {
    if (observation.kind === "content" && !runningKeys.has(key)) {
      observationMap.set(key, {
        ...observation,
        endedAt: observation.endedAt ?? nowIso,
      });
    }
    if (
      observation.kind === "host-notice" &&
      !unidentified.some(
        (item) =>
          `${item.emulatorId}:host:${item.exeName}`.toLowerCase() === key,
      )
    ) {
      observationMap.set(key, {
        ...observation,
        endedAt: observation.endedAt ?? nowIso,
      });
    }
  }

  if (resolveItems.length > 0) {
    intents.push({ type: "resolve", items: resolveItems.slice(0, 20) });
  }
  return {
    intents,
    observations: [...observationMap.values()],
    runningKeys,
  };
}

export function accumulateObservationRuntime(
  observations: readonly EmulatorObservation[],
  runningKeys: ReadonlySet<string>,
  now: number,
  checkpointMs = 60_000,
) {
  const nowIso = new Date(now).toISOString();
  return observations.map((observation): EmulatorObservation => {
    if (observation.kind !== "content") return observation;
    if (runningKeys.has(observation.key)) {
      if (!observation.runningSince) {
        return { ...observation, runningSince: nowIso, endedAt: undefined };
      }
      const since = Date.parse(observation.runningSince);
      const elapsed = Number.isFinite(since) ? now - since : 0;
      if (elapsed >= checkpointMs) {
        return {
          ...observation,
          trackedSeconds: (observation.trackedSeconds ?? 0) + elapsed / 1000,
          runningSince: nowIso,
          endedAt: undefined,
        };
      }
      return observation.endedAt
        ? { ...observation, endedAt: undefined }
        : observation;
    }
    if (!observation.runningSince) return observation;
    const since = Date.parse(observation.runningSince);
    const elapsed = Number.isFinite(since) ? Math.max(0, now - since) : 0;
    const { runningSince: _runningSince, ...rest } = observation;
    return {
      ...rest,
      trackedSeconds: (observation.trackedSeconds ?? 0) + elapsed / 1000,
      endedAt: observation.endedAt ?? nowIso,
    };
  });
}

export function creditableSeconds(
  observation: EmulatorContentObservation,
  now: number,
) {
  const since = observation.runningSince
    ? Date.parse(observation.runningSince)
    : Number.NaN;
  const openSeconds = Number.isFinite(since)
    ? Math.max(0, now - since) / 1000
    : 0;
  return Math.round((observation.trackedSeconds ?? 0) + openSeconds);
}

function observationToSignal(
  observation: EmulatorContentObservation,
): EmulatorContentSignal {
  return {
    kind: observation.contentKind,
    value: observation.contentValue,
    display: observation.display,
    trust: observation.trust,
    shareable: observation.shareable,
    volatile: true,
    detectionSource: observation.detectionSource,
    searchHint: observation.searchHint,
    shareableSearchHint: observation.shareableSearchHint,
  };
}
