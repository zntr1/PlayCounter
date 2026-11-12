import { Fragment, type ReactNode } from "react";

const MARKED = /(<b>[\s\S]*?<\/b>|<kbd>[\s\S]*?<\/kbd>)/;

/** A guide text with its marks drawn: `<b>` is the name of a control, `<kbd>`
 *  a key. Anything else stays text, so a translation can't inject markup. */
export function TourRichText({
  text,
  boldClassName = "font-semibold text-text",
}: {
  text: string;
  boldClassName?: string;
}): ReactNode {
  return text.split(MARKED).map((part, index) => {
    const bold = /^<b>([\s\S]*)<\/b>$/.exec(part);
    if (bold)
      return (
        <strong key={index} className={boldClassName}>
          {bold[1]}
        </strong>
      );
    const key = /^<kbd>([\s\S]*)<\/kbd>$/.exec(part);
    if (key)
      return (
        <kbd
          key={index}
          className="inline-block min-w-5 rounded-[5px] border border-b-2 border-border bg-bg px-1.5 text-center font-sans text-[11px] font-semibold leading-[18px] text-text"
        >
          {key[1]}
        </kbd>
      );
    return <Fragment key={index}>{part}</Fragment>;
  });
}

/** The same text without its marks, for places that only take a string. */
export const plainTourText = (text: string) =>
  text.replace(/<\/?(b|kbd)>/g, "");
