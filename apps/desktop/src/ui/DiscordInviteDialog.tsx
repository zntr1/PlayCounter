import { invoke } from "@tauri-apps/api/core";
import { getT } from "../i18n";
import { useAppStore } from "../store";
import { Button, Modal } from "./primitives";
import { DiscordIcon } from "./shell/HeaderLinks";

const t = getT("shell");

// Its own invite, so Discord counts the joins that came from this dialog.
const DISCORD_INVITE_URL = "https://discord.gg/FeW3jUhR4h";
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

/* The invite waits for a finished session, so it never greets a fresh
   install. "Not now" brings it back once, two weeks later; the second
   "Not now" or "Join Discord" ends it for good. */
export function discordInviteDue(input: {
  done: boolean;
  snoozedAt: string | null;
  hasFinishedSession: boolean;
  now?: number;
}) {
  if (input.done || !input.hasFinishedSession) return false;
  if (!input.snoozedAt) return true;
  return (input.now ?? Date.now()) - Date.parse(input.snoozedAt) >= SNOOZE_MS;
}

export function DiscordInviteDialog({ onClose }: { onClose: () => void }) {
  const snooze = useAppStore((state) => state.snoozeDiscordInvite);
  const finish = useAppStore((state) => state.finishDiscordInvite);
  const addToast = useAppStore((state) => state.addToast);

  function notNow() {
    snooze();
    onClose();
  }

  function join() {
    finish();
    onClose();
    invoke("open_external_url", { url: DISCORD_INVITE_URL }).catch((error) =>
      addToast({
        tone: "error",
        title: t("Could not open {{label}}", { label: "Discord" }),
        detail: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  return (
    <Modal
      size="sm"
      labelId="discord-invite-title"
      title={t("Join the Discord")}
      icon={DiscordIcon}
      onClose={notNow}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={notNow}>
            {t("Not now")}
          </Button>
          <Button variant="primary" data-autofocus onClick={join}>
            {t("Join Discord")}
          </Button>
        </div>
      }
    >
      <p className="leading-6 text-text-muted">
        {t(
          "PlayCounter is still in development. On Discord you can share ideas, report bugs and chat with other players. We'd love to hear your thoughts and ideas!",
        )}
      </p>
    </Modal>
  );
}
