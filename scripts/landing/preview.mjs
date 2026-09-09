import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, relative, extname } from "node:path";
import { root } from "./build.mjs";

// A local static preview of the configured paths, redirects and response headers.
// Azure host/domain behavior still needs a deployment check; this is not SWA itself.
const directory = resolve(root, "landing");
const config = JSON.parse(
  readFileSync(resolve(directory, "staticwebapp.config.json"), "utf8"),
);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
const port = Number(process.env.PLAYCOUNTER_LANDING_PORT ?? 4180);
createServer((request, response) => {
  const headers = { ...config.globalHeaders };
  const send = (status, body = "", extra = {}) => {
    response.writeHead(status, { ...headers, ...extra });
    response.end(request.method === "HEAD" ? undefined : body);
  };
  let pathname;
  try {
    pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
  } catch {
    send(400);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    send(405, "", { Allow: "GET, HEAD" });
    return;
  }
  const rule = config.routes.find((route) =>
    route.route.endsWith("*")
      ? pathname.startsWith(route.route.slice(0, -1))
      : pathname === route.route,
  );
  if (rule?.headers) Object.assign(headers, rule.headers);
  if (rule?.redirect) {
    send(rule.statusCode ?? 302, "", { Location: rule.redirect });
    return;
  }
  if (pathname.endsWith(".html") && pathname !== "/404.html") {
    const file = resolve(directory, `.${pathname}`);
    if (existsSync(file)) {
      send(301, "", { Location: pathname.slice(0, -5) });
      return;
    }
  }
  let file = resolve(directory, `.${rule?.rewrite ?? pathname}`);
  if (
    relative(directory, file).startsWith("..") ||
    pathname.includes("\\") ||
    pathname.includes("\0")
  ) {
    send(400);
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) {
    file = resolve(file, "index.html");
    if (existsSync(file) && !pathname.endsWith("/")) {
      send(301, "", { Location: `${pathname}/` });
      return;
    }
  } else if (!extname(file) && existsSync(`${file}.html`)) file += ".html";
  if (!existsSync(file) || !statSync(file).isFile()) {
    const errorFile = resolve(
      directory,
      `.${config.responseOverrides["404"].rewrite}`,
    );
    send(404, readFileSync(errorFile), { "Content-Type": mime[".html"] });
    return;
  }
  send(200, readFileSync(file), {
    "Content-Type": mime[extname(file)] ?? "application/octet-stream",
  });
}).listen(port, "127.0.0.1", () =>
  console.log(`Landing preview: http://127.0.0.1:${port}`),
);
