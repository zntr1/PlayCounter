import type { CommunityMetadataCandidate } from "@playcounter/shared";
import { useState } from "react";
import { CommunitySuggestionForm } from "../views/DiscoveredView";
import { TOUR_DEMO_GAME, TOUR_DEMO_EMULATOR } from "./tourDemoGame";

export const TOUR_SAMPLE_CHOICES: CommunityMetadataCandidate[] = [
  {
    igdbId: -1,
    name: TOUR_DEMO_GAME.name,
    coverUrl: TOUR_DEMO_GAME.coverUrl,
    releaseYear: 2004,
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
  onConfirm,
  onClose,
}: {
  exeName: string;
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
      practice
      title="Choose the sample game"
      exeName={exeName}
      candidates={choices}
      selection={selection}
      search={query}
      state="idle"
      message={
        choices.length
          ? "Review the title and cover, then confirm. Practice only; nothing is shared."
          : "No sample result. Try World of Warcraft or Zelda."
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
