// Authentication only: no library, account details or credentials leave this
// verified account page. A connection can be saved before any game-list work.
(() => {
  if (
    location.origin !== "https://account.battle.net" ||
    !/^\/(?:overview|games-and-subs)?\/?$/.test(location.pathname)
  )
    return null;

  const key = "__playcounterBattleNetAuthentication";
  if (window[key]) return window[key];
  window[key] = { status: "pending" };
  const fail = (error) => (window[key] = { status: "error", error });
  void (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch("/api/", {
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      const refused = response.status === 401 || response.status === 403;
      if (!response.ok && !refused) return fail("unavailable");
      if (
        response.redirected ||
        response.url !== "https://account.battle.net/api/" ||
        !response.headers.get("content-type")?.includes("application/json")
      )
        return fail(refused ? "renew" : "unavailable");
      const body = await response.text();
      if (body.length > 64_000) return fail("unavailable");
      let status;
      try {
        status = JSON.parse(body);
      } catch {
        return fail(refused ? "renew" : "unavailable");
      }
      if (status?.authenticated === false) return fail("expired");
      if (refused) return fail("renew");
      if (status?.authenticated !== true) return fail("unavailable");
      window[key] = { status: "complete", games: [], incomplete: false };
    } catch {
      fail("unavailable");
    } finally {
      clearTimeout(timeout);
    }
  })();
  return window[key];
})();
