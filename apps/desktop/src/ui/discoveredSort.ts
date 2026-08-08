export type IgnoredProcessSort =
  | "lastAdded"
  | "az"
  | "za"
  | "userFirst"
  | "systemFirst";

type ReviewExecutable = {
  exeName: string;
  isRunning: boolean;
  cacheEntry: {
    state: string;
    trackedSeconds?: number;
    runningSince?: string;
  } | null;
};

type FindableReviewExecutable = {
  exeName: string;
  exePath: string | null;
};

export function findReviewExecutables<T extends FindableReviewExecutable>(
  executables: readonly T[],
  query: string,
  limit = 8,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle || limit <= 0) return [];

  return executables
    .map((executable, index) => {
      const exeName = executable.exeName.toLowerCase();
      const exePath = executable.exePath?.toLowerCase() ?? "";
      const matchRank = exeName.startsWith(needle)
        ? 0
        : exeName.includes(needle)
          ? 1
          : exePath.includes(needle)
            ? 2
            : -1;
      return { executable, index, matchRank };
    })
    .filter((entry) => entry.matchRank >= 0)
    .sort(
      (left, right) =>
        left.matchRank - right.matchRank || left.index - right.index,
    )
    .slice(0, limit)
    .map((entry) => entry.executable);
}

function observedRuntimeSeconds(executable: ReviewExecutable, now: number) {
  const entry = executable.cacheEntry;
  if (!entry || entry.state !== "unmatched") return 0;

  const accumulated = entry.trackedSeconds ?? 0;
  if (!executable.isRunning || !entry.runningSince) return accumulated;

  const runningSince = Date.parse(entry.runningSince);
  if (!Number.isFinite(runningSince)) return accumulated;
  return accumulated + Math.max(0, (now - runningSince) / 1000);
}

export function sortReviewExecutables<T extends ReviewExecutable>(
  executables: readonly T[],
  now = Date.now(),
): T[] {
  return [...executables].sort((left, right) => {
    const runningOrder = Number(right.isRunning) - Number(left.isRunning);
    if (runningOrder !== 0) return runningOrder;

    const runtimeOrder =
      observedRuntimeSeconds(right, now) - observedRuntimeSeconds(left, now);
    if (runtimeOrder !== 0) return runtimeOrder;

    return left.exeName.localeCompare(right.exeName, undefined, {
      sensitivity: "base",
    });
  });
}

type IgnoredExecutable = {
  key: string;
  exeName: string;
  status?: string;
};

export function sortIgnoredExecutables<T extends IgnoredExecutable>(
  executables: readonly T[],
  sort: IgnoredProcessSort,
  addedOrder: readonly string[],
): T[] {
  const sorted = [...executables];

  if (sort === "az" || sort === "za") {
    const direction = sort === "az" ? 1 : -1;
    return sorted.sort(
      (left, right) =>
        direction *
        left.exeName.localeCompare(right.exeName, undefined, {
          sensitivity: "base",
        }),
    );
  }

  if (sort === "userFirst" || sort === "systemFirst") {
    const preferredStatus = sort === "userFirst" ? "userIgnored" : "ignored";
    return sorted.sort((left, right) => {
      const categoryOrder =
        Number(right.status === preferredStatus) -
        Number(left.status === preferredStatus);
      return (
        categoryOrder ||
        left.exeName.localeCompare(right.exeName, undefined, {
          sensitivity: "base",
        })
      );
    });
  }

  const addedIndexes = new Map(
    addedOrder.map((key, index) => [key.toLowerCase(), index]),
  );
  return sorted.sort((left, right) => {
    const leftIndex = addedIndexes.get(left.key) ?? -1;
    const rightIndex = addedIndexes.get(right.key) ?? -1;
    return (
      rightIndex - leftIndex ||
      left.exeName.localeCompare(right.exeName, undefined, {
        sensitivity: "base",
      })
    );
  });
}

type RunningExecutable = {
  isRunning: boolean;
  status: string;
};

export function filterRunningExecutables<T extends RunningExecutable>(
  executables: readonly T[],
  filterId: string,
  runningOnly: boolean,
): T[] {
  if (!runningOnly || filterId !== "ignored") return [...executables];
  return executables.filter(
    (executable) => executable.isRunning && executable.status === "userIgnored",
  );
}

export function shouldShowRunningUserProcessesOnly(filterId: string) {
  return filterId === "ignored";
}

export function paginateExecutables<T>(
  executables: readonly T[],
  requestedPage: number,
  requestedPageSize: number,
) {
  const pageSize = Math.max(1, requestedPageSize);
  const pageCount = Math.max(1, Math.ceil(executables.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const offset = (page - 1) * pageSize;
  const items = executables.slice(offset, offset + pageSize);

  return {
    items,
    page,
    pageCount,
    start: items.length > 0 ? offset + 1 : 0,
    end: offset + items.length,
    total: executables.length,
  };
}
