import http from "node:http";
import fs from "fs-extra";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

export async function startPreviewServer(
  rootDir: string,
  port: number
): Promise<{ url: string; close: () => Promise<void> }> {
  const root = path.resolve(rootDir);
  const entryPages = await readEntryPages(root);
  loadEnvFiles(root);

  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || `localhost:${port}`;
      const url = new URL(req.url || "/", `http://${host}`);

      // Contact form → Resend
      if (url.pathname === "/api/contact" || url.pathname === "/api/contact/") {
        return handleContactApi(req, res);
      }

      // Same-origin proxy for the site's own APIs. Their CORS allowlists name
      // the production host, so XHR from localhost is rejected outright.
      if (url.pathname === PROXY_PATH) {
        return proxyRequest(req, res, url.searchParams.get("url"));
      }

      // Stub Next RSC / data requests
      if (url.searchParams.has("_rsc") || url.pathname.includes("/_next/data/")) {
        res.writeHead(200, { "content-type": "text/x-component" });
        res.end("{}");
        return;
      }

      // Emulate /_next/image?url=/assets/...
      if (url.pathname.includes("/_next/image")) {
        const inner = url.searchParams.get("url");
        if (inner) {
          const assetPath = inner.startsWith("http")
            ? new URL(inner).pathname
            : inner;
          const filePath = safeJoin(root, assetPath);
          if (filePath && (await fs.pathExists(filePath))) {
            return sendFile(res, filePath);
          }
        }
        res.writeHead(404);
        res.end("image not found");
        return;
      }

      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith("/")) pathname += "index.html";
      if (pathname === "/") pathname = "/index.html";

      let filePath = safeJoin(root, pathname);
      if (filePath && (await fs.pathExists(filePath)) && (await fs.stat(filePath)).isDirectory()) {
        filePath = path.join(filePath, "index.html");
      }

      if (!filePath || !(await fs.pathExists(filePath))) {
        // Only navigations get the SPA fallback. Serving HTML for a missing
        // image or script would mask the 404 behind a confusing parse error.
        if (acceptsHtml(req)) {
          const fallback = await findSpaFallback(root, pathname, entryPages);
          if (fallback) return sendFile(res, fallback);
        }
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      return sendFile(res, filePath);
    } catch (err) {
      res.writeHead(500);
      res.end(err instanceof Error ? err.message : "Server error");
    }
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  return {
    url: `http://localhost:${port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

export const PROXY_PATH = "/__clone-proxy";

function loadEnvFiles(siteRoot: string): void {
  const candidates = [
    path.resolve(siteRoot, ".env"),
    path.resolve(siteRoot, "..", ".env"),
    path.resolve(siteRoot, "..", "..", ".env"),
    path.resolve(process.cwd(), ".env"),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, "utf8");
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 1) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = val;
      }
    } catch {
      // ignore
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function handleContactApi(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const cors: Record<string, string> = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "Content-Type",
    "content-type": "application/json",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, cors);
    res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
    return;
  }

  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw.toString("utf8") || "{}") as Record<
      string,
      unknown
    >;
    const type = String(body.type || "contact").trim().toLowerCase();
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim();
    const phone = String(body.phone || "").trim();
    const message = String(body.message || "").trim();
    const source = String(body.source || "website").trim();

    const isNewsletter = type === "newsletter";

    if (!email || (!isNewsletter && (!name || !message))) {
      res.writeHead(400, cors);
      res.end(
        JSON.stringify({
          ok: false,
          error: isNewsletter
            ? "Email is required."
            : "Name, email, and message are required.",
        })
      );
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.writeHead(400, cors);
      res.end(JSON.stringify({ ok: false, error: "Invalid email." }));
      return;
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      res.writeHead(500, cors);
      res.end(
        JSON.stringify({ ok: false, error: "Email service not configured." })
      );
      return;
    }

    const to =
      process.env.RESEND_TO || "saadnaseeroffice@gmail.com";
    const from =
      process.env.RESEND_FROM || "The Aussies <onboarding@resend.dev>";
    const intendedTo = process.env.RESEND_INTENDED_TO || "contact@theaussies.org";

    const subject = isNewsletter
      ? `Newsletter signup → ${intendedTo}`
      : `Website enquiry from ${name || email} → ${intendedTo}`;

    const html = isNewsletter
      ? `<h2>Newsletter signup — The Aussies</h2>
<p><strong>Deliver to (business inbox):</strong> ${escapeHtml(intendedTo)}</p>
<p><strong>Email:</strong> ${escapeHtml(email)}</p>
<p><strong>Source:</strong> ${escapeHtml(source)}</p>`
      : `<h2>New enquiry from The Aussies website</h2>
<p><strong>Deliver to (business inbox):</strong> ${escapeHtml(intendedTo)}</p>
<p><strong>Source:</strong> ${escapeHtml(source)}</p>
<p><strong>Name:</strong> ${escapeHtml(name)}</p>
<p><strong>Email:</strong> ${escapeHtml(email)}</p>
<p><strong>Phone:</strong> ${escapeHtml(phone || "—")}</p>
<p><strong>Message:</strong></p>
<p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>`;

    const text = isNewsletter
      ? `Newsletter signup (forward to ${intendedTo})\nEmail: ${email}\nSource: ${source}`
      : `New enquiry (forward to ${intendedTo})\nSource: ${source}\nName: ${name}\nEmail: ${email}\nPhone: ${phone || "—"}\n\n${message}`;

    const upstream = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: email,
        subject,
        html,
        text,
      }),
    });

    const data = (await upstream.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
    };
    if (!upstream.ok) {
      res.writeHead(502, cors);
      res.end(
        JSON.stringify({
          ok: false,
          error: data.message || "Failed to send email.",
        })
      );
      return;
    }

    res.writeHead(200, cors);
    res.end(JSON.stringify({ ok: true, id: data.id || null }));
  } catch (err) {
    res.writeHead(500, cors);
    res.end(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : "Server error.",
      })
    );
  }
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "content-encoding",
  "content-length",
  "host",
  "origin",
  "referer",
]);

async function proxyRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  target: string | null
): Promise<void> {
  const corsHeaders: Record<string, string> = {
    "access-control-allow-origin": req.headers.origin || "*",
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": req.headers["access-control-request-headers"] || "*",
    "access-control-max-age": "600",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (!target || !/^https?:\/\//i.test(target)) {
    res.writeHead(400, corsHeaders);
    res.end("proxy requires an absolute http(s) url");
    return;
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(key) || key.startsWith("sec-") || key.startsWith("access-control-")) {
      continue;
    }
    if (typeof value === "string") headers[key] = value;
  }
  // Present as the real site so origin allowlists and hotlink checks pass
  try {
    const upstream = new URL(target);
    headers.origin = upstream.origin.replace(/^https?:\/\/(?!www\.)/, (m) => m);
    headers.referer = upstream.origin + "/";
  } catch {
    // keep defaults
  }

  const body =
    req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);

  try {
    const upstreamRes = await fetch(target, {
      method: req.method || "GET",
      headers,
      body: body ? new Uint8Array(body) : undefined,
      redirect: "follow",
    });
    const buffer = Buffer.from(await upstreamRes.arrayBuffer());
    const outHeaders: Record<string, string> = { ...corsHeaders };
    const contentType = upstreamRes.headers.get("content-type");
    if (contentType) outHeaders["content-type"] = contentType;
    res.writeHead(upstreamRes.status, outHeaders);
    res.end(buffer);
  } catch (err) {
    res.writeHead(502, corsHeaders);
    res.end(err instanceof Error ? err.message : "proxy error");
  }
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Cloned page paths from the manifest, longest first, for SPA fallback. */
async function readEntryPages(root: string): Promise<string[]> {
  try {
    const manifest = await fs.readJson(path.join(root, "manifest.json"));
    const paths: string[] = (manifest.pages || [])
      .map((p: { path?: string }) => p.path)
      .filter((p: unknown): p is string => typeof p === "string" && p.length > 0);
    return paths.sort((a, b) => b.length - a.length);
  } catch {
    return [];
  }
}

function acceptsHtml(req: http.IncomingMessage): boolean {
  const accept = req.headers.accept || "";
  return accept.includes("text/html") || accept.includes("*/*");
}

/**
 * Client-routed URLs like /en-US/cars have no file on disk. Prefer the cloned
 * page that shares the deepest path prefix so the SPA boots on the right locale
 * and route base, rather than always falling back to the site root.
 */
async function findSpaFallback(
  root: string,
  pathname: string,
  entryPages: string[]
): Promise<string | null> {
  const requested = pathname.replace(/^\/+/, "").replace(/\/index\.html$/, "");
  const segments = requested.split("/").filter(Boolean);

  for (let i = segments.length; i >= 0; i--) {
    const prefix = segments.slice(0, i).join("/");
    for (const page of entryPages) {
      const pageDir = page.replace(/\/?index\.html$/, "");
      if (pageDir === prefix || (prefix && pageDir.startsWith(`${prefix}/`))) {
        const candidate = safeJoin(root, page);
        if (candidate && (await fs.pathExists(candidate))) return candidate;
      }
    }
  }

  for (const page of entryPages) {
    const candidate = safeJoin(root, page);
    if (candidate && (await fs.pathExists(candidate))) return candidate;
  }

  const rootIndex = path.join(root, "index.html");
  return (await fs.pathExists(rootIndex)) ? rootIndex : null;
}

function safeJoin(root: string, pathname: string): string | null {
  const rel = pathname.replace(/^\/+/, "");
  const resolved = path.resolve(root, rel);
  if (!resolved.startsWith(path.resolve(root))) return null;
  return resolved;
}

async function sendFile(res: http.ServerResponse, filePath: string): Promise<void> {
  const ext = path.extname(filePath).toLowerCase();
  const data = await fs.readFile(filePath);
  res.writeHead(200, {
    "content-type": MIME[ext] || "application/octet-stream",
    "cache-control": "no-cache",
  });
  res.end(data);
}

// Prevent unused import issues in some bundlers
void fileURLToPath;
