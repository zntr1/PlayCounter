import { describe, expect, it } from "vitest";
import { drawMarks, nextNumber, type Mark } from "./screenshotMarks";

/** A canvas that writes down what is drawn: every point and line width.
 *  Text is as wide as a real font of that size would make it, roughly. */
function recorder() {
  const calls: { name: string; values: number[] }[] = [];
  const state: Record<string, unknown> = { font: "10px sans-serif" };
  const context = new Proxy(state, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (key === "measureText")
        return (text: string) => ({
          width:
            text.length * parseFloat(String(target.font).split(" ")[1]) * 0.55,
        });
      return (...args: unknown[]) => {
        calls.push({
          name: key,
          values: args.filter((arg): arg is number => typeof arg === "number"),
        });
      };
    },
    set(target, key: string, value) {
      target[key] = value;
      if (key === "lineWidth") calls.push({ name: key, values: [value] });
      return true;
    },
  });
  return { context: context as unknown as CanvasRenderingContext2D, calls };
}

const PATH_CALLS = new Set(["moveTo", "lineTo", "quadraticCurveTo"]);

/** Points as parts of the picture's width and height, widths as parts of
 *  its width, so drawings at two sizes can be compared. */
function relative(
  calls: { name: string; values: number[] }[],
  width: number,
  height: number,
) {
  return calls
    .filter(({ name }) => PATH_CALLS.has(name) || name === "lineWidth")
    .map(({ name, values }) => ({
      name,
      values: values.map((value, index) =>
        Number(
          (name === "lineWidth"
            ? value / width
            : value / (index % 2 ? height : width)
          ).toFixed(6),
        ),
      ),
    }));
}

const label = () => "Check later";

describe("drawing marks", () => {
  it("draws a stroke on the screen where it goes into the full-size picture", () => {
    const stroke: Mark = {
      kind: "pen",
      color: "red",
      points: [
        [0.5, 0.9],
        [0.42, 0.72],
        [0.28, 0.63],
      ],
    };
    const screen = recorder();
    drawMarks(screen.context, 880, 495, [stroke], label);
    const file = recorder();
    drawMarks(file.context, 3840, 2160, [stroke], label);

    const onScreen = relative(screen.calls, 880, 495);
    expect(onScreen).toEqual(relative(file.calls, 3840, 2160));
    // It starts where the player put the pen down.
    expect(onScreen.find(({ name }) => name === "moveTo")!.values).toEqual([
      0.5, 0.9,
    ]);
  });

  it("draws arrows and circles the same way at any size", () => {
    const marks: Mark[] = [
      { kind: "arrow", color: "green", from: [0.56, 0.82], to: [0.72, 0.62] },
      { kind: "circle", color: "amber", from: [0.42, 0.12], to: [0.58, 0.55] },
    ];
    const screen = recorder();
    drawMarks(screen.context, 1280, 720, marks, label);
    const file = recorder();
    drawMarks(file.context, 2560, 1440, marks, label);
    expect(relative(screen.calls, 1280, 720)).toEqual(
      relative(file.calls, 2560, 1440),
    );
  });

  it("puts a sticker over the same part of the picture at any size", () => {
    const marks: Mark[] = [
      { kind: "sticker", sticker: "later", at: [0.82, 0.68] },
    ];
    const [onScreen] = drawMarks(recorder().context, 880, 495, marks, label);
    const [inFile] = drawMarks(recorder().context, 3840, 2160, marks, label);
    onScreen!.forEach((edge, index) =>
      expect(edge).toBeCloseTo(inFile![index], 6),
    );
    // Centred on the spot that was clicked.
    expect((onScreen![0] + onScreen![2]) / 2).toBeCloseTo(0.82, 6);
    expect((onScreen![1] + onScreen![3]) / 2).toBeCloseTo(0.68, 6);
  });

  it("says where numbers and stickers are, so they can be dragged, but not lines", () => {
    const boxes = drawMarks(
      recorder().context,
      880,
      495,
      [
        { kind: "pen", color: "white", points: [[0.1, 0.1]] },
        { kind: "number", color: "white", value: 1, at: [0.3, 0.58] },
      ],
      label,
    );
    expect(boxes[0]).toBeNull();
    const [left, top, right, bottom] = boxes[1]!;
    expect(left < 0.3 && 0.3 < right && top < 0.58 && 0.58 < bottom).toBe(true);
  });

  it("numbers go on from the highest one on the picture", () => {
    expect(nextNumber([])).toBe(1);
    expect(
      nextNumber([
        { kind: "number", color: "red", value: 1, at: [0, 0] },
        { kind: "pen", color: "red", points: [[0, 0]] },
        { kind: "number", color: "red", value: 3, at: [0, 0] },
      ]),
    ).toBe(4);
  });
});
