export function toggleCollapsedSection(
  ids: readonly string[],
  id: string,
): string[] {
  return ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id];
}

export function normalizeCollapsedSections(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.length > 0,
      ),
    ),
  ];
}
