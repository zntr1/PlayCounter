import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import { buildOutputs, guides, removedHtml, root } from "./build.mjs";
import { site, mergedPages, retiredPages } from "./site.mjs";

const directory = resolve(root, "landing");
const outputs = buildOutputs();
const expectedHtml = [...outputs.keys()].filter((path) =>
  path.endsWith(".html"),
);
const actualHtml = readdirSync(directory, { recursive: true })
  .filter((path) => path.endsWith(".html"))
  .map((path) => path.replaceAll("\\", "/"));
assert.deepEqual(
  actualHtml.sort(),
  expectedHtml.sort(),
  "HTML inventory differs from the reviewed page list",
);
for (const path of removedHtml)
  assert(
    !existsSync(resolve(directory, path)),
    `Retired content still exists: ${path}`,
  );

const decode = (value) =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
const attribute = (tag, name) =>
  decode(tag.match(new RegExp(`\\b${name}="([^"]*)"`, "i"))?.[1] ?? "");
const tags = (html, name) =>
  [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map(
    (match) => match[0],
  );
const metadata = (html, key) =>
  tags(html, "meta").find(
    (tag) =>
      attribute(tag, "name") === key || attribute(tag, "property") === key,
  );
const content = (html, key) => attribute(metadata(html, key) ?? "", "content");
const canonicalPath = (path) =>
  path === "index.html"
    ? "/"
    : path.endsWith("/index.html")
      ? `/${path.slice(0, -10)}`
      : `/${path.slice(0, -5)}`;
const files = new Map(expectedHtml.map((path) => [canonicalPath(path), path]));
const titles = new Set();
const descriptions = new Set();
const incoming = new Map();
let checkedLinks = 0;

for (const path of expectedHtml) {
  const html = readFileSync(resolve(directory, path), "utf8");
  const canonical = canonicalPath(path);
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
  assert(title && !titles.has(title), `Missing or duplicate title: ${path}`);
  titles.add(title);
  const description = content(html, "description");
  assert(
    description && !descriptions.has(description),
    `Missing or duplicate description: ${path}`,
  );
  descriptions.add(description);
  assert.equal(
    (html.match(/<h1(?:\s|>)/g) ?? []).length,
    1,
    `Expected one main heading: ${path}`,
  );
  assert(html.includes('<main id="main"'), `Missing main landmark: ${path}`);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size, `Duplicate fragment ID: ${path}`);
  const noindex = content(html, "robots").includes("noindex");
  assert.equal(
    noindex,
    path === "404.html",
    `Unexpected indexing directive: ${path}`,
  );
  if (!noindex) {
    const link = tags(html, "link").find(
      (tag) => attribute(tag, "rel") === "canonical",
    );
    assert.equal(
      attribute(link ?? "", "href"),
      `${site.origin}${canonical}`,
      `Wrong canonical: ${path}`,
    );
    assert.equal(
      content(html, "og:url"),
      `${site.origin}${canonical}`,
      `Wrong Open Graph URL: ${path}`,
    );
    const blocks = [
      ...html.matchAll(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
      ),
    ];
    assert(blocks.length, `Missing structured data: ${path}`);
    for (const [, json] of blocks) {
      const data = JSON.parse(json);
      assert.equal(data["@context"], "https://schema.org");
      assert(
        data["@graph"].every((node) => node["@type"] !== "FAQPage"),
        "Retired FAQ rich-result markup returned",
      );
      for (const node of data["@graph"]) {
        if (node["@type"] === "SoftwareApplication") {
          assert.equal(node.softwareVersion, site.version);
          assert.equal(node.downloadUrl, site.download);
          assert.equal(node.offers.price, "0");
        }
      }
    }
  }
  assert.equal(content(html, "og:title"), decode(title));
  assert.equal(content(html, "og:description"), description);
  assert.equal(content(html, "twitter:description"), description);
  for (const property of ["og:image", "twitter:image"]) {
    const image = new URL(content(html, property));
    assert.equal(image.origin, site.origin);
    assert(
      existsSync(resolve(directory, `.${image.pathname}`)),
      `Missing social image: ${path}`,
    );
  }
  for (const img of tags(html, "img")) {
    assert(/\balt="/.test(img), `Image has no alt attribute: ${path}`);
    assert(
      +attribute(img, "width") > 0 && +attribute(img, "height") > 0,
      `Missing image dimensions: ${path}`,
    );
  }
  for (const tag of [
    ...tags(html, "a"),
    ...tags(html, "link"),
    ...tags(html, "img"),
    ...tags(html, "script"),
  ]) {
    const value = attribute(tag, "href") || attribute(tag, "src");
    if (!value || /^(mailto:|data:)/.test(value)) continue;
    const target = new URL(value, `${site.origin}${canonical}`);
    if (target.origin !== site.origin) {
      if (
        tag.startsWith("<script") ||
        tag.startsWith("<img") ||
        tag.startsWith("<link")
      )
        assert.fail(`Unexpected external resource: ${value}`);
      assert.equal(
        target.protocol,
        "https:",
        `Insecure external link: ${value}`,
      );
      continue;
    }
    assert(
      !value.includes(".html"),
      `Internal link uses HTML alias: ${value} in ${path}`,
    );
    const targetPage = files.get(target.pathname);
    const targetFile = targetPage ?? target.pathname.slice(1);
    const absolute = resolve(directory, targetFile);
    assert(
      !relative(directory, absolute).startsWith(".."),
      `Link escapes landing directory: ${value}`,
    );
    assert(existsSync(absolute), `Broken local link ${value} in ${path}`);
    if (target.hash && targetPage) {
      const targetHtml = readFileSync(absolute, "utf8");
      assert(
        targetHtml.includes(`id="${decodeURIComponent(target.hash.slice(1))}"`),
        `Broken fragment ${value} in ${path}`,
      );
    }
    if (targetPage && targetPage !== path && tag.startsWith("<a"))
      incoming.set(targetPage, (incoming.get(targetPage) ?? 0) + 1);
    checkedLinks++;
  }
  assert(
    !/v1-0-6|factor of two|most tools fail|cracked games|FAQPage/i.test(html),
    `Obsolete content found: ${path}`,
  );
}
for (const path of expectedHtml.filter((path) => path !== "404.html"))
  assert(incoming.has(path), `Orphaned page: ${path}`);
for (const guide of guides) {
  assert(guide.sources.length > 0, `Guide lacks sources: ${guide.slug}`);
  assert.equal(
    new Set(guide.sections.map((section) => section.id)).size,
    guide.sections.length,
  );
}
const sitemap = readFileSync(resolve(directory, "sitemap.xml"), "utf8");
const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((match) => match[1])
  .sort();
assert.deepEqual(
  locations,
  [...files.keys()]
    .filter((path) => path !== "/404")
    .map((path) => `${site.origin}${path}`)
    .sort(),
  "Sitemap does not match canonical pages",
);
const config = JSON.parse(
  readFileSync(resolve(directory, "staticwebapp.config.json"), "utf8"),
);
assert(
  !config.navigationFallback,
  "Unknown URLs must not return the homepage with HTTP 200",
);
assert.equal(config.responseOverrides["404"].statusCode, 404);
assert.equal(config.responseOverrides["404"].rewrite, "/404.html");
for (const name of ["datenschutz", "impressum"]) {
  const canonical = config.routes.find((route) => route.route === `/${name}`);
  assert.equal(
    canonical?.rewrite,
    `/${name}.html`,
    `Missing legal-page rewrite: ${name}`,
  );
  for (const suffix of ["/", ".html"]) {
    const alias = config.routes.find(
      (route) => route.route === `/${name}${suffix}`,
    );
    assert.equal(alias?.statusCode, 301);
    assert.equal(alias.redirect, `/${name}`);
  }
}
for (const [slug, destination] of Object.entries(mergedPages)) {
  for (const suffix of ["", "/", "/index", "/index/", "/index.html", ".html"]) {
    const route = config.routes.find(
      (item) => item.route === `/${slug}${suffix}`,
    );
    assert.equal(route?.statusCode, 301);
    assert.equal(route.redirect, destination);
  }
}
for (const slug of retiredPages)
  assert(
    !config.routes.some((route) => route.route.startsWith(`/${slug}`)),
    `Unrelated redirect for removed page: ${slug}`,
  );
assert(
  !config.routes.some((route) => route.route === "/index.html"),
  "SWA index.html rules also match / and can create a redirect loop",
);
assert.equal(
  config.routes.find((route) => route.route === "/index")?.redirect,
  "/",
);
console.log(
  `Landing checks passed: ${files.size - 1} canonical pages, ${guides.length} sourced guides, ${checkedLinks} local links/assets, metadata, schema, sitemap and retirement rules.`,
);
