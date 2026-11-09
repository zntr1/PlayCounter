import { useAppStore } from "../store";

/** Settings, scrolled to Keyboard shortcuts. A dialog open on another page
 *  closes with that page. */
export function openKeyboardShortcuts() {
  useAppStore.getState().setActiveView("settings");
  let tries = 0;
  const scroll = () => {
    const panel = document.querySelector('[data-tour="settings-shortcuts"]');
    if (panel) panel.scrollIntoView({ block: "start", behavior: "smooth" });
    else if (tries++ < 20) requestAnimationFrame(scroll);
  };
  requestAnimationFrame(scroll);
}
