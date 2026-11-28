//! Mouse buttons as hotkeys (docs/mouse-hotkeys-plan.md). Windows has no
//! RegisterHotKey for the mouse, so a thread asks every 10 ms whether the
//! middle button, Mouse 4 or Mouse 5 is down. That costs the same whatever
//! the mouse's rate and never sits in the game's input. The click still
//! reaches the game, so a button acts only while a running game is in front.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::AppHandle;

/// A click is held far longer; the spike caught 90 of 90 held 15 ms.
const TICK: Duration = Duration::from_millis(10);

/// Ctrl, Alt, Shift and Win as bits.
const CONTROL: u8 = 1;
const ALT: u8 = 2;
const SHIFT: u8 = 4;
const SUPER: u8 = 8;
/// The buttons as the recorder names them (shortcutKeys.ts).
const BUTTONS: [&str; 3] = ["MouseMiddle", "Mouse4", "Mouse5"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MouseShortcut {
    modifiers: u8,
    button: usize,
}

/// `Control+Mouse4` is a mouse shortcut; `Control+KeyP` is not (None).
pub fn parse(shortcut: &str) -> Result<Option<MouseShortcut>, String> {
    let mut parts: Vec<&str> = shortcut.split('+').collect();
    let Some(last) = parts.pop() else {
        return Ok(None);
    };
    let Some(button) = BUTTONS.iter().position(|name| *name == last) else {
        return Ok(None);
    };
    let mut modifiers = 0;
    for part in parts {
        modifiers |= match part {
            "Control" => CONTROL,
            "Alt" => ALT,
            "Shift" => SHIFT,
            "Super" => SUPER,
            _ => return Err(format!("Unknown modifier in {shortcut}")),
        };
    }
    Ok(Some(MouseShortcut { modifiers, button }))
}

/// The buttons down and the modifiers held at one tick.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct Buttons {
    down: [bool; 3],
    modifiers: u8,
}

/// The actions whose button went down since the last tick, with exactly
/// their modifiers held.
fn pressed(
    before: Buttons,
    now: Buttons,
    bindings: &HashMap<String, MouseShortcut>,
) -> Vec<String> {
    let mut actions: Vec<String> = bindings
        .iter()
        .filter(|(_, shortcut)| {
            now.down[shortcut.button]
                && !before.down[shortcut.button]
                && now.modifiers == shortcut.modifiers
        })
        .map(|(action, _)| action.clone())
        .collect();
    actions.sort();
    actions
}

#[derive(Default)]
struct Shared {
    bindings: HashMap<String, MouseShortcut>,
    game_pids: Vec<u32>,
    running: bool,
}

impl Shared {
    /// Sets or clears an action's button; refuses one another action has.
    fn set(&mut self, action: &str, shortcut: Option<MouseShortcut>) -> Result<(), String> {
        let Some(shortcut) = shortcut else {
            self.bindings.remove(action);
            return Ok(());
        };
        if self
            .bindings
            .iter()
            .any(|(other, taken)| other != action && *taken == shortcut)
        {
            return Err("This hotkey is already assigned to another action.".into());
        }
        self.bindings.insert(action.to_string(), shortcut);
        Ok(())
    }

    /// The thread runs only while a button is set and a game runs.
    fn needed(&self) -> bool {
        !self.bindings.is_empty() && !self.game_pids.is_empty()
    }
}

#[derive(Default)]
pub struct MouseHotkeys(Arc<Mutex<Shared>>);

impl MouseHotkeys {
    /// Sets or clears an action's button (None clears).
    pub fn set(
        &self,
        app: &AppHandle,
        action: &str,
        shortcut: Option<MouseShortcut>,
    ) -> Result<(), String> {
        let mut shared = self.0.lock().map_err(|error| error.to_string())?;
        shared.set(action, shortcut)?;
        self.start_if_needed(app, &mut shared);
        Ok(())
    }

    fn start_if_needed(&self, app: &AppHandle, shared: &mut Shared) {
        if shared.running || !shared.needed() {
            return;
        }
        shared.running = true;
        let state = self.0.clone();
        let app = app.clone();
        std::thread::spawn(move || watch(app, state));
    }
}

/// The running games' processes, from each scan (tracker.ts). A button acts
/// only while one of their windows is in front.
#[tauri::command]
pub fn set_mouse_hotkey_games(
    app: AppHandle,
    window: tauri::Window,
    mouse: tauri::State<'_, MouseHotkeys>,
    pids: Vec<u32>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("unauthorized window".into());
    }
    let mut shared = mouse.0.lock().map_err(|error| error.to_string())?;
    shared.game_pids = pids;
    mouse.start_if_needed(&app, &mut shared);
    Ok(())
}

/// std's sleep keeps 10 ms on Windows (spike: 98 ticks a second).
fn watch(app: AppHandle, state: Arc<Mutex<Shared>>) {
    // A button already held when the watcher starts doesn't count.
    let mut before = read_buttons();
    loop {
        std::thread::sleep(TICK);
        let now = read_buttons();
        let (actions, pids) = {
            let Ok(mut shared) = state.lock() else {
                return;
            };
            if !shared.needed() {
                shared.running = false;
                return;
            }
            (
                pressed(before, now, &shared.bindings),
                shared.game_pids.clone(),
            )
        };
        before = now;
        if !actions.is_empty() && crate::play_activity::game_in_front(&pids) {
            for action in actions {
                crate::hotkeys::fire(&app, &action);
            }
        }
    }
}

#[cfg(windows)]
fn read_buttons() -> Buttons {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VIRTUAL_KEY, VK_CONTROL, VK_LWIN, VK_MBUTTON, VK_MENU, VK_RWIN, VK_SHIFT,
        VK_XBUTTON1, VK_XBUTTON2,
    };
    let held = |key: VIRTUAL_KEY| (unsafe { GetAsyncKeyState(i32::from(key)) }) < 0;
    let mut modifiers = 0;
    if held(VK_CONTROL) {
        modifiers |= CONTROL;
    }
    if held(VK_MENU) {
        modifiers |= ALT;
    }
    if held(VK_SHIFT) {
        modifiers |= SHIFT;
    }
    if held(VK_LWIN) || held(VK_RWIN) {
        modifiers |= SUPER;
    }
    Buttons {
        down: [held(VK_MBUTTON), held(VK_XBUTTON1), held(VK_XBUTTON2)],
        modifiers,
    }
}

/// Mouse buttons are Windows only for now (docs/mouse-hotkeys-plan.md).
#[cfg(not(windows))]
fn read_buttons() -> Buttons {
    Buttons::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shortcut(text: &str) -> MouseShortcut {
        parse(text).unwrap().unwrap()
    }

    fn at(down: [bool; 3], modifiers: u8) -> Buttons {
        Buttons { down, modifiers }
    }

    fn bound(pairs: &[(&str, &str)]) -> HashMap<String, MouseShortcut> {
        pairs
            .iter()
            .map(|(action, text)| (action.to_string(), shortcut(text)))
            .collect()
    }

    #[test]
    fn reads_the_recorders_mouse_names_and_leaves_keys_to_the_plugin() {
        assert_eq!(
            shortcut("MouseMiddle"),
            MouseShortcut {
                modifiers: 0,
                button: 0
            }
        );
        assert_eq!(
            shortcut("Mouse4"),
            MouseShortcut {
                modifiers: 0,
                button: 1
            }
        );
        assert_eq!(
            shortcut("Control+Shift+Mouse5"),
            MouseShortcut {
                modifiers: CONTROL | SHIFT,
                button: 2
            }
        );
        assert_eq!(
            shortcut("Alt+Super+Mouse4"),
            MouseShortcut {
                modifiers: ALT | SUPER,
                button: 1
            }
        );
        assert_eq!(parse("Control+KeyP"), Ok(None));
        assert_eq!(parse("F8"), Ok(None));
        assert!(parse("Hyper+Mouse4").is_err());
    }

    #[test]
    fn a_press_fires_once_however_long_the_button_is_held() {
        let bindings = bound(&[("screenshot", "Mouse5")]);
        let up = at([false; 3], 0);
        let down = at([false, false, true], 0);
        assert_eq!(pressed(up, down, &bindings), vec!["screenshot".to_string()]);
        assert!(pressed(down, down, &bindings).is_empty());
        assert!(pressed(down, up, &bindings).is_empty());
        assert_eq!(pressed(up, down, &bindings), vec!["screenshot".to_string()]);
    }

    #[test]
    fn the_modifiers_must_match_like_a_keyboard_hotkey() {
        let bindings = bound(&[("quick-note", "Mouse4"), ("live-timer", "Control+Mouse4")]);
        let up = at([false; 3], 0);
        assert_eq!(
            pressed(up, at([false, true, false], 0), &bindings),
            vec!["quick-note".to_string()]
        );
        assert_eq!(
            pressed(up, at([false, true, false], CONTROL), &bindings),
            vec!["live-timer".to_string()]
        );
        assert!(pressed(up, at([false, true, false], SHIFT), &bindings).is_empty());
        // Another button does nothing.
        assert!(pressed(up, at([true, false, true], 0), &bindings).is_empty());
    }

    #[test]
    fn a_button_another_action_has_is_refused() {
        let mut shared = Shared::default();
        shared.set("screenshot", Some(shortcut("Mouse5"))).unwrap();
        assert_eq!(
            shared.set("quick-note", Some(shortcut("Mouse5"))),
            Err("This hotkey is already assigned to another action.".to_string())
        );
        // The same action may take it again, and others may take other buttons.
        shared.set("screenshot", Some(shortcut("Mouse5"))).unwrap();
        shared
            .set("quick-note", Some(shortcut("Control+Mouse5")))
            .unwrap();
        shared.set("screenshot", None).unwrap();
        shared
            .set("counter-key:deaths", Some(shortcut("Mouse5")))
            .unwrap();
    }

    #[test]
    fn the_watcher_runs_only_while_a_button_is_set_and_a_game_runs() {
        let mut shared = Shared::default();
        assert!(!shared.needed());
        shared.set("screenshot", Some(shortcut("Mouse5"))).unwrap();
        assert!(!shared.needed());
        shared.game_pids = vec![4242];
        assert!(shared.needed());
        shared.set("screenshot", None).unwrap();
        assert!(!shared.needed());
    }
}
