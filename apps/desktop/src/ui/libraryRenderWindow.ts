export const INITIAL_LIBRARY_RENDER_COUNT = 36;
export const LIBRARY_RENDER_BATCH_SIZE = 36;

export function nextLibraryRenderLimit(current: number, total: number) {
  return Math.min(
    Math.max(0, total),
    Math.max(0, current) + LIBRARY_RENDER_BATCH_SIZE,
  );
}
