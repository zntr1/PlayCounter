/* The API serves IGDB art at t_1080p (1920 wide). On a HiDPI screen, or with
   the content zoomed, a banner needs more than that, and IGDB has a 2x
   rendition of every size. Let the browser pick by device pixel ratio. */
export function artSrcSet(url: string) {
  const marker = "/t_1080p/";
  if (!url.includes(marker)) return undefined;
  return `${url} 1x, ${url.replace(marker, "/t_1080p_2x/")} 2x`;
}
