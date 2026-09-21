import type { CSSProperties } from "react";
import "./wordmark.css";

export type BrandSurface = "auto" | "dark" | "light";
export type PlayCounterWordmarkProps = {
  size?: number;
  surface?: BrandSurface;
  assetBase?: string;
  decorative?: boolean;
  className?: string;
};

/** Native vector outlines preserve the approved type and spacing, without a font download.
 * Auto follows html[data-theme], falling back to the OS only if no app theme is set. */
export function PlayCounterWordmark({
  size = 19,
  surface = "auto",
  assetBase = "/brand",
  decorative = false,
  className = "",
}: PlayCounterWordmarkProps) {
  return (
    <span
      className={`pc-wordmark ${className}`}
      data-surface={surface}
      style={{ "--pc-wordmark-size": `${size}px` } as CSSProperties}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "PlayCounter"}
      aria-hidden={decorative || undefined}
    >
      <img
        className="pc-wordmark__dark"
        src={`${assetBase}/playcounter-wordmark-on-dark.svg`}
        width={1087}
        height={208}
        alt=""
        draggable={false}
      />
      <img
        className="pc-wordmark__light"
        src={`${assetBase}/playcounter-wordmark-on-light.svg`}
        width={1087}
        height={208}
        alt=""
        draggable={false}
      />
    </span>
  );
}
