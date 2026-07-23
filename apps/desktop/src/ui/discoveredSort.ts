export type IgnoredProcessSort =
  | "lastAdded"
  | "az"
  | "za"
  | "userFirst"
  | "systemFirst";

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
