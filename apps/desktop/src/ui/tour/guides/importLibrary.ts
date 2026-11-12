import { Download } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a } from "./shared";

const t = getT("tour");

export function importLibraryGuide(): TourDefinition {
  return {
    id: "import-library",
    version: 2,
    release: "1.2.2",
    kind: "guide",
    category: "library",
    icon: Download,
    title: t("Import a launcher library"),
    description: t("Review an optional import and confirm a sample game."),
    duration: t("2 min"),
    simulation: "import",
    finishView: "games",
    nextTourId: "watch-folders",
    steps: [
      {
        id: "intro",
        view: "games",
        anchor: a("demo-import"),
        title: t("Imports are optional"),
        body: t(
          "PlayCounter detects games automatically, regardless of launcher. Steam, Xbox, Battle.net, Epic Games, GOG, and PlayStation imports can help bring an existing library across. In your library, right-click My Games in the sidebar to open any importer. This practice does not scan your PC, sign in, or contact a provider.",
        ),
      },
      {
        id: "review",
        view: "games",
        anchor: a("demo-import"),
        anchorTargets: [a("demo-import-providers")],
        additionalAnchors: [a("demo-import-executable")],
        interactive: true,
        manualAdvance: true,
        allow: [a("demo-library-stage")],
        title: t("Review the game and executable"),
        body: t(
          "Choose a provider. One eligible game executable is preselected here; launcher and updater files are excluded. If several files are eligible in a real import, choose the game executable. Review the suggested title and cover before confirming.",
        ),
      },
      {
        id: "confirm",
        view: "games",
        anchor: a("demo-import"),
        anchorTargets: [a("demo-library-result"), a("demo-import-match")],
        interactive: true,
        manualAdvance: true,
        allow: [a("demo-library-stage")],
        title: t("Pick the game, then import"),
        body: t(
          "Try searching the bundled sample titles, click the exact game, then click Import. Clicking a suggestion alone imports nothing. The result here is temporary.",
        ),
      },
      {
        id: "totals",
        view: "games",
        anchor: a("demo-import"),
        title: t("Imported time and tracked sessions"),
        body: t(
          "Steam and Xbox can supply launcher playtime totals, and so can Epic Games, GOG, and PlayStation when you sign in. Those totals do not create a made-up session history. Battle.net does not provide past playtime here. Future sessions tracked by PlayCounter build History. A provider badge describes where a game came from; a file-match badge explains recognition.",
        ),
      },
      {
        id: "auto-add",
        view: "games",
        anchor: a("demo-import"),
        title: t("New installs join by themselves"),
        body: t(
          "After your first import from Steam, Battle.net, Epic Games, or GOG, games you install there later show up in My Games on their own. Games you removed from PlayCounter are not added again. Xbox games need another Xbox import. You can turn this off in Settings under Library import.",
        ),
      },
    ],
  };
}
