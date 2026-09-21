fn main() {
    // Icons are consumed by both the Windows resources and generate_context!.
    // Track the source directory so Cargo refreshes them even when no Rust or
    // Tauri configuration files changed (especially during `tauri dev`).
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build();
    // Native integration tests need Common Controls v6 for TaskDialogIndirect.
    // The app already embeds its own manifest through tauri_build; applying
    // these flags to the app would create a duplicate MANIFEST resource.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-tests=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
    }
}
