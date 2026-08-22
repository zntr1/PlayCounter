import clsx from "clsx";

export type XboxControl = "A" | "B" | "DPAD" | "RIGHT_STICK" | "VIEW" | "RB";

type XboxFaceButton = Extract<XboxControl, "A" | "B">;

const faceButtonStyles: Record<XboxFaceButton, string> = {
  A: "border-[#58bf55] bg-[#107c10] text-white shadow-[0_0_10px_rgb(16_124_16/0.45)]",
  B: "border-[#ff6b73] bg-[#d71920] text-white shadow-[0_0_10px_rgb(215_25_32/0.45)]",
};

export function XboxButtonGlyph({
  button,
  size = "normal",
}: {
  button: XboxControl;
  size?: "small" | "normal";
}) {
  if (button === "DPAD") {
    return (
      <span
        aria-hidden="true"
        className="relative inline-block h-6 w-7 shrink-0 drop-shadow-[0_2px_3px_rgb(0_0_0/0.45)]"
      >
        <span className="absolute left-0 top-[7px] h-[10px] w-7 rounded-[3px] border border-white/20 bg-[#343842]" />
        <span className="absolute left-[9px] top-0 h-6 w-[10px] rounded-[3px] border border-white/20 bg-[#343842]" />
        <span className="absolute left-[11px] top-[9px] h-1.5 w-1.5 rounded-sm bg-[#15171c]" />
      </span>
    );
  }

  if (button === "RIGHT_STICK") {
    return (
      <span
        aria-hidden="true"
        className="relative inline-block h-7 w-7 shrink-0 drop-shadow-[0_2px_3px_rgb(0_0_0/0.45)]"
      >
        <span className="absolute bottom-0 left-1/2 h-2.5 w-5 -translate-x-1/2 rounded-[50%] border border-white/20 bg-[#24272e]" />
        <span className="absolute left-1/2 top-0 grid h-5 w-5 -translate-x-1/2 place-items-center rounded-full border-2 border-[#737985] bg-[#343842] text-[9px] font-black text-white">
          R
        </span>
      </span>
    );
  }

  if (button === "VIEW") {
    return (
      <span
        aria-hidden="true"
        className="relative inline-block h-6 w-8 shrink-0 rounded-[7px] border border-white/25 bg-[#343842] shadow-[0_2px_4px_rgb(0_0_0/0.4)]"
      >
        <span className="absolute left-[8px] top-[7px] h-[7px] w-[9px] rounded-[1px] border border-white/85" />
        <span className="absolute left-[12px] top-[10px] h-[7px] w-[9px] rounded-[1px] border border-white/85 bg-[#343842]" />
      </span>
    );
  }

  if (button === "RB") {
    return (
      <span
        aria-hidden="true"
        className="inline-grid h-6 min-w-9 shrink-0 place-items-center rounded-b-md rounded-t-xl border border-white/30 bg-[#343842] px-2 text-[9px] font-black text-white shadow-[0_2px_4px_rgb(0_0_0/0.4)]"
      >
        RB
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={clsx(
        "inline-grid shrink-0 place-items-center rounded-full border-2 font-sans font-black leading-none",
        faceButtonStyles[button],
        size === "small" ? "h-[18px] w-[18px] text-[10px]" : "h-6 w-6 text-xs",
      )}
    >
      {button}
    </span>
  );
}
