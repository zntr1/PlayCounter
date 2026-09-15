import { ArrowRight, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { DisplayNotes } from "../releaseNotes";
import { Modal } from "./primitives";
import { TOURS } from "./tour/tourDefinitions";

export function ReleaseNotesDialog({
  version,
  eyebrow,
  sections,
  onClose,
  footer,
  onStartTour,
}: {
  version: string;
  eyebrow: string;
  sections: Array<{ version: string; notes: DisplayNotes }>;
  onClose: () => void;
  footer?: ReactNode;
  onStartTour?: (id: string) => void;
}) {
  return (
    <Modal
      size="md"
      labelId="release-notes-title"
      eyebrow={eyebrow}
      title={
        sections.length > 1
          ? "What's new since your last update"
          : `What's new in ${version}`
      }
      icon={Sparkles}
      onClose={onClose}
      footer={footer}
    >
      <div className="grid gap-6 break-words">
        {onStartTour &&
        sections.some((section) =>
          TOURS.some((tour) => tour.release === section.version),
        ) ? (
          <section className="rounded-xl border border-accent/30 bg-accent-tint p-3">
            <h3 className="font-semibold text-text">Try the new features</h3>
            <p className="mb-2 mt-1 text-xs text-text-muted">
              Short guides with sample games to practice on. Nothing you do in
              them changes your library. You can also start them from ? Help.
            </p>
            <div className="grid gap-1">
              {TOURS.filter((tour) =>
                sections.some((section) => tour.release === section.version),
              ).map((tour) => (
                <button
                  key={tour.id}
                  type="button"
                  onClick={() => onStartTour(tour.id)}
                  className="flex items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-text transition hover:bg-surface-hover"
                >
                  <span className="min-w-0 flex-1">{tour.title}</span>
                  <span className="text-xs text-text-muted">
                    {tour.duration}
                  </span>
                  <ArrowRight size={14} className="shrink-0 text-accent" />
                </button>
              ))}
            </div>
          </section>
        ) : null}
        {sections.map((section, sectionIndex) => (
          <section
            key={section.version}
            className={
              sectionIndex > 0 ? "border-t border-border pt-6" : undefined
            }
          >
            {sections.length > 1 ? (
              <h3 className="mb-3 text-sm font-semibold text-accent">
                Version {section.version}
              </h3>
            ) : null}
            <ReleaseNotesContent notes={section.notes} />
          </section>
        ))}
      </div>
    </Modal>
  );
}

function ReleaseNotesContent({ notes }: { notes: DisplayNotes }) {
  return (
    <div className="grid gap-5">
      {notes.headline ? (
        <p className="text-base leading-relaxed text-text">{notes.headline}</p>
      ) : null}
      {notes.highlights.length > 0 ? (
        <ul className="grid list-disc gap-3 pl-5 text-sm leading-relaxed text-text-muted marker:text-accent">
          {notes.highlights.map((highlight, index) => (
            <li key={`${index}:${highlight}`}>{highlight}</li>
          ))}
        </ul>
      ) : null}
      {notes.paragraphs.map((paragraph, index) => (
        <p
          key={`${index}:${paragraph}`}
          className="text-sm leading-relaxed text-text-muted"
        >
          {paragraph}
        </p>
      ))}
    </div>
  );
}
