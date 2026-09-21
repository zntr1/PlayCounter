import "./loader.css";
import { PlayCounterWordmark, type BrandSurface } from "./PlayCounterWordmark";

export type PlayCounterLoaderProps = {
  label?: string;
  surface?: BrandSurface;
  assetBase?: string;
  className?: string;
};

/** Mount only while real work is pending. Unmount as soon as the app is ready. */
export function PlayCounterLoader({
  label = "Starting PlayCounter…",
  surface = "auto",
  assetBase = "/brand",
  className = "",
}: PlayCounterLoaderProps) {
  return (
    <div
      className={`pc-loader ${className}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <picture className="pc-loader__picture">
        <source
          media="(prefers-reduced-motion: reduce)"
          srcSet={`${assetBase}/playcounter-loader-static.svg`}
        />
        <img
          className="pc-loader__image"
          src={`${assetBase}/playcounter-loader.svg`}
          width={160}
          height={128}
          alt=""
          draggable={false}
        />
      </picture>
      <PlayCounterWordmark
        size={26}
        surface={surface}
        assetBase={assetBase}
        decorative
      />
      <p className="pc-loader__label">{label}</p>
    </div>
  );
}
