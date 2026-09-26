import { AppWindow, Image as ImageIcon, X } from "lucide-react";
import { useState } from "react";
import { useAppStore } from "../store";
import { markExecutableAsSoftware } from "../tracker";
import { ArtPickerDialog } from "./ArtPickerDialog";
import { Button, Input, Modal, Switch } from "./primitives";

/* "Track as software" from Discovered: the app leaves Discovered at once and gets
   its own counter on the Software page. Shared, the community learns it too,
   reviewed per executable like a game. */

function defaultSoftwareName(exeName: string) {
  return exeName.replace(/\.exe$/i, "");
}

export function SoftwareDialog({
  exeName,
  suggestedName,
  isOffline,
  onClose,
  onSaved,
}: {
  exeName: string;
  /** The product name from the exe, when known. */
  suggestedName?: string | null;
  isOffline: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const addToast = useAppStore((state) => state.addToast);
  const trackTools = useAppStore((state) => state.settings.trackTools === true);
  const setTrackTools = useAppStore((state) => state.setTrackTools);
  const [name, setName] = useState(
    () => suggestedName?.trim() || defaultSoftwareName(exeName),
  );
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [share, setShare] = useState(!isOffline);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      // Choosing to track this app is the opt-in; the setting follows it.
      if (!trackTools) setTrackTools(true);
      const outcome = await markExecutableAsSoftware(exeName, {
        name: trimmed,
        coverUrl: coverUrl ?? undefined,
        share: share && !isOffline,
      });
      const where = "It counts on the Software page now.";
      if (outcome.kind === "failed") {
        addToast({
          tone: "error",
          title: `${trimmed} saved on this PC only`,
          detail: `Sharing failed: ${outcome.error}`,
        });
      } else {
        addToast({
          tone: "success",
          title: `Tracking ${trimmed} as software`,
          detail:
            outcome.kind === "submitted"
              ? `Shared for review. ${where}`
              : outcome.kind === "already-known"
                ? `The community already knows it. ${where}`
                : outcome.kind === "rejected"
                  ? `It was shared before and not accepted, so it stays on this PC. ${where}`
                  : where,
        });
      }
      onSaved?.();
      onClose();
    } catch (error) {
      addToast({
        tone: "error",
        title: "Could not save",
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Modal
        labelId="software-dialog-title"
        icon={AppWindow}
        eyebrow={exeName}
        title="Track as software"
        subtitle="Counted on the Software page, never as a game."
        onClose={onClose}
        bodyClassName="grid gap-4"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={saving}
              disabled={!name.trim()}
              onClick={() => void save()}
            >
              Save
            </Button>
          </div>
        }
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-text">Name</span>
            <Input
              value={name}
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
              data-autofocus
            />
          </label>
          <div className="grid gap-1.5 text-sm">
            <span className="font-medium text-text">Art (optional)</span>
            <div className="flex items-center gap-3">
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt=""
                  className="h-16 w-11 rounded-md border border-border object-cover"
                />
              ) : null}
              <Button
                variant="secondary"
                icon={ImageIcon}
                onClick={() => setPicking(true)}
              >
                {coverUrl ? "Change art" : "Pick art"}
              </Button>
              {coverUrl ? (
                <Button
                  variant="ghost"
                  icon={X}
                  onClick={() => setCoverUrl(null)}
                >
                  Remove
                </Button>
              ) : (
                <span className="text-xs text-text-faint">
                  Without art, the app's own icon is used.
                </span>
              )}
            </div>
          </div>
          <label className="flex items-start justify-between gap-4 text-sm">
            <span>
              <span className="block font-medium text-text">
                Share with the community
              </span>
              <span className="block text-xs text-text-muted">
                {isOffline
                  ? "Sharing needs a connection. It stays on this PC."
                  : "Sends the file name, the name and the art. After review, PlayCounter recognizes it for everyone."}
              </span>
            </span>
            <Switch
              aria-label="Share with the community"
              checked={share && !isOffline}
              disabled={isOffline}
              onChange={(event) => setShare(event.target.checked)}
            />
          </label>
          {trackTools ? null : (
            <p className="rounded-md border border-border bg-bg/50 px-3 py-2 text-xs text-text-muted">
              Saving turns on Track software in Settings. Other software is then
              counted too.
            </p>
          )}
        </form>
      </Modal>
      {picking ? (
        <ArtPickerDialog
          game={{
            gameId: 0,
            source: "custom",
            name: name.trim() || defaultSoftwareName(exeName),
            canEditCover: true,
          }}
          onClose={() => setPicking(false)}
          onPickCover={setCoverUrl}
        />
      ) : null}
    </>
  );
}
