import type { ImgHTMLAttributes } from "react";
import { useImageFadeIn } from "./useImageFadeIn";

/* Banner and hero art that fades in once loaded instead of popping in
   (useImageFadeIn). Give it `key={src}`: a new picture then loads hidden and
   fades in again, rather than the old one swapping to an empty frame. */
export function ArtImage({
  alt = "",
  ...props
}: ImgHTMLAttributes<HTMLImageElement>) {
  const fadeIn = useImageFadeIn({
    onLoad: props.onLoad,
    onTransitionEnd: props.onTransitionEnd,
  });
  return <img alt={alt} {...props} {...fadeIn} />;
}
