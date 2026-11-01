import type { AchievementList, GameAchievement } from "@playcounter/shared";
import { Check, Eye, Lock, RefreshCw, Trophy } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Trans } from "react-i18next";
import clsx from "clsx";
import {
  achievementSummary,
  filterAchievements,
  isConcealed,
  mergeSteamCatalog,
  orderAchievements,
  type AchievementFilter,
  type SteamCatalogAchievement,
} from "../../../achievements/model";
import {
  readSteamAchievements,
  steamAchievementCatalog,
  type SteamAchievementRead,
} from "../../../achievements/steam";
import {
  achievementListKey,
  loadAchievementList,
  saveAchievementLists,
  useAchievementLists,
} from "../../../achievements/achievementLists";
import {
  readEpicAchievements,
  type EpicAchievementStatus,
} from "../../../achievements/epic";
import {
  readGogAchievements,
  type GogAchievementStatus,
} from "../../../achievements/gog";
import { refreshXboxAchievementList } from "../../../library/providers/xbox";
import { signInEpicAccount } from "../../../library/epicAccount";
import { signInGogAccount } from "../../../library/gogAccount";
import { refreshKeptLogins, useKeptLogin } from "../../../library/keptLogins";
import {
  beginLoginAccountChange,
  recordLoginHealth,
  useLoginHealth,
} from "../../../library/loginHealth";
import { appLocale, getT } from "../../../i18n";
import { nativeText } from "../../../nativeText";
import { currentPlatform } from "../../../platform";
import { useAppStore } from "../../../store";
import { Button, Pill } from "../../primitives";
import type { GameSummary } from "../MyGamesView";
import { XboxSignInWait } from "./XboxSignInWait";

const t = getT("games");
const accountsT = getT("accounts");

/* A game's own achievements, the ones its developers made, from Steam's
   files on this PC or from the last Xbox, Epic Games or GOG sign-in. Not
   PlayCounter's milestones: those live on the Achievements page. */

export type AchievementSource = {
  provider: "steam" | "epic" | "gog" | "xbox";
  externalId: string;
};

/** Steam first, Xbox last. */
const ORDER = { steam: 0, epic: 1, gog: 2, xbox: 3 } as const;

/** The game's Steam, Epic Games, GOG and Xbox entries. Epic and GOG only on
 *  Windows, where their sign-ins exist. None: no tab. */
export function achievementSources(
  game: Pick<GameSummary, "libraryImports">,
): AchievementSource[] {
  const signIns = currentPlatform() === "windows";
  const seen = new Set<string>();
  const sources: AchievementSource[] = [];
  for (const { provider, externalId } of game.libraryImports) {
    if (
      provider !== "steam" &&
      provider !== "xbox" &&
      !((provider === "epic" || provider === "gog") && signIns)
    )
      continue;
    const key = `${provider}:${externalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({ provider, externalId });
  }
  return sources.sort((a, b) => ORDER[a.provider] - ORDER[b.provider]);
}

const PROVIDER_LABEL = {
  steam: "Steam",
  epic: "Epic Games",
  gog: "GOG",
  xbox: "Xbox",
} as const;

export function GameAchievementsTab({
  sources,
}: {
  sources: readonly AchievementSource[];
}) {
  const [selected, setSelected] = useState(0);
  const source = sources[Math.min(selected, sources.length - 1)];
  if (!source) return null;
  const sameProvider = (item: AchievementSource) =>
    sources.filter((other) => other.provider === item.provider).length > 1;
  return (
    <div className="grid gap-4">
      {sources.length > 1 ? (
        <div
          role="group"
          aria-label={t("Achievement source")}
          className="flex flex-wrap gap-2"
        >
          {sources.map((item, index) => (
            <Pill
              key={`${item.provider}:${item.externalId}`}
              selected={item === source}
              onClick={() => setSelected(index)}
            >
              {sameProvider(item)
                ? `${PROVIDER_LABEL[item.provider]} ${item.externalId}`
                : PROVIDER_LABEL[item.provider]}
            </Pill>
          ))}
        </div>
      ) : null}
      {source.provider === "steam" ? (
        <SteamAchievements key={source.externalId} appId={source.externalId} />
      ) : source.provider === "epic" ? (
        <KeptLoginAchievements
          key={`epic:${source.externalId}`}
          source={epicSource()}
          externalId={source.externalId}
        />
      ) : source.provider === "gog" ? (
        <KeptLoginAchievements
          key={`gog:${source.externalId}`}
          source={gogSource()}
          externalId={source.externalId}
        />
      ) : (
        <XboxAchievements key={source.externalId} titleId={source.externalId} />
      )}
    </div>
  );
}

function SteamAchievements({ appId }: { appId: string }) {
  const [read, setRead] = useState<SteamAchievementRead | null>(null);
  const [catalog, setCatalog] = useState<SteamCatalogAchievement[] | null>(
    null,
  );
  const [reads, setReads] = useState(0);
  const [reading, setReading] = useState(true);

  // Steam's files are the truth: read them every time the tab opens.
  useEffect(() => {
    let current = true;
    setReading(true);
    readSteamAchievements(appId)
      .then((value) => {
        if (current) setRead(value);
      })
      .catch(() => {
        if (current) setRead({ status: "unreadable" });
      })
      .finally(() => {
        if (current) setReading(false);
      });
    return () => {
      current = false;
    };
  }, [appId, reads]);

  // Optional: the share of players, and achievements newer than the file.
  useEffect(() => {
    let current = true;
    steamAchievementCatalog(appId)
      .then((value) => {
        if (current) setCatalog(value);
      })
      .catch(() => {
        // Offline or Steam busy: the list works without it.
      });
    return () => {
      current = false;
    };
  }, [appId]);

  const achievements = useMemo(
    () =>
      read?.status !== "ok"
        ? []
        : catalog
          ? mergeSteamCatalog(read.achievements, catalog)
          : read.achievements,
    [read, catalog],
  );

  const refresh = (
    <Button
      icon={RefreshCw}
      loading={reading && read !== null}
      onClick={() => setReads((count) => count + 1)}
    >
      {t("Refresh")}
    </Button>
  );

  if (!read) return <Reading />;
  if (read.status !== "ok") {
    const text = {
      noSteam: t("Steam was not found on this PC."),
      noSchema: t(
        "Steam saves achievements on this PC once you start the game through Steam.",
      ),
      noAchievements: t("This game has no Steam achievements."),
      unreadable: t(
        "PlayCounter can't read Steam's achievement file for this game.",
      ),
    }[read.status];
    return <Message action={refresh}>{text}</Message>;
  }
  return (
    <AchievementOverview
      achievements={achievements}
      origin={t("From Steam on this PC")}
      note={
        read.hasPlayerStats
          ? undefined
          : t("Steam has no progress for your Steam account on this PC yet.")
      }
      action={refresh}
    />
  );
}

function xboxErrorText(
  error: "unavailable" | "forbidden" | "rate_limited" | "failed",
) {
  return {
    unavailable: t(
      "Xbox sent no achievements for this game. Xbox 360 games are not supported yet.",
    ),
    forbidden: t(
      "Xbox didn't allow reading these achievements. Check the Microsoft account and its Xbox privacy settings.",
    ),
    rate_limited: t("Xbox is busy right now. Try again in a few minutes."),
    failed: t("Xbox achievements could not be loaded. Try again later."),
  }[error];
}

function XboxAchievements({ titleId }: { titleId: string }) {
  const list = useAchievementLists((state) =>
    state.lists.get(achievementListKey("xbox", titleId)),
  );
  const apiEndpoint = useAppStore((state) => state.settings.apiEndpoint);
  const kept = useKeptLogin("xbox") !== null;
  const [storageFailed, setStorageFailed] = useState(false);
  const [signIn, setSignIn] = useState<{ url?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (list !== undefined) return;
    loadAchievementList("xbox", titleId).catch(() => setStorageFailed(true));
  }, [list, titleId]);

  // Closing Details ends a sign-in that is still waiting.
  useEffect(() => () => controller.current?.abort(), []);

  async function refresh() {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setSignIn({});
    setError(null);
    try {
      const result = await refreshXboxAchievementList(titleId, {
        apiEndpoint,
        signal: request.signal,
        onAuthorizeUrl: (url) => {
          if (controller.current === request) setSignIn({ url });
        },
      });
      if (request.signal.aborted) return;
      if ("list" in result) {
        // Shown at once; kept for the next start when storage works.
        await saveAchievementLists([result.list], { show: true }).catch(
          () => {},
        );
      } else {
        setError(xboxErrorText(result.error));
      }
    } catch (cause) {
      if (!request.signal.aborted)
        setError(
          cause instanceof Error && cause.message
            ? cause.message
            : xboxErrorText("failed"),
        );
    } finally {
      if (controller.current === request) {
        controller.current = null;
        setSignIn(null);
      }
      // The sign-in may have been kept, renewed or refused.
      void refreshKeptLogins();
    }
  }

  const waiting = signIn ? (
    <XboxSignInWait
      url={signIn.url}
      kept={kept}
      onCancel={() => {
        controller.current?.abort();
        controller.current = null;
        setSignIn(null);
      }}
    />
  ) : null;
  const errorLine = error ? (
    <p role="alert" className="text-sm text-danger">
      {error}
    </p>
  ) : null;

  if (list === undefined && !storageFailed) return <Reading />;
  if (!list) {
    return (
      <div className="grid gap-3">
        <Message
          action={
            signIn ? null : (
              <Button variant="primary" onClick={() => void refresh()}>
                {kept ? t("Refresh") : t("Sign in with Microsoft")}
              </Button>
            )
          }
        >
          {kept
            ? t("Your Xbox achievements are not loaded yet.")
            : t("Sign in with Microsoft to load your Xbox achievements.")}
        </Message>
        {waiting}
        {errorLine}
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      {waiting}
      {errorLine}
      <AchievementOverview
        achievements={list.achievements}
        origin={t("From Xbox, updated {{date}}", {
          date: new Date(list.fetchedAt).toLocaleDateString(appLocale()),
        })}
        action={
          <Button
            icon={RefreshCw}
            disabled={signIn !== null}
            onClick={() => void refresh()}
          >
            {kept ? t("Refresh") : t("Refresh with Microsoft")}
          </Button>
        }
      />
    </div>
  );
}

/** A launcher whose lists load with its kept sign-in, without a window:
 *  Epic Games and GOG. What differs between them is passed in; texts are
 *  built while rendering, so a language switch updates them. */
type KeptLoginSource<S extends string> = {
  service: "epic" | "gog";
  read: (
    externalId: string,
  ) => Promise<{ list: AchievementList } | { status: S }>;
  signIn: (signal: AbortSignal) => Promise<unknown>;
  /** The line for an answer without a list, or for a sign-in to renew. */
  statusText: (status: S | "noLogin" | "needsSignIn") => string;
  signInLabel: string;
  origin: (date: string) => string;
};

function epicStatusText(status: EpicAchievementStatus) {
  return {
    noLogin: t("Sign in to Epic Games to load your achievements."),
    needsSignIn: accountsT("{{launcher}} needs you to sign in again.", {
      launcher: "Epic Games",
    }),
    notInAccount: t("This game isn't in your Epic Games account."),
    noAchievements: t("This game has no Epic achievements."),
    blocked: t("Epic Games didn't send the achievements. Try again later."),
    unavailable: t("Epic Games didn't send the achievements. Try again later."),
  }[status];
}

function epicSource(): KeptLoginSource<EpicAchievementStatus> {
  return {
    service: "epic",
    read: readEpicAchievements,
    signIn: signInEpicAccount,
    statusText: epicStatusText,
    signInLabel: t("Sign in to Epic Games"),
    origin: (date) => t("From Epic Games, updated {{date}}", { date }),
  };
}

function gogStatusText(status: GogAchievementStatus) {
  return {
    noLogin: t("Sign in to GOG to load your achievements."),
    needsSignIn: accountsT("{{launcher}} needs you to sign in again.", {
      launcher: "GOG",
    }),
    noAchievements: t("This game has no GOG achievements."),
    unavailable: t("GOG didn't send the achievements. Try again later."),
  }[status];
}

function gogSource(): KeptLoginSource<GogAchievementStatus> {
  return {
    service: "gog",
    read: readGogAchievements,
    signIn: signInGogAccount,
    statusText: gogStatusText,
    signInLabel: t("Sign in to GOG"),
    origin: (date) => t("From GOG, updated {{date}}", { date }),
  };
}

function KeptLoginAchievements<S extends string>({
  source,
  externalId,
}: {
  source: KeptLoginSource<S>;
  externalId: string;
}) {
  const { service } = source;
  const list = useAchievementLists((state) =>
    state.lists.get(achievementListKey(service, externalId)),
  );
  const login = useKeptLogin(service);
  const expired = useLoginHealth(
    (state) => state.checks[service]?.status === "needsSignIn",
  );
  const [storageFailed, setStorageFailed] = useState(false);
  const [reading, setReading] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [status, setStatus] = useState<S | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);
  const mounted = useRef(false);
  const signInRequest = useRef<AbortController | null>(null);

  const signedOut = !login || status === "noLogin";
  const needsSignIn = expired || status === "needsSignIn";
  const nothingSaved = list === null || (list === undefined && storageFailed);

  useEffect(() => {
    if (list !== undefined) return;
    loadAchievementList(service, externalId).catch(() =>
      setStorageFailed(true),
    );
  }, [list, service, externalId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Closing Details ends a sign-in that is still waiting.
      signInRequest.current?.abort();
    };
  }, []);

  async function read() {
    loaded.current = true;
    setReading(true);
    setStatus(null);
    setError(null);
    try {
      const result = await source.read(externalId);
      if ("list" in result) {
        // Shown at once; kept for the next start when storage works.
        await saveAchievementLists([result.list], { show: true }).catch(
          () => {},
        );
      } else if (mounted.current) setStatus(result.status);
    } finally {
      if (mounted.current) setReading(false);
    }
  }

  // Nothing saved and a kept sign-in: load at once, once. No window opens.
  useEffect(() => {
    if (!nothingSaved || signedOut || needsSignIn || loaded.current) return;
    void read();
  });

  async function signIn() {
    if (signInRequest.current) return;
    const request = new AbortController();
    signInRequest.current = request;
    // The read after the sign-in is the load.
    loaded.current = true;
    beginLoginAccountChange(service);
    setSigningIn(true);
    setStatus(null);
    setError(null);
    try {
      await source.signIn(request.signal);
      const kept = await refreshKeptLogins();
      if (request.signal.aborted) return;
      if (!kept.some((item) => item.service === service)) {
        if (mounted.current)
          setError(accountsT("Sign-in was not saved. Please try again."));
        return;
      }
      recordLoginHealth(service, "valid");
      if (mounted.current) setSigningIn(false);
      await read();
    } catch (cause) {
      if (!request.signal.aborted && mounted.current)
        setError(
          nativeText(cause instanceof Error ? cause.message : String(cause)),
        );
    } finally {
      if (signInRequest.current === request) signInRequest.current = null;
      if (mounted.current) setSigningIn(false);
    }
  }

  const action =
    needsSignIn || signedOut ? (
      <Button
        variant="primary"
        loading={signingIn}
        disabled={reading}
        onClick={() => void signIn()}
      >
        {needsSignIn ? accountsT("Sign in again") : source.signInLabel}
      </Button>
    ) : (
      <Button
        icon={RefreshCw}
        loading={reading}
        disabled={signingIn}
        onClick={() => void read()}
      >
        {t("Refresh")}
      </Button>
    );
  const line = needsSignIn
    ? source.statusText("needsSignIn")
    : status
      ? source.statusText(status)
      : null;
  const errorLine = error ? (
    <p role="alert" className="text-sm text-danger">
      {error}
    </p>
  ) : null;

  if (!nothingSaved && !list) return <Reading />;
  if (!list) {
    // A kept sign-in without an answer yet is about to load.
    if (reading || (!line && !signedOut)) return <Reading />;
    return (
      <div className="grid gap-3">
        <Message action={action}>
          {line ?? source.statusText("noLogin")}
        </Message>
        {errorLine}
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      {line ? (
        <p role="alert" className="text-sm text-danger">
          {line}
        </p>
      ) : null}
      {errorLine}
      <AchievementOverview
        achievements={list.achievements}
        origin={source.origin(
          new Date(list.fetchedAt).toLocaleDateString(appLocale()),
        )}
        action={action}
      />
    </div>
  );
}

function Reading() {
  return (
    <p role="status" className="py-6 text-center text-sm text-text-muted">
      {t("Reading achievements…")}
    </p>
  );
}

function Message({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg p-4">
      <p className="min-w-0 flex-1 text-sm text-text-muted">{children}</p>
      {action}
    </div>
  );
}

function number(value: number) {
  return new Intl.NumberFormat(appLocale()).format(value);
}

function percent(value: number, digits = 0) {
  return new Intl.NumberFormat(appLocale(), {
    style: "percent",
    maximumFractionDigits: digits,
  }).format(value / 100);
}

function AchievementOverview({
  achievements,
  origin,
  note,
  action,
}: {
  achievements: readonly GameAchievement[];
  origin: string;
  note?: string;
  action: ReactNode;
}) {
  const [filter, setFilter] = useState<AchievementFilter>("all");
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  const ordered = useMemo(
    () => orderAchievements(achievements),
    [achievements],
  );
  const summary = useMemo(
    () => achievementSummary(achievements),
    [achievements],
  );
  const visible = filterAchievements(ordered, filter);
  const filters: Array<{
    id: AchievementFilter;
    label: string;
    count: number;
  }> = [
    { id: "all", label: t("All"), count: summary.total },
    { id: "unlocked", label: t("Unlocked"), count: summary.unlocked },
    {
      id: "locked",
      label: t("Locked"),
      count: summary.total - summary.unlocked,
    },
  ];

  return (
    <div className="grid gap-4">
      <section className="rounded-xl border border-border bg-bg p-4">
        <div className="flex flex-wrap items-center gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-accent/20 bg-accent-tint text-accent-ink">
            <Trophy size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-text-muted">
              <Trans
                t={t}
                i18nKey="<count>{{unlocked}}</count> of {{total}} unlocked"
                values={{
                  unlocked: number(summary.unlocked),
                  total: number(summary.total),
                }}
                components={{
                  count: (
                    <span className="font-mono text-2xl font-bold text-text" />
                  ),
                }}
              />
              <span className="ml-2 font-mono text-text">
                {percent(summary.percent)}
              </span>
            </p>
            {summary.gamerscore ? (
              <p className="text-sm text-text-muted">
                {t("{{earned}} of {{total}} Gamerscore", {
                  earned: number(summary.gamerscore.earned),
                  total: number(summary.gamerscore.total),
                })}
              </p>
            ) : null}
            {summary.xp ? (
              <p className="text-sm text-text-muted">
                {t("{{earned}} of {{total}} XP", {
                  earned: number(summary.xp.earned),
                  total: number(summary.xp.total),
                })}
              </p>
            ) : null}
            <p className="text-xs text-text-faint">{origin}</p>
          </div>
          {action}
        </div>
        <div
          aria-hidden
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-hover"
        >
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${summary.percent}%` }}
          />
        </div>
        {note ? <p className="mt-3 text-sm text-text-muted">{note}</p> : null}
      </section>

      <div className="flex flex-wrap gap-2">
        {filters.map(({ id, label, count }) => (
          <Pill
            key={id}
            selected={filter === id}
            count={count}
            onClick={() => setFilter(id)}
          >
            {label}
          </Pill>
        ))}
      </div>

      {visible.length ? (
        <ul className="grid gap-2">
          {visible.map((achievement) => (
            <AchievementRow
              key={achievement.id}
              achievement={achievement}
              concealed={isConcealed(achievement, revealed)}
              onReveal={() =>
                setRevealed((previous) => new Set(previous).add(achievement.id))
              }
            />
          ))}
        </ul>
      ) : (
        <p className="py-4 text-center text-sm text-text-muted">
          {filter === "locked"
            ? t("Everything is unlocked.")
            : t("Nothing unlocked yet.")}
        </p>
      )}
    </div>
  );
}

function AchievementRow({
  achievement,
  concealed,
  onReveal,
}: {
  achievement: GameAchievement;
  concealed: boolean;
  onReveal: () => void;
}) {
  const [iconFailed, setIconFailed] = useState(false);
  const icon = achievement.unlocked
    ? achievement.iconUrl
    : (achievement.lockedIconUrl ?? achievement.iconUrl);
  const { progress } = achievement;
  return (
    <li
      data-achievement-row
      className={clsx(
        "flex items-center gap-3 rounded-lg border px-3 py-2.5",
        achievement.unlocked
          ? "border-accent/25 bg-surface"
          : "border-border bg-bg",
      )}
    >
      <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md bg-surface-hover text-text-faint">
        {icon && !iconFailed && !concealed ? (
          <img
            src={icon}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setIconFailed(true)}
            className={clsx(
              "h-full w-full object-cover",
              // Xbox has one icon: grey it out while locked.
              !achievement.unlocked &&
                !achievement.lockedIconUrl &&
                "grayscale opacity-60",
            )}
          />
        ) : achievement.unlocked ? (
          <Trophy size={20} />
        ) : (
          <Lock size={18} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <h4 className="truncate text-sm font-semibold text-text">
          {concealed ? t("Hidden achievement") : achievement.name}
        </h4>
        <p className="text-sm text-text-muted">
          {concealed
            ? t("Unlock it to see what it is.")
            : achievement.description}
        </p>
        {progress && !achievement.unlocked && !concealed ? (
          <div className="mt-1.5 flex items-center gap-2">
            <div
              aria-hidden
              className="h-1 max-w-48 flex-1 overflow-hidden rounded-full bg-surface-hover"
            >
              <div
                className="h-full rounded-full bg-accent/70"
                style={{
                  width: `${Math.min(100, (progress.current / progress.target) * 100)}%`,
                }}
              />
            </div>
            <span className="font-mono text-xs text-text-muted">
              {number(progress.current)} / {number(progress.target)}
            </span>
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-right">
        {achievement.unlocked ? (
          <span className="flex items-center gap-1 text-xs font-medium text-accent-ink">
            <Check size={13} />
            {achievement.unlockedAt
              ? t("Unlocked {{date}}", {
                  date: new Date(achievement.unlockedAt).toLocaleDateString(
                    appLocale(),
                  ),
                })
              : t("Unlocked, date unknown")}
          </span>
        ) : concealed ? (
          <Button variant="ghost" icon={Eye} onClick={onReveal}>
            {t("Show")}
          </Button>
        ) : null}
        {achievement.gamerscore !== undefined ? (
          <span className="font-mono text-xs text-text-muted">
            {t("{{score}} G", { score: number(achievement.gamerscore) })}
          </span>
        ) : null}
        {achievement.xp !== undefined ? (
          <span className="font-mono text-xs text-text-muted">
            {t("{{xp}} XP", { xp: number(achievement.xp) })}
          </span>
        ) : null}
        {achievement.globalPercent !== undefined ? (
          <span className="text-xs text-text-faint">
            {t("{{percent}} of players", {
              percent: percent(achievement.globalPercent, 1),
            })}
          </span>
        ) : null}
      </div>
    </li>
  );
}
