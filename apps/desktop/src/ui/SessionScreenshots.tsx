import clsx from "clsx";
import { Camera, MessageSquare } from "lucide-react";
import { useEffect, useState } from "react";
import {
  makeScreenshotPreview,
  openScreenshotViewer,
  screenshotSource,
  useSessionScreenshots,
  type Screenshot,
} from "../screenshots";
import { getT } from "../i18n";

const t = getT("history");

/** How many small pictures a session shows before "+N". */
const SHOWN = 4;

/** A session's screenshots as small pictures; nothing when it has none. */
export function SessionScreenshots({
  sessionId,
  gameName,
  className,
}: {
  sessionId: number;
  gameName?: string;
  className?: string;
}) {
  const shots = useSessionScreenshots(sessionId);
  if (!shots.length) return null;
  return (
    <ScreenshotStrip shots={shots} gameName={gameName} className={className} />
  );
}

/** The same strip on a table row of its own, for the journal's session list. */
export function SessionScreenshotsTableRow({
  sessionId,
  gameName,
  colSpan,
}: {
  sessionId: number;
  gameName?: string;
  colSpan: number;
}) {
  const shots = useSessionScreenshots(sessionId);
  if (!shots.length) return null;
  return (
    <tr className="!border-t-0">
      <td colSpan={colSpan} className="px-3 pb-2.5">
        <ScreenshotStrip shots={shots} gameName={gameName} />
      </td>
    </tr>
  );
}

function ScreenshotStrip({
  shots,
  gameName,
  className,
}: {
  shots: Screenshot[];
  gameName?: string;
  className?: string;
}) {
  const shown = shots.slice(0, SHOWN);
  const more = shots.length - shown.length;
  const tile =
    "relative block h-12 w-[86px] shrink-0 overflow-hidden rounded-md border border-border bg-surface-hover transition hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";
  return (
    <ul
      aria-label={t("Screenshots")}
      className={clsx("flex flex-wrap items-center gap-1.5", className)}
    >
      {shown.map((shot, index) => (
        <li key={shot.path}>
          <button
            type="button"
            className={tile}
            aria-label={t("Open screenshot {{index}} of {{total}}", {
              index: index + 1,
              total: shots.length,
            })}
            title={shot.caption ?? undefined}
            onClick={() => openScreenshotViewer(shots, index, gameName)}
          >
            <ScreenshotThumb shot={shot} />
            {shot.caption ? (
              <span
                data-caption-mark
                className="absolute bottom-1 left-1 grid h-[18px] w-[18px] place-items-center rounded-[5px] bg-black/70 text-accent"
              >
                <MessageSquare size={11} aria-hidden />
              </span>
            ) : null}
          </button>
        </li>
      ))}
      {more > 0 ? (
        <li>
          <button
            type="button"
            className={clsx(
              tile,
              "grid place-items-center text-sm font-semibold text-text-muted",
            )}
            aria-label={t("Show all screenshots")}
            onClick={() => openScreenshotViewer(shots, SHOWN, gameName)}
          >
            +{more}
          </button>
        </li>
      ) : null}
    </ul>
  );
}

/** The picture's preview, made on the spot when it has none yet. */
function ScreenshotThumb({ shot }: { shot: Screenshot }) {
  const [preview, setPreview] = useState(shot.previewPath);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (preview) return;
    let current = true;
    void makeScreenshotPreview(shot.path).then((made) => {
      if (!current) return;
      if (made) setPreview(made);
      else setFailed(true);
    });
    return () => {
      current = false;
    };
  }, [preview, shot.path]);
  if (!preview || failed)
    return (
      <span className="grid h-full w-full place-items-center text-text-muted">
        <Camera size={15} />
      </span>
    );
  return (
    <img
      src={screenshotSource(preview)}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  );
}
