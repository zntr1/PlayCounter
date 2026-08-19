export const TOUR_STATE_VERSION = 1;
export const WELCOME_VERSION = 1;

export type TourProgress = {
  version: number;
  welcomeVersion: number;
  completed: Record<string, number>;
};

export function defaultTourProgress(): TourProgress {
  return { version: TOUR_STATE_VERSION, welcomeVersion: 0, completed: {} };
}

export function normalizeTourProgress(
  value: unknown,
  knownIds: readonly string[],
): TourProgress {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultTourProgress();
  }
  const candidate = value as Partial<TourProgress>;
  if (candidate.version !== TOUR_STATE_VERSION) return defaultTourProgress();
  const completed: Record<string, number> = {};
  if (candidate.completed && typeof candidate.completed === "object") {
    for (const id of knownIds) {
      const version = candidate.completed[id];
      if (typeof version === "number" && Number.isFinite(version)) {
        completed[id] = version;
      }
    }
  }
  return {
    version: TOUR_STATE_VERSION,
    welcomeVersion:
      typeof candidate.welcomeVersion === "number"
        ? candidate.welcomeVersion
        : 0,
    completed,
  };
}

export function shouldShowWelcome(progress: TourProgress) {
  return progress.welcomeVersion < WELCOME_VERSION;
}

export function markWelcomeSeen(progress: TourProgress): TourProgress {
  return { ...progress, welcomeVersion: WELCOME_VERSION };
}

export function markTourCompleted(
  progress: TourProgress,
  id: string,
  version: number,
): TourProgress {
  return { ...progress, completed: { ...progress.completed, [id]: version } };
}
