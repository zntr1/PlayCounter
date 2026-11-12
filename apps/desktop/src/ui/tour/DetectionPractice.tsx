import type { Game } from "@playcounter/shared";
import { getT } from "../../i18n";
import { useAppStore } from "../../store";
import { DiscoveredView } from "../views/DiscoveredView";
import {
  AmbiguousMatchCard,
  type AmbiguousSampleChoice,
} from "../views/nowPlaying/AmbiguousMatchCard";
import { emitTourEvent } from "./tourEvents";
import { TOUR_SAMPLE_CHOICES } from "./TourSampleSearch";

const t = getT("tour");

/* Practice for "Fix an unrecognized game": the page the step is on, with
   sample apps. A step on Discovered shows the real Discovered page (it
   brings its own samples while a guide runs, see discoveredSample.ts); a
   step on Now Playing shows the card that asks which game a file is. */
export function DetectionPractice() {
  const onNowPlaying = useAppStore((state) => state.activeView === "now");
  return onNowPlaying ? <PickerSample /> : <DiscoveredView />;
}

// i18n-exempt: a sample file several games could ship, in a sample folder.
const PICKER_FILE = "Engine.exe";
const PICKER_PATH = "C:\\Games\\New game\\Engine.exe";
/** Database games past the two covers, so the card offers its search. */
const PICKER_HIDDEN_GAMES = 38;

const pickerGames = (): Game[] =>
  TOUR_SAMPLE_CHOICES.map((choice) => ({
    id: choice.igdbId,
    name: choice.name,
    source: "igdb",
    coverUrl: choice.coverUrl ?? "",
    releaseYear: choice.releaseYear,
  }));

function pickerMessage(choice: AmbiguousSampleChoice) {
  switch (choice.kind) {
    case "game":
      return t(
        "Sample tracked as {{name}}. In the app, this choice is remembered on this PC.",
        { name: choice.name },
      );
    case "custom":
      return t(
        "Sample added as {{name}}. Custom games appear in My Games; no global filename match is created.",
        { name: choice.name },
      );
    case "software":
      return t(
        "Sample counted as software. In the app, its time moves to the Software page.",
      );
    case "reported":
      return t(
        "Sample ignored. In the app, an anonymous report also goes to review.",
      );
    case "ignored":
      return t("Sample ignored. In the app, it can be restored in Discovered.");
  }
}

function PickerSample() {
  // Back and a jump from the card's list start the card over.
  const resetToken = useAppStore((state) => state.demoResetToken);
  return (
    <div data-tour="demo-ambiguous">
      <AmbiguousMatchCard
        key={resetToken}
        exeName={PICKER_FILE}
        exePath={PICKER_PATH}
        candidates={pickerGames()}
        hiddenCandidateCount={PICKER_HIDDEN_GAMES}
        elapsedSeconds={754}
        ended={false}
        sample={{
          // Every way out is a decision, so each one finishes the step.
          onChoice: (choice) =>
            emitTourEvent("demo.step-completed", pickerMessage(choice)),
        }}
      />
    </div>
  );
}
