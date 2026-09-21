import "./loader.css";
import { PlayCounterAnimatedIcon } from "./PlayCounterAnimatedIcon";
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
      <PlayCounterAnimatedIcon size={160} assetBase={assetBase} />
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
