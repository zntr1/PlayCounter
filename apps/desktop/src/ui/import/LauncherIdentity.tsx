import clsx from "clsx";
import { getT } from "../../i18n";
import type { KeptLogin } from "../../library/keptLogins";
import type { LoginHealth } from "../../library/loginHealth";
import type { BuiltinImportProviderId } from "../../library/importProviders";
import type { LocalLibraryAccount } from "../../library/types";
import { providerTabConfig } from "../libraryProviderTabs";

const accountsT = getT("accounts");
const t = getT("import");

export function LauncherLogo({
  providerId,
  size = "md",
}: {
  providerId: BuiltinImportProviderId;
  size?: "md" | "lg";
}) {
  const iconUrl = providerTabConfig(providerId)?.iconUrl;
  return (
    <span
      aria-hidden="true"
      className={clsx(
        "grid shrink-0 place-items-center bg-surface-hover ring-1 ring-inset ring-white/5",
        size === "lg" ? "h-16 w-16 rounded-2xl" : "h-10 w-10 rounded-xl",
      )}
    >
      {iconUrl ? (
        <img
          src={iconUrl}
          alt=""
          className={size === "lg" ? "h-9 w-9" : "h-6 w-6"}
        />
      ) : null}
    </span>
  );
}

/** Who the import reads: the same line for every launcher. */
export function AccountLine({
  login,
  keptLogin,
  health,
  localAccount,
  onSignOut,
  signOutDisabled = false,
}: {
  /** Null: the launcher is read from this PC, without a sign-in. */
  login: string | null;
  keptLogin: KeptLogin | null;
  health?: LoginHealth;
  localAccount?: LocalLibraryAccount;
  onSignOut?: () => void;
  signOutDisabled?: boolean;
}) {
  let tone: "ok" | "warn" | "off" = "off";
  let text: string;
  if (login === null) {
    tone = "ok";
    text = localAccount
      ? accountsT("Steam account: {{name}}", {
          name: localAccount.personaName || String(localAccount.accountId),
        })
      : accountsT("Local library");
  } else if (health?.status === "needsSignIn") {
    tone = "warn";
    text = accountsT("Needs sign-in");
  } else if (keptLogin) {
    if (health?.status === "checking") text = accountsT("Checking…");
    else if (health?.status === "unavailable")
      text = accountsT("Could not check connection");
    else {
      tone = "ok";
      text = keptLogin.name
        ? accountsT("Signed in as {{name}}", { name: keptLogin.name })
        : accountsT("Signed in");
    }
  } else {
    text = accountsT("Not signed in");
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span
        className={clsx(
          "inline-flex items-center gap-2",
          tone === "warn" ? "text-warning" : "text-text-muted",
        )}
      >
        <span
          aria-hidden="true"
          className={clsx(
            "h-2 w-2 shrink-0 rounded-full",
            tone === "ok" && "bg-success",
            tone === "warn" && "bg-warning",
            tone === "off" && "border border-text-faint",
          )}
        />
        {text}
      </span>
      {keptLogin && onSignOut ? (
        <button
          type="button"
          disabled={signOutDisabled}
          onClick={onSignOut}
          className="rounded font-semibold text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("Sign out")}
        </button>
      ) : null}
    </span>
  );
}
