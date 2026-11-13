use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::Emitter;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[derive(Default)]
pub struct HotkeyState(Mutex<HashMap<String, Shortcut>>);

/// What a hotkey can do.
const ACTIONS: [&str; 10] = [
    "show-window",
    "current-session",
    "quick-note",
    "live-timer",
    "pause-timer",
    "screenshot",
    "screenshot-caption",
    "quick-add",
    "counter-undo",
    "counter-box",
];
/// A counter's own key: this prefix plus the counter's id (counterInput.ts).
const COUNTER_KEY_PREFIX: &str = "counter-key:";

/// The counter a counter key is for, if the action is one.
fn counter_key_id(action: &str) -> Option<&str> {
    action
        .strip_prefix(COUNTER_KEY_PREFIX)
        .filter(|id| !id.is_empty() && id.len() <= 64)
}

fn is_known_action(action: &str) -> bool {
    ACTIONS.contains(&action) || counter_key_id(action).is_some()
}

// Registration dispatches to the main loop, so never block it with synchronous IPC.
#[tauri::command(async)]
pub fn set_global_hotkey(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, HotkeyState>,
    action: String,
    shortcut: Option<String>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("unauthorized window".into());
    }
    if !is_known_action(&action) {
        return Err("Unknown hotkey action".into());
    }
    let next = shortcut
        .as_deref()
        .map(|value| value.parse::<Shortcut>().map_err(|error| error.to_string()))
        .transpose()?;
    let mut bindings = state.0.lock().map_err(|error| error.to_string())?;
    let previous = bindings.get(&action).copied();
    if previous == next {
        return Ok(());
    }
    if let Some(next) = next {
        if bindings.values().any(|existing| existing.id() == next.id()) {
            return Err("This hotkey is already assigned to another action.".into());
        }
        let handler_action = action.clone();
        let pressed = AtomicBool::new(false);
        app.global_shortcut()
            .on_shortcut(next, move |app, _, event| {
                if event.state == ShortcutState::Released {
                    pressed.store(false, Ordering::Release);
                    return;
                }
                if pressed.swap(true, Ordering::AcqRel) {
                    return;
                }
                match handler_action.as_str() {
                    "show-window" => crate::show_main_window(app),
                    "quick-note" => {
                        // The game is still in front here; the note window
                        // gives focus back to it when it closes.
                        crate::quick_note::remember_foreground(app);
                        let _ = app.emit_to("main", "playcounter:quick-note-hotkey", ());
                    }
                    "quick-add" => {
                        // As for the note: focus goes back to the window in
                        // front when the box closes.
                        crate::quick_note::remember_foreground(app);
                        let _ = app.emit_to("main", "playcounter:quick-add-hotkey", ());
                    }
                    "live-timer" => {
                        let _ = app.emit_to("main", "playcounter:live-timer-hotkey", ());
                    }
                    "pause-timer" => {
                        let _ = app.emit_to("main", "playcounter:pause-timer-hotkey", ());
                    }
                    "counter-undo" => {
                        let _ = app.emit_to("main", "playcounter:counter-undo-hotkey", ());
                    }
                    "counter-box" => {
                        // As for the note: focus goes back to the game when
                        // the box closes.
                        crate::quick_note::remember_foreground(app);
                        let _ = app.emit_to("main", "playcounter:counter-box-hotkey", ());
                    }
                    action if counter_key_id(action).is_some() => {
                        let id = counter_key_id(action).unwrap_or_default().to_string();
                        let _ = app.emit_to("main", "playcounter:counter-key-hotkey", id);
                    }
                    "screenshot" => {
                        // The picture is taken right here, before the main
                        // window says which session it belongs to.
                        crate::screenshot::commands::key_pressed(app);
                        let _ = app.emit_to("main", "playcounter:screenshot-hotkey", ());
                    }
                    "screenshot-caption" => {
                        // The same picture; the main window then opens the
                        // caption box over the game.
                        crate::screenshot::commands::key_pressed(app);
                        let _ = app.emit_to("main", "playcounter:screenshot-caption-hotkey", ());
                    }
                    _ => {
                        let _ = app.emit_to("main", "playcounter:current-session-hotkey", ());
                    }
                }
            })
            .map_err(|error| format!("Hotkey unavailable. Choose another combination. {error}"))?;
    }
    // Keep the old binding when the new one cannot be registered.
    if let Some(previous) = previous {
        if let Err(error) = app.global_shortcut().unregister(previous) {
            if let Some(next) = next {
                let _ = app.global_shortcut().unregister(next);
            }
            return Err(error.to_string());
        }
    }
    if let Some(next) = next {
        bindings.insert(action, next);
    } else {
        bindings.remove(&action);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_the_screenshot_actions_and_nothing_made_up() {
        for action in [
            "show-window",
            "current-session",
            "quick-note",
            "live-timer",
            "pause-timer",
            "screenshot",
            "screenshot-caption",
            "quick-add",
            "counter-undo",
            "counter-box",
            "counter-key:deaths",
            "counter-key:0b8f6c3e-2c1d-4a8e-9f00-1234567890ab",
        ] {
            assert!(is_known_action(action), "{action}");
        }
        assert!(!is_known_action("delete-everything"));
        assert!(!is_known_action(""));
        assert!(!is_known_action("counter-key:"));
        assert!(!is_known_action(&format!("counter-key:{}", "x".repeat(65))));
    }

    #[test]
    fn a_counter_key_names_its_counter() {
        assert_eq!(counter_key_id("counter-key:deaths"), Some("deaths"));
        assert_eq!(counter_key_id("counter-undo"), None);
        // Gone: counters have their own keys now.
        assert!(!is_known_action("counter-add"));
    }

    #[test]
    fn parses_the_recorders_physical_key_names() {
        for key in [
            "Control+Shift+KeyP",
            "Alt+Digit1",
            "Super+ArrowUp",
            "Control+Shift+Equal",
            "NumpadAdd",
            "NumpadSubtract",
            "Numpad1",
            "Control+Numpad5",
            "Control+Space",
            "Control+BracketLeft",
            "Control+Backquote",
            "Control+Quote",
            "Control+Backslash",
            "F8",
            "F24",
        ] {
            assert!(
                key.parse::<Shortcut>().is_ok(),
                "Unsupported recorder output: {key}"
            );
        }
        assert_eq!(
            "Control+Shift+KeyP".parse::<Shortcut>().unwrap().id(),
            "Ctrl+Shift+P".parse::<Shortcut>().unwrap().id(),
        );
    }
}
