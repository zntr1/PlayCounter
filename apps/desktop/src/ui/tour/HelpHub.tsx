import { Check, CircleHelp, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getT } from "../../i18n";
import {
  DEFAULT_MENU_SCALE,
  normalizeInterfaceScale,
} from "../../interfaceScale";
import { useAppStore } from "../../store";
import { IconButton } from "../primitives";
import { tourCategories, tours } from "./tourDefinitions";

const t = getT("tour");

// Built on each render, so the menu follows the current language.
function helpTourGroups() {
  return tourCategories()
    .map((category) => ({
      ...category,
      tours: tours().filter((tour) => tour.category === category.id),
    }))
    .filter((group) => group.tours.length > 0);
}

export function HelpButton() {
  const open = useAppStore((state) => state.helpMenuOpen);
  const setOpen = useAppStore((state) => state.setHelpMenuOpen);
  const startTour = useAppStore((state) => state.startTour);
  const progress = useAppStore((state) => state.tourProgress);
  const menuScale = useAppStore((state) =>
    normalizeInterfaceScale(state.settings.menuScale, DEFAULT_MENU_SCALE),
  );
  const helpGroups = helpTourGroups();
  const [categoryId, setCategoryId] = useState(helpGroups[0].id);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    // The title bar can be scaled independently. Keep the wider picker inside
    // the window, even when its right edge cannot stay under the Help button.
    const position = () => {
      const root = rootRef.current;
      const panel = panelRef.current;
      if (!root || !panel) return;
      const anchor = root.getBoundingClientRect();
      const width = Math.min(720, (window.innerWidth - 32) / menuScale);
      const left = Math.max(
        16,
        Math.min(anchor.right, window.innerWidth - 16) - width * menuScale,
      );
      panel.style.width = `${width}px`;
      panel.style.right = `${(anchor.right - left - width * menuScale) / menuScale}px`;
      panel.style.maxHeight = `${Math.max(0, (window.innerHeight - panel.getBoundingClientRect().top - 16) / menuScale)}px`;
    };
    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [open, menuScale]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      rootRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open, setOpen]);

  return (
    <div ref={rootRef} className="relative">
      {/* inline-flex: an inline span measures only its line box, which made the
          guide's highlight ring flatter than the button. */}
      <span data-tour="help" className="inline-flex">
        <IconButton
          aria-label={t("Help and tutorials")}
          title={t("Help and tutorials")}
          aria-expanded={open}
          aria-controls="help-tutorials"
          icon={CircleHelp}
          onClick={() => setOpen(!open)}
        />
      </span>
      {open ? (
        <div
          ref={panelRef}
          id="help-tutorials"
          className="absolute right-0 top-11 z-50 flex w-[720px] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-raised"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 className="font-semibold text-text">
                {t("Help & tutorials")}
              </h2>
              <div className="mt-0.5 text-xs text-text-muted">
                {t("Choose a topic, then pick a guide.")}
              </div>
            </div>
            <IconButton
              aria-label={t("Close help")}
              icon={X}
              onClick={() => {
                setOpen(false);
                rootRef.current
                  ?.querySelector<HTMLButtonElement>("button")
                  ?.focus();
              }}
            />
          </div>
          {/* As tall as the longest guide list; it only scrolls when the
              window is too short. */}
          <div className="flex min-h-0">
            <div
              role="tablist"
              aria-label={t("Guide categories")}
              aria-orientation="vertical"
              className="flex w-[188px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-surface-hover/30 p-2"
            >
              {helpGroups.map((group, index) => {
                const selected = group.id === categoryId;
                return (
                  <button
                    key={group.id}
                    id={`help-category-${group.id}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={`help-guides-${group.id}`}
                    tabIndex={selected ? 0 : -1}
                    className={`flex shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-3 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 ${
                      selected
                        ? "bg-accent-tint text-accent-ink"
                        : "text-text-muted hover:bg-surface-hover hover:text-text"
                    }`}
                    onClick={() => setCategoryId(group.id)}
                    onKeyDown={(event) => {
                      let next = index;
                      if (event.key === "ArrowDown") next += 1;
                      else if (event.key === "ArrowUp") next -= 1;
                      else if (event.key === "Home") next = 0;
                      else if (event.key === "End")
                        next = helpGroups.length - 1;
                      else return;
                      event.preventDefault();
                      const target =
                        helpGroups[
                          (next + helpGroups.length) % helpGroups.length
                        ];
                      setCategoryId(target.id);
                      document
                        .getElementById(`help-category-${target.id}`)
                        ?.focus();
                    }}
                  >
                    <span>{group.title}</span>
                    <span
                      aria-label={t("{{count}} guides", {
                        count: group.tours.length,
                      })}
                      className="shrink-0 rounded-md bg-surface px-1.5 py-0.5 text-[10px] tabular-nums"
                    >
                      {group.tours.length}
                    </span>
                  </button>
                );
              })}
            </div>
            {/* Every list shares one grid cell so switching topics never
                resizes the panel; hidden lists only keep their height. */}
            <div className="grid min-w-0 flex-1 grid-rows-[minmax(0,1fr)]">
              {helpGroups.map((group) => (
                <div
                  key={group.id}
                  id={`help-guides-${group.id}`}
                  role="tabpanel"
                  aria-labelledby={`help-category-${group.id}`}
                  aria-hidden={group.id !== categoryId}
                  className={`col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col ${
                    group.id === categoryId ? "" : "invisible"
                  }`}
                >
                  <h3 className="shrink-0 px-4 pb-2 pt-4 text-sm font-semibold text-text">
                    {group.title}
                  </h3>
                  <div className="min-h-0 overflow-y-auto px-2 pb-2">
                    {group.tours.map((tour) => {
                      const complete =
                        progress.completed[tour.id] === tour.version;
                      return (
                        <button
                          key={tour.id}
                          type="button"
                          className="flex w-full items-start gap-3 rounded-lg px-2 py-3 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
                          onClick={() => startTour(tour.id)}
                        >
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-tint text-accent-ink">
                            {complete ? (
                              <Check size={16} />
                            ) : (
                              <CircleHelp size={16} />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-3 text-sm font-medium text-text">
                              <span>{tour.title}</span>
                              <span className="shrink-0 whitespace-nowrap text-[11px] font-normal text-text-muted">
                                {complete ? t("Replay") : tour.duration}
                              </span>
                            </span>
                            <span className="block text-xs leading-relaxed text-text-muted">
                              {tour.description}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
