import { ChevronsUp } from "lucide-react";
import { useState } from "react";
import { commitLibraryImports } from "../library/commit";
import { checkLibraryImportForMatches } from "../library/recheck";
import type { LibraryImportCommit } from "../library/types";
import { useAppStore, useIsOffline } from "../store";
import {
  acceptCommunityUpgrade,
  convertLocalSuggestionToCommunity,
} from "../tracker";
import type { LevelUpOffer } from "./levelUpOffers";
import { providerTabConfig } from "./libraryProviderTabs";
import { Button, Modal } from "./primitives";

export type LevelUpResult = { applied: number; missed: string[] };

export function LevelUpAllDialog({
  offers,
  onCancel,
  onDone,
}: {
  offers: readonly LevelUpOffer[];
  onCancel: () => void;
  onDone: (result: LevelUpResult) => void;
}) {
  const apiEndpoint = useAppStore((state) => state.settings.apiEndpoint);
  const ignoredProcesses = useAppStore((state) => state.ignoredProcesses);
  const isOffline = useIsOffline();
  // Unticked rows, so an offer that shows up while the dialog is open starts
  // ticked like the rest.
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  // Launcher games need a fresh lookup before their files are linked.
  const available = (offer: LevelUpOffer) =>
    offer.kind !== "tracking" || !isOffline;
  const picked = offers.filter(
    (offer) => available(offer) && !skipped.has(offer.key),
  );

  function toggle(key: string, checked: boolean) {
    setSkipped((current) => {
      const next = new Set(current);
      if (checked) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function apply() {
    if (applying || picked.length === 0) return;
    setApplying(true);
    setError("");
    let applied = 0;
    const missed: string[] = [];
    const tracking: Extract<LevelUpOffer, { kind: "tracking" }>[] = [];
    for (const offer of picked) {
      if (offer.kind === "approved") {
        convertLocalSuggestionToCommunity(offer.exeName);
        applied += 1;
      } else if (offer.kind === "match") {
        acceptCommunityUpgrade(offer.exeName);
        applied += 1;
      } else {
        tracking.push(offer);
      }
    }

    const commits: LibraryImportCommit[] = [];
    const queue = [...tracking];
    // Three at a time, like the startup check, so a big library does not
    // flood the API.
    await Promise.all(
      Array.from({ length: Math.min(3, queue.length) }, async () => {
        while (queue.length > 0) {
          const offer = queue.shift()!;
          try {
            const result = await checkLibraryImportForMatches({
              apiEndpoint,
              entry: offer.entry,
              install: offer.install,
              ignoredProcesses,
            });
            if (result.kind === "found") commits.push(result.commit);
            else missed.push(offer.gameName);
          } catch {
            missed.push(offer.gameName);
          }
        }
      }),
    );
    if (commits.length > 0) {
      try {
        commitLibraryImports(commits);
        applied += commits.length;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setApplying(false);
        return;
      }
    }
    onDone({ applied, missed });
  }

  return (
    <Modal
      size="md"
      labelId="level-up-all-dialog-title"
      eyebrow="My Games"
      title="Level up games"
      subtitle={`${offers.length} ${offers.length === 1 ? "game" : "games"} can level up`}
      icon={ChevronsUp}
      onClose={onCancel}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2 [&>button]:whitespace-nowrap">
          <Button
            variant="primary"
            icon={ChevronsUp}
            loading={applying}
            disabled={picked.length === 0}
            onClick={() => void apply()}
          >
            {picked.length === 1
              ? "Level up 1 game"
              : `Level up ${picked.length} games`}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={applying}>
            Cancel
          </Button>
        </div>
      }
    >
      <p className="text-sm leading-6 text-text-muted">
        Untick anything that looks wrong. Playtime you already tracked comes
        along.
      </p>
      <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
        {offers.map((offer) => (
          <li key={offer.key}>
            <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors hover:bg-surface-hover/50">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--color-accent))]"
                checked={available(offer) && !skipped.has(offer.key)}
                disabled={applying || !available(offer)}
                onChange={(event) => toggle(offer.key, event.target.checked)}
                aria-label={`Level up ${offer.gameName}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-text">
                  {offer.kind === "match"
                    ? `${offer.gameName} → ${offer.matchName}`
                    : offer.gameName}
                </span>
                <span className="block truncate text-xs text-text-muted">
                  {offerDetail(offer, isOffline)}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}
    </Modal>
  );
}

function offerDetail(offer: LevelUpOffer, isOffline: boolean) {
  if (offer.kind === "approved") {
    return `Your suggestion was approved · ${offer.exeName} → community`;
  }
  if (offer.kind === "match") {
    const source = offer.matchSource === "igdb" ? "IGDB" : "the community";
    return `Custom → found in ${source} · ${offer.exeName}`;
  }
  const provider =
    providerTabConfig(offer.entry.provider)?.label ?? offer.entry.provider;
  if (isOffline) return `${provider} · needs a connection`;
  return `${provider} · start tracking ${offer.exeNames.join(", ")}`;
}
