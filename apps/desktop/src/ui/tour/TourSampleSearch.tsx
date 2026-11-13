import type { CommunityMetadataCandidate } from "@playcounter/shared";
import { useState } from "react";
import { CommunitySuggestionForm } from "../views/DiscoveredView";
import { TOUR_DEMO_GAME, TOUR_DEMO_EMULATOR } from "./tourDemoGame";
import { getT } from "../../i18n";

const t = getT("tour");

export const TOUR_SAMPLE_CHOICES: CommunityMetadataCandidate[] = [
  {
    igdbId: -1,
    name: TOUR_DEMO_GAME.name,
    coverUrl: TOUR_DEMO_GAME.coverUrl,
    releaseYear: 2023,
  },
  {
    igdbId: -2,
    name: TOUR_DEMO_EMULATOR.gameName,
    coverUrl: TOUR_DEMO_EMULATOR.coverUrl,
    releaseYear: 2002,
  },
];

/** The real search/review form, supplied only with bundled sample results. */
export function TourSampleSearch({
  exeName,
  share = false,
  onConfirm,
  onClose,
}: {
  exeName: string;
  /** The sample stands in for Add & Share: the form keeps that dialog's
   *  title and button, so a guide can name them. */
  share?: boolean;
  onConfirm: (choice: CommunityMetadataCandidate) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState(TOUR_SAMPLE_CHOICES);
  const [selection, setSelection] = useState<CommunityMetadataCandidate | null>(
    null,
  );
  return (
    <CommunitySuggestionForm
      practice={share ? "share" : true}
      title={share ? undefined : t("Choose the sample game")}
      exeName={exeName}
      candidates={choices}
      selection={selection}
      search={query}
      state="idle"
      message={
        choices.length
          ? t(
              "Review the title and cover, then confirm. Practice only; nothing is shared.",
            )
          : t("No sample result. Try Diablo or Zelda.")
      }
      onSearchChange={setQuery}
      onApplyCandidate={setSelection}
      onSearch={(options) => {
        setChoices(
          TOUR_SAMPLE_CHOICES.filter(
            (choice) =>
              choice.name.toLowerCase().includes(query.trim().toLowerCase()) &&
              (!options.releaseYear ||
                choice.releaseYear === options.releaseYear),
          ),
        );
        setSelection(null);
      }}
      onCancel={onClose}
      onSubmit={() => selection && onConfirm(selection)}
    />
  );
}
