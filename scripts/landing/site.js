// Optional enhancements; navigation and all page content work without JavaScript.
const menu = document.querySelector(".mobile-menu");
if (menu) {
  menu.addEventListener("click", (event) => {
    if (event.target.closest("a")) menu.open = false;
  });
  document.addEventListener("click", (event) => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.open) {
      menu.open = false;
      menu.querySelector("summary").focus();
    }
  });
}

// The hero's "Current session" popup counts this visit, in the browser only.
const chip = document.querySelector("[data-session-chip]");
if (chip) {
  const output = chip.querySelector("[data-session-time]");
  const pad = (value) => String(value).padStart(2, "0");
  const tick = () => {
    const seconds = Math.floor(performance.now() / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    output.textContent = hours
      ? `${hours}:${pad(minutes)}:${pad(seconds % 60)}`
      : `${minutes}:${pad(seconds % 60)}`;
  };
  tick();
  chip.hidden = false;
  setInterval(tick, 1000);
}

// Play the stopwatch once when the download section comes into view.
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
for (const mark of document.querySelectorAll("[data-animate-src]")) {
  if (reducedMotion || !("IntersectionObserver" in window)) continue;
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      mark.src = mark.dataset.animateSrc;
      observer.disconnect();
    },
    { threshold: 0.6 },
  );
  observer.observe(mark);
}

// WoW /played calculator: characters' totals in, one PlayCounter total out.
const calc = document.querySelector("[data-played-calc]");
if (calc) {
  const rows = calc.querySelector("[data-calc-rows]");
  const add = calc.querySelector("[data-calc-add]");
  const read = (row, unit) =>
    Math.max(
      0,
      Math.floor(Number(row.querySelector(`[data-unit="${unit}"]`).value) || 0),
    );
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const update = () => {
    let minutes = 0;
    for (const row of rows.children)
      minutes += read(row, "d") * 1440 + read(row, "h") * 60 + read(row, "m");
    const hours = Math.floor(minutes / 60);
    calc.querySelector("[data-calc-hours]").textContent = hours;
    calc.querySelector("[data-calc-minutes]").textContent = minutes % 60;
    calc.querySelector("[data-calc-days]").textContent =
      `= ${plural(Math.floor(hours / 24), "day")}, ${plural(hours % 24, "hour")}, ${plural(minutes % 60, "minute")}`;
  };
  const renumber = () => {
    [...rows.children].forEach((row, index) => {
      for (const input of row.querySelectorAll("input"))
        input.setAttribute(
          "aria-label",
          input
            .getAttribute("aria-label")
            .replace(/Character \d+/, `Character ${index + 1}`),
        );
      const remove = row.querySelector("[data-calc-remove]");
      remove.setAttribute("aria-label", `Remove character ${index + 1}`);
      remove.hidden = rows.children.length < 2;
    });
  };
  calc.addEventListener("submit", (event) => event.preventDefault());
  calc.addEventListener("input", update);
  calc.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-calc-remove]");
    if (!remove || rows.children.length < 2) return;
    remove.closest("[data-calc-row]").remove();
    renumber();
    update();
    add.focus();
  });
  add.addEventListener("click", () => {
    const row = rows.lastElementChild.cloneNode(true);
    for (const input of row.querySelectorAll("input")) input.value = "";
    rows.append(row);
    renumber();
    update();
    row.querySelector("input").focus();
  });
  add.hidden = false;
  renumber();
  update();
}
