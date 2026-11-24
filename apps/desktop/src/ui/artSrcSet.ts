/* The API serves IGDB art at t_1080p (1920 wide). On a HiDPI screen, or with
   the content zoomed, a banner needs more than that, and IGDB has a 2x
   rendition of every size. Let the browser pick by device pixel ratio. */
export function artSrcSet(url: string) {
  const marker = "/t_1080p/";
  if (!url.includes(marker)) return undefined;
  return `${url} 1x, ${url.replace(marker, "/t_1080p_2x/")} 2x`;
}

/* IGDB's screenshots come at t_1080p too. As small pictures in a grid or a
   strip they load IGDB's 569px rendition instead; other URLs stay as they
   are. */
export function igdbScreenshotThumb(url: string) {
  return url.replace("/t_1080p/", "/t_screenshot_med/");
}

/* In the viewer, one picture fills most of the screen, so it loads IGDB's 2x
   rendition at any screen scaling (Phil, 2026-11-24: 1080p looked soft).
   IGDB's originals are often wider than 1920 (2560 for Elden Ring); t_1080p
   shrinks and recompresses them, t_1080p_2x keeps their detail at about
   1 MB, where t_original is 5-9 MB. */
export function igdbScreenshotLarge(url: string) {
  return url.replace("/t_1080p/", "/t_1080p_2x/");
}
