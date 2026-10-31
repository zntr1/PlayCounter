import { Copy, Loader2 } from "lucide-react";
import { getT } from "../../../i18n";
import { useAppStore } from "../../../store";
import { Button } from "../../primitives";

// The import's own words: this is the same Microsoft sign-in.
const t = getT("import");

/** While a Microsoft sign-in runs in the browser: the link to copy into
 *  another browser, and a way out. */
export function XboxSignInWait({
  url,
  onCancel,
}: {
  url?: string;
  onCancel: () => void;
}) {
  const addToast = useAppStore((state) => state.addToast);

  async function copy() {
    if (!url) return;
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error(t("PlayCounter cannot reach the clipboard right now."));
      }
      await navigator.clipboard.writeText(url);
      addToast({
        tone: "success",
        title: t("Sign-in link copied"),
        detail: t("Open it in the browser you want to sign in with."),
      });
    } catch (cause) {
      addToast({
        tone: "error",
        title: t("Could not copy sign-in link"),
        detail: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-text-muted"
    >
      <Loader2 size={15} className="animate-spin motion-reduce:animate-none" />
      <span className="min-w-0 flex-1">
        {t("Waiting for Microsoft sign-in…")}
      </span>
      <Button
        variant="ghost"
        icon={Copy}
        disabled={!url}
        onClick={() => void copy()}
      >
        {t("Copy sign-in link")}
      </Button>
      <Button onClick={onCancel}>{t("Cancel")}</Button>
    </div>
  );
}
