import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import { create } from "zustand";
import { getT } from "../i18n";
import { currentPlatform } from "../platform";
import { useAppStore } from "../store";
import {
  refreshKeptLogins,
  useKeptLogins,
  type KeptLoginService,
} from "./keptLogins";

export const LOGIN_CHECK_INTERVAL_MS = 30 * 60_000;
const RETRY_INTERVAL_MS = 5 * 60_000;
const t = getT("accounts");
const services: KeptLoginService[] = ["xbox", "epic", "battlenet"];
const labels = { xbox: "Xbox", epic: "Epic Games", battlenet: "Battle.net" };

export type LoginHealth = {
  status: "checking" | "valid" | "needsSignIn" | "unavailable";
  checkedAt: number | null;
  lastSuccessAt: number | null;
};

export const useLoginHealth = create<{
  checks: Partial<Record<KeptLoginService, LoginHealth>>;
}>(() => ({ checks: {} }));
const versions: Record<KeptLoginService, number> = {
  xbox: 0,
  epic: 0,
  battlenet: 0,
};
const operationRevisions: Record<KeptLoginService, number> = {
  xbox: 0,
  epic: 0,
  battlenet: 0,
};
const inFlight = new Map<KeptLoginService, Promise<void>>();
const previousChecks = new Map<KeptLoginService, LoginHealth | undefined>();
const notifiedExpired = new Set<KeptLoginService>();

export function getLoginHealth(service: KeptLoginService) {
  return useLoginHealth.getState().checks[service];
}

/** The badge on Launcher accounts: sign-ins that ran out, leaving out the
 *  launchers whose sign-in warnings the player turned off. */
export function useLoginWarningCount() {
  const off = useAppStore((state) => state.settings.loginWarningsOff);
  return useLoginHealth(
    (state) =>
      Object.entries(state.checks).filter(
        ([service, check]) =>
          check.status === "needsSignIn" && !off?.includes(service),
      ).length,
  );
}

function putHealth(service: KeptLoginService, value?: LoginHealth) {
  useLoginHealth.setState(({ checks }) => {
    const next = { ...checks };
    if (value) next[service] = value;
    else delete next[service];
    return { checks: next };
  });
}

/** Foreground results supersede any older background request. */
export function recordLoginHealth(
  service: KeptLoginService,
  status: Exclude<LoginHealth["status"], "checking">,
) {
  versions[service]++;
  const previous = getLoginHealth(service);
  if (
    status === "unavailable" &&
    (previous?.status === "needsSignIn" ||
      (previous?.status === "checking" &&
        previousChecks.get(service)?.status === "needsSignIn"))
  )
    status = "needsSignIn";
  const now = Date.now();
  putHealth(service, {
    status,
    checkedAt: now,
    lastSuccessAt: status === "valid" ? now : (previous?.lastSuccessAt ?? null),
  });
  if (status === "valid") notifiedExpired.delete(service);
  if (status === "needsSignIn" && !notifiedExpired.has(service)) {
    notifiedExpired.add(service);
    if (!useAppStore.getState().settings.loginWarningsOff?.includes(service))
      useAppStore.getState().addToast({
        tone: "info",
        title: t("{{launcher}} needs you to sign in again.", {
          launcher: labels[service],
        }),
        detail: t("Open Launcher accounts to reconnect."),
      });
  }
}

export function clearLoginHealth(service: KeptLoginService) {
  versions[service]++;
  operationRevisions[service]++;
  notifiedExpired.delete(service);
  putHealth(service);
}

/** Called before explicit login/logout, so an old check cannot update that account. */
export function supersedeLoginCheck(service: KeptLoginService) {
  versions[service]++;
  if (getLoginHealth(service)?.status === "checking") {
    putHealth(service, previousChecks.get(service));
  }
}

export function beginLoginAccountChange(service: KeptLoginService) {
  operationRevisions[service]++;
  supersedeLoginCheck(service);
}

export function getLoginOperationRevision(service: KeptLoginService) {
  return operationRevisions[service];
}

export function checkLauncherLogin(
  service: KeptLoginService,
  apiEndpoint: string,
  minimumAgeMs = 0,
): Promise<void> {
  if (currentPlatform() !== "windows") return Promise.resolve();
  const pending = inFlight.get(service);
  if (pending) return pending;
  if (
    !useKeptLogins.getState().logins.some((login) => login.service === service)
  )
    return Promise.resolve();
  const previous = getLoginHealth(service);
  if (
    previous?.checkedAt != null &&
    Date.now() - previous.checkedAt < minimumAgeMs
  )
    return Promise.resolve();
  const version = versions[service];
  previousChecks.set(service, previous);
  putHealth(service, {
    status: "checking",
    checkedAt: previous?.checkedAt ?? null,
    lastSuccessAt: previous?.lastSuccessAt ?? null,
  });
  const run = (async () => {
    let status: unknown;
    try {
      status =
        navigator.onLine === false
          ? "unavailable"
          : await invoke("logins_check", { service, apiEndpoint });
    } catch {
      status = "unavailable";
    }
    if (versions[service] !== version) return;
    if (status === "busy") {
      putHealth(service, previous);
      return;
    }
    if (status === "signedOut") {
      const saved = await refreshKeptLogins();
      if (versions[service] !== version) return;
      if (saved.some((login) => login.service === service))
        recordLoginHealth(service, "needsSignIn");
      else clearLoginHealth(service);
      return;
    } else {
      recordLoginHealth(
        service,
        status === "valid" || status === "needsSignIn" ? status : "unavailable",
      );
    }
    await refreshKeptLogins();
  })().finally(() => {
    if (inFlight.get(service) === run) {
      inFlight.delete(service);
      previousChecks.delete(service);
    }
  });
  inFlight.set(service, run);
  return run;
}

export async function checkLauncherLogins(
  apiEndpoint: string,
  minimumAgeMs = 60_000,
) {
  if (currentPlatform() !== "windows") return;
  await refreshKeptLogins();
  // Check one at a time: Battle.net can need a hidden browser, while Xbox and
  // Epic can rotate tokens. Avoid a burst of requests on startup/resume.
  for (const service of services) {
    if (getLoginHealth(service)?.status === "needsSignIn") continue;
    await checkLauncherLogin(service, apiEndpoint, minimumAgeMs);
  }
}

/** App-wide checks run while the app is open, including when parked in tray. */
export function startLauncherAccountChecks(apiEndpoint: string) {
  if (currentPlatform() !== "windows") return () => {};
  let disposed = false;
  let running = false;
  const run = async (minimumAgeMs?: number) => {
    if (disposed || running) return;
    running = true;
    try {
      await refreshKeptLogins();
      for (const service of services) {
        if (disposed) break;
        const health = getLoginHealth(service);
        if (health?.status === "needsSignIn") continue;
        await checkLauncherLogin(
          service,
          apiEndpoint,
          minimumAgeMs ??
            (health?.status === "unavailable"
              ? RETRY_INTERVAL_MS
              : LOGIN_CHECK_INTERVAL_MS),
        );
      }
    } finally {
      running = false;
    }
  };
  const startup = globalThis.setTimeout(() => {
    void run();
  }, 5_000);
  const timer = globalThis.setInterval(() => {
    void run();
  }, 60_000);
  const onResume = () => {
    void run(RETRY_INTERVAL_MS);
  };
  const onOnline = () => {
    void run(0);
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") onResume();
  };
  window.addEventListener("focus", onResume);
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    disposed = true;
    globalThis.clearTimeout(startup);
    globalThis.clearInterval(timer);
    window.removeEventListener("focus", onResume);
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
    for (const service of services) supersedeLoginCheck(service);
  };
}

export function useLauncherAccountChecks(apiEndpoint: string) {
  const previousEndpoint = useRef(apiEndpoint);
  useEffect(() => {
    if (previousEndpoint.current !== apiEndpoint) clearLoginHealth("xbox");
    previousEndpoint.current = apiEndpoint;
    return startLauncherAccountChecks(apiEndpoint);
  }, [apiEndpoint]);
}
