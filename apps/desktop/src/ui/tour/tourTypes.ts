import type { LucideIcon } from "lucide-react";
import type { ViewId } from "../../store";
import type { SettingsGroupId } from "../views/settings/settingsGroups";
import { getT } from "../../i18n";

const t = getT("tour");

export type TourAdvance =
  | { type: "anchor-present"; selector: string }
  | {
      type: "event";
      name:
        | "demo.action-completed"
        | "mygames.demo-session-logged"
        | "mygames.demo-launch-attempted"
        | "library.demo-shelf-created"
        | "demo.step-completed";
    };

export type TourEventName = Extract<TourAdvance, { type: "event" }>["name"];

export function tourCategories() {
  return [
    { id: "getting-started", title: t("Getting started") },
    { id: "library", title: t("Your library") },
    { id: "playtime", title: t("Playtime & stats") },
    { id: "detection", title: t("Detection & launching") },
    { id: "settings", title: t("Settings & support") },
  ] as const;
}

export type TourCategoryId = ReturnType<typeof tourCategories>[number]["id"];

export type TourStep = {
  id: string;
  title: string;
  /** What the step is about. `<b>…</b>` marks the name of a control. */
  body: string;
  /** What to do now, shown as "Your turn". `<b>` and `<kbd>` are allowed.
   *  A step with a task finishes by itself once the task is done. */
  task?: string;
  view: ViewId | "keep" | "return";
  /** On the Settings view: the group the step opens. */
  settingsGroup?: SettingsGroupId;
  anchor?: string;
  /** Prefer these targets, in order, as an action opens a menu or dialog. */
  anchorTargets?: string[];
  additionalAnchors?: string[];
  /** Place instructions outside this container while highlighting its detail. */
  positionAnchor?: string;
  optional?: boolean;
  interactive?: boolean;
  manualAdvance?: boolean;
  /** The highlighted controls are real settings: a change is saved. */
  persistentInteraction?: boolean;
  allow?: string[];
  advanceOn?: TourAdvance;
  retreatWhenMissing?: string;
  backTo?: string;
  skipTo?: string;
  keyboardHint?: string;
  /** The step's dialog brings its own backdrop, so the guide draws none. */
  ownBackdrop?: boolean;
  /** Entering the step puts the Discovered sample back to its start. */
  resetsDiscoveredSample?: boolean;
};

export type TourDefinition = {
  id: string;
  version: number;
  kind: "core" | "guide";
  category: TourCategoryId;
  title: string;
  description: string;
  duration: string;
  icon: LucideIcon;
  demoGame?: boolean;
  practice?: boolean;
  simulation?: "detection" | "stats" | "import";
  finishView?: ViewId;
  release?: string;
  nextTourId?: string;
  steps: TourStep[];
};

/** A guide the player tries things in, on sample data. Real settings a guide
 *  only walks through do not count. */
export const isHandsOn = (tour: TourDefinition) =>
  tour.steps.some((step) => step.interactive && !step.persistentInteraction);
