import { Users } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a, NEXT_RELEASE } from "./shared";

const t = getT("tour");

/* A read-only walk over the real Launcher accounts page: no step lets a click
   through, so nothing signs in or out. Every launcher has a card whether it is
   signed in or not, so each step rings a control in both states: a step
   prefers the card it is about (signed in, or a sign-in that ran out) and
   falls back to any card. */

/** Something inside a card that stands like this. */
const inCard = (state: "signed-in" | "needs-sign-in", name: string) =>
  `${a("accounts-card")}[data-tour-state="${state}"] ${a(name)}`;

/** A launcher under My Games in the sidebar, not All games or PlayCounter. */
const sidebarLauncher =
  '.sidebar-sources [role="tab"][id^="library-tab-"]:not(#library-tab-all):not(#library-tab-unimported)';

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
    nextTourId: "watch-folders",
    steps: [
      {
        id: "nav",
        view: "accounts",
        anchor: a("nav-accounts"),
        title: t("Your launcher sign-ins in one place"),
        body: t(
          "<b>Launcher accounts</b> in the sidebar lists every launcher you can import from. A number on it means a sign-in needs you. This guide only shows the page: nothing is clicked or changed.",
        ),
      },
      {
        id: "card",
        view: "accounts",
        anchor: a("accounts-status"),
        anchorTargets: [inCard("signed-in", "accounts-status")],
        title: t("One card per launcher"),
        body: t(
          "The line under a launcher's name says where it stands: signed in and as whom, <b>Not signed in</b> or <b>Needs sign-in</b>. Steam needs no sign-in: its accounts are read on this PC.",
        ),
      },
      {
        id: "more",
        view: "accounts",
        anchor: a("accounts-card"),
        anchorTargets: [
          inCard("signed-in", "accounts-more"),
          a("accounts-more"),
        ],
        title: t("More actions on a card"),
        body: t(
          "Signed in, <b>More</b> holds <b>Check connection</b> and <b>Sign out</b>. Signing out keeps your games and playtime. Battle.net, Epic Games and GOG also offer <b>Find installed games</b>.",
        ),
      },
      {
        id: "sign-in-again",
        view: "accounts",
        anchor: a("accounts-action"),
        anchorTargets: [
          inCard("needs-sign-in", "accounts-action"),
          inCard("signed-in", "accounts-action"),
        ],
        title: t("When a sign-in runs out"),
        body: t(
          "Launchers end sign-ins now and then. The card then says <b>Needs sign-in</b> and offers <b>Sign in again</b>. After that, <b>Import games</b> brings your playtime up to date.",
        ),
      },
      {
        id: "accounts",
        view: "accounts",
        anchor: a("accounts-status"),
        anchorTargets: [inCard("signed-in", "accounts-status")],
        title: t("Several accounts of one launcher"),
        body: t(
          "One account per launcher is signed in at a time. For another, sign out, sign in with it and import again. Its hours are added to the first's, and Details lists each account.",
        ),
      },
      {
        id: "forget",
        view: "accounts",
        anchor: a("nav-settings"),
        anchorTargets: [sidebarLauncher],
        title: t("Forget a launcher's imported data"),
        body: t(
          "Right-click a launcher under My Games in the sidebar and choose <b>Forget imported data</b>, or find it in Settings under <b>Library import</b>. Your tracked sessions stay.",
        ),
      },
    ],
  };
}
