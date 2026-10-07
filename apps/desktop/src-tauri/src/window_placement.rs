//! Keeps the restored main window reachable. The saved geometry can point at
//! a monitor that is gone or at a spot mostly outside the screen, and the
//! frameless window then opens where it cannot be grabbed.
use crate::notification_overlay::PhysRect;

/// Where to move a window that is mostly off-screen, or `None` while at least
/// half of it sits on a monitor's work area.
pub fn reachable_rect(window: PhysRect, work_areas: &[PhysRect]) -> Option<PhysRect> {
    let window_area = area(window);
    let (best, visible) = work_areas
        .iter()
        .map(|work_area| (*work_area, overlap(window, *work_area)))
        .max_by_key(|(_, visible)| *visible)?;
    if window_area == 0 || visible * 2 >= window_area {
        return None;
    }
    let width = window.width.min(best.width);
    let height = window.height.min(best.height);
    Some(PhysRect {
        x: clamp_start(window.x, width, best.x, best.width),
        y: clamp_start(window.y, height, best.y, best.height),
        width,
        height,
    })
}

fn area(rect: PhysRect) -> u64 {
    u64::from(rect.width) * u64::from(rect.height)
}

fn overlap(a: PhysRect, b: PhysRect) -> u64 {
    let span = |a_start: i32, a_len: u32, b_start: i32, b_len: u32| {
        let start = i64::from(a_start).max(i64::from(b_start));
        let end =
            (i64::from(a_start) + i64::from(a_len)).min(i64::from(b_start) + i64::from(b_len));
        (end - start).max(0) as u64
    };
    span(a.x, a.width, b.x, b.width) * span(a.y, a.height, b.y, b.height)
}

fn clamp_start(start: i32, len: u32, area_start: i32, area_len: u32) -> i32 {
    let max = i64::from(area_start) + i64::from(area_len) - i64::from(len);
    i64::from(start).clamp(i64::from(area_start), max) as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: i32, y: i32, width: u32, height: u32) -> PhysRect {
        PhysRect {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn leaves_a_mostly_visible_window_alone() {
        let screen = rect(0, 0, 3024, 1964);
        assert_eq!(reachable_rect(rect(100, 100, 2920, 1520), &[screen]), None);
        // Partly past the edge, but more than half is on screen.
        assert_eq!(reachable_rect(rect(1000, 200, 2920, 1520), &[screen]), None);
    }

    #[test]
    fn pulls_a_mostly_hidden_window_back_onto_its_monitor() {
        let screen = rect(0, 0, 3024, 1964);
        assert_eq!(
            reachable_rect(rect(2380, 626, 2920, 1520), &[screen]),
            Some(rect(104, 444, 2920, 1520))
        );
    }

    #[test]
    fn moves_a_window_from_a_missing_monitor_and_shrinks_it_to_fit() {
        let screen = rect(0, 0, 1920, 1080);
        assert_eq!(
            reachable_rect(rect(-3000, 50, 2560, 1440), &[screen]),
            Some(rect(0, 0, 1920, 1080))
        );
    }

    #[test]
    fn prefers_the_monitor_holding_most_of_the_window() {
        let left = rect(-1920, 0, 1920, 1080);
        let right = rect(0, 0, 2560, 1440);
        assert_eq!(
            reachable_rect(rect(2000, 1000, 1200, 800), &[left, right]),
            Some(rect(1360, 640, 1200, 800))
        );
    }

    #[test]
    fn needs_a_monitor() {
        assert_eq!(reachable_rect(rect(0, 0, 100, 100), &[]), None);
    }
}
