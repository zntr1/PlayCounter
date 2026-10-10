import { isAppLanguage, type AppLanguage } from "./appLanguages";
import { appLanguage } from "./i18n";
import rawReleaseNotes from "./releaseNotes.json";

export const MAX_RELEASE_NOTE_HEADLINE_LENGTH = 240;
export const MAX_RELEASE_NOTE_LINE_LENGTH = 600;
export const MAX_RELEASE_NOTE_HIGHLIGHTS = 12;
export const MAX_RELEASE_NOTE_PARAGRAPHS = 8;

export type ReleaseNoteText = {
  headline: string;
  highlights: string[];
};

export type ReleaseNote = ReleaseNoteText & {
  version: string;
  releasedAt?: string;
  /** The headline and highlights in the other app languages. */
  translations?: Partial<Record<AppLanguage, ReleaseNoteText>>;
};

/** Update manifest notes in the other app languages. */
export type TranslatedNotes = Partial<Record<AppLanguage, string>>;

export type DisplayNotes = {
  headline: string | null;
  highlights: string[];
  paragraphs: string[];
};

export type ReleaseNotesDecision =
  | { action: "wait" }
  | { action: "mark-seen"; version: string }
  | { action: "show"; version: string; notes: ReleaseNote[] };

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const BULLET_PREFIX = /^\s*[-*+•–]\s+/;
const MARKDOWN_HEADING = /^\s*#{1,6}\s+/;

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(CONTROL_CHARACTERS, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.slice(0, maxLength);
}

function normalizeVersion(version: string) {
  return version.trim().replace(/^v/i, "");
}

function parseReleaseVersion(version: string): [number, number, number] | null {
  const match = normalizeVersion(version).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareReleaseVersions(left: string, right: string): number | null {
  const leftParts = parseReleaseVersion(left);
  const rightParts = parseReleaseVersion(right);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

function sanitizeNoteText(value: unknown): ReleaseNoteText | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const headline = cleanText(raw.headline, MAX_RELEASE_NOTE_HEADLINE_LENGTH);
  if (!headline) return null;

  const highlights = Array.isArray(raw.highlights)
    ? raw.highlights
        .map((item) => cleanText(item, MAX_RELEASE_NOTE_LINE_LENGTH))
        .filter((item): item is string => item !== null)
        .slice(0, MAX_RELEASE_NOTE_HIGHLIGHTS)
    : [];
  return { headline, highlights };
}

function sanitizeTranslations(value: unknown): ReleaseNote["translations"] {
  if (!value || typeof value !== "object") return undefined;
  const translations: ReleaseNote["translations"] = {};
  for (const [language, raw] of Object.entries(value)) {
    if (!isAppLanguage(language) || language === "en") continue;
    const text = sanitizeNoteText(raw);
    if (text) translations[language] = text;
  }
  return Object.keys(translations).length > 0 ? translations : undefined;
}

export function sanitizeReleaseNotes(value: unknown): ReleaseNote[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const raw = candidate as Record<string, unknown>;
    const version = cleanText(raw.version, 32);
    const text = sanitizeNoteText(raw);
    if (!version || !text) return [];

    const releasedAt = cleanText(raw.releasedAt, 32);
    const translations = sanitizeTranslations(raw.translations);

    return [
      {
        version: normalizeVersion(version),
        ...text,
        ...(releasedAt ? { releasedAt } : {}),
        ...(translations ? { translations } : {}),
      },
    ];
  });
}

export const RELEASE_NOTES = sanitizeReleaseNotes(rawReleaseNotes);

export function findReleaseNote(
  version: string | null | undefined,
  notes: readonly ReleaseNote[] = RELEASE_NOTES,
): ReleaseNote | null {
  if (!version) return null;
  const normalized = normalizeVersion(version);
  return (
    notes.find((note) => normalizeVersion(note.version) === normalized) ?? null
  );
}

export function findUnseenReleaseNotes(
  currentVersion: string | null | undefined,
  lastSeenVersion: string | null | undefined,
  notes: readonly ReleaseNote[] = RELEASE_NOTES,
): ReleaseNote[] {
  const currentNote = findReleaseNote(currentVersion, notes);
  if (!currentVersion || !currentNote || !lastSeenVersion) {
    return currentNote ? [currentNote] : [];
  }

  const rangeDirection = compareReleaseVersions(
    lastSeenVersion,
    currentVersion,
  );
  if (rangeDirection === null || rangeDirection >= 0) return [currentNote];

  const selected = new Map<string, ReleaseNote>();
  for (const note of notes) {
    const afterLastSeen = compareReleaseVersions(note.version, lastSeenVersion);
    const atOrBeforeCurrent = compareReleaseVersions(
      note.version,
      currentVersion,
    );
    if (
      afterLastSeen !== null &&
      atOrBeforeCurrent !== null &&
      afterLastSeen > 0 &&
      atOrBeforeCurrent <= 0
    ) {
      selected.set(normalizeVersion(note.version), note);
    }
  }

  return [...selected.values()].sort(
    (left, right) => compareReleaseVersions(right.version, left.version) ?? 0,
  );
}

/** The note in the app's language, or in English when it has no translation. */
export function toDisplayNotes(
  note: ReleaseNote,
  language: AppLanguage = appLanguage(),
): DisplayNotes {
  const text = note.translations?.[language] ?? note;
  return {
    headline: text.headline,
    highlights: text.highlights,
    paragraphs: [],
  };
}

/** The update manifest's notes_translations, for the languages the app has. */
export function sanitizeTranslatedNotes(
  value: unknown,
): TranslatedNotes | undefined {
  if (!value || typeof value !== "object") return undefined;
  const notes: TranslatedNotes = {};
  for (const [language, text] of Object.entries(value)) {
    if (!isAppLanguage(language) || language === "en") continue;
    if (typeof text === "string" && text.trim()) notes[language] = text;
  }
  return Object.keys(notes).length > 0 ? notes : undefined;
}

/** An available update's notes in the app's language, else in English. */
export function updateDisplayNotes(
  update: { notes?: string; translatedNotes?: TranslatedNotes },
  language: AppLanguage = appLanguage(),
): DisplayNotes {
  return parseManifestNotes(update.translatedNotes?.[language] ?? update.notes);
}

export function parseManifestNotes(
  value: string | null | undefined,
): DisplayNotes {
  const result: DisplayNotes = {
    headline: null,
    highlights: [],
    paragraphs: [],
  };
  if (!value?.trim()) return result;

  let sawBullet = false;
  for (const rawLine of value.split(/\r?\n/)) {
    const withoutHeading = rawLine.replace(MARKDOWN_HEADING, "");
    const isBullet = BULLET_PREFIX.test(withoutHeading);
    const text = cleanText(
      withoutHeading.replace(BULLET_PREFIX, ""),
      MAX_RELEASE_NOTE_LINE_LENGTH,
    );
    if (!text) continue;

    if (isBullet) {
      sawBullet = true;
      if (result.highlights.length < MAX_RELEASE_NOTE_HIGHLIGHTS) {
        result.highlights.push(text);
      }
      continue;
    }
    if (!result.headline && !sawBullet) {
      result.headline = text.slice(0, MAX_RELEASE_NOTE_HEADLINE_LENGTH);
    } else if (result.paragraphs.length < MAX_RELEASE_NOTE_PARAGRAPHS) {
      result.paragraphs.push(text);
    }
  }

  return result;
}

export function isEmptyDisplayNotes(notes: DisplayNotes) {
  return (
    !notes.headline &&
    notes.highlights.length === 0 &&
    notes.paragraphs.length === 0
  );
}

export function decideReleaseNotesDisplay(
  input: {
    version: string | null;
    lastSeenVersion: string | null;
    hadPersistedState: boolean;
    blocked: boolean;
  },
  notes: readonly ReleaseNote[] = RELEASE_NOTES,
): ReleaseNotesDecision {
  if (!input.version) return { action: "wait" };
  const version = normalizeVersion(input.version);
  if (
    input.lastSeenVersion &&
    normalizeVersion(input.lastSeenVersion) === version
  ) {
    return { action: "wait" };
  }
  if (input.blocked) return { action: "wait" };
  if (!input.hadPersistedState) return { action: "mark-seen", version };

  const unseenNotes = findUnseenReleaseNotes(
    version,
    input.lastSeenVersion,
    notes,
  );
  return unseenNotes.length > 0
    ? { action: "show", version, notes: unseenNotes }
    : { action: "mark-seen", version };
}
