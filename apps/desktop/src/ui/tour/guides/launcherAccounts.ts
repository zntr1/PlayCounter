import { Users } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { NEXT_RELEASE } from "./shared";

const t = getT("tour");

// Starting point only: the steps are still to be written (docs/tours-plan.md, WP6).
export function launcherAccountsGuide(): TourDefinition {
  return {
    id: "launcher-accounts",
    version: 1,
    release: NEXT_RELEASE,
    kind: "guide",
    category: "library",
    icon: Users,
    title: t("Launcher accounts"),
    description: t(
      "Sign-ins, several accounts and what to do when one runs out.",
    ),
    duration: t("1 min"),
    steps: [
      {
        id: "intro",
        view: "accounts",
        title: t("Your launcher sign-ins in one place"),
        body: t("Every launcher you import from has a card here."),
      },
    ],
  };
}
