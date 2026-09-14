// Cancel the browser menu while letting custom right-click handlers run.
function preventBrowserContextMenu(event: MouseEvent) {
  event.preventDefault();
}

document.addEventListener("contextmenu", preventBrowserContextMenu, true);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    document.removeEventListener(
      "contextmenu",
      preventBrowserContextMenu,
      true,
    );
  });
}
