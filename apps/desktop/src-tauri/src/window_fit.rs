//! Keeps the main window on its screen when it isn't maximized. The saved
//! window state can hold the full screen as the window's normal size; then
//! restoring it from maximized (or starting the app) gave a window bigger
//! than the screen, its bottom under the taskbar.

/// A rectangle in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Area {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Where a window whose page is `client` big goes instead, on a screen whose
/// free area (without the taskbar) is `work`: the app's first-start size,
/// at most 90 % of the free area, centered on it. None when it fits.
pub fn fitted(client: (u32, u32), work: Area, first_start: (u32, u32)) -> Option<Area> {
    if client.0 <= work.width && client.1 <= work.height {
        return None;
    }
    let width = first_start.0.min(work.width * 9 / 10);
    let height = first_start.1.min(work.height * 9 / 10);
    Some(Area {
        x: work.x + ((work.width - width) / 2) as i32,
        y: work.y + ((work.height - height) / 2) as i32,
        width,
        height,
    })
}

/// Checks the main window now, with its live state: a window that is
/// maximized, fullscreen, minimized or hidden is left alone.
pub fn keep_on_screen(window: &tauri::Window) {
    use tauri::Manager;
    let left_alone = |state: tauri::Result<bool>| state.unwrap_or(true);
    if left_alone(window.is_maximized())
        || left_alone(window.is_fullscreen())
        || left_alone(window.is_minimized())
        || !window.is_visible().unwrap_or(false)
    {
        return;
    }
    let (Ok(Some(monitor)), Ok(client)) = (window.current_monitor(), window.inner_size()) else {
        return;
    };
    let work = monitor.work_area();
    let scale = monitor.scale_factor();
    let first_start = window
        .app_handle()
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == window.label())
        .map(|config| {
            (
                (config.width * scale).round() as u32,
                (config.height * scale).round() as u32,
            )
        })
        .unwrap_or((1280, 720));
    let Some(target) = fitted(
        (client.width, client.height),
        Area {
            x: work.position.x,
            y: work.position.y,
            width: work.size.width,
            height: work.size.height,
        },
        first_start,
    ) else {
        return;
    };
    let _ = window.set_size(tauri::PhysicalSize::new(target.width, target.height));
    let _ = window.set_position(tauri::PhysicalPosition::new(target.x, target.y));
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Phil's left screen: 2560×1440, the taskbar takes the bottom 40.
    const LEFT_SCREEN: Area = Area {
        x: -2560,
        y: 0,
        width: 2560,
        height: 1400,
    };

    #[test]
    fn a_window_bigger_than_the_screen_comes_back_at_its_first_start_size() {
        // The restored size Windows kept: 2576×1449, a little more than the
        // whole screen.
        assert_eq!(
            fitted((2560, 1441), LEFT_SCREEN, (1820, 1030)),
            Some(Area {
                x: -2560 + 370,
                y: 185,
                width: 1820,
                height: 1030,
            })
        );
    }

    #[test]
    fn a_window_too_tall_or_too_wide_alone_is_also_too_big() {
        assert!(fitted((1800, 1420), LEFT_SCREEN, (1820, 1030)).is_some());
        assert!(fitted((2600, 900), LEFT_SCREEN, (1820, 1030)).is_some());
    }

    #[test]
    fn a_window_that_fits_stays_as_it_is() {
        assert_eq!(fitted((1820, 1030), LEFT_SCREEN, (1820, 1030)), None);
        // Filling the free area exactly still fits.
        assert_eq!(fitted((2560, 1400), LEFT_SCREEN, (1820, 1030)), None);
    }

    #[test]
    fn on_a_small_screen_it_takes_most_of_the_free_area() {
        let laptop = Area {
            x: 0,
            y: 0,
            width: 1366,
            height: 728,
        };
        assert_eq!(
            fitted((1400, 800), laptop, (1820, 1030)),
            // Centered: (1366 - 1229) / 2 and (728 - 655) / 2, rounded down.
            Some(Area {
                x: 68,
                y: 36,
                width: 1229,
                height: 655,
            })
        );
    }
}
