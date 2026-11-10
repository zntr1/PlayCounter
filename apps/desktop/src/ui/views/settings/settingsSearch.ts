import type { Settings } from "@playcounter/shared";
import {
  nodeAvailable,
  type SettingsGroupDef,
  type SettingsNode,
} from "./settingsTree";

export type SettingsHit = {
  node: SettingsNode;
  /** The switch it needs that is off, by name; null when it works. */
  off: string | null;
};

export type SettingsGroupHits = {
  group: SettingsGroupDef;
  hits: SettingsHit[];
};

// Case and accents don't matter: "popup" finds "Pop-ups", "ecran" finds "écran".
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();

/** Every setting whose texts hold all the words, in menu order, grouped. */
export function searchSettings(
  groups: SettingsGroupDef[],
  query: string,
  settings: Settings,
): SettingsGroupHits[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const results: SettingsGroupHits[] = [];
  for (const group of groups) {
    const hits: SettingsHit[] = [];
    for (const section of group.sections) {
      const context = [
        section.title?.() ?? "",
        group.title(),
        group.searchDescription ? group.description() : "",
      ];
      const walk = (nodes: SettingsNode[], off: string | null) => {
        for (const node of nodes) {
          if (!nodeAvailable(node)) continue;
          const text = fold(
            [
              node.title(),
              node.description?.() ?? "",
              ...(node.keywords?.() ?? []),
              ...context,
            ].join(" "),
          );
          if (words.every((word) => text.includes(word)))
            hits.push({ node, off });
          if (node.children)
            walk(
              node.children,
              off ?? (node.isOn?.(settings) === false ? node.title() : null),
            );
        }
      };
      walk(
        section.nodes,
        section.needs && !section.needs.isOn(settings)
          ? section.needs.title()
          : null,
      );
    }
    if (hits.length) results.push({ group, hits });
  }
  return results;
}
