import { getT } from "./i18n";
import igdb from "./locales/en/igdb.json";

const t = getT("igdb");

type IgdbKey = keyof typeof igdb;

const known = new Set<string>(Object.keys(igdb));

/** An IGDB genre or game mode in the app's language. IGDB sends English
 *  names; ones igdb.json doesn't list stay as IGDB sends them. */
export function igdbTerm(name: string): string {
  return known.has(name) ? t(name as IgdbKey) : name;
}
