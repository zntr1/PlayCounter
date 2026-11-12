import { StatsPractice } from "./TourStatsPractice";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { BuiltinImportProviderId } from "../../library/importProviders";
import type { GameMetadata } from "../../store";
import { Button, Pill, Select } from "../primitives";
import { DetectionPractice } from "./DetectionPractice";
import type { TourDefinition } from "./tourDefinitions";
import { emitTourEvent } from "./TourUI";
import { getT } from "../../i18n";

const t = getT("tour");

const importT = getT("import");

const GameMatchPicker = lazy(() =>
  import("../import/GameMatchPicker").then((module) => ({
    default: module.GameMatchPicker,
  })),
);

export function TourPracticeSurface({
  tour,
  stepId,
}: {
  tour: TourDefinition;
  stepId: string;
}) {
  return createPortal(
    <div className="tour-practice-space">
      <div
        data-tour="demo-library-stage"
        className="grid gap-4 rounded-xl border border-border bg-bg p-4"
      >
        <div>
          <h2 className="font-semibold text-text">
            {t("Practice · {{title}}", { title: tour.title })}
          </h2>
          <p className="text-xs text-text-muted">
            {t(
              "Sample data · changes disappear when you leave · nothing is submitted",
            )}
          </p>
        </div>
        {tour.simulation === "detection" ? (
          <DetectionPractice />
        ) : tour.simulation === "stats" ? (
          <StatsPractice milestones={stepId === "milestones"} />
        ) : (
          <ImportPractice />
        )}
      </div>
    </div>,
    document.body,
  );
}

function Result({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (typeof children === "string")
      emitTourEvent("demo.action-completed", children);
  }, [children]);
  return (
    <p
      role="status"
      data-tour="demo-library-result"
      className="rounded-lg border border-accent/30 bg-accent-tint p-3 text-sm text-text"
    >
      {children}
    </p>
  );
}

const IMPORT_SAMPLES: GameMetadata[] = [
  {
    id: -4,
    igdbId: -4,
    source: "igdb",
    // i18n-exempt: sample game name.
    name: "Diablo IV",
    coverUrl: "/tour/diablo-iv-cover.webp",
    releaseYear: 2023,
  },
];

function ImportPractice() {
  const [provider, setProvider] = useState<BuiltinImportProviderId>("xbox");
  const [executable, setExecutable] = useState("Diablo IV.exe");
  const [result, setResult] = useState("");
  const [choices, setChoices] = useState<GameMetadata[]>(IMPORT_SAMPLES);
  const [picked, setPicked] = useState<GameMetadata | null>(IMPORT_SAMPLES[0]);
  return (
    <div data-tour="demo-import" className="grid gap-4">
      <div data-tour="demo-import-providers" className="flex flex-wrap gap-2">
        {(
          ["steam", "xbox", "battlenet", "epic", "gog", "playstation"] as const
        ).map((id) => (
          <Pill
            key={id}
            selected={provider === id}
            onClick={() => {
              setProvider(id);
              setResult("");
            }}
          >
            {id === "battlenet"
              ? "Battle.net"
              : id === "xbox"
                ? "Xbox"
                : id === "epic"
                  ? "Epic Games"
                  : id === "gog"
                    ? "GOG"
                    : id === "playstation"
                      ? "PlayStation"
                      : "Steam"}
          </Pill>
        ))}
      </div>
      <p className="text-sm text-text-muted">
        {t(
          "Import is optional. Automatic detection works with games from any launcher. Review the game and its executable before importing.",
        )}
      </p>
      <label data-tour="demo-import-executable" className="grid gap-2 text-sm">
        {t("Game executable")}
        <Select
          aria-label={t("Game executable")}
          value={executable}
          onChange={(event) => setExecutable(event.target.value)}
        >
          <option value="Diablo IV.exe">
            {t("{{file}} · eligible game file", { file: "Diablo IV.exe" })}
          </option>
          <option disabled>{t("Uninstall.exe · installer excluded")}</option>
        </Select>
      </label>
      <p className="text-xs text-text-muted">
        {t(
          "One eligible file is selected for you. This selection does not import anything.",
        )}
      </p>
      <div data-tour="demo-import-match" className="grid gap-3">
        <Suspense
          fallback={
            <p className="text-sm text-text-muted">
              {t("Loading sample review…")}
            </p>
          }
        >
          <GameMatchPicker
            practice
            key={provider}
            // i18n-exempt: sample game name.
            title="Diablo IV"
            candidates={choices}
            selectedId={picked?.igdbId ?? null}
            onSelect={setPicked}
            onResults={(games) => {
              setChoices(games);
              setPicked(games[0] ?? null);
            }}
            search={async (query) =>
              IMPORT_SAMPLES.filter((game) =>
                game.name.toLowerCase().includes(query.trim().toLowerCase()),
              )
            }
          />
        </Suspense>
        <Button
          variant="primary"
          className="justify-self-start"
          disabled={!picked}
          onClick={() => {
            if (!picked) return;
            setResult(
              [
                t("Sample imported: {{game}} ({{file}}).", {
                  game: picked.name,
                  file: executable,
                }),
                provider === "battlenet"
                  ? t("Battle.net does not supply past playtime here.")
                  : provider === "epic"
                    ? t(
                        "Epic Games supplies a playtime total when you sign in; it is not a list of PlayCounter sessions.",
                      )
                    : t(
                        "Imported launcher time is a total, not a list of PlayCounter sessions.",
                      ),
                t("Future tracked sessions build your History."),
              ].join(" "),
            );
          }}
        >
          {importT("Import")}
        </Button>
      </div>
      {result ? <Result>{result}</Result> : null}
    </div>
  );
}
