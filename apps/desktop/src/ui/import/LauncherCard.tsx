import clsx from "clsx";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Info,
  LogIn,
  Search,
} from "lucide-react";
import type { ReactNode } from "react";
import { Trans } from "react-i18next";
import { getT } from "../../i18n";
import type { KeptLogin } from "../../library/keptLogins";
import type { LoginHealth } from "../../library/loginHealth";
import { importProfile, type ImportScope } from "../../library/importProfiles";
import type { ImportSession } from "../../library/importSession";
import { Panel } from "../components";
import { Button } from "../primitives";
import { AccountLine, LauncherLogo } from "./LauncherIdentity";
import { ImportError } from "./ImportError";
import { useImportActions } from "./importHost";
import {
  launcherMissingText,
  launcherName,
  launcherNoAccountsText,
  launcherNote,
} from "./importTexts";

const t = getT("import");

/** Step 1 for every launcher: who is read, what is read, one button. */
export function LauncherCard({
  session,
  keptLogin,
  health,
  battleNetNoticeSeen,
  onFind,
  onCopySignInLink,
  onSignOut,
  onBack,
}: {
  session: ImportSession;
  keptLogin: KeptLogin | null;
  health?: LoginHealth;
  battleNetNoticeSeen: boolean;
  onFind: () => void;
  onCopySignInLink: () => void;
  onSignOut: () => void;
  /** Back to the games found before, when the card was opened to change. */
  onBack?: () => void;
}) {
  const actions = useImportActions();
  const { providerId, status, accounts, accountId, scope } = session;
  const profile = importProfile(providerId);
  const providerName = launcherName(providerId);
  const missing = status !== null && !status.available;
  const readsAccount =
    profile.choice !== "accountOrInstalled" || scope === "account";
  const needsSignIn =
    profile.login !== null &&
    readsAccount &&
    (!keptLogin || health?.status === "needsSignIn");
  const localAccount = accounts.find(
    (account) => account.accountId === accountId,
  );
  // Found, but no account to import from: what keeps Find games disabled.
  const noAccounts = !missing && status !== null && accountId === null;

  return (
    <Panel className="grid gap-6 p-6">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 justify-self-start rounded text-sm font-semibold text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          {t("Back to the games")}
        </button>
      ) : null}
      <div className="flex items-center gap-4">
        <LauncherLogo providerId={providerId} size="lg" />
        <div className="min-w-0">
          <h2 className="text-2xl font-bold tracking-tight text-text">
            {providerName}
          </h2>
          <div className="mt-1">
            {missing ? (
              <span className="text-sm text-text-muted">
                {t("{{providerName}} was not found", { providerName })}
              </span>
            ) : (
              <AccountLine
                login={profile.login}
                keptLogin={keptLogin}
                health={health}
                localAccount={localAccount}
                onSignOut={onSignOut}
              />
            )}
          </div>
        </div>
      </div>

      {missing ? (
        <Note>{launcherMissingText(providerId)}</Note>
      ) : (
        <>
          <fieldset className="min-w-0">
            <legend className="mb-2.5 font-semibold text-text">
              {t("What to import")}
            </legend>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {profile.choice === "localAccounts" ? (
                accounts.map((account) => (
                  <Choice
                    key={account.accountId}
                    name={`import-account-${providerId}`}
                    checked={account.accountId === accountId}
                    onChange={() => actions.chooseAccount(account.accountId)}
                    title={
                      account.personaName ??
                      t("Account {{id}}", { id: account.accountId })
                    }
                    body={t("{{count}} games", {
                      count: account.gamesWithPlaytime,
                    })}
                  />
                ))
              ) : profile.choice === "account" ? (
                <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-hover/40 px-4 py-3.5">
                  <Check
                    size={17}
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-success"
                  />
                  <span>
                    <span className="block font-semibold text-text">
                      {t("Your {{providerName}} account", { providerName })}
                    </span>
                    <span className="block text-sm text-text-muted">
                      {accountBody(profile.hasPlaytime, providerName)}
                    </span>
                  </span>
                </div>
              ) : (
                (["account", "installed"] as const).map((option) => (
                  <Choice
                    key={option}
                    name={`import-scope-${providerId}`}
                    checked={scope === option}
                    onChange={() => actions.chooseScope(option)}
                    title={scopeTitle(option, providerName)}
                    body={
                      option === "account" ? (
                        accountBody(profile.hasPlaytime, providerName)
                      ) : (
                        <>
                          {t("No sign-in needed.")}
                          {profile.hasPlaytime
                            ? ` ${t("Past playtime stays unknown.")}`
                            : null}
                        </>
                      )
                    }
                  />
                ))
              )}
            </div>
          </fieldset>

          {noAccounts ? (
            <Note warn>{launcherNoAccountsText(providerId)}</Note>
          ) : null}
          {profile.playtimeNotice && battleNetNoticeSeen ? (
            <Note warn>
              {t(
                "Battle.net does not provide historical playtime. To include your previous hours, you need to set each game's total yourself.",
              )}{" "}
              <Trans
                t={t}
                i18nKey="After importing, right-click a game in <strong>My Games</strong> and choose <strong>Adjust total playtime</strong>."
                components={{ strong: <strong className="text-text" /> }}
              />
            </Note>
          ) : (
            <Note>
              {launcherNote(providerId)}
              {profile.copySignInLink && !keptLogin ? (
                <span className="mt-1 block">
                  {t(
                    "Use the Microsoft account that belongs to your Xbox gamertag. If you are not sure, copy the sign-in link and open it in a private browser window.",
                  )}
                </span>
              ) : null}
            </Note>
          )}
        </>
      )}

      {session.error ? <ImportError message={session.error} /> : null}

      {missing ? null : (
        <div className="flex flex-wrap items-center justify-end gap-4">
          {profile.copySignInLink && needsSignIn ? (
            <button
              type="button"
              disabled={accountId === null}
              onClick={onCopySignInLink}
              className="rounded text-sm font-semibold text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
            >
              {t("Copy sign-in link")}
            </button>
          ) : null}
          <Button
            variant="primary"
            icon={needsSignIn ? LogIn : Search}
            disabled={accountId === null}
            onClick={onFind}
            data-tour="import-find-games"
            className="px-5 py-2.5 text-[15px]"
          >
            {needsSignIn ? t("Sign in and find games") : t("Find games")}
          </Button>
        </div>
      )}
    </Panel>
  );
}

function scopeTitle(option: ImportScope, providerName: string) {
  return option === "account"
    ? t("Your {{providerName}} account", { providerName })
    : t("Only installed games");
}

function accountBody(hasPlaytime: boolean, providerName: string) {
  return hasPlaytime
    ? t(
        "Every game on your account, with the playtime {{providerName}} recorded.",
        {
          providerName,
        },
      )
    : t("Every game on your account, installed or not.");
}

function Choice({
  name,
  checked,
  onChange,
  title,
  body,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  body: ReactNode;
}) {
  return (
    <label
      className={clsx(
        "flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3.5 transition",
        checked
          ? "border-accent/70 bg-accent-tint"
          : "border-border bg-surface-hover/40 hover:border-text-faint",
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--color-accent))]"
      />
      <span className="min-w-0">
        <span className="block font-semibold text-text">{title}</span>
        <span className="block text-sm text-text-muted">{body}</span>
      </span>
    </label>
  );
}

function Note({
  warn = false,
  children,
}: {
  warn?: boolean;
  children: ReactNode;
}) {
  const Icon = warn ? AlertTriangle : Info;
  return (
    <div
      className={clsx(
        "flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm leading-6",
        warn
          ? "border border-warning-border/60 bg-warning-tint/40 text-warning"
          : "bg-surface-hover/60 text-text-muted",
      )}
    >
      <Icon size={16} aria-hidden="true" className="mt-1 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
