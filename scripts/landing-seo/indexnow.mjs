// Pings IndexNow (Bing, Yandex, Seznam, Naver) with every URL in the sitemap so
// new pages get crawled in hours instead of weeks. Run AFTER the landing site
// has actually deployed - the key file must be reachable at
// https://playcounter.app/<key>.txt or the submission is rejected.
//
//   node scripts/landing-seo/indexnow.mjs
//
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST = "playcounter.app";
const KEY = "ca4ea6ad3df5381db4ba50053b8f2e22";

const sitemap = await readFile(
  join(HERE, "..", "..", "landing", "sitemap.xml"),
  "utf8",
);
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

const keyCheck = await fetch(`https://${HOST}/${KEY}.txt`).catch(() => null);
if (!keyCheck?.ok) {
  console.error(
    `Key file is not live at https://${HOST}/${KEY}.txt - deploy the landing site first.`,
  );
  process.exit(1);
}

const response = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({
    host: HOST,
    key: KEY,
    keyLocation: `https://${HOST}/${KEY}.txt`,
    urlList,
  }),
});

console.log(`Submitted ${urlList.length} URLs - ${response.status} ${response.statusText}`);
if (!response.ok) console.error(await response.text());
