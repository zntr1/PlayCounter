type Snapshot = {
  exeName: string;
  exePath: string | null;
  emulatorId?: string | null;
  commandLine?: string[] | null;
  windowTitle?: string | null;
  [key: string]: unknown;
};

export function toPublicSnapshots<T extends Snapshot>(snapshots: T[]): T[] {
  const publicSnapshots = snapshots.map((snapshot) => {
    const {
      commandLine: _commandLine,
      windowTitle: _windowTitle,
      ...safe
    } = snapshot;
    return safe as T;
  });
  const seenHosts = new Set<string>();
  return publicSnapshots.filter((snapshot) => {
    if (!snapshot.emulatorId) return true;
    const key = snapshot.exeName.toLowerCase();
    if (seenHosts.has(key)) return false;
    seenHosts.add(key);
    return true;
  });
}
