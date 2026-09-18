// Evaluated only on the authenticated Battle.net account page. Keep credentials,
// account identifiers and classic-game CD keys inside the temporary webview.
(() => {
  if (
    location.origin !== "https://account.battle.net" ||
    !/^\/(?:overview|games-and-subs)?\/?$/.test(location.pathname)
  )
    return null;

  const key = "__playcounterBattleNetLibrary";
  if (window[key]) return window[key];
  window[key] = { status: "pending" };

  async function read(path, field) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`/api/${path}`, {
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (response.status === 401 || response.status === 403) {
        return { error: "expired" };
      }
      if (!response.ok) return { error: "unavailable" };
      if (
        response.redirected ||
        response.url !== `https://account.battle.net/api/${path}` ||
        !response.headers.get("content-type")?.includes("application/json")
      )
        return { error: "invalid" };
      const body = await response.text();
      if (body.length > 4_000_000) return { error: "invalid" };
      const rows = JSON.parse(body)?.[field];
      if (!Array.isArray(rows) || rows.length > 1_000) {
        return { error: "invalid" };
      }
      const games = [];
      let skipped = false;
      for (const row of rows) {
        const titleId = field === "gameAccounts" ? Number(row?.titleId) : null;
        const name =
          typeof row?.localizedGameName === "string"
            ? row.localizedGameName.trim().slice(0, 256)
            : "";
        const franchise =
          typeof row?.regionalGameFranchiseIconFilename === "string"
            ? row.regionalGameFranchiseIconFilename.slice(0, 256)
            : null;
        if (
          (titleId !== null &&
            (!Number.isSafeInteger(titleId) ||
              titleId <= 0 ||
              titleId > 4_294_967_295)) ||
          (titleId === null && !name)
        ) {
          skipped = true;
          continue;
        }
        games.push({
          titleId,
          name: name || `Battle.net title ${titleId}`,
          franchise,
        });
      }
      return { games, skipped };
    } catch {
      return { error: "unavailable" };
    } finally {
      clearTimeout(timeout);
    }
  }

  void Promise.all([
    read("games-and-subs", "gameAccounts"),
    read("classic-games", "classicGames"),
  ])
    .then(([modern, classic]) => {
      if (modern.error === "expired") {
        window[key] = { status: "error", error: "expired" };
      } else if (modern.error && classic.error) {
        window[key] = { status: "error", error: "unavailable" };
      } else {
        window[key] = {
          status: "complete",
          games: [...(modern.games || []), ...(classic.games || [])],
          incomplete: Boolean(
            modern.error || classic.error || modern.skipped || classic.skipped,
          ),
        };
      }
    })
    .catch(() => {
      window[key] = { status: "error", error: "unavailable" };
    });
  return window[key];
})();
