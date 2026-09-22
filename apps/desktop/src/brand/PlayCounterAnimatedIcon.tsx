import "./animatedIcon.css";

type PlayCounterAnimatedIconProps = {
  size?: number;
  playback?: "loop" | "once" | "slow";
  assetBase?: string;
  className?: string;
};

/** Decorative: pair with a visible status label when work is pending. */
export function PlayCounterAnimatedIcon({
  size = 64,
  playback = "loop",
  assetBase = "/brand",
  className = "",
}: PlayCounterAnimatedIconProps) {
  const fragment =
    playback === "once"
      ? "#pc-amber-mark"
      : playback === "slow"
        ? "#pc-amber-mark-slow"
        : "";

  return (
    <picture
      className={`pc-animated-icon ${className}`}
      style={{ width: size }}
      aria-hidden="true"
    >
      <source
        media="(prefers-reduced-motion: reduce)"
        srcSet={`${assetBase}/playcounter-loader-static.svg`}
      />
      <img
        src={`${assetBase}/playcounter-loader.svg${fragment}`}
        width={size}
        height={size * 0.8}
        alt=""
        draggable={false}
      />
    </picture>
  );
}
