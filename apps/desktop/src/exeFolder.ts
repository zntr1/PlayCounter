/* The folder an unknown executable lives in is the best evidence of what it
   is: "steamapps\common\Hades II" says game, "Program Files\PostgreSQL" does
   not. Discovered shows the folder as a trail and marks the part that gives a
   game away. */

export type FolderSegment = {
  text: string;
  /** Part of a known game location, e.g. "steamapps" and "common". */
  marker: boolean;
  /** The folder right after that location, usually the game's own. */
  gameFolder: boolean;
};

export type ExeFolder = {
  segments: FolderSegment[];
  /** Where it sits, phrased for "Probably a game: it's in …". */
  gameLocation: string | null;
};

// Most specific first; a plain "Games" folder is the weakest evidence.
const GAME_LOCATIONS: ReadonlyArray<{ path: string[]; label: string }> = [
  { path: ["steamapps", "common"], label: "a Steam library" },
  { path: ["epic games"], label: "the Epic Games folder" },
  { path: ["xboxgames"], label: "the Xbox games folder" },
  { path: ["gog galaxy", "games"], label: "a GOG games folder" },
  { path: ["gog games"], label: "a GOG games folder" },
  {
    path: ["ubisoft game launcher", "games"],
    label: "the Ubisoft games folder",
  },
  { path: ["ea games"], label: "the EA games folder" },
  { path: ["amazon games", "library"], label: "the Amazon Games library" },
  { path: ["itch", "apps"], label: "the itch.io library" },
  { path: ["games"], label: "a folder called Games" },
];

export function describeExeFolder(exePath: string): ExeFolder {
  const parts = exePath.split(/[\\/]+/).filter(Boolean);
  const folders = parts.slice(0, -1);
  const lower = folders.map((part) => part.toLowerCase());

  for (const location of GAME_LOCATIONS) {
    const start = findSequence(lower, location.path);
    // The location itself must hold a game folder, not the file directly.
    if (start < 0 || start + location.path.length >= folders.length) continue;
    const end = start + location.path.length;
    return {
      gameLocation: location.label,
      segments: folders.map((text, index) => ({
        text,
        marker: index >= start && index < end,
        gameFolder: index === end,
      })),
    };
  }
  return {
    gameLocation: null,
    segments: folders.map((text) => ({
      text,
      marker: false,
      gameFolder: false,
    })),
  };
}

function findSequence(haystack: readonly string[], needle: readonly string[]) {
  for (let index = 0; index + needle.length <= haystack.length; index += 1) {
    if (needle.every((part, offset) => haystack[index + offset] === part)) {
      return index;
    }
  }
  return -1;
}
