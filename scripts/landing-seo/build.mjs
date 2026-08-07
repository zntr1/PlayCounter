// Generates the landing-site guide pages from the content modules and rewrites
// sitemap.xml. Plain static HTML in, plain static HTML out - the Azure Static
// Web Apps deploy uploads /landing verbatim, so the output must be committed.
//
//   node scripts/landing-seo/build.mjs
//
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { launcherPages } from "./pages-launchers.mjs";
import { topicPages } from "./pages-topics.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LANDING = join(HERE, "..", "..", "landing");

const SITE = "https://playcounter.app";
const DOWNLOAD =
  "https://github.com/zntr1/PlayCounter/releases/latest/download/PlayCounter-Setup.exe";
const OG_IMAGE = `${SITE}/playcounter-og-2026-07-v2.png`;
const BUILD_DATE = "2026-08-07";

const pages = [...launcherPages, ...topicPages];

/** Pages that already exist as hand-written HTML; only the sitemap knows them. */
const staticPages = [
  { slug: "", lastmod: BUILD_DATE },
  { slug: "track-playtime-outside-steam", lastmod: "2026-07-12" },
  { slug: "playcounter-vs-playnite", lastmod: "2026-07-12" },
  { slug: "how-automatic-game-detection-works", lastmod: "2026-07-12" },
  { slug: "supported-games", lastmod: "2026-07-12" },
];

const legalPages = [
  { file: "impressum.html", lastmod: "2026-07-17" },
  { file: "datenschutz.html", lastmod: "2026-07-17" },
];

const escape = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Strip tags so schema text and reading times are computed on prose only. */
const plain = (html) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const readingMinutes = (page) => {
  const words = plain(
    page.sections.map((s) => s.body).join(" ") +
      " " +
      (page.faq ?? []).map((f) => f.a).join(" "),
  ).split(" ").length;
  return Math.max(3, Math.round(words / 220));
};

const prettyDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

const nav = (slug) => `
        <nav class="nav-items" aria-label="Main navigation">
          <a class="nav-link" href="/guides/"${
            slug === "guides" ? ' aria-current="page"' : ""
          }>Guides</a>
          <a class="nav-link" href="/how-automatic-game-detection-works/"
            >Detection</a
          >
          <a class="nav-link" href="/supported-games/">Games</a>
          <a
            class="nav-link"
            href="https://github.com/zntr1/PlayCounter"
            target="_blank"
            rel="noopener noreferrer"
            >GitHub</a
          >
          <a class="button button-primary" href="${DOWNLOAD}">Download</a>
        </nav>`;

const footer = `
    <footer class="site-footer">
      <div class="shell footer-shell">
        <div>
          <a class="brand" href="/">
            <img src="../icon.png" alt="" width="38" height="38" />
            <span>PlayCounter</span>
          </a>
          <div class="copyright">&copy; 2026 PlayCounter</div>
        </div>

        <nav class="footer-links" aria-label="Footer navigation">
          <a href="/guides/">All guides</a>
          <a href="/total-playtime-across-all-launchers/">Total playtime</a>
          <a href="/track-playtime-outside-steam/">Outside Steam</a>
          <a href="/playcounter-vs-playnite/">Comparison</a>
          <a href="/how-automatic-game-detection-works/">Detection guide</a>
          <a href="/supported-games/">Supported games</a>
          <a
            href="https://github.com/zntr1/PlayCounter/releases/latest"
            target="_blank"
            rel="noopener noreferrer"
            >Releases &amp; checksums</a
          >
          <a href="/impressum.html">Impressum</a>
          <a href="/datenschutz.html">Privacy</a>
        </nav>
      </div>
    </footer>`;

const relatedBlock = (related) =>
  related.length
    ? `
            <div class="related-links">
${related.map((r) => `              <a href="${r.href}">${escape(r.label)}</a>`).join("\n")}
            </div>`
    : "";

const faqBlock = (faq) =>
  faq.length
    ? `
      <section class="section" id="faq" aria-labelledby="faq-title">
        <div class="shell faq-layout">
          <div>
            <h2 class="section-heading" id="faq-title">Common questions</h2>
          </div>

          <div class="faq-list">
${faq
  .map(
    (item) => `            <details>
              <summary>${escape(item.q)}</summary>
              <div class="faq-answer">
                <p>${item.a}</p>
              </div>
            </details>`,
  )
  .join("\n\n")}
          </div>
        </div>
      </section>`
    : "";

const schema = (page, url, minutes) => {
  const graph = [
    {
      "@type": "BreadcrumbList",
      "@id": `${url}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "PlayCounter", item: `${SITE}/` },
        { "@type": "ListItem", position: 2, name: "Guides", item: `${SITE}/guides/` },
        { "@type": "ListItem", position: 3, name: page.breadcrumb, item: url },
      ],
    },
    {
      "@type": "Article",
      "@id": `${url}#article`,
      headline: page.h1,
      description: page.description,
      url,
      mainEntityOfPage: url,
      image: OG_IMAGE,
      datePublished: BUILD_DATE,
      dateModified: BUILD_DATE,
      inLanguage: "en",
      wordCount: plain(page.sections.map((s) => s.body).join(" ")).split(" ").length,
      timeRequired: `PT${minutes}M`,
      about: { "@id": `${SITE}/#software` },
      author: { "@type": "Organization", name: "PlayCounter", url: `${SITE}/` },
      publisher: {
        "@type": "Organization",
        name: "PlayCounter",
        url: `${SITE}/`,
        logo: { "@type": "ImageObject", url: `${SITE}/icon.png` },
      },
      isPartOf: { "@type": "WebSite", name: "PlayCounter", url: `${SITE}/` },
    },
  ];

  if (page.faq?.length) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${url}#faq`,
      mainEntity: page.faq.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: plain(item.a) },
      })),
    });
  }

  if (page.howTo?.length) {
    graph.push({
      "@type": "HowTo",
      "@id": `${url}#howto`,
      name: page.howToTitle ?? page.h1,
      step: page.howTo.map((step, i) => ({
        "@type": "HowToStep",
        position: i + 1,
        name: step.name,
        text: plain(step.text),
      })),
    });
  }

  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 2)
    .split("\n")
    .map((line) => `      ${line}`)
    .join("\n");
};

const render = (page) => {
  const url = `${SITE}/${page.slug}/`;
  const minutes = readingMinutes(page);
  const related = page.related ?? [];
  const faq = page.faq ?? [];

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />

    <title>${escape(page.title)}</title>
    <meta name="description" content="${escape(page.description)}" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <meta name="theme-color" content="#2457e6" />
    <meta name="application-name" content="PlayCounter" />

    <link rel="canonical" href="${url}" />
    <link rel="icon" href="../icon.png" />
    <link rel="apple-touch-icon" href="../icon.png" />
    <link rel="stylesheet" href="../styles.css" />
    <link rel="sitemap" type="application/xml" href="../sitemap.xml" />

    <meta property="og:title" content="${escape(page.ogTitle ?? page.title)}" />
    <meta property="og:description" content="${escape(page.description)}" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${url}" />
    <meta property="og:site_name" content="PlayCounter" />
    <meta property="og:locale" content="en_US" />
    <meta property="og:image" content="${OG_IMAGE}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta
      property="og:image:alt"
      content="PlayCounter recording playtime for a running Windows game"
    />
    <meta property="article:published_time" content="${BUILD_DATE}" />
    <meta property="article:modified_time" content="${BUILD_DATE}" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escape(page.ogTitle ?? page.title)}" />
    <meta name="twitter:description" content="${escape(page.description)}" />
    <meta name="twitter:image" content="${OG_IMAGE}" />
    <meta
      name="twitter:image:alt"
      content="PlayCounter automatically matching and timing a running Windows game"
    />

    <script type="application/ld+json">
${schema(page, url, minutes)}
    </script>
  </head>

  <body>
    <a class="skip-link" href="#main">Skip to main content</a>

    <header class="site-header">
      <div class="shell nav-shell">
        <a class="brand" href="/" aria-label="PlayCounter home">
          <img src="../icon.png" alt="" width="38" height="38" />
          <span>PlayCounter</span>
        </a>
${nav(page.slug)}
      </div>
    </header>

    <main id="main">
      <header class="article-hero">
        <div class="shell">
          <p class="breadcrumb">
            <a href="/">PlayCounter</a> / <a href="/guides/">Guides</a> /
            ${escape(page.breadcrumb)}
          </p>
          <p class="eyebrow">${escape(page.eyebrow)}</p>
          <h1>${escape(page.h1)}</h1>
          <p class="article-deck">${page.deck}</p>
          <p class="article-meta">
            Updated ${prettyDate(BUILD_DATE)} &middot; ${minutes} minute read
          </p>
        </div>
      </header>

      <section class="section">
        <div class="shell article-layout">
          <article class="article-body">
${page.sections
  .map(
    (section) => `            <h2>${escape(section.heading)}</h2>
${section.body}`,
  )
  .join("\n\n")}
          </article>

          <aside class="article-aside" aria-label="Download and related guides">
            <h2>${escape(page.asideTitle ?? "Track it automatically")}</h2>
            <p>${page.asideBody}</p>
            <a class="button button-primary" href="${DOWNLOAD}"
              >Download for Windows</a
            >${relatedBlock(related)}
          </aside>
        </div>
      </section>
${faqBlock(faq)}

      <section class="final-cta" aria-labelledby="download-title">
        <div class="shell cta-grid">
          <div>
            <h2 id="download-title">Download PlayCounter for Windows</h2>
            <p>${page.ctaBody}</p>
          </div>
          <div class="cta-box">
            <a class="button button-primary button-large" href="${DOWNLOAD}"
              >Download PlayCounter</a
            >
            <p>Windows &middot; Free &middot; No account</p>
          </div>
        </div>
      </section>
    </main>
${footer}
  </body>
</html>
`;
};

const renderSitemap = () => {
  const entries = [
    ...staticPages.map((p) => ({
      loc: `${SITE}/${p.slug ? `${p.slug}/` : ""}`,
      lastmod: p.lastmod,
    })),
    ...pages.map((p) => ({ loc: `${SITE}/${p.slug}/`, lastmod: BUILD_DATE })),
    ...legalPages.map((p) => ({ loc: `${SITE}/${p.file}`, lastmod: p.lastmod })),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (e) => `  <url>
    <loc>${e.loc}</loc>
    <lastmod>${e.lastmod}</lastmod>
  </url>`,
  )
  .join("\n")}
</urlset>
`;
};

const slugs = new Set();
for (const page of pages) {
  if (slugs.has(page.slug)) throw new Error(`Duplicate slug: ${page.slug}`);
  slugs.add(page.slug);
  if (page.title.length > 62) {
    console.warn(`  ! title ${page.title.length} chars: ${page.slug}`);
  }
  if (page.description.length > 158) {
    console.warn(`  ! description ${page.description.length} chars: ${page.slug}`);
  }

  const dir = join(LANDING, page.slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "index.html"), render(page), "utf8");
  console.log(`  wrote landing/${page.slug}/index.html`);
}

await writeFile(join(LANDING, "sitemap.xml"), renderSitemap(), "utf8");
console.log(`  wrote landing/sitemap.xml (${slugs.size + 7} urls)`);

// Sanity check: every related link must point at a page that exists.
const known = new Set([
  ...[...slugs].map((s) => `/${s}/`),
  ...staticPages.map((p) => `/${p.slug ? `${p.slug}/` : ""}`),
]);
for (const page of pages) {
  for (const r of page.related ?? []) {
    if (r.href.startsWith("/") && !known.has(r.href)) {
      console.warn(`  ! ${page.slug} links to unknown page ${r.href}`);
    }
  }
}

const home = await readFile(join(LANDING, "index.html"), "utf8");
if (!home.includes("/guides/")) {
  console.warn("  ! landing/index.html does not link to /guides/");
}
