import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { DisplayNotes } from "../releaseNotes";
import { Modal } from "./primitives";

export function ReleaseNotesDialog({
  version,
  eyebrow,
  sections,
  onClose,
  footer,
}: {
  version: string;
  eyebrow: string;
  sections: Array<{ version: string; notes: DisplayNotes }>;
  onClose: () => void;
  footer?: ReactNode;
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
