// Pause repeating animations while the main window is in the background, so a
// pulsing dot or a sheen never keeps the GPU busy while a game runs. One-time
// entrances (a banner, backdrop or dialog fading in) keep running: paused on
// their first frame they stayed invisible until PlayCounter got the focus,
// for example after opening it from the tray or on a second monitor.
let idle = false;

function repeats(animation: Animation) {
  // Infinity for endless animations.
  return (animation.effect?.getComputedTiming().iterations ?? 1) > 1;
}

function pauseRepeating() {
  for (const animation of document.getAnimations()) {
    if (repeats(animation)) animation.pause();
  }
}

function resumeRepeating() {
  for (const animation of document.getAnimations()) {
    if (repeats(animation) && animation.playState === "paused") {
      animation.play();
    }
  }
}

function syncIdle() {
  idle = document.hidden || !document.hasFocus();
  if (idle) pauseRepeating();
  else resumeRepeating();
}

// A repeating animation that starts while the window is idle stops at once.
function pauseNewWhileIdle() {
  if (idle) pauseRepeating();
}

window.addEventListener("focus", syncIdle);
window.addEventListener("blur", syncIdle);
document.addEventListener("visibilitychange", syncIdle);
document.addEventListener("animationstart", pauseNewWhileIdle);
syncIdle();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.removeEventListener("focus", syncIdle);
    window.removeEventListener("blur", syncIdle);
    document.removeEventListener("visibilitychange", syncIdle);
    document.removeEventListener("animationstart", pauseNewWhileIdle);
    idle = false;
    resumeRepeating();
  });
}
