export const INITIAL_LIBRARY_RENDER_COUNT = 12;
export const LIBRARY_RENDER_BATCH_SIZE = 12;

export function nextLibraryRenderLimit(
  current: number,
  total: number,
  batch = LIBRARY_RENDER_BATCH_SIZE,
) {
  return Math.min(Math.max(0, total), Math.max(0, current) + batch);
}
