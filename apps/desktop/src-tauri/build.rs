fn main() {
    tauri_build::build();
    // Library tests that instantiate a real webview also link TaskDialogIndirect.
    // Tauri's executable resource does not reach the lib-test harness; request
    // Common Controls v6 there as well (the app already uses this assembly).
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
    }
}
