import type { Session } from "@playcounter/shared";
import clsx from "clsx";
import {
  ArrowRight,
  Equal,
  Info,
  Merge,
  Pencil,
  Plus,
  Scissors,
  Timer,
  type LucideIcon,
} from "lucide-react";
import {
  Fragment,
  useId,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
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
import { NumberDrum } from "./NumberDrum";
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

/** A card of the edit box. The two picked ones count and have an amber
 *  border; the third fills in from them. A click picks a card, changing
 *  something in it does too. */
function TimeFieldCard({
  labelId,
  label,
  picked,
  onPick,
  children,
}: {
  labelId: string;
  label: string;
  picked: boolean;
  onPick: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      onClick={onPick}
      className={clsx(
        "flex h-full cursor-pointer flex-col rounded-lg border p-3.5 transition",
        picked
          ? "border-accent/60 bg-accent-tint"
          : "border-border bg-surface-hover hover:border-accent/40",
      )}
    >
      <div
        id={labelId}
        className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-faint"
      >
        {label}
      </div>
      {children}
    </div>
  );
}

// The form after a change to one field: it and the field changed before it
// win, the third fills in.
function nextForm(
  current: EditForm,
  field: SessionTimeField,
  patch: Partial<EditForm>,
): EditForm {
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
}

type FormPatch = (state: EditForm) => Partial<EditForm> | null;

type TimesCheck =
  | { kind: "ok" | "incomplete" | "order" | "future" | "short" }
  | { kind: "overlap"; startMs: number; other: SessionTimes };

function problemText(check: TimesCheck) {
  switch (check.kind) {
    case "ok":
      return null;
    case "incomplete":
      return t("Enter when the session started and ended.");
    case "order":
      return t("The end must be after the start.");
    case "future":
      return t("The end can't be in the future.");
    case "short":
      return t("A session needs at least one minute.");
    case "overlap":
      return t(
        "This overlaps your session from {{time}}. Combine them instead.",
        { time: overlapStart(check.other.startMs, check.startMs) },
      );
  }
}

// Why a step stopped: the problem the step would have caused.
function stopText(check: TimesCheck) {
  switch (check.kind) {
    case "ok":
    case "incomplete":
      return null;
    case "order":
      return t("Stops here: the end has to stay after the start.");
    case "future":
      return t("Stops here: the end can't be in the future.");
    case "short":
      return t("Stops here: a session needs at least one minute.");
    case "overlap":
      return check.other.startMs >= check.startMs
        ? t(
            "Stops here: your next session of this game starts at {{time}}. Combine them instead.",
            { time: overlapStart(check.other.startMs, check.startMs) },
          )
        : t(
            "Stops here: your previous session of this game ends at {{time}}. Combine them instead.",
            { time: overlapStart(check.other.endMs, check.startMs) },
          );
  }
}

// A step moves the moment itself, so 23:59 + 1 minute is the next day.
const timeStep =
  (field: "start" | "end", minutes: number): FormPatch =>
  (state) => {
    const ms = parseLocal(state[field]);
    return Number.isFinite(ms)
      ? { [field]: localDateTimeValue(new Date(ms + minutes * minuteMs)) }
      : null;
  };

const lengthStep =
  (minutes: number): FormPatch =>
  (state) => {
    const total =
      wholeNumber(state.hours) * 60 + wholeNumber(state.minutes) + minutes;
    return total < 0 ? null : lengthTexts(total * 60);
  };

/** Started → Ended = Length. Change any two, the third fills in. */
export function EditSessionDialog({
  session,
  gameName,
  onCancel,
  overlapFor,
  onConfirm,
}: DialogProps & {
  overlapFor: (times: SessionTimes) => Session | undefined;
  onConfirm: (times: SessionTimes) => void;
}) {
  const ids = useId();
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

  // Picking a card changes nothing: the three values always agree.
  const pick = (field: SessionTimeField) =>
    setForm((current) => ({
      ...current,
      changed: changedFields(current.changed, field),
    }));
  const update = (field: SessionTimeField, patch: Partial<EditForm>) => {
    setStopHint(null);
    setForm((current) => nextForm(current, field, patch));
  };

  const checkTimes = (state: EditForm): TimesCheck => {
    const { startMs, endMs, lengthSeconds } = fillSessionTimes(
      state.changed,
      formValues(state),
    );
    if (!Number.isFinite(startMs + endMs)) return { kind: "incomplete" };
    // End on the start is a length of zero: too short, not out of order.
    if (endMs < startMs) return { kind: "order" };
    if (endMs > Date.now()) return { kind: "future" };
    if (lengthSeconds < 60) return { kind: "short" };
    const overlap = overlapFor({ startMs, endMs });
    return overlap
      ? { kind: "overlap", startMs, other: sessionTimes(overlap) }
      : { kind: "ok" };
  };
  const problemOf = (state: EditForm) => problemText(checkTimes(state));
  // The reason the last step stopped, until the next change.
  const [stopHint, setStopHint] = useState<string | null>(null);
  // Wheel, arrow keys and clicks stop where a step would cause a problem.
  // Typing still can, and says why.
  const stepAllowed = (
    state: EditForm,
    field: SessionTimeField,
    patch: FormPatch,
  ) => {
    const change = patch(state);
    if (!change) return false;
    return (
      problemOf(state) !== null ||
      problemOf(nextForm(state, field, change)) === null
    );
  };
  const step = (field: SessionTimeField, patch: FormPatch) => {
    setStopHint(null);
    setForm((current) => {
      const change = patch(current);
      return change && stepAllowed(current, field, patch)
        ? nextForm(current, field, change)
        : current;
    });
  };
  // No step at all (the length can't go below 0h) needs no explaining.
  const stopped = (field: SessionTimeField, patch: FormPatch) => {
    const change = patch(form);
    setStopHint(
      change ? stopText(checkTimes(nextForm(form, field, change))) : null,
    );
  };
  const setTime = (
    field: "start" | "end",
    part: "hours" | "minutes",
    value: number,
  ) => {
    const date = new Date(parseLocal(form[field]));
    if (Number.isNaN(date.getTime())) return;
    if (part === "hours" && value < 24) date.setHours(value);
    else if (part === "minutes" && value < 60) date.setMinutes(value);
    else return;
    update(field, { [field]: localDateTimeValue(date) });
  };
  const setDay = (field: "start" | "end", day: string) => {
    if (!day) return;
    update(field, { [field]: `${day}T${form[field].slice(11)}` });
  };
  const lengthMinutes =
    wholeNumber(form.hours) * 60 + wholeNumber(form.minutes);

  const { startMs, endMs } = fillSessionTimes(form.changed, formValues(form));
  const times = { startMs, endMs };
  const filledField = (["start", "end", "length"] as const).find(
    (field) => !form.changed.includes(field),
  );
  const problem = problemOf(form);
  const canSubmit = form.touched && problem === null;

  const timeCard = (field: "start" | "end", label: string) => {
    const date = new Date(parseLocal(form[field]));
    const valid = !Number.isNaN(date.getTime());
    const labelId = `${ids}-${field}`;
    return (
      <TimeFieldCard
        labelId={labelId}
        label={label}
        picked={filledField !== field}
        onPick={() => pick(field)}
      >
        <Input
          type="date"
          aria-labelledby={labelId}
          value={form[field].slice(0, 10)}
          max={localDateTimeValue(new Date()).slice(0, 10)}
          onChange={(event) => setDay(field, event.target.value)}
          className="mt-2 w-full"
        />
        <div className="mt-auto flex items-center justify-center gap-1.5 pt-3">
          <NumberDrum
            value={valid ? date.getHours() : 0}
            labelledBy={`${labelId} ${ids}-hours`}
            caption={t("Hours")}
            cycle={24}
            autoFocus={field === "start"}
            canStep={(delta) =>
              stepAllowed(form, field, timeStep(field, delta * 60))
            }
            onStep={(delta) => step(field, timeStep(field, delta * 60))}
            onBlocked={(delta) => stopped(field, timeStep(field, delta * 60))}
            onSet={(value) => setTime(field, "hours", value)}
          />
          {/* Level with the numbers, above the captions. */}
          <span
            aria-hidden="true"
            className="pb-4 font-mono text-2xl font-bold text-text-faint"
          >
            :
          </span>
          <NumberDrum
            value={valid ? date.getMinutes() : 0}
            labelledBy={`${labelId} ${ids}-minutes`}
            caption={t("Minutes")}
            cycle={60}
            canStep={(delta) =>
              stepAllowed(form, field, timeStep(field, delta))
            }
            onStep={(delta) => step(field, timeStep(field, delta))}
            onBlocked={(delta) => stopped(field, timeStep(field, delta))}
            onSet={(value) => setTime(field, "minutes", value)}
          />
        </div>
      </TimeFieldCard>
    );
  };

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
      size="wide"
    >
      <form
        id="edit-history-session-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) onConfirm(times);
        }}
      >
        <p className="text-sm leading-6 text-text-muted">
          {t(
            "Pick the two you know: click them or change them. The third one fills in.",
          )}
        </p>
        <span id={`${ids}-hours`} className="sr-only">
          {t("Hours")}
        </span>
        <span id={`${ids}-minutes`} className="sr-only">
          {t("Minutes")}
        </span>
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-3">
          {timeCard("start", t("Started"))}
          <Operator icon={ArrowRight} />
          {timeCard("end", t("Ended"))}
          <Operator icon={Equal} />
          <TimeFieldCard
            labelId={`${ids}-length`}
            label={t("Length")}
            picked={filledField !== "length"}
            onPick={() => pick("length")}
          >
            <div className="mt-auto flex items-center justify-center gap-3 pt-3">
              <NumberDrum
                value={Math.floor(lengthMinutes / 60)}
                labelledBy={`${ids}-length ${ids}-hours`}
                caption={t("Hours")}
                digits={3}
                canStep={(delta) =>
                  stepAllowed(form, "length", lengthStep(delta * 60))
                }
                onStep={(delta) => step("length", lengthStep(delta * 60))}
                onBlocked={(delta) => stopped("length", lengthStep(delta * 60))}
                onSet={(value) => update("length", { hours: String(value) })}
              />
              <NumberDrum
                value={lengthMinutes % 60}
                labelledBy={`${ids}-length ${ids}-minutes`}
                caption={t("Minutes")}
                cycle={60}
                canStep={(delta) =>
                  stepAllowed(form, "length", lengthStep(delta))
                }
                onStep={(delta) => step("length", lengthStep(delta))}
                onBlocked={(delta) => stopped("length", lengthStep(delta))}
                onSet={(value) =>
                  value < 60
                    ? update("length", { minutes: String(value) })
                    : undefined
                }
              />
            </div>
          </TimeFieldCard>
        </div>
        {problem ? (
          <Problem>{problem}</Problem>
        ) : stopHint ? (
          <p
            aria-live="polite"
            className="mt-3 flex items-start gap-2 text-xs leading-5 text-text-muted"
          >
            <Info size={14} className="mt-0.5 shrink-0 text-accent-ink" />
            {stopHint}
          </p>
        ) : null}
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
      size="wide"
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
            <div className="mt-3 grid max-w-sm grid-cols-2 gap-3">
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
          <>
            {/* This session = the first part + the second part, side by
                side. */}
            <div className="mt-4 grid grid-cols-[minmax(0,1.2fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
              <div className="flex items-start gap-3 rounded-lg border border-border bg-surface px-3.5 py-3 text-sm">
                <SessionCover
                  session={session}
                  gameName={gameName}
                  coverUrl={coverUrl}
                />
                <SessionSummary
                  label={t("This session")}
                  session={session}
                  showDurationDays={showDurationDays}
                />
              </div>
              <Operator icon={Equal} />
              <div className="rounded-lg border border-border bg-surface-hover px-3.5 py-3 text-sm">
                <SessionSummary
                  label={t("First part")}
                  session={parts[0]!}
                  showDurationDays={showDurationDays}
                  taken={{ end: true }}
                />
              </div>
              <Operator icon={Plus} />
              <div className="rounded-lg border border-border bg-surface-hover px-3.5 py-3 text-sm">
                <SessionSummary
                  label={t("Second part")}
                  session={parts[1]!}
                  showDurationDays={showDurationDays}
                  taken={{ start: true }}
                />
              </div>
            </div>
            {breakMinutes > 0 ? (
              <p className="mt-2 flex items-start gap-2 text-xs leading-5 text-text-muted">
                {/* The break's grey, as on the slider. */}
                <span
                  aria-hidden="true"
                  className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm bg-border"
                />
                {t("The {{duration}} break doesn't count as playtime.", {
                  duration: formatDuration(breakMinutes * 60, showDurationDays),
                })}
              </p>
            ) : null}
          </>
        )}
      </form>
    </SessionChangeModal>
  );
}

/* Combine marks the start and end the combined session takes with an amber
   pill and greys out the two it drops. Split marks the two times the knob
   sets. */
type TakenTimes = { start?: boolean; end?: boolean };

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
