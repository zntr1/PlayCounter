use serde::Serialize;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, OnceLock,
};
use std::time::Instant;
use tauri::{Emitter, Manager};

const REVEAL_HOLD_MS: u64 = 2_000;
/// View + D-pad up / down held this long counts one (docs/counters-plan.md).
const COUNT_HOLD_MS: u64 = 1_000;
/// To the main window: a counting combo was held ("add" or "undo").
const COUNT_EVENT: &str = "playcounter:controller-count";
const REVEAL_COOLDOWN_MS: u64 = 3_000;
const DIRECTION_INITIAL_REPEAT_MS: u64 = 350;
const DIRECTION_REPEAT_MS: u64 = 120;
const SCROLL_REPEAT_MS: u64 = 16;
const REVEAL_FOCUS_GRACE_MS: u64 = 3_000;
const KNOWN_CONTROLLER_RETRY_MS: u64 = 100;
const NEW_CONTROLLER_PROBE_MS: u64 = 2_000;
const STICK_DEAD_ZONE: i16 = 16_000;
const SCROLL_DEAD_ZONE: i16 = 12_000;
// Pads that fire within this window of the pad in use are ignored. DS4Windows
// or DSX without HidHide show one PlayStation pad twice (itself and a virtual
// Xbox pad), and both copies would otherwise move the selection.
const INPUT_OWNER_QUIET_MS: u64 = 500;
/// With neither navigation nor counting on, the watcher only notes when a
/// pad moves (auto pause). Ten minutes of play can't hide between reads.
#[cfg_attr(not(windows), allow(dead_code))]
const PAD_ACTIVITY_TICK_MS: u64 = 250;
/// How far a stick or trigger has to move from where it rested to count as
/// input. Stick noise and drift stay well below it; a thumb doesn't.
#[cfg_attr(not(windows), allow(dead_code))]
const PAD_MOVE_STEP: i32 = 4_000;
// XInput button bits. PlayStation pads are translated into the same layout.
pub(crate) const BUTTON_DPAD_UP: u16 = 0x0001;
pub(crate) const BUTTON_DPAD_DOWN: u16 = 0x0002;
pub(crate) const BUTTON_DPAD_LEFT: u16 = 0x0004;
pub(crate) const BUTTON_DPAD_RIGHT: u16 = 0x0008;
pub(crate) const BUTTON_MENU: u16 = 0x0010;
pub(crate) const BUTTON_VIEW: u16 = 0x0020;
pub(crate) const BUTTON_LEFT_SHOULDER: u16 = 0x0100;
pub(crate) const BUTTON_RIGHT_SHOULDER: u16 = 0x0200;
pub(crate) const BUTTON_A: u16 = 0x1000;
pub(crate) const BUTTON_B: u16 = 0x2000;
pub(crate) const BUTTON_X: u16 = 0x4000;
pub(crate) const BUTTON_Y: u16 = 0x8000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ControllerAction {
    Reveal,
    ToggleLibraryView,
    Up,
    Down,
    Left,
    Right,
    ScrollUp,
    ScrollDown,
    Confirm,
    Back,
    ToggleFullscreen,
    StopGame,
    /// Y / Triangle: Details of the selected game.
    OpenDetails,
    /// LB / L1 and RB / R1: the tab before or after the open one.
    PreviousTab,
    NextTab,
    /// View + D-pad up held: one more on the running game's hotkey counter.
    CountAdd,
    /// View + D-pad down held: take the last count back.
    CountUndo,
}

impl ControllerAction {
    fn is_count(self) -> bool {
        matches!(self, Self::CountAdd | Self::CountUndo)
    }
}

/// Counting works with controller navigation off and the other way round:
/// each kind of action only goes out while its setting is on.
fn allowed(action: ControllerAction, navigation: bool, counting: bool) -> bool {
    if action.is_count() {
        counting
    } else {
        navigation
    }
}

// Which button art the UI shows. A PlayStation pad that reaches us through
// XInput (Steam, DS4Windows, DSX) is indistinguishable from an Xbox pad.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ControllerKind {
    Xbox,
    Ps5,
    Ps4,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct ControllerEvent {
    action: ControllerAction,
    at: u64,
    kind: ControllerKind,
}

// The pad that fired last owns input until it has been quiet for
// INPUT_OWNER_QUIET_MS. Sources are XInput slots 0-3 and HID pads from 4 up.
#[derive(Debug, Default)]
struct InputOwner {
    source: Option<usize>,
    last_action_at: u64,
}

impl InputOwner {
    fn accepts(&mut self, source: usize, now_ms: u64) -> bool {
        let owned_by_other = self.source.is_some_and(|owner| owner != source)
            && now_ms.saturating_sub(self.last_action_at) < INPUT_OWNER_QUIET_MS;
        if owned_by_other {
            return false;
        }
        self.source = Some(source);
        self.last_action_at = now_ms;
        true
    }
}

#[derive(Debug, Default, Clone)]
pub struct ControllerMachine {
    previous_buttons: u16,
    chord_started_at: Option<u64>,
    chord_fired: bool,
    view_tap_candidate: bool,
    reveal_cooldown_until: u64,
    held_direction: Option<ControllerAction>,
    direction_repeat_at: u64,
    held_scroll: Option<ControllerAction>,
    scroll_repeat_at: u64,
    /// The counting combo held, and since when.
    count_chord: Option<(ControllerAction, u64)>,
    count_fired: bool,
}

impl ControllerMachine {
    pub fn reset(&mut self) {
        *self = Self::default();
    }

    pub fn update(
        &mut self,
        buttons: u16,
        stick: (i16, i16),
        right_stick_y: i16,
        now_ms: u64,
    ) -> Vec<ControllerAction> {
        let mut actions = Vec::new();
        let view_down = buttons & BUTTON_VIEW != 0;
        let view_was_down = self.previous_buttons & BUTTON_VIEW != 0;
        if view_down && !view_was_down {
            self.view_tap_candidate = buttons & BUTTON_RIGHT_SHOULDER == 0;
        }
        if buttons & BUTTON_RIGHT_SHOULDER != 0 {
            self.view_tap_candidate = false;
        }
        // View + D-pad up / down: a count once held long enough, and no
        // View tap when let go.
        let count_target = if !view_down {
            None
        } else if buttons & BUTTON_DPAD_UP != 0 {
            Some(ControllerAction::CountAdd)
        } else if buttons & BUTTON_DPAD_DOWN != 0 {
            Some(ControllerAction::CountUndo)
        } else {
            None
        };
        match (count_target, self.count_chord) {
            (None, _) => {
                self.count_chord = None;
                self.count_fired = false;
            }
            (Some(target), Some((held, started))) if held == target => {
                if !self.count_fired && now_ms.saturating_sub(started) >= COUNT_HOLD_MS {
                    actions.push(target);
                    self.count_fired = true;
                }
            }
            (Some(target), _) => {
                self.view_tap_candidate = false;
                self.count_chord = Some((target, now_ms));
                self.count_fired = false;
            }
        }
        if !view_down && view_was_down && self.view_tap_candidate {
            actions.push(ControllerAction::ToggleLibraryView);
            self.view_tap_candidate = false;
        }
        let reveal_chord = BUTTON_VIEW | BUTTON_RIGHT_SHOULDER;
        let chord_held = buttons & reveal_chord == reveal_chord;
        if chord_held {
            let started = *self.chord_started_at.get_or_insert(now_ms);
            if !self.chord_fired
                && now_ms >= self.reveal_cooldown_until
                && now_ms.saturating_sub(started) >= REVEAL_HOLD_MS
            {
                actions.push(ControllerAction::Reveal);
                self.chord_fired = true;
                self.reveal_cooldown_until = now_ms + REVEAL_COOLDOWN_MS;
            }
        } else {
            self.chord_started_at = None;
            self.chord_fired = false;
        }

        let pressed = buttons & !self.previous_buttons;
        if pressed & BUTTON_A != 0 {
            actions.push(ControllerAction::Confirm);
        }
        if pressed & BUTTON_B != 0 {
            actions.push(ControllerAction::Back);
        }
        if pressed & BUTTON_MENU != 0 {
            actions.push(ControllerAction::ToggleFullscreen);
        }
        if pressed & BUTTON_X != 0 {
            actions.push(ControllerAction::StopGame);
        }
        if pressed & BUTTON_Y != 0 {
            actions.push(ControllerAction::OpenDetails);
        }
        if pressed & BUTTON_LEFT_SHOULDER != 0 {
            actions.push(ControllerAction::PreviousTab);
        }
        // With View held, RB starts the bring-forward chord instead.
        if pressed & BUTTON_RIGHT_SHOULDER != 0 && !view_down {
            actions.push(ControllerAction::NextTab);
        }

        // With View held the D-pad belongs to the counting combo.
        let dpad_direction = if view_down {
            None
        } else if buttons & BUTTON_DPAD_UP != 0 {
            Some(ControllerAction::Up)
        } else if buttons & BUTTON_DPAD_DOWN != 0 {
            Some(ControllerAction::Down)
        } else if buttons & BUTTON_DPAD_LEFT != 0 {
            Some(ControllerAction::Left)
        } else if buttons & BUTTON_DPAD_RIGHT != 0 {
            Some(ControllerAction::Right)
        } else {
            None
        };
        let stick_direction = if stick.1 > STICK_DEAD_ZONE {
            Some(ControllerAction::Up)
        } else if stick.1 < -STICK_DEAD_ZONE {
            Some(ControllerAction::Down)
        } else if stick.0 < -STICK_DEAD_ZONE {
            Some(ControllerAction::Left)
        } else if stick.0 > STICK_DEAD_ZONE {
            Some(ControllerAction::Right)
        } else {
            None
        };
        // A deliberate D-pad press wins over analog-stick drift or a stick
        // that has not quite returned to its dead zone yet.
        let direction = dpad_direction.or(stick_direction);

        match (self.held_direction, direction) {
            (_, None) => {
                self.held_direction = None;
                self.direction_repeat_at = 0;
            }
            (held, Some(next)) if held != Some(next) => {
                actions.push(next);
                self.held_direction = Some(next);
                self.direction_repeat_at = now_ms + DIRECTION_INITIAL_REPEAT_MS;
            }
            (Some(next), Some(_)) if now_ms >= self.direction_repeat_at => {
                actions.push(next);
                self.direction_repeat_at = now_ms + DIRECTION_REPEAT_MS;
            }
            _ => {}
        }

        let scroll = if right_stick_y > SCROLL_DEAD_ZONE {
            Some(ControllerAction::ScrollUp)
        } else if right_stick_y < -SCROLL_DEAD_ZONE {
            Some(ControllerAction::ScrollDown)
        } else {
            None
        };
        match (self.held_scroll, scroll) {
            (_, None) => {
                self.held_scroll = None;
                self.scroll_repeat_at = 0;
            }
            (held, Some(next)) if held != Some(next) => {
                actions.push(next);
                self.held_scroll = Some(next);
                self.scroll_repeat_at = now_ms + SCROLL_REPEAT_MS;
            }
            (Some(next), Some(_)) if now_ms >= self.scroll_repeat_at => {
                actions.push(next);
                self.scroll_repeat_at = now_ms + SCROLL_REPEAT_MS;
            }
            _ => {}
        }

        self.previous_buttons = buttons;
        actions
    }
}

/// Every input that shows someone holds the pad: all buttons, both sticks,
/// both triggers. Triggers use the sticks' range; 0 where a pad has none.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct PadInputs {
    pub buttons: u16,
    /// Left X, left Y, right X, right Y, left trigger, right trigger.
    pub axes: [i16; 6],
}

/// An XInput trigger (0..=255) in the sticks' range.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn trigger_axis(raw: u8) -> i16 {
    i16::from(raw) * 128
}

/// Tells a pad in use from one lying still: a button changed, or a stick or
/// trigger moved a real step from where it rested. A drifting stick on the
/// table never counts.
#[derive(Debug, Default, Clone)]
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) struct PadActivity {
    rest: Option<PadInputs>,
}

#[cfg_attr(not(windows), allow(dead_code))]
impl PadActivity {
    /// Whether these inputs show the pad in use. The first read only notes
    /// where the pad rests.
    pub(crate) fn update(&mut self, inputs: PadInputs) -> bool {
        let Some(rest) = self.rest else {
            self.rest = Some(inputs);
            return false;
        };
        let moved = rest.buttons != inputs.buttons
            || rest
                .axes
                .iter()
                .zip(inputs.axes)
                .any(|(from, to)| (i32::from(*from) - i32::from(to)).abs() >= PAD_MOVE_STEP);
        if moved {
            self.rest = Some(inputs);
        }
        moved
    }
}

static PAD_CLOCK: OnceLock<Instant> = OnceLock::new();
/// When a pad last moved: milliseconds on PAD_CLOCK plus one; 0 = never.
static LAST_PAD_INPUT: AtomicU64 = AtomicU64::new(0);

fn pad_clock_ms() -> u64 {
    PAD_CLOCK.get_or_init(Instant::now).elapsed().as_millis() as u64
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn note_pad_input() {
    LAST_PAD_INPUT.store(pad_clock_ms() + 1, Ordering::Relaxed);
}

/// Since a pad last moved, for auto pause (play_activity.rs). None until one
/// did while the watcher ran.
pub(crate) fn pad_idle_ms() -> Option<u64> {
    let last = LAST_PAD_INPUT.load(Ordering::Relaxed);
    (last != 0).then(|| pad_clock_ms().saturating_sub(last - 1))
}

#[derive(Default)]
pub struct ControllerWatcher {
    generation: Arc<AtomicU64>,
}

/// Starts (or restarts) reading pads. `navigation`: moving through the app;
/// `counting`: the counting combos, also while the window is hidden.
#[tauri::command]
pub fn controller_watch_start(
    app: tauri::AppHandle,
    watcher: tauri::State<'_, ControllerWatcher>,
    navigation: Option<bool>,
    counting: Option<bool>,
) {
    let navigation = navigation.unwrap_or(true);
    let counting = counting.unwrap_or(false);
    let generation = watcher.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let current = Arc::clone(&watcher.generation);
    tauri::async_runtime::spawn(async move {
        watch_controllers(app, current, generation, navigation, counting).await;
    });
}

#[tauri::command]
pub fn controller_watch_stop(watcher: tauri::State<'_, ControllerWatcher>) {
    watcher.generation.fetch_add(1, Ordering::SeqCst);
}

#[cfg(windows)]
async fn watch_controllers(
    app: tauri::AppHandle,
    current_generation: Arc<AtomicU64>,
    generation: u64,
    navigation: bool,
    counting: bool,
) {
    use windows_sys::Win32::UI::Input::XboxController::{XInputGetState, XINPUT_STATE};

    let started = std::time::Instant::now();
    let mut machines = std::array::from_fn::<_, 4, _>(|_| ControllerMachine::default());
    let mut activity = std::array::from_fn::<_, 4, _>(|_| PadActivity::default());
    let tick_ms = if navigation || counting {
        16
    } else {
        PAD_ACTIVITY_TICK_MS
    };
    let mut next_probe_at = [0_u64; 4];
    let mut seen_connected = [false; 4];
    let mut playstation_pads = super::playstation_pad::PlaystationPads::new(4);
    let mut owner = InputOwner::default();
    let mut focus_grace_until = 0_u64;
    while current_generation.load(Ordering::SeqCst) == generation {
        let now_ms = started.elapsed().as_millis() as u64;
        let mut selected: Option<(ControllerKind, Vec<ControllerAction>)> = None;
        for slot in 0..4 {
            if now_ms < next_probe_at[slot] {
                continue;
            }
            let mut state = unsafe { std::mem::zeroed::<XINPUT_STATE>() };
            let result = unsafe { XInputGetState(slot as u32, &mut state) };
            if result != 0 {
                machines[slot].reset();
                activity[slot] = PadActivity::default();
                next_probe_at[slot] = now_ms
                    + if seen_connected[slot] {
                        KNOWN_CONTROLLER_RETRY_MS
                    } else {
                        NEW_CONTROLLER_PROBE_MS
                    };
                continue;
            }
            seen_connected[slot] = true;
            next_probe_at[slot] = now_ms;
            let pad = &state.Gamepad;
            if activity[slot].update(PadInputs {
                buttons: pad.wButtons,
                axes: [
                    pad.sThumbLX,
                    pad.sThumbLY,
                    pad.sThumbRX,
                    pad.sThumbRY,
                    trigger_axis(pad.bLeftTrigger),
                    trigger_axis(pad.bRightTrigger),
                ],
            }) {
                note_pad_input();
            }
            let mut actions = machines[slot].update(
                state.Gamepad.wButtons,
                (state.Gamepad.sThumbLX, state.Gamepad.sThumbLY),
                state.Gamepad.sThumbRY,
                now_ms,
            );
            actions.retain(|action| allowed(*action, navigation, counting));
            if selected.is_none() && !actions.is_empty() && owner.accepts(slot, now_ms) {
                selected = Some((ControllerKind::Xbox, actions));
            }
        }
        for (source, kind, mut actions) in playstation_pads.poll(now_ms) {
            actions.retain(|action| allowed(*action, navigation, counting));
            if actions.is_empty() {
                continue;
            }
            if selected.is_none() && owner.accepts(source, now_ms) {
                selected = Some((kind, actions));
            }
        }
        let (kind, selected_actions) = selected.unwrap_or((ControllerKind::Xbox, Vec::new()));
        for action in selected_actions {
            if action == ControllerAction::Reveal {
                focus_grace_until = now_ms + REVEAL_FOCUS_GRACE_MS;
            }
            let allow_focus_grace = now_ms <= focus_grace_until;
            emit_action(&app, action, kind, now_ms, allow_focus_grace);
            if action != ControllerAction::Reveal && allow_focus_grace {
                focus_grace_until = 0;
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(tick_ms)).await;
    }
}

#[cfg(not(windows))]
async fn watch_controllers(
    _app: tauri::AppHandle,
    _current_generation: Arc<AtomicU64>,
    _generation: u64,
    _navigation: bool,
    _counting: bool,
) {
}

fn emit_action(
    app: &tauri::AppHandle,
    action: ControllerAction,
    kind: ControllerKind,
    at: u64,
    allow_focus_grace: bool,
) {
    // A count goes to the main window whether it is shown or not, and
    // never brings it to the front: the player is in a game.
    if action.is_count() {
        let _ = app.emit_to(
            "main",
            COUNT_EVENT,
            if action == ControllerAction::CountAdd { "add" } else { "undo" },
        );
        return;
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if action == ControllerAction::Reveal {
        let _ = window.set_always_on_top(true);
        super::show_main_window(app);
        let window_for_reset = window.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            let _ = window_for_reset.set_always_on_top(false);
        });
    } else {
        if window.is_visible().ok() != Some(true) {
            return;
        }
        if window.is_focused().ok() != Some(true) {
            if !allow_focus_grace {
                return;
            }
            let _ = window.set_focus();
        }
    }
    let _ = app.emit_to(
        "main",
        "controller-input",
        ControllerEvent { action, at, kind },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    // docs/auto-pause-plan.md, "Controller input".
    fn at_rest() -> PadInputs {
        PadInputs::default()
    }

    fn left_stick(x: i16, y: i16) -> PadInputs {
        PadInputs {
            axes: [x, y, 0, 0, 0, 0],
            ..PadInputs::default()
        }
    }

    #[test]
    fn a_pad_lying_still_is_not_input_even_with_noise_or_drift() {
        let mut activity = PadActivity::default();
        // The first read only notes where the pad rests: a drifted stick.
        assert!(!activity.update(left_stick(9_000, -2_500)));
        for (x, y) in [(9_400, -2_100), (8_700, -2_900), (9_000, -2_500)] {
            assert!(!activity.update(left_stick(x, y)), "noise {x} {y}");
        }
    }

    #[test]
    fn a_button_press_and_its_release_are_input_holding_it_is_not() {
        let mut activity = PadActivity::default();
        activity.update(at_rest());
        let pressed = PadInputs {
            buttons: BUTTON_A,
            ..at_rest()
        };
        assert!(activity.update(pressed));
        assert!(!activity.update(pressed));
        assert!(activity.update(at_rest()));
    }

    #[test]
    fn a_stick_or_trigger_moved_a_real_step_is_input() {
        let mut activity = PadActivity::default();
        activity.update(at_rest());
        // A slow push adds up from where the stick rested.
        assert!(!activity.update(left_stick(2_000, 0)));
        assert!(!activity.update(left_stick(3_500, 0)));
        assert!(activity.update(left_stick(4_500, 0)));
        // Held there: no more input until it moves on.
        assert!(!activity.update(left_stick(4_600, 0)));

        let throttle = PadInputs {
            axes: [4_500, 0, 0, 0, 0, trigger_axis(255)],
            ..at_rest()
        };
        assert!(activity.update(throttle));
        assert_eq!(trigger_axis(255), 32_640);
    }

    #[test]
    fn auto_pause_hears_when_a_pad_last_moved() {
        note_pad_input();
        let idle = pad_idle_ms().expect("a pad moved");
        assert!(idle < 1_000, "{idle} ms");
    }

    #[test]
    fn reveal_chord_requires_a_hold_and_fires_once() {
        let mut machine = ControllerMachine::default();
        let chord = BUTTON_VIEW | BUTTON_RIGHT_SHOULDER;
        assert!(machine.update(chord, (0, 0), 0, 0).is_empty());
        assert!(machine.update(chord, (0, 0), 0, 1_999).is_empty());
        assert_eq!(
            machine.update(chord, (0, 0), 0, 2_000),
            vec![ControllerAction::Reveal]
        );
        assert!(machine.update(chord, (0, 0), 0, 2_200).is_empty());
        assert!(machine.update(0, (0, 0), 0, 2_300).is_empty());
        machine.update(chord, (0, 0), 0, 2_400);
        assert!(machine.update(chord, (0, 0), 0, 4_000).is_empty());
        assert_eq!(
            machine.update(chord, (0, 0), 0, 5_000),
            vec![ControllerAction::Reveal]
        );
    }

    #[test]
    fn view_and_dpad_up_held_one_second_counts_once() {
        let mut machine = ControllerMachine::default();
        let combo = BUTTON_VIEW | BUTTON_DPAD_UP;
        assert!(machine.update(combo, (0, 0), 0, 0).is_empty());
        assert!(machine.update(combo, (0, 0), 0, 999).is_empty());
        assert_eq!(
            machine.update(combo, (0, 0), 0, 1_000),
            vec![ControllerAction::CountAdd]
        );
        // Held on: no second count.
        assert!(machine.update(combo, (0, 0), 0, 3_000).is_empty());
        // Let go: no View tap either.
        assert!(machine.update(0, (0, 0), 0, 3_016).is_empty());
    }

    #[test]
    fn letting_go_before_one_second_counts_nothing() {
        let mut machine = ControllerMachine::default();
        let combo = BUTTON_VIEW | BUTTON_DPAD_UP;
        assert!(machine.update(combo, (0, 0), 0, 0).is_empty());
        assert!(machine.update(combo, (0, 0), 0, 900).is_empty());
        assert!(machine.update(BUTTON_VIEW, (0, 0), 0, 916).is_empty());
        assert!(machine.update(combo, (0, 0), 0, 1_500).is_empty());
        assert!(machine.update(0, (0, 0), 0, 1_516).is_empty());
    }

    #[test]
    fn view_and_dpad_down_held_takes_one_back() {
        let mut machine = ControllerMachine::default();
        let combo = BUTTON_VIEW | BUTTON_DPAD_DOWN;
        machine.update(combo, (0, 0), 0, 0);
        assert_eq!(
            machine.update(combo, (0, 0), 0, 1_000),
            vec![ControllerAction::CountUndo]
        );
    }

    #[test]
    fn the_dpad_with_view_held_does_not_move_the_selection() {
        let mut machine = ControllerMachine::default();
        assert!(machine
            .update(BUTTON_VIEW | BUTTON_DPAD_UP, (0, 0), 0, 0)
            .is_empty());
    }

    #[test]
    fn counting_and_navigation_each_need_their_setting() {
        assert!(allowed(ControllerAction::CountAdd, false, true));
        assert!(!allowed(ControllerAction::CountAdd, true, false));
        assert!(!allowed(ControllerAction::Up, false, true));
        assert!(!allowed(ControllerAction::Reveal, false, true));
        assert!(allowed(ControllerAction::Up, true, false));
    }

    #[test]
    fn confirm_and_back_are_edge_triggered() {
        let mut machine = ControllerMachine::default();
        assert_eq!(
            machine.update(BUTTON_A, (0, 0), 0, 0),
            vec![ControllerAction::Confirm]
        );
        assert!(machine.update(BUTTON_A, (0, 0), 0, 100).is_empty());
        machine.update(0, (0, 0), 0, 200);
        assert_eq!(
            machine.update(BUTTON_B, (0, 0), 0, 300),
            vec![ControllerAction::Back]
        );
    }

    #[test]
    fn menu_toggles_fullscreen_once_per_press() {
        let mut machine = ControllerMachine::default();
        assert_eq!(
            machine.update(BUTTON_MENU, (0, 0), 0, 0),
            vec![ControllerAction::ToggleFullscreen]
        );
        assert!(machine.update(BUTTON_MENU, (0, 0), 0, 1_000).is_empty());
        machine.update(0, (0, 0), 0, 1_100);
        assert_eq!(
            machine.update(BUTTON_MENU, (0, 0), 0, 1_200),
            vec![ControllerAction::ToggleFullscreen]
        );
    }

    #[test]
    fn x_stops_a_game_once_per_press() {
        let mut machine = ControllerMachine::default();
        assert_eq!(
            machine.update(BUTTON_X, (0, 0), 0, 0),
            vec![ControllerAction::StopGame]
        );
        assert!(machine.update(BUTTON_X, (0, 0), 0, 1_000).is_empty());
        machine.update(0, (0, 0), 0, 1_100);
        assert_eq!(
            machine.update(BUTTON_X, (0, 0), 0, 1_200),
            vec![ControllerAction::StopGame]
        );
    }

    #[test]
    fn y_opens_details_once_per_press() {
        let mut machine = ControllerMachine::default();
        assert_eq!(
            machine.update(BUTTON_Y, (0, 0), 0, 0),
            vec![ControllerAction::OpenDetails]
        );
        assert!(machine.update(BUTTON_Y, (0, 0), 0, 1_000).is_empty());
        machine.update(0, (0, 0), 0, 1_100);
        assert_eq!(
            machine.update(BUTTON_Y, (0, 0), 0, 1_200),
            vec![ControllerAction::OpenDetails]
        );
    }

    #[test]
    fn bumpers_switch_tabs_once_per_press() {
        let mut machine = ControllerMachine::default();
        assert_eq!(
            machine.update(BUTTON_LEFT_SHOULDER, (0, 0), 0, 0),
            vec![ControllerAction::PreviousTab]
        );
        assert!(machine
            .update(BUTTON_LEFT_SHOULDER, (0, 0), 0, 1_000)
            .is_empty());
        machine.update(0, (0, 0), 0, 1_100);
        assert_eq!(
            machine.update(BUTTON_RIGHT_SHOULDER, (0, 0), 0, 1_200),
            vec![ControllerAction::NextTab]
        );
        assert!(machine
            .update(BUTTON_RIGHT_SHOULDER, (0, 0), 0, 2_000)
            .is_empty());
    }

    #[test]
    fn rb_held_with_view_is_the_reveal_chord_not_a_tab_switch() {
        let mut machine = ControllerMachine::default();
        assert!(machine.update(BUTTON_VIEW, (0, 0), 0, 0).is_empty());
        let chord = BUTTON_VIEW | BUTTON_RIGHT_SHOULDER;
        assert!(machine.update(chord, (0, 0), 0, 200).is_empty());
        assert_eq!(
            machine.update(chord, (0, 0), 0, 2_200),
            vec![ControllerAction::Reveal]
        );
        assert!(machine.update(0, (0, 0), 0, 2_300).is_empty());
    }

    #[test]
    fn view_tap_fires_on_release_without_conflicting_with_the_reveal_chord() {
        let mut machine = ControllerMachine::default();
        assert!(machine.update(BUTTON_VIEW, (0, 0), 0, 0).is_empty());
        assert!(machine.update(BUTTON_VIEW, (0, 0), 0, 400).is_empty());
        assert_eq!(
            machine.update(0, (0, 0), 0, 416),
            vec![ControllerAction::ToggleLibraryView]
        );

        let chord = BUTTON_VIEW | BUTTON_RIGHT_SHOULDER;
        assert!(machine.update(chord, (0, 0), 0, 500).is_empty());
        assert_eq!(
            machine.update(chord, (0, 0), 0, 2_500),
            vec![ControllerAction::Reveal]
        );
        assert!(machine.update(0, (0, 0), 0, 2_516).is_empty());
    }

    #[test]
    fn directions_repeat_after_the_initial_delay() {
        let mut machine = ControllerMachine::default();
        assert_eq!(
            machine.update(BUTTON_DPAD_RIGHT, (0, 0), 0, 0),
            vec![ControllerAction::Right]
        );
        assert!(machine.update(BUTTON_DPAD_RIGHT, (0, 0), 0, 349).is_empty());
        assert_eq!(
            machine.update(BUTTON_DPAD_RIGHT, (0, 0), 0, 350),
            vec![ControllerAction::Right]
        );
        assert!(machine.update(BUTTON_DPAD_RIGHT, (0, 0), 0, 469).is_empty());
        assert_eq!(
            machine.update(BUTTON_DPAD_RIGHT, (0, 0), 0, 470),
            vec![ControllerAction::Right]
        );
    }

    #[test]
    fn dpad_takes_priority_over_an_active_stick() {
        let mut machine = ControllerMachine::default();
        assert_eq!(
            machine.update(BUTTON_DPAD_RIGHT, (0, STICK_DEAD_ZONE + 1), 0, 0),
            vec![ControllerAction::Right]
        );
        assert_eq!(
            machine.update(0, (0, STICK_DEAD_ZONE + 1), 0, 16),
            vec![ControllerAction::Up]
        );
    }

    #[test]
    fn right_stick_scrolls_continuously_after_its_dead_zone() {
        let mut machine = ControllerMachine::default();
        assert_eq!(
            machine.update(0, (0, 0), -20_000, 0),
            vec![ControllerAction::ScrollDown]
        );
        assert!(machine.update(0, (0, 0), -20_000, 15).is_empty());
        assert_eq!(
            machine.update(0, (0, 0), -20_000, 16),
            vec![ControllerAction::ScrollDown]
        );
        machine.update(0, (0, 0), 0, 32);
        assert_eq!(
            machine.update(0, (0, 0), 20_000, 48),
            vec![ControllerAction::ScrollUp]
        );
    }

    #[test]
    fn the_pad_in_use_keeps_input_until_it_is_quiet() {
        let mut owner = InputOwner::default();
        assert!(owner.accepts(4, 0));
        // The virtual Xbox copy of the same pad fires a moment later.
        assert!(!owner.accepts(0, 8));
        assert!(owner.accepts(4, 120));
        assert!(!owner.accepts(0, 619));
        assert!(owner.accepts(0, 620));
        assert!(!owner.accepts(4, 700));
    }

    #[test]
    fn reset_drops_held_buttons() {
        let mut machine = ControllerMachine::default();
        machine.update(BUTTON_A, (0, 0), 0, 0);
        machine.reset();
        assert_eq!(
            machine.update(BUTTON_A, (0, 0), 0, 100),
            vec![ControllerAction::Confirm]
        );
    }
}
