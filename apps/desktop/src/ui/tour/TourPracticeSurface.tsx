import { StatsPractice } from "./TourStatsPractice";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { BuiltinImportProviderId } from "../../library/importProviders";
import type { GameMetadata } from "../../store";
import { Button, Pill, Select } from "../primitives";
import {
  TriageWizardCard,
  TOUR_DISCOVERED_EXECUTABLE,
} from "../views/DiscoveredView";
import { CandidateTile } from "../views/nowPlaying/AmbiguousMatchCard";
import { TourSampleSearch, TOUR_SAMPLE_CHOICES } from "./TourSampleSearch";
import type { TourDefinition } from "./tourDefinitions";
import { emitTourEvent } from "./TourUI";

const LibraryMatchControls = lazy(() =>
  import("../views/ImportLibraryView").then((module) => ({
    default: module.LibraryMatchControls,
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
          <h2 className="font-semibold text-text">Practice · {tour.title}</h2>
          <p className="text-xs text-text-muted">
            Sample data · changes disappear when you leave · nothing is
            submitted
          </p>
        </div>
        {tour.simulation === "detection" ? (
          <DetectionPractice stepId={stepId} />
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

function DetectionPractice({ stepId }: { stepId: string }) {
  const [custom, setCustom] = useState(false);
  const [name, setName] = useState("");
  const [search, setSearch] = useState(false);
  const [result, setResult] = useState("");
  useEffect(() => {
    setCustom(false);
    setSearch(false);
    setResult("");
  }, [stepId]);
  if (result)
    return (
      <div
        data-tour={stepId === "ambiguous" ? "demo-ambiguous" : "demo-discovery"}
        className="grid gap-3"
      >
        <Result>{result}</Result>
        <Button className="justify-self-start" onClick={() => setResult("")}>
          Try sample again
        </Button>
      </div>
    );
  return (
    <>
      {stepId === "ambiguous" ? (
        <div data-tour="demo-ambiguous" className="grid gap-3">
          <h3 className="text-lg font-semibold">Which game is Game.exe?</h3>
          <p className="text-sm text-text-muted">
            These sample games share a filename. Choose the one you started. In
            the app, this choice is remembered only on this PC.
          </p>
          <div className="grid max-w-lg grid-cols-2 gap-3">
            {TOUR_SAMPLE_CHOICES.map((choice) => (
              <CandidateTile
                key={choice.igdbId}
                exeName="Game.exe"
                ended={false}
                game={{
                  id: choice.igdbId,
                  name: choice.name,
                  source: "igdb",
                  coverUrl: choice.coverUrl,
                }}
                onSelect={(game) =>
                  setResult(
                    `Sample selected: ${game.name}. This exercise does not create a shared executable match.`,
                  )
                }
              />
            ))}
          </div>
        </div>
      ) : (
        <div data-tour="demo-discovery">
          <TriageWizardCard
            executable={TOUR_DISCOVERED_EXECUTABLE}
            reviewOptions={[TOUR_DISCOVERED_EXECUTABLE]}
            queueLength={1}
            currentIndex={1}
            customGameName={name}
            isCustomGameEntryOpen={custom}
            isOffline={false}
            isPending={false}
            isRetrying={false}
            onCancelCustomGame={() => setCustom(false)}
            onCustomGameNameChange={setName}
            onStartCustomGame={() => setCustom(true)}
            onSaveCustomGame={() => {
              if (name.trim()) {
                setResult(
                  `Sample added as ${name.trim()}. Custom games appear in My Games; no global filename match is created.`,
                );
                setCustom(false);
              }
            }}
            onSuggest={() => setSearch(true)}
            onIgnore={() =>
              setResult(
                "Sample ignored. In your library, this stops tracking that executable until you restore it in Discovered.",
              )
            }
            onSkip={() =>
              setResult(
                "Skipped for now. In Discovered, this app stays in Needs review.",
              )
            }
            onRecheck={() =>
              setResult(
                "Sample check complete. Use Add & Share to review a match.",
              )
            }
            onSelectReview={() => {}}
          />
        </div>
      )}
      {search ? (
        <TourSampleSearch
          exeName="Wow.exe"
          onClose={() => setSearch(false)}
          onConfirm={(choice) => {
            setSearch(false);
            setResult(
              `Sample matched to ${choice.name}. In the real flow, Add & Share sends a suggestion for review. Nothing was sent here.`,
            );
          }}
        />
      ) : null}
    </>
  );
}

function ImportPractice() {
  const [provider, setProvider] = useState<BuiltinImportProviderId>("xbox");
  const [executable, setExecutable] = useState("Diablo IV.exe");
  const [result, setResult] = useState("");
  const candidates: GameMetadata[] = [
    {
      id: -4,
      igdbId: -4,
      source: "igdb",
      name: "Diablo IV",
      coverUrl: "/tour/diablo-iv-cover.webp",
      releaseYear: 2023,
    },
  ];
  return (
    <div data-tour="demo-import" className="grid gap-4">
      <div data-tour="demo-import-providers" className="flex flex-wrap gap-2">
        {(["steam", "xbox", "battlenet"] as const).map((id) => (
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
                : "Steam"}
          </Pill>
        ))}
      </div>
      <p className="text-sm text-text-muted">
        Import is optional. Automatic detection works with games from any
        launcher. Review the game and its executable before importing.
      </p>
      <label data-tour="demo-import-executable" className="grid gap-2 text-sm">
        Game executable
        <Select
          aria-label="Game executable"
          value={executable}
          onChange={(event) => setExecutable(event.target.value)}
        >
          <option value="Diablo IV.exe">
            Diablo IV.exe · eligible game file
          </option>
          <option disabled>Uninstall.exe · installer excluded</option>
        </Select>
      </label>
      <p className="text-xs text-text-muted">
        One eligible file is selected for you. This selection does not import
        anything.
      </p>
      <div data-tour="demo-import-match">
        <Suspense
          fallback={
            <p className="text-sm text-text-muted">Loading sample review…</p>
          }
        >
          <LibraryMatchControls
            practice
            key={provider}
            provider={provider}
            apiEndpoint=""
            candidates={candidates}
            title="Diablo IV"
            importing={false}
            searchGames={async (query) =>
              candidates.filter((game) =>
                game.name.toLowerCase().includes(query.trim().toLowerCase()),
              )
            }
            onConfirm={async (game) =>
              setResult(
                `Sample imported: ${game.name} (${executable}). ${provider === "battlenet" ? "Battle.net does not supply past playtime here." : "Imported launcher time is a total, not a list of PlayCounter sessions."} Future tracked sessions build your History.`,
              )
            }
          />
        </Suspense>
      </div>
      {result ? <Result>{result}</Result> : null}
    </div>
  );
}
