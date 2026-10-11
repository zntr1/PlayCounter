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
  /** The known game location it sits in; Discovered words it. */
  gameLocation: GameLocation | null;
};

export type GameLocation =
  | "steam"
  | "epic"
  | "xbox"
  | "gog"
  | "ubisoft"
  | "ea"
  | "amazon"
  | "itch"
  | "games";

// Most specific first; a plain "Games" folder is the weakest evidence.
const GAME_LOCATIONS: ReadonlyArray<{
  path: string[];
  location: GameLocation;
}> = [
  { path: ["steamapps", "common"], location: "steam" },
  { path: ["epic games"], location: "epic" },
  { path: ["xboxgames"], location: "xbox" },
  { path: ["gog galaxy", "games"], location: "gog" },
  { path: ["gog games"], location: "gog" },
  { path: ["ubisoft game launcher", "games"], location: "ubisoft" },
  { path: ["ea games"], location: "ea" },
  { path: ["amazon games", "library"], location: "amazon" },
  { path: ["itch", "apps"], location: "itch" },
  { path: ["games"], location: "games" },
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
      gameLocation: location.location,
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
