import "./animatedIcon.css";

type PlayCounterAnimatedIconProps = {
  size?: number;
  once?: boolean;
  assetBase?: string;
  className?: string;
};

/** Decorative: pair with a visible status label when work is pending. */
export function PlayCounterAnimatedIcon({
  size = 64,
  once = false,
  assetBase = "/brand",
  className = "",
}: PlayCounterAnimatedIconProps) {
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
        src={`${assetBase}/playcounter-loader.svg${once ? "#pc-amber-mark" : ""}`}
        width={size}
        height={size * 0.8}
        alt=""
        draggable={false}
      />
    </picture>
  );
}
