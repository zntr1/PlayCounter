import { useState } from "react";
import { useStore } from "zustand";
import { Trophy } from "lucide-react";
import { useAppStore } from "../../store";
import { milestoneMetrics, type AwardedMilestone } from "../../milestones";
import { buildAchievementCatalog } from "../views/achievements/achievementCatalog";
import { LadderRow } from "../views/achievements/LadderRow";
import { PersonalLibraryContext } from "../PersonalLibraryContext";
import { GameJournalHost } from "../GameJournalDialog";
import { HistoryView } from "../views/HistoryView";
import { createLibraryTourStore } from "./libraryTourStore";
import { tourSessionsForGame } from "./tourDemoGame";
import type { GameSummary } from "../views/MyGamesView";

export function StatsPractice({
  milestones = false,
  game,
}: { milestones?: boolean; game?: GameSummary } = {}) {
  const [store] = useState(() => {
    const store = createLibraryTourStore(useAppStore.getState().settings);
    if (game) {
      store.setState({ recentSessions: tourSessionsForGame(game) });
      return store;
    }
    const samples = store.getState().recentSessions;
    store.setState({
      recentSessions: [0, 2, 5, 10, 18, 40].map((days, index) => {
        const sample =
          index % 2 === 0
            ? samples[0]
            : {
                ...samples[1],
                gameId: -2,
                gameName: "Grand Theft Auto V",
                coverUrl: "/tour/gta-v-cover.webp",
                exeName: "GTA5.exe",
                source: "igdb" as const,
              };
        const end = new Date();
        end.setHours(12, 0, 0, 0);
        end.setDate(end.getDate() - days);
        const durationSeconds = (index + 1) * 1800;
        return {
          ...sample,
          id: -200 - index,
          durationSeconds,
          endedAt: end.toISOString(),
          startedAt: new Date(
            end.getTime() - durationSeconds * 1000,
          ).toISOString(),
        };
      }),
    });
    return store;
  });
  const sessions = useStore(store, (state) => state.recentSessions);
  const metrics = milestoneMetrics({
    sessions,
    archivedSeconds: 0,
    archivedGameSeconds: {},
    playtimeAdjustments: {},
    verifiedContributions: 0,
  });
  const awards: AwardedMilestone[] =
    metrics.totalHours >= 10
      ? [
          {
            id: "milestone:total:10",
            kind: "milestone-total",
            title: "You've played 10 hours in total",
            awardedAt: new Date().toISOString(),
          },
        ]
      : [];
  const catalog = buildAchievementCatalog(awards, metrics, new Map());
  return (
    <PersonalLibraryContext.Provider value={store}>
      <div data-tour="demo-stats">
        {milestones ? (
          <LadderRow
            leading={<Trophy className="text-accent-ink" />}
            title="Total playtime · sample milestone"
            subtitle={`${metrics.totalHours.toFixed(1)} hours in this practice history`}
            rungs={catalog.get("total") ?? []}
          />
        ) : (
          <HistoryView />
        )}
      </div>
      <GameJournalHost />
    </PersonalLibraryContext.Provider>
  );
}
