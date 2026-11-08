import {
  usePersonalLibraryState,
  useLibraryPractice,
} from "./PersonalLibraryContext";
import {
  BookOpen,
  CircleDot,
  FolderHeart,
  Medal,
  Star,
  StickyNote,
  X,
} from "lucide-react";
import { GAME_TIERS, gameStatusLabel, type GameTier } from "../personalLibrary";
import { type GameIdentityRef } from "../store";
import {
  ContextMenuHeading,
  ContextMenuItem,
  ContextMenuSubmenu,
} from "./primitives";
import { GAME_STATUS_LIST, TIER_TONES } from "./journalStyles";
import { GameStatusIcon } from "./GameStatusIcon";
import { useGameJournal } from "./useGameJournal";
import { getT } from "../i18n";
import { Trans } from "react-i18next";

const t = getT("dialogs");

export function GameJournalMenu({
  game,
  onClose,
  heading = true,
}: {
  game: GameIdentityRef;
  onClose: () => void;
  heading?: boolean;
}) {
  const practice = useLibraryPractice();
  const journal = useGameJournal(game);
  const open = usePersonalLibraryState((s) => s.openGameJournal);
  const update = usePersonalLibraryState((s) => s.updateGameJournal);
  const shelves = usePersonalLibraryState((s) => s.personalShelves);
  const showShelves = usePersonalLibraryState(
    (s) => s.settings.libraryShowShelves !== false,
  );
  // Filters fill their own shelves, and Favorites has its own item above.
  const handShelves = shelves.filter((shelf) => !shelf.filters);
  return (
    <>
      {heading ? (
        <ContextMenuHeading>{t("My library")}</ContextMenuHeading>
      ) : null}
      <ContextMenuItem
        dataTour={practice ? "demo-menu-favorite" : undefined}
        icon={Star}
        // A favourite shows the cover's yellow star.
        mark={
          journal.favorite ? (
            <Star
              size={14}
              aria-hidden="true"
              fill="currentColor"
              className="shrink-0 text-favorite"
            />
          ) : undefined
        }
        onClick={() => {
          onClose();
          update(game, { favorite: !journal.favorite });
        }}
      >
        {journal.favorite ? t("Remove from Favorites") : t("Add to Favorites")}
      </ContextMenuItem>
      <ContextMenuItem
        dataTour={practice ? "demo-menu-journal" : undefined}
        icon={BookOpen}
        onClick={() => {
          onClose();
          open({ game, tab: "note" });
        }}
      >
        {t("Journal")}
      </ContextMenuItem>
      <ContextMenuSubmenu
        label={t("Status")}
        icon={CircleDot}
        mark={
          journal.status ? <GameStatusIcon status={journal.status} /> : undefined
        }
      >
        {GAME_STATUS_LIST.map((status) => (
          <ContextMenuItem
            key={status}
            selected={journal.status === status}
            onClick={() => {
              onClose();
              update(game, { status });
            }}
          >
            <GameStatusIcon
              status={status}
              className="mr-2 inline-block align-middle"
            />
            {gameStatusLabel(status)}
          </ContextMenuItem>
        ))}
        {journal.status ? (
          <ContextMenuItem
            icon={X}
            onClick={() => {
              onClose();
              update(game, { status: null });
            }}
          >
            {t("Clear status")}
          </ContextMenuItem>
        ) : null}
      </ContextMenuSubmenu>
      <ContextMenuSubmenu
        label={t("Tier")}
        icon={Medal}
        mark={journal.tier ? <TierMark tier={journal.tier} /> : undefined}
        dataTour={practice ? "demo-menu-tier" : undefined}
        menuDataTour={practice ? "demo-tier-menu" : undefined}
      >
        <GameTierMenuItems game={game} onClose={onClose} />
      </ContextMenuSubmenu>
      {showShelves && handShelves.length ? (
        // A game can sit on several shelves: a pick adds or removes one.
        <ContextMenuSubmenu
          label={t("Shelves")}
          icon={FolderHeart}
          menuDataTour={practice ? "demo-shelf-menu" : undefined}
        >
          {handShelves.map((shelf) => {
            const member = journal.shelfIds.includes(shelf.id);
            return (
              <ContextMenuItem
                key={shelf.id}
                selected={member}
                onClick={() => {
                  onClose();
                  update(game, {
                    shelfIds: member
                      ? journal.shelfIds.filter((id) => id !== shelf.id)
                      : [...journal.shelfIds, shelf.id],
                  });
                }}
              >
                {shelf.name}
              </ContextMenuItem>
            );
          })}
        </ContextMenuSubmenu>
      ) : null}
    </>
  );
}

/** The picked tier in its cover colour, where a menu row draws its icon. CSS
 *  draws the letter, so the row's text stays "Tier" and typing T finds it. */
function TierMark({ tier }: { tier: GameTier }) {
  return (
    <span
      aria-hidden="true"
      data-tier={tier}
      className={`w-3.5 shrink-0 text-center font-mono text-[13px] font-bold leading-none before:content-[attr(data-tier)] ${TIER_TONES[tier]}`}
    />
  );
}

/** The ends say which way the scale runs; the letters between need no words.
 *  The letter wears its cover colour, the words keep the row's. */
function tierMenuLabel(tier: GameTier) {
  const letter = <span className={TIER_TONES[tier]} />;
  if (tier === "S")
    return (
      <Trans
        t={t}
        i18nKey="<tier>S</tier> – Best"
        components={{ tier: letter }}
      />
    );
  if (tier === "F")
    return (
      <Trans
        t={t}
        i18nKey="<tier>F</tier> – Worst"
        components={{ tier: letter }}
      />
    );
  return <span className={TIER_TONES[tier]}>{tier}</span>;
}

/** S to F, the current one checked, and Clear once there is one. Shared by
 *  the card menu and the tier tile in game details. */
export function GameTierMenuItems({
  game,
  onClose,
}: {
  game: GameIdentityRef;
  onClose: () => void;
}) {
  const practice = useLibraryPractice();
  const journal = useGameJournal(game);
  const setTier = usePersonalLibraryState((s) => s.setGameTier);
  return (
    <>
      {GAME_TIERS.map((tier) => (
        <ContextMenuItem
          key={tier}
          dataTour={practice ? `demo-tier-${tier}` : undefined}
          selected={journal.tier === tier}
          onClick={() => {
            onClose();
            setTier(game, tier);
          }}
        >
          {tierMenuLabel(tier)}
        </ContextMenuItem>
      ))}
      {journal.tier ? (
        <ContextMenuItem
          icon={X}
          onClick={() => {
            onClose();
            setTier(game, null);
          }}
        >
          {t("Clear tier")}
        </ContextMenuItem>
      ) : null}
    </>
  );
}

// No text colour here: each badge sets its own. Tailwind orders same-kind
// classes alphabetically, so a shared "text-white" would beat "text-amber-300"
// and the tier colours whatever their place in the class list.
const badgeShell =
  "grid h-7 w-7 place-items-center rounded-full border border-white/20 bg-black/75 shadow-md";

/** What the journal knows about a game, read from its cover: a note to pick up,
 *  a favorite, your tier, and where the game stands. Nothing else earns cover
 *  space. */
export function GameJournalBadges({
  game,
  compact = false,
}: {
  game: GameIdentityRef;
  compact?: boolean;
}) {
  const practice = useLibraryPractice();
  const journal = useGameJournal(game);
  const open = usePersonalLibraryState((s) => s.openGameJournal);
  const showStatus = usePersonalLibraryState(
    (s) => s.settings.libraryShowStatusBadges !== false,
  );
  const showNotes = usePersonalLibraryState(
    (s) => s.settings.libraryShowNoteBadges !== false,
  );
  const showTiers = usePersonalLibraryState(
    (s) => s.settings.libraryShowTierBadges !== false,
  );
  const status = showStatus ? journal.status : null;
  const statusLabel = status
    ? t("Status: {{status}}", { status: gameStatusLabel(status) })
    : undefined;
  const other = journal.playthroughs.find((p) => p.note);
  const hasNote = showNotes && Boolean(journal.note || other);
  const tier = showTiers ? journal.tier : undefined;
  const tierLabel = tier ? t("Tier: {{tier}}", { tier }) : undefined;
  const notePlaythroughId =
    journal.playthroughs.find(
      (p) => p.id === journal.activePlaythroughId && p.note,
    )?.id ?? (journal.note ? null : other?.id);
  if (!hasNote && !journal.favorite && !tier && !status) return null;
  return (
    <div
      className={`game-card-journal-badges status-on-dark absolute ${compact ? "left-1 top-1" : "bottom-2 left-2"} z-40 flex items-center gap-1`}
    >
      {status ? (
        // First, so it sits in the same spot on every card. The icon alone,
        // like the other badges: a name would not fit beside them in every
        // language. The name is in the tooltip.
        <span
          aria-label={statusLabel}
          title={statusLabel}
          className={`${badgeShell} ${compact ? "h-6 w-6" : ""}`}
        >
          <GameStatusIcon status={status} size={compact ? 11 : 13} />
        </span>
      ) : null}
      {hasNote ? (
        <button
          type="button"
          aria-label={t("Read note for {{game}}", {
            game: game.gameName ?? t("game"),
          })}
          title={t("Read note")}
          onClick={(event) => {
            event.stopPropagation();
            open({ game, tab: "note", playthroughId: notePlaythroughId });
          }}
          className={`${badgeShell} text-white transition hover:bg-accent hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${compact ? "h-6 w-6" : ""}`}
        >
          <StickyNote size={compact ? 12 : 14} />
        </button>
      ) : null}
      {journal.favorite ? (
        <span
          aria-label={t("Favorite")}
          title={t("Favorite")}
          className={`${badgeShell} text-favorite ${compact ? "h-6 w-6" : ""}`}
        >
          <Star size={compact ? 11 : 13} fill="currentColor" />
        </span>
      ) : null}
      {tier ? (
        <span
          aria-label={tierLabel}
          title={tierLabel}
          className={`${badgeShell} font-mono font-bold ${TIER_TONES[tier]} ${compact ? "h-6 w-6 text-[11px]" : "text-[13px]"}`}
        >
          {tier}
        </span>
      ) : null}
    </div>
  );
}
