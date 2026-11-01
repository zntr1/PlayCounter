import { useEffect, useRef, useState } from "react";
import { useLibraryImportRequest } from "../../library/importRequest";
import { importProfile } from "../../library/importProfiles";
import {
  cancelImport,
  chooseImportScope,
  copyImportSignInLink,
  detectImportLauncher,
  leaveImportView,
  openImportSession,
  resumeImportView,
  signOutImportLogin,
  startImportScan,
  useImportSession,
} from "../../library/importSession";
import { useKeptLogin } from "../../library/keptLogins";
import { useLoginHealth } from "../../library/loginHealth";
import { useAppStore } from "../../store";
import { BattleNetPlaytimeNotice } from "./BattleNetPlaytimeNotice";
import { ImportDone } from "./ImportDone";
import { ImportLoading } from "./ImportLoading";
import { ImportReview } from "./ImportReview";
import { importStageText, launcherDetectingText } from "./importTexts";
import { LauncherCard } from "./LauncherCard";

/* One importer for every launcher: the launcher card, the loader, the review
   and the done screen. Which launcher it is only changes the data. */
export function ImportLibraryView() {
  const activeView = useAppStore((state) => state.activeView);
  const providerId = useAppStore((state) => state.libraryImportProvider);
  const noticeSeen = useAppStore((state) => state.battleNetPlaytimeNoticeSeen);
  const importRequest = useLibraryImportRequest((state) => state.request);
  const stored = useImportSession((state) => state.session);
  const session = stored.providerId === providerId ? stored : null;
  const profile = importProfile(providerId);
  const keptLogin = useKeptLogin(profile.login);
  const health = useLoginHealth((state) =>
    profile.login ? state.checks[profile.login] : undefined,
  );
  const [pendingScan, setPendingScan] = useState<{
    copySignInLink: boolean;
  } | null>(null);
  const [changing, setChanging] = useState(false);
  const previousView = useRef(activeView);

  useEffect(() => {
    openImportSession(providerId);
    setPendingScan(null);
    setChanging(false);
  }, [providerId]);

  useEffect(() => {
    if (session?.phase === "detecting") void detectImportLauncher();
  }, [session?.id, session?.phase]);

  useEffect(() => {
    if (previousView.current === "import" && activeView !== "import") {
      leaveImportView();
      setPendingScan(null);
      useLibraryImportRequest.setState({ request: null });
    }
    if (activeView === "import") resumeImportView();
    previousView.current = activeView;
  }, [activeView]);

  useEffect(() => () => leaveImportView(), []);

  function requestScan(copySignInLink = false) {
    if (
      profile.playtimeNotice &&
      !useAppStore.getState().battleNetPlaytimeNoticeSeen
    ) {
      setPendingScan({ copySignInLink });
      return;
    }
    setChanging(false);
    void startImportScan({ copySignInLink });
  }

  // "Import" on another page: start once the launcher is found. Queued after
  // the commit, so a remount in development does not cancel it.
  useEffect(() => {
    if (
      activeView !== "import" ||
      !session ||
      importRequest?.provider !== providerId ||
      !session.status?.available ||
      session.accountId === null ||
      (session.phase !== "ready" && session.phase !== "done")
    )
      return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      useLibraryImportRequest.setState({ request: null });
      chooseImportScope(
        importRequest.mode === "installed" ? "installed" : "account",
      );
      requestScan();
    });
    return () => {
      cancelled = true;
    };
    // requestScan only reads the profile and the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeView,
    importRequest,
    providerId,
    session?.status,
    session?.accountId,
    session?.phase,
  ]);

  const notice = pendingScan ? (
    <BattleNetPlaytimeNotice
      onCancel={() => setPendingScan(null)}
      onConfirm={() => {
        const scan = pendingScan;
        useAppStore.getState().markBattleNetPlaytimeNoticeSeen();
        setPendingScan(null);
        setChanging(false);
        void startImportScan(scan);
      }}
    />
  ) : null;

  if (!session || session.phase === "detecting")
    return <ImportLoading label={launcherDetectingText(providerId)} />;
  if (session.phase === "scanning")
    return (
      <ImportLoading
        label={importStageText(
          providerId,
          session.stage,
          session.waitingForServer,
        )}
        onCancel={cancelImport}
        onCopySignInLink={
          profile.copySignInLink &&
          session.stage === "signin" &&
          session.authorizeUrl
            ? () => void copyImportSignInLink()
            : undefined
        }
      />
    );

  const signOut = () => void signOutImportLogin();
  if (!session.scan || changing)
    return (
      <>
        {notice}
        <LauncherCard
          session={session}
          keptLogin={keptLogin}
          health={health}
          battleNetNoticeSeen={noticeSeen}
          onFind={() => requestScan()}
          onCopySignInLink={() => requestScan(true)}
          onSignOut={signOut}
          onBack={session.scan ? () => setChanging(false) : undefined}
        />
      </>
    );
  if (session.phase === "done" && session.lastImport)
    return <ImportDone session={session} />;
  return (
    <>
      {notice}
      <ImportReview
        session={session}
        keptLogin={keptLogin}
        health={health}
        onScanAgain={() => requestScan()}
        onChange={() => setChanging(true)}
        onSignOut={signOut}
      />
    </>
  );
}

export default ImportLibraryView;
