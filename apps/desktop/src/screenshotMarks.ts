/* Marks drawn on a screenshot (docs/screenshot-markup-plan.md). They live in
   picture coordinates, 0 to 1, and every size goes with the picture's width,
   so one drawing function paints the screen and the file that gets saved:
   what you see is what goes into the picture. */

export type Point = [number, number];
export type MarkColor = "red" | "amber" | "green" | "white";
export type StickerId =
  | "way"
  | "later"
  | "danger"
  | "loot"
  | "boss"
  | "locked"
  | "key";

export type Mark =
  | { kind: "pen"; color: MarkColor; points: Point[] }
  | { kind: "arrow" | "circle"; color: MarkColor; from: Point; to: Point }
  | { kind: "number"; color: MarkColor; value: number; at: Point }
  | { kind: "sticker"; sticker: StickerId; at: Point };

/** Where a sticker or number sits, to grab it: left, top, right, bottom. */
export type Box = [number, number, number, number];

export const MARK_COLORS: Record<MarkColor, string> = {
  red: "#f87171",
  amber: "#efc160",
  green: "#4ade80",
  white: "#f4f4f5",
};

export const STICKER_COLORS: Record<StickerId, string> = {
  way: "#4ade80",
  later: "#efc160",
  danger: "#f87171",
  loot: "#60a5fa",
  boss: "#c084fc",
  locked: "#d4d4d8",
  key: "#2dd4bf",
};

/* The stickers' icons as path data on a 24 × 24 grid: Lucide's check,
   circle-help, triangle-alert, gem, skull, lock and key-round (ISC), the
   same ones the sticker buttons show. */
const STICKER_ICONS: Record<StickerId, string[]> = {
  way: ["M20 6 9 17l-5-5"],
  later: [
    "M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0",
    "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3",
    "M12 17h.01",
  ],
  danger: [
    "M21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
    "M12 9v4",
    "M12 17h.01",
  ],
  loot: ["M6 3h12l4 6-10 13L2 9Z", "M11 3 8 9l4 13 4-13-3-6", "M2 9h20"],
  boss: [
    "M12.5 17l-.5-1-.5 1h1z",
    "M15 22a1 1 0 0 0 1-1v-1a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20v1a1 1 0 0 0 1 1z",
    "M14 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0",
    "M8 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0",
  ],
  locked: [
    "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z",
    "M7 11V7a5 5 0 0 1 10 0v4",
  ],
  key: [
    "M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z",
    "M16 7.5a.5.5 0 1 0 1 0a.5.5 0 1 0-1 0",
  ],
};

const FONT = 'Inter, "Segoe UI", system-ui, sans-serif';
/** The thin dark edge around every mark, so it shows on any picture. */
const EDGE = "rgba(0, 0, 0, 0.55)";
const INK = "#141414";

/** The next number to put down: one more than the highest so far. */
export function nextNumber(marks: Mark[]) {
  return (
    marks.reduce(
      (highest, mark) =>
        mark.kind === "number" ? Math.max(highest, mark.value) : highest,
      0,
    ) + 1
  );
}

/** Draws the marks on a canvas `width` × `height` big. Answers where each
 *  sticker and number ended up (null for lines), in picture coordinates. */
export function drawMarks(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  marks: Mark[],
  label: (sticker: StickerId) => string,
): (Box | null)[] {
  return marks.map((mark) =>
    drawMark(context, width, height, mark, label, width / 1000),
  );
}

function edged(
  context: CanvasRenderingContext2D,
  unit: number,
  color: string,
  build: () => void,
) {
  const line = 4.6 * unit;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = EDGE;
  context.lineWidth = line + 3.2 * unit;
  build();
  context.stroke();
  context.strokeStyle = color;
  context.lineWidth = line;
  build();
  context.stroke();
}

function drawMark(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  mark: Mark,
  label: (sticker: StickerId) => string,
  unit: number,
): Box | null {
  const x = (point: Point) => point[0] * width;
  const y = (point: Point) => point[1] * height;
  context.save();
  try {
    switch (mark.kind) {
      case "pen": {
        const points = mark.points;
        edged(context, unit, MARK_COLORS[mark.color], () => {
          context.beginPath();
          context.moveTo(x(points[0]), y(points[0]));
          // A click alone leaves a dot.
          if (points.length === 1)
            context.lineTo(x(points[0]) + 0.01, y(points[0]));
          // Through the middle of each step, so the line comes out smooth.
          for (let index = 1; index < points.length - 1; index++) {
            const [here, next] = [points[index], points[index + 1]];
            context.quadraticCurveTo(
              x(here),
              y(here),
              (x(here) + x(next)) / 2,
              (y(here) + y(next)) / 2,
            );
          }
          if (points.length > 1) {
            const last = points[points.length - 1];
            context.lineTo(x(last), y(last));
          }
        });
        return null;
      }
      case "arrow": {
        const [fromX, fromY, toX, toY] = [
          x(mark.from),
          y(mark.from),
          x(mark.to),
          y(mark.to),
        ];
        const angle = Math.atan2(toY - fromY, toX - fromX);
        const head = Math.min(
          22 * unit,
          Math.hypot(toX - fromX, toY - fromY) * 0.6,
        );
        edged(context, unit, MARK_COLORS[mark.color], () => {
          context.beginPath();
          context.moveTo(fromX, fromY);
          context.lineTo(toX, toY);
          context.moveTo(
            toX - head * Math.cos(angle - 0.5),
            toY - head * Math.sin(angle - 0.5),
          );
          context.lineTo(toX, toY);
          context.lineTo(
            toX - head * Math.cos(angle + 0.5),
            toY - head * Math.sin(angle + 0.5),
          );
        });
        return null;
      }
      case "circle": {
        const [fromX, fromY, toX, toY] = [
          x(mark.from),
          y(mark.from),
          x(mark.to),
          y(mark.to),
        ];
        edged(context, unit, MARK_COLORS[mark.color], () => {
          context.beginPath();
          context.ellipse(
            (fromX + toX) / 2,
            (fromY + toY) / 2,
            Math.max(Math.abs(toX - fromX) / 2, 1),
            Math.max(Math.abs(toY - fromY) / 2, 1),
            0,
            0,
            Math.PI * 2,
          );
        });
        return null;
      }
      case "number": {
        const [centerX, centerY, radius] = [x(mark.at), y(mark.at), 14 * unit];
        context.shadowColor = "rgba(0, 0, 0, 0.45)";
        context.shadowBlur = 8 * unit;
        context.shadowOffsetY = 2 * unit;
        context.beginPath();
        context.arc(centerX, centerY, radius, 0, Math.PI * 2);
        context.fillStyle = MARK_COLORS[mark.color];
        context.fill();
        context.shadowColor = "transparent";
        context.lineWidth = 2.2 * unit;
        context.strokeStyle = EDGE;
        context.stroke();
        context.fillStyle = INK;
        context.font = `800 ${16 * unit}px ${FONT}`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(String(mark.value), centerX, centerY + 0.8 * unit);
        return [
          (centerX - radius) / width,
          (centerY - radius) / height,
          (centerX + radius) / width,
          (centerY + radius) / height,
        ];
      }
      case "sticker": {
        const text = label(mark.sticker);
        context.font = `700 ${14 * unit}px ${FONT}`;
        const [tall, start, icon, gap, end] = [
          30 * unit,
          9.5 * unit,
          16 * unit,
          6 * unit,
          11 * unit,
        ];
        const wide = start + icon + gap + context.measureText(text).width + end;
        const [left, top] = [x(mark.at) - wide / 2, y(mark.at) - tall / 2];
        context.shadowColor = "rgba(0, 0, 0, 0.5)";
        context.shadowBlur = 10 * unit;
        context.shadowOffsetY = 3 * unit;
        context.beginPath();
        context.roundRect(left, top, wide, tall, tall / 2);
        context.fillStyle = STICKER_COLORS[mark.sticker];
        context.fill();
        context.shadowColor = "transparent";
        context.lineWidth = 1.2 * unit;
        context.strokeStyle = "rgba(0, 0, 0, 0.35)";
        context.stroke();
        if (typeof Path2D === "function") {
          context.save();
          context.translate(left + start, top + (tall - icon) / 2);
          context.scale(icon / 24, icon / 24);
          context.strokeStyle = INK;
          context.lineWidth = 2.5;
          context.lineCap = "round";
          context.lineJoin = "round";
          for (const path of STICKER_ICONS[mark.sticker])
            context.stroke(new Path2D(path));
          context.restore();
        }
        context.fillStyle = INK;
        context.textAlign = "left";
        context.textBaseline = "middle";
        context.fillText(
          text,
          left + start + icon + gap,
          top + tall / 2 + 0.6 * unit,
        );
        return [
          left / width,
          top / height,
          (left + wide) / width,
          (top + tall) / height,
        ];
      }
    }
  } finally {
    context.restore();
  }
}

/** The marks alone, see-through around them, as a PNG as big as the picture.
 *  Rust lays it over the picture (screenshot_markup). */
export async function marksPng(
  marks: Mark[],
  width: number,
  height: number,
  label: (sticker: StickerId) => string,
): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  // i18n-exempt: logged only; the viewer shows its own message.
  if (!context || !width || !height) throw new Error("No canvas to draw on.");
  drawMarks(context, width, height, marks, label);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  // i18n-exempt: logged only; the viewer shows its own message.
  if (!blob) throw new Error("The canvas made no PNG.");
  return new Uint8Array(await blob.arrayBuffer());
}
