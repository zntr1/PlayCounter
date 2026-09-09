# Landing page maintenance

The public site is committed static HTML in `landing/`. Its source is here so
navigation, metadata, download facts and support lists stay consistent across
pages. No runtime framework, third-party scripts, analytics or external fonts
are required. The small local script only improves the native mobile menu.

```sh
corepack pnpm landing:build
corepack pnpm landing:check
corepack pnpm landing:preview
```

Preview uses `http://127.0.0.1:4180`. Set `PLAYCOUNTER_LANDING_PORT` to change it.
It models configured redirects and headers, but does not replace verification
on Azure Static Web Apps.

- `site.mjs`: verified public release, download, support lists and homepage FAQ.
  Development package versions can be ahead of a public release. Update the
  website facts after checking the published installer, size and release date.
- `guides-*.mjs`: distinct tasks, instructions, relevant sources and related links.
  Keep a page only when it provides useful instructions beyond the product pitch.
  Do not add comparison pages, gaming-motivation essays or speculative statistics.
- `build.mjs`: shared HTML and structured data, homepage, guide index, sitemap,
  `llms.txt`, robots and Azure route configuration. `llms.txt` is a factual summary,
  not a promised search or AI-ranking mechanism. Do not add fabricated ratings,
  testimonials or obsolete FAQ rich-result markup.
- `styles.css` and `site.js`: the site presentation. The renderer includes a
  content hash in their URLs so new markup receives the current assets.
- `legal/`: retained bilingual policy and legal text. Keep factual data-flow
  disclosures aligned with the desktop and backend; copy edits are not a legal
  clearance. The September update adds Steam and emulator disclosures.

`site.reviewed` is the explicit date of the full September 2026 content review;
it is not the build date. Do not bump it on every build or ordinary release.
If future edits affect only selected pages, introduce per-page modification
dates rather than assigning fresh dates to unchanged guides.

The roughly 200-user milestone is the owner's September 2026 estimate since
the June launch. It is not a count of online installations, monthly active users
or installer downloads. Update it only with a new confirmed milestone.

Screenshots in `landing/images/` show the real 1.1.16 React interface with example
data, labeled on the page. Future captures should use the current public UI and
an example library, without exposing accounts or paths. Change the filenames
when replacing them: versioned images are cached for a year. Game art and the
Steam, Xbox, DOSBox and Dolphin marks come from the existing repository assets.

Retired URLs are recorded in `site.mjs`. The generic Windows page merges into
the homepage; the old gaming-habits page points to the actual totals section.
Comparison, self-ranking and Steam Replay pages have no equivalent replacement
and return a real 404. Do not add a catch-all homepage rewrite.

Before publishing, run the checks and inspect home, imports, emulators, a game
guide and the legal pages on desktop and narrow mobile screens. Confirm the
download link against the latest public release. The Azure workflow validates
the committed output before uploading `landing/`; it currently deploys the
`test` branch. This implementation does not change deployment ownership.

After deployment, verify 200s for sitemap URLs, 301s for merged and `/index`
aliases, and 404s for retired and unknown URLs. Also check image cache headers.
Set the apex domain as the default domain in Azure to redirect `www` to
`playcounter.app`: host-based redirects are a hosting setting, not supported by
the path-only `routes` configuration. See Microsoft's
[default-domain instructions](https://learn.microsoft.com/en-us/azure/static-web-apps/custom-domain-default).
Canonicals and internal links use the apex.
Private Search Console/Bing data and production conversion measurements are
separate follow-up evidence; local validation cannot establish ranking gains.
