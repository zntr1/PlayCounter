/**
 * Resolves once the current DOM has painted: after two animation frames.
 *
 * The main window starts hidden and only opens after the frontend reports a
 * painted frame. WebView2 keeps rendering a hidden window, but WKWebView on
 * macOS runs no animation frames until its window is shown, which would keep
 * the window hidden forever. The timeout stands in for the frames there.
 */
export function afterPaint(timeoutMs = 250): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  });
}
