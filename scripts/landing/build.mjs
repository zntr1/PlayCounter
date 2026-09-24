import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { site, faq, mergedPages, retiredPages } from "./site.mjs";
import { productGuides } from "./guides-product.mjs";
import { launcherGuides } from "./guides-launchers.mjs";
import { gameGuides } from "./guides-games.mjs";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const guides = [...productGuides, ...launcherGuides, ...gameGuides];
const esc = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const date = (value) =>
  new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const url = (path) => `${site.origin}${path}`;
const assetVersion = (name) =>
  createHash("sha256")
    .update(
      readFileSync(resolve(root, `scripts/landing/${name}`), "utf8").replaceAll(
        "\r\n",
        "\n",
      ),
    )
    .digest("hex")
    .slice(0, 12);
// Bricolage Grotesque (latin, variable weight and optical size), already
// shipped in landing/fonts. Used for display type only.
const displayFont = "/fonts/pc-font-a97232426709.woff2";
const shotUrl = (key) => `/images/${site.screenshots[key].file}`;
const arrow = '<span aria-hidden="true">↗</span>';
const download = (label = "Download for Windows", secondary = false) =>
  `<a class="button${secondary ? " secondary" : ""}" href="${site.download}">${label} <span aria-hidden="true">↓</span></a>`;
const installer = () =>
  `Release ${site.version} · ${site.installerBytes ? `${(site.installerBytes / 1000000).toFixed(1)} MB installer` : "Windows installer"}`;
const brand = `<img class="brand-mark" src="/brands/playcounter-mark.svg" width="34" height="34" alt="" /><img class="brand-wordmark" src="/brands/playcounter-wordmark-on-dark.svg" width="1087" height="208" alt="PlayCounter" />`;
const steamSoon = `<p class="steam-soon"><img src="/brands/steam.svg" width="18" height="18" alt="" />${site.steamStatus}</p>`;
// The approved Amber loader. Its URL fragment selects the playback:
// #pc-amber-mark plays one cycle and holds, no fragment loops.
const animatedMark = (fragment = "", size = 56, cls = "") =>
  `<img class="${`animated-mark ${cls}`.trim()}" src="/brands/playcounter-loader.svg${fragment}" width="${size}" height="${Math.round(size * 0.8)}" alt="" />`;

// Lucide outlines for the app's own view names (ISC license).
const icons = {
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  games:
    '<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59l-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258l-.017-.151A4 4 0 0 0 17.32 5z"/>',
  history:
    '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  trophy:
    '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  journal:
    '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
};
const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;

// Concentric clock arcs and a stopwatch bezel, after the Steam page artwork.
const dial = `<svg class="dial" viewBox="0 0 1000 1000" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor">${[170, 250, 330, 410, 490].map((r) => `<circle cx="500" cy="500" r="${r}" stroke-opacity="${(0.2 - r / 3200).toFixed(3)}"/>`).join("")}<path class="dial-arc" d="M 500 750 A 250 250 0 0 1 250 500" pathLength="100" stroke-width="2.5" stroke-linecap="round"/></g><circle class="dial-tip" cx="250" cy="500" r="5"/></svg>`;
// A week of play as session marks: each dash is one session, its length the duration.
const sessionMarks = `<svg class="session-marks" viewBox="0 0 1200 8" preserveAspectRatio="none" aria-hidden="true" focusable="false">${[
  [0, 70],
  [86, 150],
  [252, 44],
  [312, 210],
  [538, 62],
  [616, 128],
  [760, 36],
  [812, 176],
  [1004, 58],
  [1078, 122],
]
  .map(
    ([x, w], index) =>
      `<rect x="${x}" y="2" width="${w}" height="4" rx="2"${index === 3 || index === 7 ? ' class="warm"' : ""}/>`,
  )
  .join("")}</svg>`;

// Game glyphs from scripts/landing/icons: Simple Icons are filled paths,
// Lucide icons are strokes. Both are inlined so CSS can color them.
function gameGlyph(file) {
  const svg = readFileSync(
    resolve(root, `scripts/landing/icons/${file}`),
    "utf8",
  );
  const inner = svg
    .slice(svg.indexOf(">", svg.indexOf("<svg")) + 1, svg.lastIndexOf("</svg>"))
    .replace(/<title>[^<]*<\/title>/, "")
    .replace(/\s+/g, " ")
    .trim();
  const paint = svg.includes('stroke="currentColor"')
    ? 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
    : 'fill="currentColor"';
  return `<svg class="game-glyph" viewBox="0 0 24 24" ${paint} aria-hidden="true" focusable="false">${inner}</svg>`;
}

function navigation() {
  const links =
    '<a href="/#features">Features</a><a href="/#imports">Imports</a><a href="/#emulators">Emulators</a><a href="/guides/">Guides</a>';
  return `<a class="skip-link" href="#main">Skip to content</a><header class="site-header"><div class="nav-wrap"><a class="brand" href="/" aria-label="PlayCounter home">${brand}</a><nav class="desktop-nav" aria-label="Main">${links}</nav><a class="nav-download" href="${site.download}">Download <span aria-hidden="true">↓</span></a><details class="mobile-menu"><summary>Menu</summary><nav aria-label="Mobile">${links}<a href="${site.download}">Download for Windows</a></nav></details></div></header>`;
}

function footer() {
  return `<footer class="site-footer"><div class="footer-top"><a class="brand" href="/" aria-label="PlayCounter home">${brand}</a><p>Every session counts. Automatic playtime tracking for Windows.</p><nav aria-label="Footer"><a href="/guides/">Guides</a><a href="${site.repository}">Source code ${arrow}</a><a href="${site.discord}">Discord ${arrow}</a><a href="${site.releases}">Releases ${arrow}</a></nav></div><div class="footer-bottom"><span>© 2026 PlayCounter</span><div><a href="/is-playcounter-safe/">Downloads &amp; privacy</a><a href="/datenschutz">Privacy policy</a><a href="/impressum">Legal notice</a></div></div><p class="trademarks">Screenshots show example data. Third-party game artwork and trademarks belong to their respective owners.</p></footer>`;
}

// Window captures ship a 1000px and a 2000px file; crops are 2x captures
// shown at their width/height, so they stay sharp without growing.
function image(key, { eager = false, sizes } = {}) {
  const shot = site.screenshots[key];
  const loading = eager
    ? 'fetchpriority="high" decoding="async"'
    : 'loading="lazy" decoding="async"';
  const srcset = shot.small
    ? ` srcset="/images/${shot.small} 1000w, ${shotUrl(key)} ${shot.width}w" sizes="${sizes ?? "(min-width: 1260px) 1200px, calc(100vw - 32px)"}"`
    : "";
  return `<img src="${shotUrl(key)}"${srcset} width="${shot.width}" height="${shot.height}" alt="${esc(shot.alt)}" ${loading} />`;
}

function screenshot(key, { eager = false, caption = true, sizes } = {}) {
  const shot = site.screenshots[key];
  return `<figure class="screenshot ${shot.kind === "crop" ? "is-crop" : "is-window"}"><a href="${shotUrl(key)}" target="_blank" rel="noopener" aria-label="Open full-size screenshot: ${esc(shot.alt)}">${image(key, { eager, sizes })}</a>${caption ? `<figcaption>PlayCounter ${site.version} · Example data</figcaption>` : ""}</figure>`;
}

function shell({
  title,
  description,
  path,
  body,
  graph = [],
  lang = "en",
  noindex = false,
}) {
  const social = site.screenshots.social;
  const website = {
    "@type": "WebSite",
    "@id": url("/#website"),
    url: url("/"),
    name: site.name,
    inLanguage: "en",
    description: site.description,
  };
  const organization = {
    "@type": "Organization",
    "@id": url("/#organization"),
    name: site.name,
    url: url("/"),
    logo: url("/icon.png"),
    sameAs: [site.repository],
  };
  return `<!doctype html>
<!-- Generated by scripts/landing/build.mjs. Edit content in scripts/landing/. -->
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<meta name="robots" content="${noindex ? "noindex, follow" : "index, follow, max-image-preview:large"}" />
<meta name="theme-color" content="#0d0d0e" />
<meta name="color-scheme" content="dark" />
<meta name="application-name" content="PlayCounter" />
${noindex ? "" : `<link rel="canonical" href="${url(path)}" />`}
<link rel="icon" href="/icon.png" />
<link rel="icon" type="image/svg+xml" href="/brands/playcounter-mark-small.svg" />
<link rel="apple-touch-icon" href="/icon.png" />
<link rel="preload" href="${displayFont}" as="font" type="font/woff2" crossorigin />
<link rel="stylesheet" href="/styles.css?v=${assetVersion("styles.css")}" />
<script src="/site.js?v=${assetVersion("site.js")}" defer></script>
<link rel="sitemap" type="application/xml" href="/sitemap.xml" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:type" content="${graph.some((item) => item["@type"] === "Article") ? "article" : "website"}" />
<meta property="og:url" content="${url(path)}" />
<meta property="og:site_name" content="PlayCounter" />
<meta property="og:locale" content="${lang === "de" ? "de_DE" : "en_US"}" />
<meta property="og:image" content="${url(shotUrl("social"))}" />
<meta property="og:image:width" content="${social.width}" />
<meta property="og:image:height" content="${social.height}" />
<meta property="og:image:alt" content="${esc(social.alt)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${url(shotUrl("social"))}" />
<meta name="twitter:image:alt" content="${esc(social.alt)}" />
${noindex ? "" : `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": [website, organization, ...graph] }, null, 2).replaceAll("<", "\\u003c")}</script>`}
</head>
<body>${navigation()}${body}${footer()}</body>
</html>
`;
}

const guideSteps = (guide) =>
  guide.sections.flatMap((section) => section.steps ?? []);
const stepLabel = (guide) => {
  const steps = guideSteps(guide);
  const images = steps.filter((step) => step.image).length;
  return steps.length
    ? `${steps.length} steps${images * 2 > steps.length ? " with screenshots" : ""}`
    : "";
};

function guideCard(guide, { thumb = false } = {}) {
  const shot = thumb && guide.thumb ? site.screenshots[guide.thumb] : null;
  const media = shot
    ? `<span class="guide-thumb" aria-hidden="true"><img src="/images/${shot.small ?? shot.file}" width="${shot.width}" height="${shot.height}" alt="" loading="lazy" decoding="async"${shot.width / shot.height > 2.2 ? ' class="is-wide"' : ""} /></span>`
    : "";
  return `<a class="guide-card${shot ? " has-thumb" : ""}" href="/${guide.slug}/">${media}<span class="guide-card-body"><span class="eyebrow">${guide.category}</span><h3>${esc(guide.title)}</h3><span class="card-link">${stepLabel(guide) || "Read guide"} <span aria-hidden="true">→</span></span></span></a>`;
}

function home() {
  const tour = [
    {
      icon: "play",
      view: "Now Playing",
      title: "A timer starts when your game does.",
      text: "Open a game the way you always do. PlayCounter recognizes it, shows a live session timer and saves the session when you quit. It can stay in the tray the whole time.",
      shot: "now",
    },
    {
      icon: "games",
      view: "My Games",
      title: "One library for every source.",
      text: "Covers, total hours and sessions for each game. Pin a favorite as a banner, sort by playtime, sort games onto shelves and give them a status like In progress or Finished. Dark or light, your choice.",
      shot: "grid",
    },
    {
      icon: "history",
      view: "My History",
      title: "See where your hours went.",
      text: "Every session with its date and length. Pick a range to see your total, your streaks, your longest session and your most played games.",
      shot: "history",
    },
    {
      icon: "trophy",
      view: "Achievements",
      title: "Milestones for the time you put in.",
      text: "Trophies for lifetime hours, monthly goals and per-game ladders unlock as you play. Nothing to set up.",
      shot: "achievements",
    },
    {
      icon: "journal",
      view: "Journal",
      title: "Notes and playthroughs for every game.",
      text: "Write down where you stopped. Start a new playthrough for New Game+ or a speedrun, each with its own playtime, note and sessions.",
      shot: "journal",
    },
  ];
  const sources = [
    "Steam",
    "Epic Games",
    "Battle.net",
    "Xbox app",
    "GOG",
    "EA app",
    "Ubisoft Connect",
    "Riot Client",
    "itch.io",
    "Disc installs",
    "Standalone .exe",
    "DOSBox",
    "Dolphin",
    "PCSX2",
  ];
  // Popular games whose own playtime is hard to find; each links to its guide.
  const popularGames = [
    [
      "Minecraft",
      "pickaxe.svg",
      "In-game stats per world",
      "/check-playtime-minecraft/",
    ],
    [
      "Roblox",
      "roblox.svg",
      "Only recent screen time",
      "/check-playtime-roblox/",
    ],
    [
      "Fortnite",
      "fortnite.svg",
      "Epic shows PC time only",
      "/check-playtime-fortnite/",
    ],
    [
      "League of Legends",
      "leagueoflegends.svg",
      "Match history, no total",
      "/check-playtime-riot-games/#league",
    ],
    [
      "VALORANT",
      "valorant.svg",
      "Match history, no total",
      "/check-playtime-riot-games/#valorant",
    ],
    [
      "World of Warcraft",
      "swords.svg",
      "/played per character",
      "/check-playtime-world-of-warcraft/",
    ],
    [
      "GTA & Red Dead",
      "rockstargames.svg",
      "Per save or character",
      "/check-playtime-rockstar-launcher/",
    ],
  ];
  const importerCards = site.importers
    .map(
      (item) =>
        `<article class="support-card${item.isNew ? " is-new" : ""}"><div class="support-heading"><span class="provider-logo ${item.id}"><img src="${item.logo}" width="38" height="38" alt="" loading="lazy" /></span><div><h3>${esc(item.name)}${item.isNew ? ' <span class="badge">New</span>' : ""}</h3><span>${item.method}</span></div></div><p class="brings">${item.brings}</p><p>${item.detail}</p><a class="text-link" href="${item.guide}">${item.guideLabel} <span aria-hidden="true">→</span></a></article>`,
    )
    .join("");
  const emulatorCards = site.emulators
    .map(
      (item) =>
        `<article class="support-card"><div class="support-heading"><span class="provider-logo ${item.id}"><img src="${item.logo}" width="42" height="42" alt="" loading="lazy" /></span><div><h3>${item.name}</h3><span>${item.systems}</span></div></div><p>${item.detail}</p></article>`,
    )
    .join("");
  const selected = [
    "check-playtime-battle-net",
    "check-playtime-world-of-warcraft",
    "adjust-total-playtime",
    "game-not-detected",
    "check-playtime-on-steam",
    "check-playtime-xbox-game-pass",
  ];
  const body = `<main id="main">
<section class="hero"><div class="hero-atmosphere" aria-hidden="true">${dial}</div><div class="wrap hero-copy"><p class="eyebrow">Free playtime tracker for Windows</p><h1>Every session <span>counts.</span></h1><p class="hero-lede">PlayCounter records how long you play, automatically. Start your games from Steam, Battle.net, Epic, a disc or an emulator: they all land in one library with one clear total each.</p><div class="hero-actions">${download()}<a class="button secondary" href="#features">See the app <span aria-hidden="true">↓</span></a></div><p class="download-meta">Free · No PlayCounter account · Windows</p>${steamSoon}</div><div class="wrap hero-shot"><div class="app-frame">${screenshot("library", { eager: true, caption: false })}<div class="session-chip" data-session-chip hidden aria-hidden="true">${animatedMark("", 52)}<span class="session-chip-body"><span class="session-chip-kicker">Current session</span><span class="session-chip-title">playcounter.app</span></span><span class="session-chip-time"><span>Session time</span><strong data-session-time>0:00</strong></span></div></div><p class="hero-caption">PlayCounter ${site.version} · Example data · <span class="milestone"><span aria-hidden="true" class="status-dot"></span>${site.milestone}</span></p>${sessionMarks}</div></section>
<section class="sources wrap" aria-labelledby="sources-title"><h2 id="sources-title" class="sources-title">Wherever your games come from</h2><ul class="source-list">${sources.map((source) => `<li>${source}</li>`).join("")}</ul><p class="sources-note">No importer or special launch setup needed for tracking. <a href="/supported-games/">Which games are recognized?</a></p><div class="popular"><h2 class="sources-title" id="popular-title">Popular games with hidden playtime</h2><p class="popular-note">These games don’t show one clear total. PlayCounter tracks them on your PC, and each guide shows where the game keeps its own numbers.</p><ul class="game-tiles" aria-labelledby="popular-title">${popularGames.map(([name, icon, hook, href]) => `<li><a href="${href}"><span class="game-icon">${gameGlyph(icon)}</span><span class="game-name">${esc(name)}</span><span class="game-hook">${esc(hook)}</span></a></li>`).join("")}</ul></div></section>
<section id="features" class="section"><div class="wrap section-heading"><p class="eyebrow">Inside the app</p><h2>Launch. Play. It’s recorded.</h2><p>A live timer while you play. A library, a history and milestones to come back to.</p></div><div class="wrap tour">${tour.map((item, index) => `<article class="tour-row${index % 2 ? " is-flipped" : ""}"><div class="tour-copy"><p class="view-label">${icon(item.icon)}${item.view}</p><h3>${item.title}</h3><p>${item.text}</p></div>${screenshot(item.shot, { sizes: "(min-width: 1260px) 760px, (min-width: 900px) 62vw, calc(100vw - 32px)" })}</article>`).join("")}</div><p class="wrap section-note">Your recorded sessions, notes and history stay on your PC. Game matching and a few other features use online services. <a href="/datenschutz#en">What the app sends online</a>.</p></section>
<section id="imports" class="section section-tint"><div class="wrap"><div class="section-heading"><p class="eyebrow">Imports</p><h2>Bring your earlier hours along.</h2><p>Tracking works without any import. Steam and Xbox imports are worth it: they bring in the hours those launchers recorded, so your totals start with your real playtime. Battle.net shares no playtime, so its import is optional.</p></div><div class="support-grid three">${importerCards}</div><div class="import-explainer"><div><h3>Every other launcher works too</h3><p>Battle.net, Epic, GOG, EA, Ubisoft, Riot, itch.io and standalone games are tracked as you play, no import needed. To include hours from before, set the game’s total yourself. <a href="/adjust-total-playtime/">How to adjust a total</a>.</p></div><div><h3>How totals add up</h3><p>Each launcher counts once. PlayCounter adds up the imported launcher totals, compares that with the time it tracked itself and shows the higher number. <a href="/total-playtime-across-all-launchers/#totals">See an example</a>.</p></div></div></div></section>
<section id="emulators" class="section"><div class="wrap"><div class="section-heading"><p class="eyebrow">Emulators</p><h2>The game, not just the emulator.</h2><p>Dedicated detection for DOSBox, Dolphin and PCSX2 gives each recognized game its own cover, total and sessions.</p></div><div class="support-grid three">${emulatorCards}</div>${screenshot("dosbox")}<p class="section-note">Some matches need your review. <a href="/playtime-tracker-for-emulators/">See supported variants, setup and detection details <span aria-hidden="true">→</span></a></p></div></section>
<section id="start" class="section section-tint"><div class="wrap"><div class="section-heading"><p class="eyebrow">Get started</p><h2>Ready in three steps.</h2></div><ol class="steps"><li><span class="step-number">1</span><h3>Install PlayCounter</h3><p>Download the free Windows app and open it. There is no account to create.</p></li><li><span class="step-number">2</span><h3>Play as usual</h3><p>Leave PlayCounter running, even in the tray. Start your games the way you always do.</p></li><li><span class="step-number">3</span><h3>Check your hours</h3><p>Now Playing shows the live session. My Games and My History keep your totals and sessions.</p></li></ol><p class="section-note">Game not showing up? <a href="/game-not-detected/">Add it in Discovered</a>. Want the details? <a href="/how-automatic-game-detection-works/">How detection works</a>.</p></div></section>
<section id="guides" class="section wrap"><div class="section-heading heading-row"><div><p class="eyebrow">Step-by-step guides</p><h2>Find your hours. Set them right.</h2></div><a class="text-link" href="/guides/">All guides <span aria-hidden="true">→</span></a></div><div class="guide-grid">${selected
    .map((slug) =>
      guideCard(
        guides.find((guide) => guide.slug === slug),
        { thumb: true },
      ),
    )
    .join("")}</div></section>
<section id="faq" class="section wrap faq-section"><div class="section-heading"><p class="eyebrow">Questions</p><h2>A few things to know.</h2></div><div class="faq-list">${faq.map(([question, answer]) => `<details><summary>${question}</summary><div><p>${answer}</p></div></details>`).join("")}</div></section>
<section id="download" class="download-section"><div class="wrap download-inner"><div class="download-mark"><img class="animated-mark" src="/brands/playcounter-loader-static.svg" data-animate-src="/brands/playcounter-loader.svg#pc-amber-mark" width="132" height="106" alt="" loading="lazy" /></div><div class="download-copy"><p class="eyebrow">PlayCounter for Windows</p><h2>Your next session starts here.</h2><p>Free to use. Desktop source available on GitHub.</p>${steamSoon}</div><div class="download-block">${download()}<p><a href="${site.releases}">${installer()}</a></p><a class="small-link" href="/is-playcounter-safe/">Download and verification details</a></div></div></section>
</main>`;
  const software = {
    "@type": "SoftwareApplication",
    "@id": url("/#software"),
    name: site.name,
    url: url("/"),
    description: site.description,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Windows",
    softwareVersion: site.version,
    ...(site.releaseDate ? { dateModified: site.releaseDate } : {}),
    downloadUrl: site.download,
    releaseNotes: site.releases,
    screenshot: url(shotUrl("library")),
    image: url(shotUrl("social")),
    author: { "@id": url("/#organization") },
    license: "https://opensource.org/license/mit",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      url: url("/#download"),
    },
    featureList: [
      "Automatic game playtime tracking across launchers",
      "Local session history, game library and journal",
      "Steam and Xbox playtime imports, Battle.net game import",
      "Manual playtime totals and missed sessions",
      "DOSBox, Dolphin and PCSX2 per-game detection",
      "Achievements, shelves, statuses and light and dark themes",
    ],
  };
  return shell({
    title: "Free Automatic Game Playtime Tracker for Windows | PlayCounter",
    description: site.description,
    path: "/",
    body,
    graph: [software],
  });
}

function breadcrumbs(items) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, path], index) => ({
      "@type": "ListItem",
      position: index + 1,
      name,
      item: url(path),
    })),
  };
}

// Numbered steps with a screenshot each. The order is the real sequence of
// clicks in the app, which is why these are numbered.
function steps(list) {
  return `<ol class="visual-steps">${list
    .map(
      (step) =>
        `<li class="visual-step${step.image && site.screenshots[step.image].kind === "crop" && site.screenshots[step.image].width < 660 ? " is-narrow" : ""}"><div class="visual-step-text"><h3>${step.title}</h3>${step.html}</div>${step.image ? screenshot(step.image, { caption: false, sizes: "(min-width: 900px) 720px, calc(100vw - 32px)" }) : ""}</li>`,
    )
    .join("")}</ol>`;
}

function guidePage(guide) {
  const path = `/${guide.slug}/`;
  const glance = guide.glance
    ? `<ol class="glance" aria-label="Quick overview">${guide.glance.map(([label, href]) => `<li><a href="${href}">${label}</a></li>`).join("")}</ol>`
    : "";
  const body = `<main id="main" class="article-wrap"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><a href="/guides/">Guides</a><span aria-hidden="true">/</span><span>${guide.category}</span></nav><article><header class="article-header"><p class="eyebrow">${guide.category}</p><h1>${esc(guide.title)}</h1><p class="article-answer">${guide.answer}</p><p class="article-meta">By the <a href="${site.repository}">PlayCounter project</a> · Updated <time datetime="${site.reviewed}">${date(site.reviewed)}</time>${stepLabel(guide) ? ` · ${stepLabel(guide)}` : ""}</p>${glance}</header><nav class="contents" aria-label="On this page"><strong>On this page</strong><ul>${guide.sections.map((section) => `<li><a href="#${section.id}">${section.title}</a></li>`).join("")}</ul></nav><div class="article-body">${guide.sections.map((section) => `<section id="${section.id}"><h2>${section.title}</h2>${section.intro ?? ""}${section.steps ? steps(section.steps) : ""}${section.html ?? ""}${section.screenshot ? screenshot(section.screenshot) : ""}</section>`).join("")}<section class="sources" id="sources"><h2>Sources &amp; further details</h2><ul>${guide.sources.map((source) => `<li><a href="${esc(source.url)}">${esc(source.label)}</a></li>`).join("")}</ul></section></div></article><aside class="article-download" aria-label="Get PlayCounter">${animatedMark("", 64)}<div><h2>Track your next PC session.</h2><p>Automatic tracking, local history and one game library.</p></div>${download()}</aside><section class="related"><h2>Related guides</h2><div class="guide-grid">${guide.related.map((slug) => guideCard(guides.find((item) => item.slug === slug))).join("")}</div><a class="text-link" href="/guides/">All PlayCounter guides <span aria-hidden="true">→</span></a></section></main>`;
  const firstImage =
    guide.thumb ??
    guide.sections.find((section) => section.screenshot)?.screenshot ??
    guide.sections.flatMap((section) => section.steps ?? [])[0]?.image ??
    "library";
  const article = {
    "@type": "Article",
    "@id": url(`${path}#article`),
    headline: guide.title,
    description: guide.description,
    dateModified: site.reviewed,
    inLanguage: "en",
    author: { "@id": url("/#organization") },
    publisher: { "@id": url("/#organization") },
    mainEntityOfPage: url(path),
    image: url(shotUrl(firstImage)),
  };
  return shell({
    title: `${guide.title} | PlayCounter`,
    description: guide.description,
    path,
    body,
    graph: [
      article,
      breadcrumbs([
        ["Home", "/"],
        ["Guides", "/guides/"],
        [guide.title, path],
      ]),
    ],
  });
}

function guideIndex() {
  const categories = ["Using PlayCounter", "Launcher guides", "Game guides"];
  const body = `<main id="main" class="wrap guide-index"><header class="section-heading"><p class="eyebrow">PlayCounter guides</p><h1>Find your playtime.<br />Get your setup right.</h1><p>Step-by-step instructions with screenshots for checking game hours, importing your games and setting totals on Windows.</p></header><nav class="guide-categories" aria-label="Guide categories">${categories.map((category, index) => `<a href="#category-${index}">${category}</a>`).join("")}</nav>${categories
    .map(
      (category, index) =>
        `<section id="category-${index}" class="guide-category"><h2>${category}</h2><div class="guide-grid">${guides
          .filter((guide) => guide.category === category)
          .map((guide) => guideCard(guide))
          .join("")}</div></section>`,
    )
    .join("")}</main>`;
  return shell({
    title: "Playtime Guides: Games, Launchers & Imports | PlayCounter",
    description:
      "Step-by-step guides with screenshots: check game hours, import Steam, Xbox and Battle.net games, add up WoW /played and set a game’s total playtime.",
    path: "/guides/",
    body,
    graph: [
      breadcrumbs([
        ["Home", "/"],
        ["Guides", "/guides/"],
      ]),
    ],
  });
}

function legalPage(name) {
  const content = readFileSync(
    resolve(root, `scripts/landing/legal/${name}.html`),
    "utf8",
  ).trim();
  const privacy = name === "datenschutz";
  return shell({
    title: privacy
      ? "Datenschutzerklärung / Privacy Policy | PlayCounter"
      : "Impressum / Legal Notice | PlayCounter",
    description: privacy
      ? "Privacy policy for the PlayCounter website and desktop app: local history, game matching, imports, emulator detection and installation presence."
      : "Legal notice, operator and contact information for PlayCounter.",
    path: `/${name}`,
    lang: "de",
    body: `<main id="main" class="article-wrap legal article-body">${content}</main>`,
  });
}

function notFound() {
  return shell({
    title: "Page not found | PlayCounter",
    description:
      "This page is no longer available. Browse the current PlayCounter features and practical playtime guides.",
    path: "/404",
    noindex: true,
    body: `<main id="main" class="wrap not-found">${animatedMark("", 120)}<p class="eyebrow">404 · Page not found</p><h1>This page isn’t here.</h1><p>The clock is still running, though. Find the app on the homepage, or browse the playtime guides.</p><div class="hero-actions"><a class="button" href="/">PlayCounter home</a><a class="button secondary" href="/guides/">Browse guides</a></div></main>`,
  });
}

export function buildOutputs() {
  const outputs = new Map([
    ["index.html", home()],
    ["guides/index.html", guideIndex()],
    ["datenschutz.html", legalPage("datenschutz")],
    ["impressum.html", legalPage("impressum")],
    ["404.html", notFound()],
  ]);
  for (const guide of guides)
    outputs.set(`${guide.slug}/index.html`, guidePage(guide));
  const pages = [
    "/",
    "/guides/",
    ...guides.map((guide) => `/${guide.slug}/`),
    "/datenschutz",
    "/impressum",
  ];
  outputs.set(
    "sitemap.xml",
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((path) => `  <url><loc>${url(path)}</loc><lastmod>${site.reviewed}</lastmod></url>`).join("\n")}\n</urlset>\n`,
  );
  outputs.set(
    "llms.txt",
    `# PlayCounter\n\n> ${site.description}\n\n- Public Windows release: ${site.version}${site.releaseDate ? `, published ${site.releaseDate}` : ""}. ${site.steamStatus}.\n- Free desktop app; no PlayCounter account required. Desktop source is MIT-licensed. The current production API is private.\n- Automatic tracking follows recognized running games, regardless of launcher. Unknown or ambiguous games can be reviewed locally in Discovered.\n- Imports: Steam (local account files, with playtime), Xbox (optional Microsoft sign-in; playtime availability varies by game) and Battle.net (optional: installed games or account sign-in, game list only, no historical playtime; Battle.net games are tracked without it).\n- Imported and adjusted totals do not recreate sessions. For a matched game, the displayed total is the higher of the PlayCounter total (tracked sessions plus any manual adjustment) and the sum of the imported launcher totals, counting each launcher once.\n- Earlier hours from launchers without a playtime import can be set with Adjust total playtime; a single missed session can be logged with its date.\n- Dedicated per-game emulator detection: DOSBox, Dolphin and PCSX2. Recognition depends on exposed game identifiers, files or titles.\n- Recorded sessions and history stay on the PC. Matching, metadata, updates and pseudonymous installation presence use online services; optional imports have additional data flows.\n\n## Official pages\n\n- [Features, imports and download](${url("/")})\n- [Guides](${url("/guides/")})\n- [Playtime totals](${url("/total-playtime-across-all-launchers/")})\n- [Set a game's total playtime](${url("/adjust-total-playtime/")})\n- [Battle.net and World of Warcraft](${url("/check-playtime-battle-net/")})\n- [Emulator support](${url("/playtime-tracker-for-emulators/")})\n- [Privacy policy](${url("/datenschutz#en")})\n- [Download verification and source](${url("/is-playcounter-safe/")})\n- [Public desktop source](${site.repository})\n- [Current releases](${site.releases})\n`,
  );
  // Azure treats /path and /path/ as duplicate routes. Emit one rule and let
  // trailingSlash: "auto" normalize file and directory URLs.
  const redirects = Object.entries(mergedPages).flatMap(([slug, destination]) =>
    ["", "/index", "/index.html", ".html"].map((suffix) => ({
      route: `/${slug}${suffix}`,
      redirect: destination,
      statusCode: 301,
    })),
  );
  // SWA's /index.html rules also match the directory itself. Redirect the
  // extensionless alias instead, after SWA's built-in HTML normalization.
  const aliases = [
    "index",
    ...["guides", ...guides.map((guide) => guide.slug)].map(
      (slug) => `${slug}/index`,
    ),
  ];
  const config = {
    trailingSlash: "auto",
    routes: [
      ...["datenschutz", "impressum"].flatMap((name) => [
        { route: `/${name}`, rewrite: `/${name}.html` },
        { route: `/${name}.html`, redirect: `/${name}`, statusCode: 301 },
      ]),
      ...redirects,
      ...aliases.map((alias) => ({
        route: `/${alias}`,
        redirect: alias === "index" ? "/" : `/${alias.slice(0, -6)}/`,
        statusCode: 301,
      })),
      {
        route: "/images/*",
        headers: { "Cache-Control": "public, max-age=31536000, immutable" },
      },
      {
        route: "/fonts/*",
        headers: { "Cache-Control": "public, max-age=31536000, immutable" },
      },
      {
        route: "/brands/*",
        headers: { "Cache-Control": "public, max-age=604800" },
      },
      {
        route: "/styles.css",
        headers: { "Cache-Control": "public, max-age=3600, must-revalidate" },
      },
      {
        route: "/site.js",
        headers: { "Cache-Control": "public, max-age=3600, must-revalidate" },
      },
    ],
    responseOverrides: { 404: { rewrite: "/404.html", statusCode: 404 } },
    globalHeaders: {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
      "X-Frame-Options": "DENY",
    },
  };
  outputs.set(
    "staticwebapp.config.json",
    `${JSON.stringify(config, null, 2)}\n`,
  );
  outputs.set(
    "robots.txt",
    `User-agent: *\nAllow: /\n\nSitemap: ${url("/sitemap.xml")}\n`,
  );
  outputs.set(
    "styles.css",
    readFileSync(resolve(root, "scripts/landing/styles.css"), "utf8"),
  );
  outputs.set(
    "site.js",
    readFileSync(resolve(root, "scripts/landing/site.js"), "utf8"),
  );
  for (const asset of [
    "playcounter-mark.svg",
    "playcounter-mark-small.svg",
    "playcounter-wordmark-on-dark.svg",
    "playcounter-loader.svg",
    "playcounter-loader-static.svg",
    "Bricolage-Grotesque-OFL.txt",
  ]) {
    outputs.set(
      `brands/${asset}`,
      readFileSync(resolve(root, `apps/desktop/public/brand/${asset}`), "utf8"),
    );
  }
  return outputs;
}

export const removedHtml = [...Object.keys(mergedPages), ...retiredPages].map(
  (slug) => `${slug}/index.html`,
);

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const outputs = buildOutputs();
  if (process.argv.includes("--check")) {
    const stale = [...outputs].filter(([path, content]) => {
      try {
        return (
          readFileSync(resolve(root, "landing", path), "utf8").replaceAll(
            "\r\n",
            "\n",
          ) !== content.replaceAll("\r\n", "\n")
        );
      } catch {
        return true;
      }
    });
    if (stale.length)
      throw new Error(
        `Generated landing files are out of date. Run node scripts/landing/build.mjs.\n${stale.map(([path]) => path).join("\n")}`,
      );
    console.log(`Generated output is current (${outputs.size} files).`);
  } else {
    for (const [path, content] of outputs) {
      const destination = resolve(root, "landing", path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, content);
    }
    console.log(`Built ${outputs.size} static files in landing/.`);
  }
}
