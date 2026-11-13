import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import {
  Bell,
  BellOff,
  Copy,
  Download,
  ExternalLink,
  HardDrive,
  KeyRound,
  Loader2,
  LockKeyhole,
  LogIn,
  LogOut,
  MoreHorizontal,
  RefreshCw,
  type LucideIcon,
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
import { signInGogAccount } from "../../library/gogAccount";
import {
  signInPlayStationAccount,
  signInPlayStationWithCode,
} from "../../library/playstationAccount";
import { importProfile } from "../../library/importProfiles";
import type { BuiltinImportProviderId } from "../../library/importProviders";
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
import {
  Button as SharedButton,
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  IconButton,
  Switch,
  useAnchoredMenu,
} from "../primitives";
import { BattleNetPlaytimeNotice } from "../import/BattleNetPlaytimeNotice";
import { GuideLink } from "../tour/GuideLink";

const t = getT("accounts");
const commonT = getT("common");

// "Sign in with a code": Sony's sign-in, then its page with the session code.
const PLAYSTATION_SIGN_IN_URL = "https://www.playstation.com/";
const PLAYSTATION_CODE_URL = "https://ca.account.sony.com/api/v1/ssocookie";

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
  const loginWarningsOff = useAppStore(
    (state) => state.settings.loginWarningsOff,
  );
  const playStationLiveOff = useAppStore(
    (state) => state.settings.playstationLiveOff === true,
  );
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
      } else if (service === "gog") {
        await signInGogAccount(controller.signal);
      } else if (service === "playstation") {
        await signInPlayStationAccount(controller.signal);
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
        <GuideLink
          tourId="launcher-accounts"
          className="ml-auto mt-0.5 shrink-0"
        />
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
          const warns = !loginWarningsOff?.includes(id);
          const busy = activity?.service === service;
          const connecting = busy && activity.kind === "connect";
          const error = service ? errors[service] : steam.error;
          const localAccount =
            steam.accounts.find((account) => account.mostRecent) ??
            steam.accounts[0];
          const connected =
            supported &&
            (isSteam
              ? Boolean(localAccount)
              : Boolean(login) &&
                !needsSignIn &&
                check?.status !== "unavailable" &&
                check?.status !== "checking");
          const checking = check?.status === "checking";
          const tone = connected ? "ok" : needsSignIn ? "warn" : "off";
          const statusSpin =
            connecting ||
            checking ||
            (isSteam && supported && steam.phase === "loading");
          const statusText = isSteam
            ? !supported
              ? t("Not available on this platform")
              : steam.phase === "loading"
                ? t("Checking…")
                : steam.phase === "missing"
                  ? t("Steam not found")
                  : steam.phase === "error"
                    ? t("Could not connect. Please try again.")
                    : localAccount
                      ? t("Steam account: {{name}}", {
                          name:
                            localAccount.personaName ||
                            String(localAccount.accountId),
                        })
                      : t("No local Steam accounts found")
            : !supported
              ? t("Not available on this platform")
              : connecting
                ? t("Connecting…")
                : needsSignIn
                  ? t("Needs sign-in")
                  : login
                    ? checking
                      ? t("Checking…")
                      : check?.status === "unavailable"
                        ? t("Could not check connection")
                        : login.name
                          ? t("Signed in as {{name}}", { name: login.name })
                          : t("Signed in")
                    : platform !== "windows"
                      ? t("Sign-in needed for each import")
                      : t("Not signed in");
          // Everything but the one main button goes into ⋯.
          const menuActions: CardMenuAction[] = [];
          if (login && !needsSignIn)
            menuActions.push({
              icon: RefreshCw,
              label: t("Check connection"),
              detail: checking
                ? t("Checking…")
                : check?.checkedAt != null
                  ? t("Last checked {{time}}", {
                      time: new Date(check.checkedAt).toLocaleTimeString(
                        appLocale(),
                        { hour: "2-digit", minute: "2-digit" },
                      ),
                    })
                  : null,
              disabled: checking,
              onSelect: () => void checkLauncherLogin(service!, apiEndpoint),
            });
          if (
            supported &&
            importProfile(id as BuiltinImportProviderId).choice ===
              "accountOrInstalled"
          )
            menuActions.push({
              icon: HardDrive,
              label: t("Find installed games"),
              onSelect: () =>
                openLauncherImport(id as BuiltinImportProviderId, "installed"),
            });
          if (id === "xbox" && authorizeUrl && !busy)
            menuActions.push({
              icon: Copy,
              label: t("Copy sign-in link"),
              onSelect: () => void copySignInLink(),
            });
          if (login || needsSignIn)
            menuActions.push({
              icon: LogOut,
              label: t("Sign out"),
              danger: true,
              onSelect: () => void disconnect(service!),
            });
          // Amber only when something needs the player.
          const mainButton = isSteam ? (
            supported && steam.phase !== "loading" && !connected ? (
              <Button
                icon={RefreshCw}
                variant="secondary"
                className="w-full"
                data-tour="accounts-action"
                disabled={Boolean(activity)}
                onClick={() => setSteamAttempt((previous) => previous + 1)}
              >
                {t("Retry")}
              </Button>
            ) : (
              <Button
                icon={Download}
                variant="secondary"
                className="w-full"
                data-tour="accounts-action"
                disabled={!connected || Boolean(activity)}
                onClick={() => openLauncherImport("steam")}
              >
                {t("Import games")}
              </Button>
            )
          ) : needsSignIn ? (
            <Button
              icon={LogIn}
              variant="primary"
              className="w-full"
              data-tour="accounts-action"
              disabled={!supported || Boolean(activity)}
              onClick={() => void connect(service!)}
            >
              {t("Sign in again")}
            </Button>
          ) : login ? (
            <Button
              icon={Download}
              variant="secondary"
              className="w-full"
              data-tour="accounts-action"
              disabled={!supported || Boolean(activity)}
              onClick={() => openLauncherImport(id)}
            >
              {t("Import games")}
            </Button>
          ) : (
            <Button
              icon={LogIn}
              variant="primary"
              className="w-full"
              data-tour="accounts-action"
              disabled={!supported || Boolean(activity)}
              onClick={() => {
                if (platform !== "windows") openLauncherImport(id);
                else if (
                  id === "battlenet" &&
                  !useAppStore.getState().battleNetPlaytimeNoticeSeen
                )
                  setBattleNetNotice(true);
                else void connect(service!);
              }}
            >
              {platform !== "windows" && id === "xbox"
                ? t("Sign in and import")
                : t("Sign in")}
            </Button>
          );
          return (
            <section
              key={id}
              data-tour="accounts-card"
              // The guide "Launcher accounts" rings a card by how it stands.
              data-tour-state={
                connected
                  ? "signed-in"
                  : needsSignIn
                    ? "needs-sign-in"
                    : "signed-out"
              }
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
                  <div className="flex items-center gap-1">
                    <h2
                      id={`launcher-account-${id}`}
                      className="text-base font-semibold text-text"
                    >
                      {provider.label}
                    </h2>
                    {service && (login || needsSignIn) ? (
                      <button
                        type="button"
                        data-controller-item="library-option"
                        aria-label={t("Sign-in warnings")}
                        aria-pressed={warns}
                        title={
                          warns
                            ? t(
                                "Sign-in warnings on: a badge and a message when {{launcher}} needs you to sign in again. Click to turn them off.",
                                { launcher: provider.label },
                              )
                            : t(
                                "Sign-in warnings off: no badge and no message when {{launcher}} needs you to sign in again. Click to turn them on.",
                                { launcher: provider.label },
                              )
                        }
                        onClick={() =>
                          useAppStore
                            .getState()
                            .setLoginWarning(service, !warns)
                        }
                        className={clsx(
                          "inline-grid h-6 w-6 shrink-0 place-items-center rounded-md transition hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                          warns ? "text-text-muted" : "text-text-faint",
                        )}
                      >
                        {warns ? (
                          <Bell size={14} aria-hidden="true" />
                        ) : (
                          <BellOff size={14} aria-hidden="true" />
                        )}
                      </button>
                    ) : null}
                  </div>
                  <p
                    aria-live="polite"
                    data-tour="accounts-status"
                    className={clsx(
                      "mt-0.5 flex items-center gap-2 text-sm",
                      tone === "warn" ? "text-warning" : "text-text-muted",
                    )}
                  >
                    {statusSpin ? (
                      <Loader2
                        size={13}
                        aria-hidden="true"
                        className="shrink-0 animate-spin"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className={clsx(
                          "h-2 w-2 shrink-0 rounded-full",
                          tone === "ok"
                            ? "bg-success"
                            : tone === "warn"
                              ? "bg-warning"
                              : "border border-text-faint",
                        )}
                      />
                    )}
                    <span className="min-w-0 break-words">{statusText}</span>
                  </p>
                </div>
                <CardMenu actions={menuActions} disabled={Boolean(activity)} />
              </div>
              <p className="mt-3 flex-1 text-sm text-text-muted">
                {isSteam
                  ? t(
                      "PlayCounter reads Steam accounts on this PC. No separate sign-in is needed.",
                    )
                  : id === "xbox"
                    ? t("Your Xbox library, playtime and achievements.")
                    : id === "epic"
                      ? t("Your Epic Games library, playtime and achievements.")
                      : id === "gog"
                        ? t("Your GOG library, playtime and achievements.")
                        : id === "playstation"
                          ? t(
                              "Your PS5 and PS4 games, the playtime Sony recorded and what you play right now.",
                            )
                          : t(
                              "Your Battle.net library. PlayCounter tracks new sessions.",
                            )}
              </p>
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
              {id === "playstation" && connected ? (
                <label className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-border bg-surface-hover/40 px-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block font-medium text-text">
                      {t("Live from PlayStation")}
                    </span>
                    <span className="block text-text-muted">
                      {t(
                        "Shows what you play on your PS5 or PS4 while PlayCounter runs.",
                      )}
                    </span>
                  </span>
                  <Switch
                    data-controller-item="library-option"
                    aria-label={t("Live from PlayStation")}
                    checked={!playStationLiveOff}
                    onChange={(event) =>
                      useAppStore
                        .getState()
                        .setPlayStationLive(event.target.checked)
                    }
                  />
                </label>
              ) : null}
              {connecting ? (
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
              ) : (
                <div className="mt-4">
                  {mainButton}
                  {id === "playstation" &&
                  supported &&
                  platform === "windows" &&
                  (!login || needsSignIn) ? (
                    <PlayStationCodeSignIn
                      disabled={Boolean(activity)}
                      onSignedIn={() => {
                        setErrors((previous) => ({
                          ...previous,
                          [service!]: undefined,
                        }));
                        setNotice(service);
                      }}
                      onError={(message) =>
                        setErrors((previous) => ({
                          ...previous,
                          [service!]: message,
                        }))
                      }
                    />
                  ) : null}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {battleNetNotice ? (
        <BattleNetPlaytimeNotice
          confirmLabel={t("Sign in")}
          onCancel={() => setBattleNetNotice(false)}
          onConfirm={() => {
            useAppStore.getState().markBattleNetPlaytimeNoticeSeen();
            setBattleNetNotice(false);
            void connect("battlenet");
          }}
        />
      ) : null}
    </div>
  );
}

function formatError(error: unknown) {
  return nativeText(error instanceof Error ? error.message : String(error));
}

/** The visible fallback when Sony's page doesn't work in the sign-in window:
 *  the player copies Sony's session code from its own page. */
function PlayStationCodeSignIn({
  disabled,
  onSignedIn,
  onError,
}: {
  disabled: boolean;
  onSignedIn: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const openPage = (url: string) =>
    void invoke("open_external_url", { url }).catch((error: unknown) =>
      onError(formatError(error)),
    );
  if (!open)
    return (
      <button
        type="button"
        data-controller-item="library-option"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1.5 rounded-md text-sm text-text-muted underline-offset-2 transition hover:text-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
      >
        <KeyRound size={14} aria-hidden="true" />
        {t("Sign in with a code")}
      </button>
    );
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    beginLoginAccountChange("playstation");
    try {
      await signInPlayStationWithCode(code);
      setCode("");
      setOpen(false);
      onSignedIn();
    } catch (error) {
      onError(formatError(error) || t("Could not connect. Please try again."));
    } finally {
      setBusy(false);
    }
  }
  const linkClass =
    "inline-flex items-center gap-1 rounded text-accent-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";
  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="mt-3 space-y-3 rounded-lg border border-border bg-surface-hover/40 p-3 text-sm"
    >
      <ol className="list-decimal space-y-2 pl-5 text-text-muted">
        <li>
          {t("Sign in at playstation.com in your browser.")}{" "}
          <button
            type="button"
            data-controller-item="library-option"
            className={linkClass}
            onClick={() => openPage(PLAYSTATION_SIGN_IN_URL)}
          >
            {t("Open playstation.com")}
            <ExternalLink size={12} aria-hidden="true" />
          </button>
        </li>
        <li>
          {t("In the same browser, open Sony's sign-in code page.")}{" "}
          <button
            type="button"
            data-controller-item="library-option"
            className={linkClass}
            onClick={() => openPage(PLAYSTATION_CODE_URL)}
          >
            {t("Open the code page")}
            <ExternalLink size={12} aria-hidden="true" />
          </button>
        </li>
        <li>{t("Copy everything on that page and paste it here.")}</li>
      </ol>
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        data-controller-item="library-option"
        aria-label={t("Sign-in code")}
        placeholder={t("Sign-in code")}
        value={code}
        onChange={(event) => setCode(event.target.value)}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text placeholder:text-text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      />
      <p className="text-xs text-text-faint">
        {t(
          "The code works like your password. PlayCounter keeps it encrypted on this PC and only sends it to Sony.",
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant="primary"
          icon={LogIn}
          loading={busy}
          disabled={disabled || !code.trim()}
        >
          {t("Sign in")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setCode("");
          }}
        >
          {t("Cancel")}
        </Button>
      </div>
    </form>
  );
}

type CardMenuAction = {
  icon: LucideIcon;
  label: string;
  detail?: string | null;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

/** The ⋯ beside a launcher's name: everything but its main button. */
function CardMenu({
  actions,
  disabled,
}: {
  actions: CardMenuAction[];
  disabled: boolean;
}) {
  const menu = useAnchoredMenu();
  if (actions.length === 0) return null;
  return (
    <>
      <IconButton
        ref={menu.anchorRef}
        data-controller-item="library-option"
        data-tour="accounts-more"
        aria-label={commonT("More")}
        title={commonT("More")}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        icon={MoreHorizontal}
        disabled={disabled}
        onClick={menu.toggle}
      />
      <ContextMenu
        open={menu.open && !disabled}
        position={menu.position}
        onClose={menu.close}
        anchorRef={menu.anchorRef}
      >
        {actions.map((action, index) => (
          <Fragment key={action.label}>
            {action.danger && index > 0 ? <ContextMenuSeparator /> : null}
            <ContextMenuItem
              icon={action.icon}
              danger={action.danger}
              disabled={action.disabled}
              onClick={() => {
                menu.close();
                action.onSelect();
              }}
            >
              {action.label}
              {action.detail ? (
                <span className="block text-xs text-text-faint">
                  {action.detail}
                </span>
              ) : null}
            </ContextMenuItem>
          </Fragment>
        ))}
      </ContextMenu>
    </>
  );
}

export default LauncherAccountsView;
