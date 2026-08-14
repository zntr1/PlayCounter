import type { EmulatorContentKind } from "@playcounter/shared";

export type EmulatorResolverDefinition = {
  id: string;
  contentKinds: readonly EmulatorContentKind[];
  igdbPlatformIds: readonly number[];
  deriveSearchQuery(contentValue: string, searchHint?: string): string | null;
};

const executableOrConfigExtension = /\.(?:exe|com|bat|conf)$/i;
const dolphinContentExtension =
  /\.(?:elf|dol|gcm|iso|tgc|wbfs|ciso|gcz|wad|dff|wia|rvz|json)$/i;

function cleanFilenameQuery(value: string, extension: RegExp) {
  const query = value
    .replace(extension, "")
    .replace(
      /\s*[[(](?:disc|disk|side|rev|revision|region)?\s*[a-z0-9 +._-]+[\])]\s*$/i,
      "",
    )
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return query.length >= 2 ? query : null;
}

export const emulatorResolverDefinitions: readonly EmulatorResolverDefinition[] =
  [
    {
      id: "dosbox",
      contentKinds: ["conf", "program"],
      igdbPlatformIds: [13],
      deriveSearchQuery: (value) =>
        cleanFilenameQuery(value, executableOrConfigExtension),
    },
    {
      id: "dolphin",
      contentKinds: ["rom", "title_id"],
      // IGDB: Wii (5), Nintendo GameCube (21).
      igdbPlatformIds: [5, 21],
      deriveSearchQuery: (value, searchHint) =>
        /^(?:[0-9a-f]{16}|[a-z0-9]{6})$/i.test(value)
          ? cleanSearchHint(searchHint)
          : cleanFilenameQuery(value, dolphinContentExtension),
    },
  ];

function cleanSearchHint(value?: string) {
  const query = value
    ?.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return query &&
    query.length >= 2 &&
    query.length <= 120 &&
    !query.includes("\\")
    ? query
    : null;
}

const definitionsById = new Map(
  emulatorResolverDefinitions.map((definition) => [definition.id, definition]),
);

export function emulatorResolverFor(emulatorId: string) {
  return definitionsById.get(emulatorId.trim().toLowerCase()) ?? null;
}

export function supportsEmulatorContent(
  emulatorId: string,
  contentKind: EmulatorContentKind,
) {
  return (
    emulatorResolverFor(emulatorId)?.contentKinds.includes(contentKind) ?? false
  );
}
