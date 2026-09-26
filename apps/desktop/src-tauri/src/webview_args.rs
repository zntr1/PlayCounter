/// WebView2 flags for every window. The main window gets the same string from
/// `additionalBrowserArgs` in tauri.conf.json: WebView2 refuses windows whose
/// flags differ on one data folder. Custom flags replace wry's defaults, so
/// the list repeats them (the ms* features and autoplay). The throttling
/// flags keep the tracker's timers on time while the page is hidden in the
/// tray; without them Chromium runs them once a minute there.
pub const WEBVIEW_BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,IntensiveWakeUpThrottling --autoplay-policy=no-user-gesture-required --disable-background-timer-throttling";
