import { useLayoutEffect, useRef } from "react";

export function ModalWindowDragRegion() {
  const regionRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const region = regionRef.current;
    const titleBars = document.querySelectorAll<HTMLElement>(
      ".app-titlebar, .app-sidebar > [data-tauri-drag-region]",
    );
    if (!region || titleBars.length === 0) return;

    // Use rendered bounds so menu scaling and banner height stay in sync.
    const syncHeight = () => {
      region.style.height = `${Math.max(
        ...Array.from(titleBars, (bar) => bar.getBoundingClientRect().bottom),
      )}px`;
    };
    syncHeight();
    const observer = new ResizeObserver(syncHeight);
    titleBars.forEach((bar) => observer.observe(bar));
    window.addEventListener("resize", syncHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncHeight);
    };
  }, []);

  return (
    <div
      ref={regionRef}
      aria-hidden="true"
      data-tauri-drag-region
      className="absolute inset-x-0 top-0 h-16"
    />
  );
}
