import type { Session } from "@playcounter/shared";
import clsx from "clsx";
import {
  Equal,
  Merge,
  Pencil,
  Plus,
  Scissors,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useState, type CSSProperties, type ReactNode } from "react";
import { appLocale, getT } from "../../../i18n";
import { useCoverUrl } from "../../../pickedCovers";
import {
  breakAround,
  changedFields,
  combineSessions,
  fillSessionTimes,
  sessionTimes,
  splitKnobRange,
  splitSession,
  UNCHANGED_FIELDS,
  type ChangedFields,
  type SessionNeighbours,
  type SessionTimeField,
  type SessionTimes,
  type SessionTimeValues,
} from "../../../sessionEdits";
import { formatDuration } from "../../components";
import { localDateTimeValue } from "../../dateTimeInput";
import { GameCover } from "../../GameCover";
import { Button, Input, Modal, Pill, type ModalSize } from "../../primitives";

const t = getT("history");

const minuteMs = 60_000;

type DialogProps = {
  session: Session;
  gameName: string;
  coverUrl: string;
  showDurationDays: boolean;
  onCancel: () => void;
};

function parseLocal(value: string) {
  return value ? new Date(value).getTime() : Number.NaN;
}

function wholeNumber(value: string) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function formatTime(ms: number) {
  return new Date(ms).toLocaleTimeString(appLocale(), {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Start and end time only. Each box is about one session, so "next day"
// would only make the line wrap.
function rangeOf(session: Session) {
  const { startMs, endMs } = sessionTimes(session);
  return `${formatTime(startMs)} – ${formatTime(endMs)}`;
}

/* Same look as the delete box: the game in the header, its cover next to
   what can be changed. */
function SessionChangeModal({
  labelId,
  title,
  icon,
  gameName,
  onCancel,
  formId,
  submitLabel,
  submitIcon,
  canSubmit,
  size = "sm",
  children,
}: {
  labelId: string;
  title: string;
  icon: LucideIcon;
  gameName: string;
  onCancel: () => void;
  formId: string;
  submitLabel: string;
  submitIcon: LucideIcon;
  canSubmit: boolean;
  size?: ModalSize;
  children: ReactNode;
}) {
  return (
    <Modal
      size={size}
      labelId={labelId}
      eyebrow={t("My History")}
      title={title}
      subtitle={gameName}
      icon={icon}
      onClose={onCancel}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            icon={submitIcon}
            disabled={!canSubmit}
          >
            {submitLabel}
          </Button>
        </div>
      }
    >
      {children}
    </Modal>
  );
}

function SessionCover({
  session,
  gameName,
  coverUrl,
}: {
  session: Session;
  gameName: string;
  coverUrl: string;
}) {
  const shownCover = useCoverUrl(session, coverUrl);
  return shownCover ? (
    <GameCover
      src={shownCover}
      alt={t("{{gameName}} cover", { gameName })}
      className="h-[88px] w-16 shrink-0 rounded-md object-cover shadow-sm"
    />
  ) : (
    <div
      aria-hidden="true"
      className="grid h-[88px] w-16 shrink-0 place-items-center rounded-md border border-border bg-surface text-text-faint shadow-sm"
    >
      <Timer size={22} />
    </div>
  );
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <p aria-live="polite" className="mt-3 text-xs leading-5 text-danger">
      {children}
    </p>
  );
}

function DateTimeField({
  label,
  value,
  max,
  autoFocus,
  onChange,
}: {
  label: string;
  value: string;
  max?: string;
  autoFocus?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-medium text-text-muted">
      {label}
      <Input
        type="datetime-local"
        value={value}
        max={max}
        data-autofocus={autoFocus ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="w-full"
      />
    </label>
  );
}

type EditForm = {
  start: string;
  end: string;
  hours: string;
  minutes: string;
  changed: ChangedFields;
  touched: boolean;
};

function formValues(form: EditForm): SessionTimeValues {
  return {
    startMs: parseLocal(form.start),
    endMs: parseLocal(form.end),
    lengthSeconds:
      (wholeNumber(form.hours) * 60 + wholeNumber(form.minutes)) * 60,
  };
}

function lengthTexts(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0)
    return { hours: "", minutes: "" };
  const minutes = Math.round(seconds / 60);
  return {
    hours: String(Math.floor(minutes / 60)),
    minutes: String(minutes % 60),
  };
}

/** Started, Ended and Length: the two typed last win, the third fills in. */
export function EditSessionDialog({
  session,
  gameName,
  coverUrl,
  onCancel,
  overlapFor,
  onConfirm,
}: DialogProps & {
  overlapFor: (times: SessionTimes) => Session | undefined;
  onConfirm: (times: SessionTimes) => void;
}) {
  const [form, setForm] = useState<EditForm>(() => {
    const { startMs, endMs } = sessionTimes(session);
    const start = localDateTimeValue(new Date(startMs));
    const end = localDateTimeValue(new Date(endMs));
    return {
      start,
      end,
      ...lengthTexts((parseLocal(end) - parseLocal(start)) / 1000),
      changed: UNCHANGED_FIELDS,
      touched: false,
    };
  });

  const update = (field: SessionTimeField, patch: Partial<EditForm>) =>
    setForm((current) => {
      const next: EditForm = {
        ...current,
        ...patch,
        changed: changedFields(current.changed, field),
        touched: true,
      };
      const filled = fillSessionTimes(next.changed, formValues(next));
      if (!next.changed.includes("length"))
        return { ...next, ...lengthTexts(filled.lengthSeconds) };
      if (!next.changed.includes("start") && Number.isFinite(filled.startMs))
        return { ...next, start: localDateTimeValue(new Date(filled.startMs)) };
      if (!next.changed.includes("end") && Number.isFinite(filled.endMs))
        return { ...next, end: localDateTimeValue(new Date(filled.endMs)) };
      return next;
    });

  const { startMs, endMs, lengthSeconds } = fillSessionTimes(
    form.changed,
    formValues(form),
  );
  const times = { startMs, endMs };
  const overlap =
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
      ? overlapFor(times)
      : undefined;
  const problem = !Number.isFinite(startMs + endMs)
    ? t("Enter when the session started and ended.")
    : endMs <= startMs
      ? t("The end must be after the start.")
      : endMs > Date.now()
        ? t("The end can't be in the future.")
        : lengthSeconds < 60
          ? t("A session needs at least one minute.")
          : overlap
            ? t(
                "This overlaps your session from {{time}}. Combine them instead.",
                {
                  time: overlapStart(sessionTimes(overlap).startMs, startMs),
                },
              )
            : null;
  const canSubmit = form.touched && problem === null;

  return (
    <SessionChangeModal
      labelId="edit-history-session-title"
      title={t("Edit session")}
      icon={Pencil}
      gameName={gameName}
      onCancel={onCancel}
      formId="edit-history-session-form"
      submitLabel={t("Save")}
      submitIcon={Pencil}
      canSubmit={canSubmit}
    >
      <form
        id="edit-history-session-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) onConfirm(times);
        }}
      >
        <p className="text-sm leading-6 text-text-muted">
          {t("Change any two of the three. The third one fills in.")}
        </p>
        <div className="mt-4 flex items-start gap-4 rounded-lg border border-border bg-surface-hover p-4">
          <SessionCover
            session={session}
            gameName={gameName}
            coverUrl={coverUrl}
          />
          <div className="grid min-w-0 flex-1 gap-3">
            <DateTimeField
              label={t("Started")}
              value={form.start}
              autoFocus
              onChange={(start) => update("start", { start })}
            />
            <DateTimeField
              label={t("Ended")}
              value={form.end}
              max={localDateTimeValue(new Date())}
              onChange={(end) => update("end", { end })}
            />
            <fieldset className="grid gap-1.5">
              <legend className="mb-1.5 text-xs font-medium text-text-muted">
                {t("Length")}
              </legend>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1 text-[11px] text-text-faint">
                  {t("Hours")}
                  <Input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={form.hours}
                    placeholder="0"
                    onChange={(event) =>
                      update("length", { hours: event.target.value })
                    }
                  />
                </label>
                <label className="grid gap-1 text-[11px] text-text-faint">
                  {t("Minutes")}
                  <Input
                    type="number"
                    min={0}
                    max={59}
                    inputMode="numeric"
                    value={form.minutes}
                    placeholder="0"
                    onChange={(event) =>
                      update("length", { minutes: event.target.value })
                    }
                  />
                </label>
              </div>
            </fieldset>
          </div>
        </div>
        {problem ? <Problem>{problem}</Problem> : null}
      </form>
    </SessionChangeModal>
  );
}

// The overlapped session's start: its time, plus the date when it is not
// the day the edited session starts.
function overlapStart(ms: number, referenceMs: number) {
  const date = new Date(ms);
  return date.toDateString() === new Date(referenceMs).toDateString()
    ? formatTime(ms)
    : `${date.toLocaleDateString(appLocale())} ${formatTime(ms)}`;
}

const breakPresets = [0, 10, 30, 60];

function breakLabel(minutes: number) {
  if (minutes === 0) return t("No break");
  return minutes % 60 === 0
    ? t("{{hours}}h", { hours: minutes / 60 })
    : formatDuration(minutes * 60);
}

/** A slider for where the session splits. A break, centred on the knob, is
 *  removed from the playtime. */
export function SplitSessionDialog({
  session,
  gameName,
  coverUrl,
  showDurationDays,
  onCancel,
  onConfirm,
}: DialogProps & { onConfirm: (pause: SessionTimes) => void }) {
  const times = sessionTimes(session);
  const sliderMin = Math.ceil(times.startMs / minuteMs);
  const sliderMax = Math.floor(times.endMs / minuteMs);
  const [knob, setKnob] = useState(() =>
    Math.round((times.startMs + times.endMs) / 2 / minuteMs),
  );
  const [preset, setPreset] = useState<number | "custom">(0);
  const [custom, setCustom] = useState({ hours: "", minutes: "" });
  const breakMinutes =
    preset === "custom"
      ? wholeNumber(custom.hours) * 60 + wholeNumber(custom.minutes)
      : preset;
  const range = splitKnobRange(times, breakMinutes);
  // A longer break pushes the knob inward; a shorter one lets it go back.
  const knobAt = range ? Math.min(Math.max(knob, range.min), range.max) : knob;
  const pause = breakAround(knobAt, breakMinutes);
  const parts = range
    ? splitSession([session], session.id, pause, -1).reverse()
    : [];
  const canSubmit = parts.length === 2;
  const problem = canSubmit
    ? null
    : breakMinutes > 0
      ? t("The break is too long for this session.")
      : t("Each part needs at least one minute.");
  const shareOf = (ms: number) =>
    Math.min(
      1,
      Math.max(
        0,
        (ms / minuteMs - sliderMin) / Math.max(1, sliderMax - sliderMin),
      ),
    );
  // Positions on the thumb's path, which is 9px short of either end.
  const onTrack = (ms: number) => `calc(9px + (100% - 18px) * ${shareOf(ms)})`;
  // Over the knob: where it splits, or the break around it.
  const knobLabel =
    breakMinutes > 0 && canSubmit
      ? `${formatTime(pause.startMs)} – ${formatTime(pause.endMs)}`
      : formatTime(knobAt * minuteMs);
  // Centred over the knob; at the very ends it stops at the track's edge.
  // The label is monospace, so half its width is half its length in ch.
  const knobLabelHalf = `${knobLabel.length / 2}ch`;

  const pickPreset = (minutes: number | "custom") => {
    if (minutes === "custom" && preset !== "custom")
      setCustom(lengthTexts(breakMinutes * 60));
    setPreset(minutes);
  };

  return (
    <SessionChangeModal
      labelId="split-history-session-title"
      title={t("Split session")}
      icon={Scissors}
      gameName={gameName}
      onCancel={onCancel}
      formId="split-history-session-form"
      submitLabel={t("Split")}
      submitIcon={Scissors}
      canSubmit={canSubmit}
    >
      <form
        id="split-history-session-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) onConfirm(pause);
        }}
      >
        <p className="text-sm leading-6 text-text-muted">
          {t(
            "Move the knob to where the session splits. If the game kept running while you were away, pick a break: that time is removed.",
          )}
        </p>
        <div className="mt-4 rounded-lg border border-border bg-surface-hover p-4">
          <label
            htmlFor="split-history-session-point"
            className="text-xs font-medium text-text-muted"
          >
            {t("Split point")}
          </label>
          <div className="relative mt-2 h-4 font-mono text-[11px] tabular-nums">
            <span
              aria-hidden="true"
              className="absolute -translate-x-1/2 whitespace-nowrap font-semibold text-accent-ink"
              style={{
                left: `clamp(${knobLabelHalf}, ${onTrack(knobAt * minuteMs)}, calc(100% - ${knobLabelHalf}))`,
              }}
            >
              {knobLabel}
            </span>
          </div>
          <input
            id="split-history-session-point"
            type="range"
            min={sliderMin}
            max={sliderMax}
            step={1}
            value={knobAt}
            aria-valuetext={knobLabel}
            data-autofocus
            onChange={(event) => {
              const value = event.currentTarget.valueAsNumber;
              setKnob(
                range ? Math.min(Math.max(value, range.min), range.max) : value,
              );
            }}
            className="pc-range pc-range-split mt-1 w-full"
            style={
              {
                // No gap on the track while the break doesn't fit.
                "--break-from": onTrack(
                  canSubmit ? pause.startMs : knobAt * minuteMs,
                ),
                "--break-to": onTrack(
                  canSubmit ? pause.endMs : knobAt * minuteMs,
                ),
              } as CSSProperties
            }
          />
          <div className="mt-1 flex justify-between font-mono text-[11px] tabular-nums text-text-faint">
            <span>{formatTime(times.startMs)}</span>
            <span>{formatTime(times.endMs)}</span>
          </div>
          <div
            id="split-history-session-break"
            className="mt-4 text-xs font-medium text-text-muted"
          >
            {t("Break")}
          </div>
          <div
            role="group"
            aria-labelledby="split-history-session-break"
            className="mt-2 flex flex-wrap gap-2"
          >
            {breakPresets.map((minutes) => (
              <Pill
                key={minutes}
                selected={preset === minutes}
                disabled={
                  minutes > 0 && splitKnobRange(times, minutes) === null
                }
                onClick={() => pickPreset(minutes)}
              >
                {breakLabel(minutes)}
              </Pill>
            ))}
            <Pill
              selected={preset === "custom"}
              onClick={() => pickPreset("custom")}
            >
              {t("Custom")}
            </Pill>
          </div>
          {preset === "custom" ? (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-[11px] text-text-faint">
                {t("Hours")}
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={custom.hours}
                  placeholder="0"
                  onChange={(event) =>
                    setCustom((current) => ({
                      ...current,
                      hours: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="grid gap-1 text-[11px] text-text-faint">
                {t("Minutes")}
                <Input
                  type="number"
                  min={0}
                  max={59}
                  inputMode="numeric"
                  value={custom.minutes}
                  placeholder="0"
                  onChange={(event) =>
                    setCustom((current) => ({
                      ...current,
                      minutes: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
          ) : null}
        </div>
        {problem ? (
          <Problem>{problem}</Problem>
        ) : (
          <div className="mt-4 flex items-center gap-4 rounded-lg border border-border bg-surface-hover p-4">
            <SessionCover
              session={session}
              gameName={gameName}
              coverUrl={coverUrl}
            />
            <dl className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              <dt className="text-text-faint">{t("First part")}</dt>
              <dd className="text-right font-medium tabular-nums text-text">
                {rangeOf(parts[0]!)} ·{" "}
                {formatDuration(
                  parts[0]!.durationSeconds ?? 0,
                  showDurationDays,
                )}
              </dd>
              {breakMinutes > 0 ? (
                <>
                  <dt className="text-text-faint">{t("Removed")}</dt>
                  <dd className="text-right font-medium tabular-nums text-text-muted">
                    {formatDuration(breakMinutes * 60, showDurationDays)}
                  </dd>
                </>
              ) : null}
              <dt className="text-text-faint">{t("Second part")}</dt>
              <dd className="text-right font-medium tabular-nums text-text">
                {rangeOf(parts[1]!)} ·{" "}
                {formatDuration(
                  parts[1]!.durationSeconds ?? 0,
                  showDurationDays,
                )}
              </dd>
            </dl>
          </div>
        )}
      </form>
    </SessionChangeModal>
  );
}

/* Combine marks the start and end the combined session takes with an amber
   pill and greys out the two it drops. */
type TakenTimes = { start: boolean; end: boolean };

// The gap counted as playtime: amber stripes, on the bar and in the note.
const countedGap = {
  background:
    "repeating-linear-gradient(135deg, rgb(var(--color-accent) / 0.6) 0 3px, rgb(var(--color-accent) / 0.18) 3px 6px)",
};

function SessionTime({ ms, taken }: { ms: number; taken?: boolean }) {
  return (
    <span
      className={clsx(
        "rounded-md px-1 py-px",
        taken === true && "bg-accent/20 font-semibold text-accent-ink",
        taken === false && "text-text-faint",
      )}
    >
      {formatTime(ms)}
    </span>
  );
}

function SessionTimes({
  session,
  taken,
}: {
  session: Session;
  taken?: TakenTimes;
}) {
  const { startMs, endMs } = sessionTimes(session);
  return (
    <span className="-ml-1 block font-medium tabular-nums text-text">
      <SessionTime ms={startMs} taken={taken?.start} /> –{" "}
      <SessionTime ms={endMs} taken={taken?.end} />
    </span>
  );
}

function SessionSummary({
  label,
  session,
  showDurationDays,
  taken,
}: {
  label: string;
  session: Session;
  showDurationDays: boolean;
  taken?: TakenTimes;
}) {
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-text-faint">
          {label}
        </span>
        <span className="mt-1 block text-[12.5px] tabular-nums text-text-muted">
          {new Date(session.startedAt).toLocaleDateString(appLocale())}
        </span>
        <SessionTimes session={session} taken={taken} />
        <span className="mt-1.5 block font-mono font-bold tabular-nums text-accent-ink">
          {formatDuration(session.durationSeconds ?? 0, showDurationDays)}
        </span>
      </span>
    </>
  );
}

function Operator({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div aria-hidden="true" className="grid place-items-center text-text-faint">
      <Icon size={16} strokeWidth={2.5} />
    </div>
  );
}

/** This session + the game's session right before or after = the result. */
export function CombineSessionDialog({
  session,
  gameName,
  coverUrl,
  showDurationDays,
  onCancel,
  neighbours,
  onConfirm,
}: DialogProps & {
  neighbours: SessionNeighbours;
  onConfirm: (other: Session) => void;
}) {
  const { startMs, endMs } = sessionTimes(session);
  const options = [
    neighbours.before
      ? {
          session: neighbours.before,
          label: t("Session before"),
          gapMs: startMs - sessionTimes(neighbours.before).endMs,
        }
      : null,
    neighbours.after
      ? {
          session: neighbours.after,
          label: t("Session after"),
          gapMs: sessionTimes(neighbours.after).startMs - endMs,
        }
      : null,
  ].filter((option) => option !== null);
  const [pickedId, setPickedId] = useState(
    () =>
      [...options].sort(
        (left, right) => Math.max(0, left.gapMs) - Math.max(0, right.gapMs),
      )[0]?.session.id,
  );
  const picked = options.find((option) => option.session.id === pickedId);
  const combined = picked
    ? combineSessions(
        [session, picked.session],
        session.id,
        picked.session.id,
      )[0]
    : undefined;
  const [earlier, later] = picked
    ? [session, picked.session].sort(
        (left, right) =>
          sessionTimes(left).startMs - sessionTimes(right).startMs,
      )
    : [];
  const endsLast =
    earlier && later && sessionTimes(earlier).endMs > sessionTimes(later).endMs
      ? earlier
      : later;
  const takenFrom = (entry: Session): TakenTimes | undefined =>
    picked && (entry.id === session.id || entry.id === picked.session.id)
      ? { start: entry.id === earlier?.id, end: entry.id === endsLast?.id }
      : undefined;
  // The combined bar: the earlier part, the gap that now counts, the later
  // part, in proportion.
  const bar =
    earlier && later && combined
      ? (() => {
          const start = sessionTimes(earlier).startMs;
          const gapFrom = Math.min(
            sessionTimes(earlier).endMs,
            sessionTimes(later).startMs,
          );
          const gapTo = sessionTimes(later).startMs;
          const end = sessionTimes(combined).endMs;
          return {
            first: gapFrom - start,
            gap: gapTo - gapFrom,
            second: end - gapTo,
          };
        })()
      : null;

  return (
    <SessionChangeModal
      labelId="combine-history-sessions-title"
      title={t("Combine sessions")}
      icon={Merge}
      gameName={gameName}
      onCancel={onCancel}
      formId="combine-history-sessions-form"
      submitLabel={t("Combine")}
      submitIcon={Merge}
      canSubmit={Boolean(picked)}
      size="wide"
    >
      <form
        id="combine-history-sessions-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (picked) onConfirm(picked.session);
        }}
      >
        <p className="text-sm leading-6 text-text-muted">
          {t("Pick the session to combine this one with.")}
        </p>
        {/* This session + (the one before or the one after) = the result,
            side by side. */}
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1.2fr)] items-center gap-3">
          <div className="rounded-lg border border-border bg-surface px-3.5 py-3 text-sm">
            <SessionSummary
              label={t("This session")}
              session={session}
              showDurationDays={showDurationDays}
              taken={takenFrom(session)}
            />
          </div>
          <Operator icon={Plus} />
          <div className="grid gap-1.5">
            {options.map((option, index) => {
              const selected = option.session.id === pickedId;
              return (
                <Fragment key={option.session.id}>
                  {index > 0 ? (
                    <div className="text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-text-faint">
                      {t("or")}
                    </div>
                  ) : null}
                  <label
                    className={clsx(
                      "flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 text-sm transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40",
                      selected
                        ? "border-accent/60 bg-accent-tint"
                        : "border-border bg-surface-hover hover:border-accent/40",
                    )}
                  >
                    <input
                      type="radio"
                      name="combine-with"
                      className="sr-only"
                      checked={selected}
                      data-autofocus={selected ? true : undefined}
                      onChange={() => setPickedId(option.session.id)}
                    />
                    <span
                      aria-hidden="true"
                      className={clsx(
                        "mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full border",
                        selected ? "border-accent" : "border-border",
                      )}
                    >
                      {selected ? (
                        <span className="h-2 w-2 rounded-full bg-accent" />
                      ) : null}
                    </span>
                    <SessionSummary
                      label={option.label}
                      session={option.session}
                      showDurationDays={showDurationDays}
                      taken={takenFrom(option.session)}
                    />
                  </label>
                </Fragment>
              );
            })}
          </div>
          <Operator icon={Equal} />
          {combined && picked && bar ? (
            <div className="rounded-lg border border-border bg-surface-hover p-3.5 text-sm">
              <div className="flex items-start gap-3">
                <SessionCover
                  session={session}
                  gameName={gameName}
                  coverUrl={coverUrl}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-faint">
                    {t("Combined session")}
                  </div>
                  <div className="mt-1 text-[12.5px] tabular-nums text-text-muted">
                    {new Date(combined.startedAt).toLocaleDateString(
                      appLocale(),
                    )}
                  </div>
                  <SessionTimes
                    session={combined}
                    taken={{ start: true, end: true }}
                  />
                  <div className="mt-1.5 font-mono font-bold tabular-nums text-accent-ink">
                    {formatDuration(
                      combined.durationSeconds ?? 0,
                      showDurationDays,
                    )}
                  </div>
                </div>
              </div>
              <div aria-hidden="true" className="mt-3 flex h-2 gap-0.5">
                <span
                  className="min-w-1 basis-0 rounded-l-full bg-accent"
                  style={{ flexGrow: bar.first }}
                />
                {bar.gap > 0 ? (
                  <span
                    className="min-w-1 basis-0"
                    style={{ ...countedGap, flexGrow: bar.gap }}
                  />
                ) : null}
                <span
                  className="min-w-1 basis-0 rounded-r-full bg-accent"
                  style={{ flexGrow: bar.second }}
                />
              </div>
              {picked.gapMs >= minuteMs ? (
                <p className="mt-2 flex items-start gap-2 text-xs leading-5 text-text-muted">
                  <span
                    aria-hidden="true"
                    className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={countedGap}
                  />
                  {t("The {{duration}} between them count as playtime.", {
                    duration: formatDuration(
                      picked.gapMs / 1000,
                      showDurationDays,
                    ),
                  })}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </form>
    </SessionChangeModal>
  );
}
