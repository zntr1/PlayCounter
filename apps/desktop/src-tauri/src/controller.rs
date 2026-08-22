use serde::Serialize;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use tauri::{Emitter, Manager};

const REVEAL_HOLD_MS: u64 = 2_000;
const REVEAL_COOLDOWN_MS: u64 = 3_000;
const DIRECTION_INITIAL_REPEAT_MS: u64 = 350;
const DIRECTION_REPEAT_MS: u64 = 120;
const SCROLL_REPEAT_MS: u64 = 16;
const REVEAL_FOCUS_GRACE_MS: u64 = 3_000;
const STICK_DEAD_ZONE: i16 = 16_000;
const SCROLL_DEAD_ZONE: i16 = 12_000;
const BUTTON_DPAD_UP: u16 = 0x0001;
const BUTTON_DPAD_DOWN: u16 = 0x0002;
const BUTTON_DPAD_LEFT: u16 = 0x0004;
const BUTTON_DPAD_RIGHT: u16 = 0x0008;
const BUTTON_VIEW: u16 = 0x0020;
const BUTTON_RIGHT_SHOULDER: u16 = 0x0200;
const BUTTON_A: u16 = 0x1000;
const BUTTON_B: u16 = 0x2000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ControllerAction {
    Reveal,
    Up,
    Down,
    Left,
    Right,
    ScrollUp,
    ScrollDown,
    Confirm,
    Back,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct ControllerEvent {
    action: ControllerAction,
    at: u64,
}

#[derive(Debug, Default, Clone)]
pub struct ControllerMachine {
    previous_buttons: u16,
    chord_started_at: Option<u64>,
    chord_fired: bool,
    reveal_cooldown_until: u64,
    held_direction: Option<ControllerAction>,
    direction_repeat_at: u64,
    held_scroll: Option<ControllerAction>,
    scroll_repeat_at: u64,
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

        let direction = if buttons & BUTTON_DPAD_UP != 0 || stick.1 > STICK_DEAD_ZONE {
            Some(ControllerAction::Up)
        } else if buttons & BUTTON_DPAD_DOWN != 0 || stick.1 < -STICK_DEAD_ZONE {
            Some(ControllerAction::Down)
        } else if buttons & BUTTON_DPAD_LEFT != 0 || stick.0 < -STICK_DEAD_ZONE {
            Some(ControllerAction::Left)
        } else if buttons & BUTTON_DPAD_RIGHT != 0 || stick.0 > STICK_DEAD_ZONE {
            Some(ControllerAction::Right)
        } else {
            None
        };

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

#[derive(Default)]
pub struct ControllerWatcher {
    generation: Arc<AtomicU64>,
}

#[tauri::command]
pub fn controller_watch_start(app: tauri::AppHandle, watcher: tauri::State<'_, ControllerWatcher>) {
    let generation = watcher.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let current = Arc::clone(&watcher.generation);
    tauri::async_runtime::spawn(async move {
        watch_controllers(app, current, generation).await;
    });
}

#[tauri::command]
pub fn controller_watch_stop(watcher: tauri::State<'_, ControllerWatcher>) {
    watcher.generation.fetch_add(1, Ordering::SeqCst);
}

#[tauri::command]
pub fn show_windows_onscreen_keyboard() -> Result<(), String> {
    #[cfg(windows)]
    {
        fn shell_open(path: &std::path::Path) -> Result<(), isize> {
            use std::os::windows::ffi::OsStrExt;
            use windows_sys::Win32::UI::{
                Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL,
            };

            let operation = "open".encode_utf16().chain(Some(0)).collect::<Vec<_>>();
            let file = path
                .as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect::<Vec<_>>();
            let result = unsafe {
                ShellExecuteW(
                    std::ptr::null_mut(),
                    operation.as_ptr(),
                    file.as_ptr(),
                    std::ptr::null(),
                    std::ptr::null(),
                    SW_SHOWNORMAL,
                )
            } as isize;
            if result > 32 {
                Ok(())
            } else {
                Err(result)
            }
        }

        let windows_dir = std::env::var_os("WINDIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::path::PathBuf::from(r"C:\Windows"));
        let osk = windows_dir.join("System32").join("osk.exe");
        let osk_error = match shell_open(&osk) {
            Ok(()) => return Ok(()),
            Err(error) => error,
        };

        let common_files = std::env::var_os("CommonProgramW6432")
            .or_else(|| std::env::var_os("CommonProgramFiles"));
        if let Some(common_files) = common_files {
            let tabtip = std::path::PathBuf::from(common_files)
                .join("microsoft shared")
                .join("ink")
                .join("TabTip.exe");
            if tabtip.is_file() {
                return shell_open(&tabtip).map_err(|error| {
                    format!(
                        "Windows rejected both on-screen keyboards (OSK code {osk_error}, touch keyboard code {error})."
                    )
                });
            }
        }
        Err(format!(
            "Windows rejected the on-screen keyboard (ShellExecute code {osk_error}); the touch keyboard was not found."
        ))
    }
    #[cfg(not(windows))]
    {
        Err("The Windows on-screen keyboard is only available on Windows.".to_string())
    }
}

#[cfg(windows)]
async fn watch_controllers(
    app: tauri::AppHandle,
    current_generation: Arc<AtomicU64>,
    generation: u64,
) {
    use windows_sys::Win32::UI::Input::XboxController::{XInputGetState, XINPUT_STATE};

    let started = std::time::Instant::now();
    let mut machines = std::array::from_fn::<_, 4, _>(|_| ControllerMachine::default());
    let mut next_probe_at = [0_u64; 4];
    let mut focus_grace_until = 0_u64;
    while current_generation.load(Ordering::SeqCst) == generation {
        let now_ms = started.elapsed().as_millis() as u64;
        let mut selected_actions = Vec::new();
        for slot in 0..4 {
            if now_ms < next_probe_at[slot] {
                continue;
            }
            let mut state = unsafe { std::mem::zeroed::<XINPUT_STATE>() };
            let result = unsafe { XInputGetState(slot as u32, &mut state) };
            if result != 0 {
                machines[slot].reset();
                next_probe_at[slot] = now_ms + 2_000;
                continue;
            }
            next_probe_at[slot] = now_ms;
            let actions = machines[slot].update(
                state.Gamepad.wButtons,
                (state.Gamepad.sThumbLX, state.Gamepad.sThumbLY),
                state.Gamepad.sThumbRY,
                now_ms,
            );
            if selected_actions.is_empty() && !actions.is_empty() {
                selected_actions = actions;
            }
        }
        for action in selected_actions {
            if action == ControllerAction::Reveal {
                focus_grace_until = now_ms + REVEAL_FOCUS_GRACE_MS;
            }
            let allow_focus_grace = now_ms <= focus_grace_until;
            emit_action(&app, action, now_ms, allow_focus_grace);
            if action != ControllerAction::Reveal && allow_focus_grace {
                focus_grace_until = 0;
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(16)).await;
    }
}

#[cfg(not(windows))]
async fn watch_controllers(
    _app: tauri::AppHandle,
    _current_generation: Arc<AtomicU64>,
    _generation: u64,
) {
}

fn emit_action(app: &tauri::AppHandle, action: ControllerAction, at: u64, allow_focus_grace: bool) {
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
    let _ = app.emit_to("main", "controller-input", ControllerEvent { action, at });
}

#[cfg(test)]
mod tests {
    use super::*;

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
        machine.update(0, (0, 0), 0, 2_300);
        machine.update(chord, (0, 0), 0, 2_400);
        assert!(machine.update(chord, (0, 0), 0, 4_000).is_empty());
        assert_eq!(
            machine.update(chord, (0, 0), 0, 5_000),
            vec![ControllerAction::Reveal]
        );
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
