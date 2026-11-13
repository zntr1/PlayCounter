import { Languages } from "lucide-react";
import { appLanguage, getT, LANGUAGE_NAMES } from "../i18n";
import { useAppStore } from "../store";
import { NoticeCard } from "./NoticeCard";
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
    <NoticeCard
      tone="info"
      icon={<Languages size={18} />}
      text={t(
        "PlayCounter is now in {{language}}. You can change the language anytime in Settings.",
        { language: LANGUAGE_NAMES[language] },
      )}
      actions={
        <>
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
        </>
      }
      // Closing keeps the language, like Keep.
      onClose={dismiss}
    />
  );
}
