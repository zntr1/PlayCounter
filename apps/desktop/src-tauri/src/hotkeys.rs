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
    if action != "show-window" && action != "current-session" {
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
            return Err("This hotkey is already assigned to the other action.".into());
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
                if handler_action == "show-window" {
                    crate::show_main_window(app);
                } else {
                    let _ = app.emit_to("main", "playcounter:current-session-hotkey", ());
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
    fn parses_the_recorders_physical_key_names() {
        for key in [
            "Control+Shift+KeyP",
            "Alt+Digit1",
            "Super+ArrowUp",
            "Control+Shift+Equal",
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
