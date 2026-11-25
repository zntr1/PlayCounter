import { Camera, Database, FolderOpen, Images } from "lucide-react";
import { useMemo } from "react";
import { formatHotkey } from "../../../hotkeyFormat";
import { appLocale, getT } from "../../../i18n";
import {
  openScreenshotViewer,
  revealScreenshot,
  useGameScreenshots,
  type GameScreenshot,
  type ViewerPicture,
} from "../../../screenshots";
import { useAppStore } from "../../../store";
import { ArtImage } from "../../ArtImage";
import { igdbScreenshotThumb } from "../../artSrcSet";
import { cn } from "../../cn";
import { formatDuration } from "../../components";
import { Button } from "../../primitives";
import { ScreenshotThumb } from "../../SessionScreenshots";
import { Panel } from "./detailsPanels";

const t = getT("games");

/* Screenshots in the game details (variant C of
   docs/game-details-screenshots-mockups.html, Phil 2026-11-23): the
   player's own pictures first, taken with PlayCounter's screenshot key, and
   IGDB's after them. A strip of both on General, all of them in the
   Screenshots tab, and one viewer that steps through both. */

export type DetailsScreenshots = {
  own: GameScreenshot[];
  igdb: string[];
  /** Own first, then IGDB's: the order of the strip, the tab and the viewer. */
  all: ViewerPicture[];
};

export function useDetailsScreenshots(
  gameKey: string | null,
  gameName: string,
  igdbUrls: string[] | undefined,
): DetailsScreenshots {
  const own = useGameScreenshots(gameKey, gameName);
  return useMemo(() => {
    const igdb = igdbUrls ?? [];
    return {
      own,
      igdb,
      all: [...own.map(({ shot }) => shot), ...igdb.map((url) => ({ url }))],
    };
  }, [own, igdbUrls]);
}

const TILE =
  "group relative block aspect-video w-full overflow-hidden rounded-lg border border-border bg-surface-hover transition hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

function IgdbThumb({ url }: { url: string }) {
  return (
    <ArtImage
      key={url}
      src={igdbScreenshotThumb(url)}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      className="h-full w-full object-cover"
    />
  );
}

function Caption({ text }: { text: string | null }) {
  return text ? (
    <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/85 to-black/0 px-2.5 pb-2 pt-5 text-left text-xs font-semibold text-white">
      {text}
    </span>
  ) : null;
}

/** General: one row of all pictures, own ones marked, "Show all" opens the
 *  tab. Nothing when the game has none. */
export function ScreenshotStrip({
  shots,
  gameName,
  onShowAll,
}: {
  shots: DetailsScreenshots;
  gameName: string;
  onShowAll: () => void;
}) {
  const { own, igdb, all } = shots;
  if (!all.length) return null;
  const open = (index: number) => openScreenshotViewer(all, index, gameName);
  const label = (index: number) =>
    t("Open screenshot {{index}} of {{total}}", {
      index: index + 1,
      total: all.length,
    });
  return (
    <Panel
      title={t("Screenshots")}
      icon={Images}
      action={
        <div className="flex items-center gap-3">
          <span className="flex gap-2 text-xs text-text-faint">
            {own.length ? (
              <span>{t("{{count}} yours", { count: own.length })}</span>
            ) : null}
            {igdb.length ? (
              <span>{t("{{count}} from IGDB", { count: igdb.length })}</span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={onShowAll}
            className="text-sm font-semibold text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            {t("Show all {{count}}", { count: all.length })}
          </button>
        </div>
      }
    >
      <ul
        data-screenshot-strip
        aria-label={t("Screenshots")}
        className="flex gap-2.5 overflow-x-auto pb-1.5"
      >
        {own.map(({ shot }, index) => (
          <li key={shot.path} className="w-[220px] shrink-0">
            <button
              type="button"
              data-controller-item="screenshot"
              aria-label={label(index)}
              title={shot.caption ?? undefined}
              onClick={() => open(index)}
              className={TILE}
            >
              <ScreenshotThumb shot={shot} />
              <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/75 py-0.5 pl-1.5 pr-2 text-[10.5px] font-bold text-accent">
                <Camera size={11} aria-hidden />
                {t("Yours")}
              </span>
              <Caption text={shot.caption} />
            </button>
          </li>
        ))}
        {igdb.map((url, index) => (
          <li
            key={url}
            className={cn(
              "w-[220px] shrink-0",
              // A line between the player's own and IGDB's.
              index === 0 && own.length > 0 && "ml-2 border-l border-border pl-4",
            )}
          >
            <button
              type="button"
              data-controller-item="screenshot"
              aria-label={label(own.length + index)}
              onClick={() => open(own.length + index)}
              className={TILE}
            >
              <IgdbThumb url={url} />
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** The Screenshots tab: the player's own, big, with when and in which
 *  session; then IGDB's. */
export function GameScreenshotsTab({
  shots,
  gameName,
}: {
  shots: DetailsScreenshots;
  gameName: string;
}) {
  const { own, igdb, all } = shots;
  const hotkey = useAppStore((state) => state.settings.screenshotHotkey);
  const showDurationDays = useAppStore(
    (state) => state.settings.showDurationDays,
  );
  const open = (index: number) => openScreenshotViewer(all, index, gameName);
  const label = (index: number) =>
    t("Open screenshot {{index}} of {{total}}", {
      index: index + 1,
      total: all.length,
    });
  const newest = own[0]?.shot;
  return (
    <div className="grid gap-4">
      <section aria-label={t("Your screenshots")}>
        <Panel
          title={t("Your screenshots")}
          icon={Camera}
          action={
            newest ? (
              <Button
                icon={FolderOpen}
                onClick={() =>
                  void revealScreenshot(newest.path).catch((error) =>
                    console.error("screenshot reveal failed", error),
                  )
                }
                className="h-8 px-3 text-xs"
              >
                {t("Show in folder")}
              </Button>
            ) : null
          }
        >
          {own.length ? (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {own.map(({ shot, session }, index) => {
                // A running session has no length yet.
                const seconds =
                  session && "durationSeconds" in session
                    ? session.durationSeconds
                    : null;
                const takenAt = new Date(shot.takenAtMs).toLocaleString(
                  appLocale(),
                  { dateStyle: "medium", timeStyle: "short" },
                );
                return (
                  <li key={shot.path}>
                    <button
                      type="button"
                      data-shot
                      data-controller-item="screenshot"
                      aria-label={label(index)}
                      onClick={() => open(index)}
                      className={TILE}
                    >
                      <ScreenshotThumb shot={shot} />
                      <Caption text={shot.caption} />
                    </button>
                    <p className="mt-1.5 text-xs text-text-muted">
                      {seconds
                        ? t("{{takenAt}} · session of {{duration}}", {
                            takenAt,
                            duration: formatDuration(
                              seconds,
                              showDurationDays,
                            ),
                          })
                        : takenAt}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-border p-3.5 text-sm text-text-muted">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-tint text-accent-ink">
                <Camera size={20} />
              </span>
              <p>
                <span className="font-semibold text-text">
                  {t("No screenshots of yours yet.")}
                </span>{" "}
                {hotkey
                  ? t(
                      "Press {{key}} while you play. Your pictures show up here, with the session they were taken in.",
                      { key: formatHotkey(hotkey) },
                    )
                  : t(
                      "Set a key for “Take a screenshot” in Settings and press it while you play. Your pictures show up here, with the session they were taken in.",
                    )}
              </p>
            </div>
          )}
        </Panel>
      </section>
      {igdb.length ? (
        <section aria-label={t("From IGDB")}>
          <Panel title={t("From IGDB")} icon={Database}>
            <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
              {igdb.map((url, index) => (
                <li key={url}>
                  <button
                    type="button"
                    data-controller-item="screenshot"
                    aria-label={label(own.length + index)}
                    onClick={() => open(own.length + index)}
                    className={TILE}
                  >
                    <IgdbThumb url={url} />
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        </section>
      ) : null}
    </div>
  );
}

