import type { ComponentProps } from "react";
import { useImageFadeIn } from "./useImageFadeIn";

/* Art and screenshots that shimmer while they load and fade in once loaded,
   instead of popping in (useImageFadeIn). Give it `key={src}`: a new picture
   then loads again, rather than the old one swapping to an empty frame. */
export function ArtImage({ alt = "", ref, ...props }: ComponentProps<"img">) {
  const fadeIn = useImageFadeIn({
    onLoad: props.onLoad,
    onAnimationEnd: props.onAnimationEnd,
    onError: props.onError,
  });
  return (
    <img
      alt={alt}
      {...props}
      {...fadeIn}
      ref={(element) => {
        fadeIn.ref.current = element;
        if (typeof ref === "function") ref(element);
        else if (ref) ref.current = element;
      }}
    />
  );
}
