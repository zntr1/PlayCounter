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

// Hero video: a silent preview loop plays while the frame is on screen. The
// button, a click on the video or any "#trailer" link plays the trailer with
// sound and controls in the same frame. Reduced motion or data saver keeps
// the poster until someone asks for the trailer. Without this script the
// frame is a plain trailer player.
const trailer = document.querySelector("[data-trailer]");
if (trailer) {
  const video = trailer.querySelector("video");
  const button = trailer.querySelector("[data-trailer-play]");
  const label = button.querySelector("[data-trailer-label]");
  const trailerSources = [...video.querySelectorAll("source")].map((source) =>
    source.cloneNode(),
  );
  const previewSources = [
    ["webm", trailer.dataset.previewWebm],
    ["mp4", trailer.dataset.previewMp4],
  ].map(([type, src]) =>
    Object.assign(document.createElement("source"), {
      src,
      type: `video/${type}`,
    }),
  );
  const useSources = (sources) => {
    video.replaceChildren(...sources.map((source) => source.cloneNode()));
    video.load();
  };
  const canPreview =
    !reducedMotion &&
    !navigator.connection?.saveData &&
    "IntersectionObserver" in window;
  let mode = "idle"; // idle (poster), preview (silent loop) or trailer
  let visible = false;

  const leaveTrailer = () => {
    trailer.classList.remove("is-playing");
    video.controls = false;
    video.tabIndex = -1;
    button.hidden = false;
  };
  const preview = () => {
    mode = "preview";
    leaveTrailer();
    video.muted = true;
    video.loop = true;
    useSources(previewSources);
    if (visible) video.play().catch(() => {});
  };
  const idle = () => {
    mode = "idle";
    leaveTrailer();
    useSources([]); // back to the poster
  };
  const playTrailer = () => {
    mode = "trailer";
    trailer.classList.add("is-playing");
    button.hidden = true;
    video.loop = false;
    video.muted = false;
    video.controls = true;
    video.tabIndex = 0;
    useSources(trailerSources);
    video.play().catch(() => {});
    video.focus({ preventScroll: true });
  };

  leaveTrailer();
  if (canPreview) {
    // The loop only starts loading once the frame is on screen.
    new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (mode === "idle" && visible) preview();
        else if (mode === "preview")
          visible ? video.play().catch(() => {}) : video.pause();
      },
      { threshold: 0.25 },
    ).observe(trailer);
  }

  button.addEventListener("click", playTrailer);
  video.addEventListener("click", () => {
    if (mode !== "trailer") playTrailer();
  });
  video.addEventListener("ended", () => {
    if (mode !== "trailer") return;
    label.textContent = "Watch again";
    if (canPreview) preview();
    else idle();
  });
  for (const link of document.querySelectorAll('a[href="#trailer"]'))
    link.addEventListener("click", (event) => {
      event.preventDefault();
      trailer.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "center",
      });
      playTrailer();
    });
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
