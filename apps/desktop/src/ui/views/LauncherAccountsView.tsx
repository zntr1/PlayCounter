import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Trans } from "react-i18next";
import {
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  HardDrive,
  LockKeyhole,
  LogIn,
  LogOut,
  RefreshCw,
} from "lucide-react";
import type { XboxImportProgressStage } from "@playcounter/shared";
import { appLocale, getT } from "../../i18n";
import { currentPlatform } from "../../platform";
import { nativeText } from "../../nativeText";
import { useAppStore } from "../../store";
import {
  refreshKeptLogins,
  signOutKeptLogin,
  useAllKeptLogins,
  type KeptLoginService,
} from "../../library/keptLogins";
import { loadLibraryProvider } from "../../library/providers";
import { signInBattleNetAccount } from "../../library/battlenetAccount";
import { signInEpicAccount } from "../../library/epicAccount";
import { signInXboxAccount } from "../../library/providers/xbox";
import {
  beginLoginAccountChange,
  checkLauncherLogin,
  checkLauncherLogins,
  recordLoginHealth,
  useLoginHealth,
} from "../../library/loginHealth";
import { openLauncherImport } from "../../library/importRequest";
import type { LocalLibraryAccount } from "../../library/types";
import { providerTabConfigs } from "../libraryProviderTabs";
import { Button as SharedButton, Modal } from "../primitives";

const t = getT("accounts");
const importT = getT("import");

function Button(props: ComponentProps<typeof SharedButton>) {
  return <SharedButton data-controller-item="library-option" {...props} />;
}

type SteamState = {
  phase: "loading" | "ready" | "missing" | "error";
  accounts: LocalLibraryAccount[];
  error?: string;
};
type Activity = { service: KeptLoginService; kind: "connect" | "disconnect" };

export function LauncherAccountsView() {
  const platform = currentPlatform();
  const logins = useAllKeptLogins();
  const health = useLoginHealth((state) => state.checks);
  const apiEndpoint = useAppStore((state) => state.settings.apiEndpoint);
  const addToast = useAppStore((state) => state.addToast);
  const [steam, setSteam] = useState<SteamState>({
    phase: "loading",
    accounts: [],
  });
  const [steamAttempt, setSteamAttempt] = useState(0);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [errors, setErrors] = useState<
    Partial<Record<KeptLoginService, string>>
  >({});
  const [notice, setNotice] = useState<KeptLoginService | null>(null);
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [xboxStage, setXboxStage] =
    useState<XboxImportProgressStage>("authorization");
  const [waiting, setWaiting] = useState(false);
  const [battleNetNotice, setBattleNetNotice] = useState(false);
  const operation = useRef<AbortController | null>(null);

  useEffect(() => {
    void refreshKeptLogins();
    return () => {
      operation.current?.abort();
      operation.current = null;
    };
  }, []);

  useEffect(() => {
    void checkLauncherLogins(apiEndpoint);
  }, [apiEndpoint]);

  useEffect(() => {
    if (platform !== "windows") return;
    let cancelled = false;
    setSteam({ phase: "loading", accounts: [] });
    void (async () => {
      try {
        const provider = await loadLibraryProvider("steam");
        const status = await provider.detect();
        if (cancelled) return;
        if (!status.available) {
          setSteam({ phase: "missing", accounts: [] });
          return;
        }
        const accounts = await provider.listAccounts();
        if (!cancelled) setSteam({ phase: "ready", accounts });
      } catch (error) {
        if (!cancelled)
          setSteam({ phase: "error", accounts: [], error: formatError(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [platform, steamAttempt]);

  function cancel() {
    operation.current?.abort();
    operation.current = null;
    setActivity(null);
    setAuthorizeUrl(null);
    setWaiting(false);
    void refreshKeptLogins();
  }

  async function connect(service: KeptLoginService) {
    if (operation.current) return;
    beginLoginAccountChange(service);
    const controller = new AbortController();
    operation.current = controller;
    const current = () =>
      operation.current === controller && !controller.signal.aborted;
    setActivity({ service, kind: "connect" });
    setErrors((previous) => ({ ...previous, [service]: undefined }));
    setNotice(null);
    setAuthorizeUrl(null);
    setXboxStage("authorization");
    setWaiting(false);
    try {
      if (service === "battlenet") {
        await signInBattleNetAccount(controller.signal);
      } else if (service === "epic") {
        await signInEpicAccount(controller.signal);
      } else {
        await signInXboxAccount({
          apiEndpoint,
          signal: controller.signal,
          onAuthorizeUrl: (url) => {
            if (current()) setAuthorizeUrl(url);
          },
          onXboxProgress: (stage) => {
            if (current()) setXboxStage(stage);
          },
          onRateLimitWait: (value) => {
            if (current()) setWaiting(value);
          },
        });
      }
      if (!current()) return;
      const kept = await refreshKeptLogins();
      if (!current()) return;
      if (!kept.some((login) => login.service === service)) {
        setErrors((previous) => ({
          ...previous,
          [service]: t("Sign-in was not saved. Please try again."),
        }));
      } else {
        recordLoginHealth(service, "valid");
        setNotice(service);
      }
      setAuthorizeUrl(null);
    } catch (error) {
      if (current())
        setErrors((previous) => ({
          ...previous,
          [service]:
            formatError(error) || t("Could not connect. Please try again."),
        }));
    } finally {
      void refreshKeptLogins();
      if (current()) {
        operation.current = null;
        setActivity(null);
        setWaiting(false);
      }
    }
  }

  async function disconnect(service: KeptLoginService) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setActivity({ service, kind: "disconnect" });
    setNotice(null);
    setErrors((previous) => ({ ...previous, [service]: undefined }));
    try {
      await signOutKeptLogin(service);
    } catch (error) {
      if (!controller.signal.aborted)
        setErrors((previous) => ({
          ...previous,
          [service]: `${t("Could not sign out. Please try again.")} ${formatError(error)}`,
        }));
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setActivity(null);
      }
    }
  }

  async function copySignInLink() {
    if (!authorizeUrl) return;
    try {
      await navigator.clipboard.writeText(authorizeUrl);
      addToast({ tone: "success", title: t("Sign-in link copied") });
    } catch {
      addToast({ tone: "error", title: t("Could not copy the sign-in link.") });
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-6">
      <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4 text-sm text-text-muted">
        <LockKeyhole
          size={18}
          className="mt-0.5 shrink-0 text-accent-ink"
          aria-hidden="true"
        />
        <div className="space-y-1">
          <p>
            {platform === "windows"
              ? t(
                  "Sign-ins stay on this PC. Signing out keeps your imported games and playtime.",
                )
              : t("Xbox sign-ins are not saved on this platform.")}
          </p>
          <p className="text-xs text-text-faint">
            {t("Choose which games to import after connecting an account.")}
          </p>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {providerTabConfigs().map((provider) => {
          const id = provider.id;
          const supported =
            provider.import.kind === "builtin" &&
            provider.import.platforms.includes(platform);
          const isSteam = id === "steam";
          const service = isSteam ? null : (id as KeptLoginService);
          const login = logins.find((item) => item.service === service);
          const check = service ? health[service] : undefined;
          const needsSignIn = check?.status === "needsSignIn";
          const busy = activity?.service === service;
          const error = service ? errors[service] : steam.error;
          const localAccount =
            steam.accounts.find((account) => account.mostRecent) ??
            steam.accounts[0];
          const status = !supported
            ? t("Not available on this platform")
            : isSteam
              ? steam.phase === "loading"
                ? t("Checking…")
                : steam.phase === "missing"
                  ? t("Steam not found")
                  : steam.phase === "error"
                    ? t("Could not connect. Please try again.")
                    : localAccount
                      ? t("Local library")
                      : t("No local Steam accounts found")
              : needsSignIn
                ? t("Needs sign-in")
                : login
                  ? check?.status === "checking"
                    ? t("Checking…")
                    : check?.status === "unavailable"
                      ? t("Could not check connection")
                      : t("Signed in")
                  : platform !== "windows"
                    ? t("Sign-in needed for each import")
                    : t("Not signed in");
          const connected =
            supported &&
            (isSteam
              ? Boolean(localAccount)
              : Boolean(login) &&
                !needsSignIn &&
                check?.status !== "unavailable" &&
                check?.status !== "checking");
          return (
            <section
              key={id}
              aria-labelledby={`launcher-account-${id}`}
              className="flex min-w-0 flex-col rounded-xl border border-border bg-surface p-5"
            >
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-surface-hover">
                  <img
                    src={provider.iconUrl}
                    alt=""
                    className="h-6 w-6 object-contain"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <h2
                    id={`launcher-account-${id}`}
                    className="text-base font-semibold text-text"
                  >
                    {provider.label}
                  </h2>
                  <p
                    className={`mt-0.5 flex items-center gap-1.5 text-xs ${connected ? "text-success" : "text-text-muted"}`}
                  >
                    {connected ? (
                      <CheckCircle2
                        size={13}
                        className="shrink-0"
                        aria-hidden="true"
                      />
                    ) : null}
                    {status}
                  </p>
                  {check?.checkedAt != null ? (
                    <p className="mt-1 text-xs text-text-faint">
                      {t("Last checked {{time}}", {
                        time: new Date(check.checkedAt).toLocaleTimeString(
                          appLocale(),
                          { hour: "2-digit", minute: "2-digit" },
                        ),
                      })}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="mt-4 flex-1 space-y-2 text-sm text-text-muted">
                {login?.name && !needsSignIn ? (
                  <p className="break-words font-medium text-text">
                    {t("Signed in as {{name}}", { name: login.name })}
                  </p>
                ) : null}
                {isSteam && localAccount ? (
                  <p className="break-words font-medium text-text">
                    {t("Steam account: {{name}}", {
                      name:
                        localAccount.personaName ||
                        String(localAccount.accountId),
                    })}
                  </p>
                ) : null}
                <p>
                  {isSteam
                    ? t(
                        "PlayCounter reads Steam accounts on this PC. No separate sign-in is needed.",
                      )
                    : id === "xbox"
                      ? t("Your Xbox library, playtime and achievements.")
                      : id === "epic"
                        ? t("Your Epic Games library and recorded playtime.")
                        : t(
                            "Your Battle.net library. PlayCounter tracks new sessions.",
                          )}
                </p>
              </div>
              {busy && activity.kind === "connect" ? (
                <div
                  role="status"
                  className="mt-4 rounded-lg bg-accent-tint p-3 text-sm text-accent-ink"
                >
                  <p>
                    {waiting
                      ? t("Waiting for the server…")
                      : id === "xbox"
                        ? xboxStage === "authorization"
                          ? t("Complete Microsoft sign-in in your browser.")
                          : t("Connecting…")
                        : id === "battlenet"
                          ? t(
                              "Complete Battle.net sign-in in the window that opened.",
                            )
                          : t("Complete sign-in in the window that opened.")}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={cancel}>
                      {t("Cancel")}
                    </Button>
                    {authorizeUrl ? (
                      <Button
                        variant="ghost"
                        icon={Copy}
                        onClick={() => void copySignInLink()}
                      >
                        {t("Copy sign-in link")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {error ? (
                <p
                  role="alert"
                  className="mt-3 break-words text-sm text-danger"
                >
                  {error}
                </p>
              ) : null}
              {notice === service && service ? (
                <p role="status" className="mt-3 text-sm text-success">
                  {t("Connected. You can now choose games to import.")}
                </p>
              ) : null}
              <div className="mt-5 flex flex-wrap gap-2">
                {isSteam ? (
                  <>
                    <Button
                      icon={Download}
                      variant="primary"
                      disabled={!connected || Boolean(activity)}
                      onClick={() => openLauncherImport("steam")}
                    >
                      {t("Import games")}
                    </Button>
                    {supported && steam.phase !== "loading" ? (
                      <Button
                        icon={RefreshCw}
                        variant="ghost"
                        disabled={Boolean(activity)}
                        onClick={() =>
                          setSteamAttempt((previous) => previous + 1)
                        }
                      >
                        {t("Retry")}
                      </Button>
                    ) : null}
                  </>
                ) : login || needsSignIn ? (
                  <>
                    {needsSignIn ? (
                      <Button
                        icon={LogIn}
                        variant="primary"
                        loading={busy && activity.kind === "connect"}
                        disabled={!supported || Boolean(activity)}
                        onClick={() => void connect(service!)}
                      >
                        {t("Sign in again")}
                      </Button>
                    ) : (
                      <Button
                        icon={Download}
                        variant="primary"
                        disabled={!supported || Boolean(activity)}
                        onClick={() => openLauncherImport(id)}
                      >
                        {t("Import games")}
                      </Button>
                    )}
                    <Button
                      icon={LogOut}
                      variant="ghost"
                      loading={busy && activity.kind === "disconnect"}
                      disabled={Boolean(activity)}
                      onClick={() => void disconnect(service!)}
                    >
                      {t("Sign out")}
                    </Button>
                    {!needsSignIn && service ? (
                      <Button
                        icon={RefreshCw}
                        variant="ghost"
                        loading={check?.status === "checking"}
                        disabled={
                          Boolean(activity) || check?.status === "checking"
                        }
                        onClick={() =>
                          void checkLauncherLogin(service, apiEndpoint)
                        }
                      >
                        {t("Check connection")}
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <Button
                    icon={LogIn}
                    variant="primary"
                    loading={busy}
                    disabled={!supported || Boolean(activity)}
                    onClick={() => {
                      if (platform !== "windows") openLauncherImport(id);
                      else if (id === "battlenet") setBattleNetNotice(true);
                      else void connect(service!);
                    }}
                  >
                    {busy
                      ? t("Connecting…")
                      : platform !== "windows" && id === "xbox"
                        ? t("Sign in and import")
                        : t("Sign in")}
                  </Button>
                )}
                {(id === "epic" || id === "battlenet") && supported ? (
                  <Button
                    icon={HardDrive}
                    variant="ghost"
                    disabled={Boolean(activity)}
                    onClick={() => openLauncherImport(id, "installed")}
                  >
                    {t("Find installed games")}
                  </Button>
                ) : null}
                {id === "xbox" && authorizeUrl && !busy ? (
                  <Button
                    icon={Copy}
                    variant="ghost"
                    onClick={() => void copySignInLink()}
                  >
                    {t("Copy sign-in link")}
                  </Button>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
      {battleNetNotice ? (
        <Modal
          labelId="accounts-battlenet-playtime"
          title={importT("Battle.net playtime")}
          icon={Clock3}
          onClose={() => setBattleNetNotice(false)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setBattleNetNotice(false)}>
                {t("Cancel")}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setBattleNetNotice(false);
                  void connect("battlenet");
                }}
              >
                {t("Sign in")}
              </Button>
            </div>
          }
        >
          <div className="space-y-4 text-sm leading-6 text-text-muted">
            <p>
              {importT(
                "Battle.net does not provide historical playtime. To include your previous hours, you need to set each game's total yourself.",
              )}
            </p>
            <p>
              <Trans
                t={importT}
                i18nKey="After importing, right-click a game in <strong>My Games</strong> and choose <strong>Adjust total playtime</strong>."
                components={{ strong: <strong className="text-text" /> }}
              />
            </p>
            <p>{importT("PlayCounter tracks new sessions automatically.")}</p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function formatError(error: unknown) {
  return nativeText(error instanceof Error ? error.message : String(error));
}

export default LauncherAccountsView;
