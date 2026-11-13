import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".png": "image/png" };
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  let base = join(root, "public");
  if (rel.startsWith("/lib/")) {
    base = join(root, "dist", "src");
    rel = rel.slice(4);
  } else if (rel.startsWith("/examples/")) {
    base = join(root, "examples");
    rel = rel.slice(9);
  }
  const file = normalize(join(base, rel));
  if (!file.startsWith(base + sep) || (req.method !== "GET" && req.method !== "HEAD")) {
    res.writeHead(404).end("not found");
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "content-security-policy": CSP, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cache-control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

const port = Number(process.env["PORT"] ?? 8787);
server.listen(port, "127.0.0.1", () => console.log(`dfir-lens on http://127.0.0.1:${port}  (local only, nothing is uploaded)`));
