import { appLanguage, getT, LANGUAGE_NAMES } from "../i18n";
import { useAppStore } from "../store";
import { Button } from "./primitives";

const t = getT("shell");

/* Someone who used PlayCounter in English and has Windows in a language
   PlayCounter now speaks gets that language right away. This says so once,
   with a way back. New installs and anyone who picked a language themselves
   never see it. */
export function LanguageNotice() {
  const seen = useAppStore((state) => state.languageNoticeSeen);
  const setting = useAppStore((state) => state.settings.language);
  const dismiss = useAppStore((state) => state.dismissLanguageNotice);
  const setLanguage = useAppStore((state) => state.setLanguage);
  const language = appLanguage();
  if (seen || (setting ?? "system") !== "system" || language === "en") {
    return null;
  }
  return (
    <div className="flex items-center justify-between gap-4 border-b border-info-border bg-info-tint px-7 py-2 text-sm text-info">
      <span className="min-w-0" role="status">
        {t(
          "PlayCounter is now in {{language}}. You can change the language anytime in Settings.",
          { language: LANGUAGE_NAMES[language] },
        )}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="secondary"
          lang="en"
          onClick={() => {
            setLanguage("en");
            dismiss();
          }}
          className="px-3 py-1.5"
        >
          {t("Switch to English")}
        </Button>
        <Button variant="primary" onClick={dismiss} className="px-3 py-1.5">
          {t("Keep")}
        </Button>
      </div>
    </div>
  );
}
