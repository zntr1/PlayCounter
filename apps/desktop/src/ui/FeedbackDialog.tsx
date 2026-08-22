import clsx from "clsx";
import {
  Bug,
  Lightbulb,
  MessageSquare,
  MessageSquarePlus,
  Send,
  X,
} from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { useState } from "react";
import type {
  FeedbackPayload,
  FeedbackResponse,
  FeedbackType,
} from "@playcounter/shared";
import { useAppStore, useIsOffline } from "../store";
import { Button, Modal } from "./primitives";

const feedbackTypes: Array<{
  id: FeedbackType;
  label: string;
  icon: typeof Bug;
  placeholder: string;
}> = [
  {
    id: "bug",
    label: "Bug",
    icon: Bug,
    placeholder: "What went wrong? Steps to reproduce help a lot.",
  },
  {
    id: "feature",
    label: "Feature",
    icon: Lightbulb,
    placeholder: "What would you like PlayCounter to do?",
  },
  {
    id: "other",
    label: "Other",
    icon: MessageSquare,
    placeholder: "Anything else you want to share.",
  },
];

function detectPlatform() {
  const value = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
  if (value.includes("win")) return "windows";
  if (value.includes("mac")) return "macos";
  if (value.includes("linux")) return "linux";
  return navigator.platform || "unknown";
}

export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const apiEndpoint = useAppStore((state) => state.settings.apiEndpoint);
  const installUuid = useAppStore((state) => state.installUuid);
  const addToast = useAppStore((state) => state.addToast);
  const isOffline = useIsOffline();

  const [type, setType] = useState<FeedbackType>("bug");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeType = feedbackTypes.find((entry) => entry.id === type)!;

  async function handleSubmit() {
    const trimmed = message.trim();
    if (!trimmed || submitting || isOffline) return;

    setSubmitting(true);
    setError(null);
    try {
      let appVersion = "";
      try {
        appVersion = await getVersion();
      } catch {
        appVersion = "";
      }

      const payload: FeedbackPayload = {
        type,
        message: trimmed,
        appVersion,
        platform: detectPlatform(),
        installUuid: installUuid ?? undefined,
      };

      const response = await fetch(`${apiEndpoint}/api/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      (await response.json()) as FeedbackResponse;

      addToast({
        tone: "success",
        title: "Thanks for the feedback",
        detail: "Your message was sent to the PlayCounter team.",
      });
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `Could not send feedback: ${caught.message}`
          : "Could not send feedback.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      size="md"
      labelId="feedback-dialog-title"
      eyebrow="Support"
      title="Send feedback"
      subtitle="Report a bug or suggest a feature."
      icon={MessageSquarePlus}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-text-faint">
            App version and platform are attached automatically.
          </span>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" icon={X} onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="feedback-form"
              variant="primary"
              icon={Send}
              loading={submitting}
              disabled={!message.trim() || isOffline}
              title={isOffline ? "Feedback unavailable offline" : undefined}
            >
              {submitting ? "Sending…" : "Send"}
            </Button>
          </div>
        </div>
      }
    >
      <form
        id="feedback-form"
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <div className="grid grid-cols-3 gap-2">
          {feedbackTypes.map((entry) => {
            const Icon = entry.icon;
            const active = type === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setType(entry.id)}
                className={clsx(
                  "inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition",
                  active
                    ? "border-accent bg-accent text-accent-fg"
                    : "border-border bg-surface text-text-muted hover:bg-surface-hover hover:text-text",
                )}
              >
                <Icon size={15} />
                {entry.label}
              </button>
            );
          })}
        </div>

        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={4000}
          rows={6}
          data-autofocus
          placeholder={activeType.placeholder}
          className="min-w-0 resize-none rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-faint outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30"
        />

        {error ? <div className="text-sm text-danger">{error}</div> : null}
        {isOffline ? (
          <div className="rounded-xl border border-border bg-bg px-3 py-2 text-sm text-text-muted">
            Feedback is unavailable while offline.
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
