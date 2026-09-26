// Pause CSS animations while the main window is in the background, so a
// pulsing dot or a sheen never keeps the GPU busy while a game runs.
function syncIdle() {
  const idle = document.hidden || !document.hasFocus();
  document.body.classList.toggle("window-idle", idle);
}

window.addEventListener("focus", syncIdle);
window.addEventListener("blur", syncIdle);
document.addEventListener("visibilitychange", syncIdle);
syncIdle();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.removeEventListener("focus", syncIdle);
    window.removeEventListener("blur", syncIdle);
    document.removeEventListener("visibilitychange", syncIdle);
    document.body.classList.remove("window-idle");
  });
}
