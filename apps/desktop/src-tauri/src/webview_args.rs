/// WebView2 flags for every window. The main window gets the same string from
/// `additionalBrowserArgs` in tauri.conf.json: WebView2 refuses windows whose
/// flags differ on one data folder. Custom flags replace wry's defaults, so
/// the list repeats them (the ms* features and autoplay). The throttling
/// flags keep the tracker's timers on time while the page is hidden in the
/// tray; without them Chromium runs them once a minute there.
pub const WEBVIEW_BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,IntensiveWakeUpThrottling --autoplay-policy=no-user-gesture-required --disable-background-timer-throttling";

#[cfg(test)]
mod tests {
    use super::WEBVIEW_BROWSER_ARGS;

    #[test]
    fn every_window_in_the_config_uses_the_shared_flags() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let windows = config["app"]["windows"].as_array().unwrap();
        assert!(!windows.is_empty());
        for window in windows {
            assert_eq!(
                window["additionalBrowserArgs"].as_str(),
                Some(WEBVIEW_BROWSER_ARGS),
                "tauri.conf.json and webview_args.rs must list the same WebView2 flags"
            );
        }
    }
}
