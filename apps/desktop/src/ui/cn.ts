import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import tailwindConfig from "../../tailwind.config";

const theme = tailwindConfig.theme.extend;

// Colours it reads as colours on its own; our shadow and animation names it
// has to be told.
const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      shadow: [{ shadow: Object.keys(theme.boxShadow) }],
      animate: [{ animate: Object.keys(theme.animation) }],
    },
  },
});

/** Joins class names like clsx; when two set the same thing (two text colours,
 *  two paddings) the last one stays. Tailwind orders its rules alphabetically,
 *  not by their place in a class list, so without this a class a screen hands
 *  to a component could lose to the component's own: "text-danger" to
 *  "text-text-muted", "hover:bg-accent" to "hover:bg-surface-hover". */
export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs));
}
