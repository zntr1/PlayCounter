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

  async function request(path, limit, authentication = false) {
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
      const refused = response.status === 401 || response.status === 403;
      if (!response.ok && !refused) return { error: "unavailable" };
      if (
        response.redirected ||
        response.url !== `https://account.battle.net/api/${path}` ||
        !response.headers.get("content-type")?.includes("application/json")
      )
        return { error: refused ? "renew" : "unavailable" };
      const body = await response.text();
      if (body.length > limit) return { error: "unavailable" };
      let data;
      try {
        data = JSON.parse(body);
      } catch {
        return { error: refused ? "renew" : "unavailable" };
      }
      // A library denial or an HTML challenge does not prove that the saved
      // login is gone. Only the account-status response can establish that.
      if (authentication && data?.authenticated === false) {
        return { error: "expired" };
      }
      if (refused) return { error: "renew" };
      if (authentication && data?.authenticated !== true) {
        return { error: "unavailable" };
      }
      return { data };
    } catch {
      return { error: "unavailable" };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function read(path, field) {
    const result = await request(path, 4_000_000);
    if (result.error) return result;
    const rows = result.data?.[field];
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
  }

  void (async () => {
    const authentication = await request("", 64_000, true);
    if (authentication.error) {
      window[key] = { status: "error", error: authentication.error };
      return;
    }
    const [modern, classic] = await Promise.all([
      read("games-and-subs", "gameAccounts"),
      read("classic-games", "classicGames"),
    ]);
    if (modern.error === "renew") {
      window[key] = { status: "error", error: "renew" };
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
  })().catch(() => {
    window[key] = { status: "error", error: "unavailable" };
  });
  return window[key];
})();
