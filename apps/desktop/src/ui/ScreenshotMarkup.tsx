import {
  ArrowUpRight,
  Check,
  Circle,
  CircleHelp,
  Eraser,
  Gem,
  Hash,
  KeyRound,
  Lock,
  Pencil,
  Skull,
  Sticker,
  TriangleAlert,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react";
import { markUpScreenshot, type Screenshot } from "../screenshots";
import {
  drawMarks,
  marksPng,
  MARK_COLORS,
  nextNumber,
  STICKER_COLORS,
  type Box,
  type Mark,
  type MarkColor,
  type Point,
  type StickerId,
} from "../screenshotMarks";
import { useAppStore } from "../store";
import { cn } from "./cn";
import { Button } from "./primitives";
import { getT } from "../i18n";

const t = getT("history");

/* Mark up in the screenshot viewer (docs/screenshot-markup-plan.md): a canvas
   over the picture and the tools under it. Saving draws the marks into the
   picture for good; the picture without them goes to the Recycle Bin. */

type Tool = "pen" | "arrow" | "circle" | "number" | "sticker";

const TOOLS: Tool[] = ["pen", "arrow", "circle", "number", "sticker"];
const TOOL_ICONS: Record<Tool, LucideIcon> = {
  pen: Pencil,
  arrow: ArrowUpRight,
  circle: Circle,
  number: Hash,
  sticker: Sticker,
};
const COLORS: MarkColor[] = ["red", "amber", "green", "white"];
const STICKERS: StickerId[] = [
  "way",
  "later",
  "danger",
  "loot",
  "boss",
  "locked",
  "key",
];
const STICKER_ICONS: Record<StickerId, LucideIcon> = {
  way: Check,
  later: CircleHelp,
  danger: TriangleAlert,
  loot: Gem,
  boss: Skull,
  locked: Lock,
  key: KeyRound,
};

function toolName(tool: Tool) {
  switch (tool) {
    case "pen":
      return t("Pen");
    case "arrow":
      return t("Arrow");
    case "circle":
      return t("Circle");
    case "number":
      return t("Number");
    case "sticker":
      return t("Stickers");
  }
}

function colorName(color: MarkColor) {
  switch (color) {
    case "red":
      return t("Red");
    case "amber":
      return t("Amber");
    case "green":
      return t("Green");
    case "white":
      return t("White");
  }
}

/** A sticker's word. It goes into the picture in the app's language at the
 *  moment it's saved. */
export function stickerText(sticker: StickerId) {
  switch (sticker) {
    case "way":
      return t("This way");
    case "later":
      return t("Check later");
    case "danger":
      return t("Danger");
    case "loot":
      return t("Loot");
    case "boss":
      return t("Boss");
    case "locked":
      return t("Locked");
    case "key":
      return t("Key");
  }
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

type Place = { left: number; top: number; width: number; height: number };

const toolButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-white/75 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-white/75";
const pressed =
  "bg-accent-tint text-accent ring-1 ring-inset ring-accent/45 hover:bg-accent-tint hover:text-accent";

export function ScreenshotMarkup({
  shot,
  image,
  width,
  onDone,
}: {
  shot: Screenshot;
  /** The picture as the viewer shows it; the canvas lies over it. */
  image: RefObject<HTMLImageElement | null>;
  /** The picture's width as shown, so the tools line up with it. */
  width: number | null;
  onDone: () => void;
}) {
  const [marks, setMarks] = useState<Mark[]>([]);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState<MarkColor>("red");
  const [sticker, setSticker] = useState<StickerId>("way");
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Saving went wrong. Toasts sit behind the viewer, so it says so here. */
  const [failed, setFailed] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  /** The line being drawn right now, before it joins the marks. */
  const draft = useRef<Mark | null>(null);
  /** The sticker or number being dragged, and where it was grabbed. */
  const drag = useRef<{ index: number; offset: Point } | null>(null);
  const boxes = useRef<(Box | null)[]>([]);
  const latest = useRef({ marks, asking, saving });

  // Over the picture, wherever the viewer shows it.
  useLayoutEffect(() => {
    const picture = image.current;
    if (!picture) return;
    const measure = () =>
      setPlace((current) => {
        const next = {
          left: picture.offsetLeft,
          top: picture.offsetTop,
          width: picture.offsetWidth,
          height: picture.offsetHeight,
        };
        return current &&
          current.left === next.left &&
          current.top === next.top &&
          current.width === next.width &&
          current.height === next.height
          ? current
          : next;
      });
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    for (const element of [picture, picture.parentElement, toolsRef.current])
      if (element) observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [image]);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const shown = draft.current
      ? [...latest.current.marks, draft.current]
      : latest.current.marks;
    boxes.current = drawMarks(
      context,
      canvas.width,
      canvas.height,
      shown,
      stickerText,
    );
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !place) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(place.width * ratio));
    canvas.height = Math.max(1, Math.round(place.height * ratio));
    paint();
  }, [place, paint]);

  useLayoutEffect(() => {
    latest.current = { marks, asking, saving };
    paint();
  }, [marks, asking, saving, paint]);

  const cancel = useCallback(() => {
    if (latest.current.marks.length) setAsking(true);
    else onDone();
  }, [onDone]);

  // Esc and Ctrl+Z, before the viewer's own Esc, which would close it.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (latest.current.saving) return;
        if (latest.current.asking) setAsking(false);
        else cancel();
      } else if (
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        event.key.toLowerCase() === "z"
      ) {
        event.preventDefault();
        if (!latest.current.saving) setMarks((list) => list.slice(0, -1));
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [cancel]);

  function pointAt(event: PointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return [
      clamp((event.clientX - rect.left) / (rect.width || 1)),
      clamp((event.clientY - rect.top) / (rect.height || 1)),
    ];
  }

  /** The sticker or number under the point, the one on top first. */
  function grabbed(point: Point) {
    for (let index = marks.length - 1; index >= 0; index--) {
      const box = boxes.current[index];
      if (
        box &&
        point[0] >= box[0] &&
        point[0] <= box[2] &&
        point[1] >= box[1] &&
        point[1] <= box[3]
      )
        return index;
    }
    return null;
  }

  function pointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 || asking || saving) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // No pointer to hold on to; the drawing still works inside the canvas.
    }
    const point = pointAt(event);
    const index = grabbed(point);
    const held = index === null ? null : marks[index];
    if (index !== null && held && "at" in held) {
      drag.current = {
        index,
        offset: [point[0] - held.at[0], point[1] - held.at[1]],
      };
      return;
    }
    switch (tool) {
      case "pen":
        draft.current = { kind: "pen", color, points: [point] };
        paint();
        return;
      case "arrow":
      case "circle":
        draft.current = { kind: tool, color, from: point, to: point };
        paint();
        return;
      case "number":
        setMarks((list) => [
          ...list,
          { kind: "number", color, value: nextNumber(list), at: point },
        ]);
        return;
      case "sticker":
        setMarks((list) => [...list, { kind: "sticker", sticker, at: point }]);
        return;
    }
  }

  function pointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const point = pointAt(event);
    const held = drag.current;
    if (held) {
      setMarks((list) =>
        list.map((mark, index) =>
          index === held.index && "at" in mark
            ? {
                ...mark,
                at: [
                  clamp(point[0] - held.offset[0]),
                  clamp(point[1] - held.offset[1]),
                ],
              }
            : mark,
        ),
      );
      return;
    }
    const line = draft.current;
    if (line?.kind === "pen") {
      const last = line.points[line.points.length - 1];
      if (Math.hypot(point[0] - last[0], point[1] - last[1]) > 0.0015)
        line.points.push(point);
      paint();
    } else if (line?.kind === "arrow" || line?.kind === "circle") {
      line.to = point;
      paint();
    } else if (!asking && !saving) {
      event.currentTarget.style.cursor =
        grabbed(point) === null ? "crosshair" : "grab";
    }
  }

  function pointerUp() {
    drag.current = null;
    const line = draft.current;
    draft.current = null;
    if (!line) return;
    // An arrow or circle needs some length; a click alone is a slip.
    const kept =
      line.kind !== "arrow" && line.kind !== "circle"
        ? true
        : Math.hypot(line.to[0] - line.from[0], line.to[1] - line.from[1]) >
          0.012;
    if (kept) setMarks((list) => [...list, line]);
    else paint();
  }

  async function save() {
    const picture = image.current;
    if (!marks.length || saving || !picture) return;
    setSaving(true);
    setFailed(false);
    try {
      const png = await marksPng(
        marks,
        picture.naturalWidth,
        picture.naturalHeight,
        stickerText,
      );
      await markUpScreenshot(shot.path, png);
      useAppStore.getState().addToast({
        tone: "success",
        title: t("Saved into the picture"),
        detail: t("The picture without your marks is in the Recycle Bin."),
      });
      onDone();
    } catch (error) {
      console.error("screenshot markup failed", error);
      setFailed(true);
      setSaving(false);
    }
  }

  const empty = marks.length === 0;
  return (
    <>
      <canvas
        ref={canvasRef}
        aria-label={t("Picture to draw on")}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        style={place ?? { display: "none" }}
        className={cn(
          "absolute z-10 touch-none rounded-lg",
          asking || saving ? "cursor-default" : "cursor-crosshair",
        )}
      />
      <div
        ref={toolsRef}
        style={width ? { width: Math.max(width, 760) } : undefined}
        className={cn(
          "mt-3 flex max-w-full shrink-0 flex-col items-center gap-1.5",
          !width && "w-full max-w-4xl",
        )}
      >
        <div
          role="toolbar"
          aria-label={t("Mark up tools")}
          className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-1.5"
        >
          <div className="flex gap-0.5">
            {TOOLS.map((each) => {
              const Icon = TOOL_ICONS[each];
              return (
                <button
                  key={each}
                  type="button"
                  aria-pressed={tool === each}
                  disabled={saving}
                  onClick={() => setTool(each)}
                  className={cn(toolButton, tool === each && pressed)}
                >
                  <Icon size={16} aria-hidden />
                  {toolName(each)}
                </button>
              );
            })}
          </div>
          <span aria-hidden className="h-5 w-px bg-white/15" />
          <div
            className={cn(
              "flex gap-2 px-1 transition-opacity",
              tool === "sticker" && "opacity-25",
            )}
          >
            {COLORS.map((each) => (
              <button
                key={each}
                type="button"
                aria-label={colorName(each)}
                title={colorName(each)}
                aria-pressed={color === each}
                disabled={tool === "sticker" || saving}
                onClick={() => setColor(each)}
                style={{
                  backgroundColor: MARK_COLORS[each],
                  boxShadow:
                    color === each
                      ? `0 0 0 2px #0b0b0c, 0 0 0 4px ${MARK_COLORS[each]}`
                      : "inset 0 0 0 1.5px rgba(0, 0, 0, 0.35)",
                }}
                className="h-[22px] w-[22px] rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              />
            ))}
          </div>
          <span aria-hidden className="h-5 w-px bg-white/15" />
          <button
            type="button"
            aria-label={t("Undo")}
            title={t("Undo")}
            aria-keyshortcuts="Control+Z"
            disabled={empty || saving}
            onClick={() => setMarks((list) => list.slice(0, -1))}
            className={cn(toolButton, "w-9 justify-center px-0")}
          >
            <Undo2 size={16} aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t("Clear all")}
            title={t("Clear all")}
            disabled={empty || saving}
            onClick={() => setMarks([])}
            className={cn(toolButton, "w-9 justify-center px-0")}
          >
            <Eraser size={16} aria-hidden />
          </button>
          <span className="flex-1" />
          <Button variant="ghost" disabled={saving} onClick={cancel}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={empty}
            loading={saving}
            onClick={() => void save()}
          >
            {t("Save into picture")}
          </Button>
        </div>
        <div className="flex h-8 flex-wrap items-center justify-center gap-2">
          {tool === "sticker"
            ? STICKERS.map((each) => {
                const Icon = STICKER_ICONS[each];
                return (
                  <button
                    key={each}
                    type="button"
                    aria-pressed={sticker === each}
                    disabled={saving}
                    onClick={() => setSticker(each)}
                    style={{
                      backgroundColor: STICKER_COLORS[each],
                      boxShadow:
                        sticker === each
                          ? `0 0 0 2px #0b0b0c, 0 0 0 4px ${STICKER_COLORS[each]}`
                          : "0 2px 8px rgba(0, 0, 0, 0.35)",
                    }}
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded-full pl-2 pr-3 text-[12.5px] font-bold text-[#141414] transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                      sticker === each
                        ? "opacity-100"
                        : "opacity-55 hover:opacity-90",
                    )}
                  >
                    <Icon size={14} strokeWidth={2.4} aria-hidden />
                    {stickerText(each)}
                  </button>
                );
              })
            : null}
        </div>
        <div className="flex h-8 items-center justify-center gap-2 text-center">
          {asking ? (
            <>
              <span className="text-sm text-white">
                {t("Discard your marks?")}
              </span>
              <Button
                variant="ghost"
                className="py-1"
                onClick={() => setAsking(false)}
              >
                {t("Keep drawing")}
              </Button>
              <Button variant="danger" className="py-1" onClick={onDone}>
                {t("Discard")}
              </Button>
            </>
          ) : failed ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {t("The marks couldn't be saved.")}
            </p>
          ) : (
            <p className="text-xs text-white/50">
              {t(
                "Saving draws the marks into the picture for good. The picture without them goes to the Recycle Bin.",
              )}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
