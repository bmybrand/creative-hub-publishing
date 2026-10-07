import { createHash } from "node:crypto";
import path from "node:path";
import type { AssetKind, Viewport } from "./types.js";

/**
 * Sites commonly serve a stripped SEO/bot variant (no CSS or JS) to headless
 * Chrome's default UA, and CDNs reject obvious crawler UAs, so present as a
 * regular desktop browser unless the caller overrides it.
 */
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export function normalizeUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.href;
}

export function sameOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin;
  } catch {
    return false;
  }
}

export function resolveUrl(base: string, href: string): string | null {
  if (
    !href ||
    href.startsWith("data:") ||
    href.startsWith("blob:") ||
    href.startsWith("javascript:") ||
    href.startsWith("mailto:") ||
    href.startsWith("tel:") ||
    href.startsWith("#")
  ) {
    return null;
  }
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

export function parseViewport(value: string): Viewport {
  const match = /^(\d+)x(\d+)$/i.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid viewport "${value}". Use WIDTHxHEIGHT, e.g. 1440x900`);
  }
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

export function urlToLocalHtmlPath(pageUrl: string, rootUrl: string): string {
  const page = new URL(pageUrl);
  const root = new URL(rootUrl);
  let pathname = page.pathname || "/";

  if (pathname === "/" || pathname === "") {
    return "index.html";
  }

  if (pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }

  if (page.origin === root.origin) {
    const relative = pathname.startsWith("/") ? pathname.slice(1) : pathname;
    if (!isDocumentPath(relative)) {
      return path.posix.join(relative, "index.html");
    }
    return relative;
  }

  const hostPart = page.hostname.replace(/[^a-zA-Z0-9.-]/g, "_");
  const rest = pathname.replace(/^\//, "");
  if (!rest || !isDocumentPath(rest)) {
    return path.posix.join(hostPart, rest || "", "index.html");
  }
  return path.posix.join(hostPart, rest);
}

const DOCUMENT_EXTENSIONS = new Set([".html", ".htm", ".xhtml", ".php", ".asp", ".aspx", ".jsp"]);

/**
 * A dot in the last segment doesn't make it a file: slugs like
 * "4.door.suv.2017" are directories. Only real document extensions should be
 * written as-is, everything else becomes <path>/index.html.
 */
function isDocumentPath(relativePath: string): boolean {
  return DOCUMENT_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase());
}

function isAssetFilePath(pathname: string): boolean {
  const ext = path.posix.extname(pathname).toLowerCase();
  if (!ext || DOCUMENT_EXTENSIONS.has(ext)) return false;
  return /^\.[a-z][a-z0-9]{0,7}$/.test(ext);
}

export function hashUrl(url: string): string {
  return createHash("sha1").update(url).digest("hex").slice(0, 12);
}

export function guessKind(url: string, contentType?: string): AssetKind {
  const ct = (contentType || "").toLowerCase();
  const pathname = safePathname(url).toLowerCase();

  if (ct.includes("text/css") || pathname.endsWith(".css")) return "css";
  if (
    ct.includes("javascript") ||
    ct.includes("ecmascript") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".mjs")
  ) {
    return "js";
  }
  if (
    ct.startsWith("font/") ||
    ct.includes("font") ||
    /\.(woff2?|ttf|otf|eot)$/i.test(pathname)
  ) {
    return "font";
  }
  if (
    ct.startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|svg|ico|avif|bmp)$/i.test(pathname)
  ) {
    return "img";
  }
  if (
    ct.startsWith("video/") ||
    ct.startsWith("audio/") ||
    /\.(mp4|webm|ogg|mp3|wav|m4a)$/i.test(pathname)
  ) {
    return "media";
  }
  return "other";
}

export function extensionFor(url: string, kind: AssetKind, contentType?: string): string {
  const pathname = safePathname(url);
  const ext = path.extname(pathname).split("?")[0];
  if (ext && ext.length <= 8) return ext;

  const ct = (contentType || "").toLowerCase();
  if (ct.includes("text/css")) return ".css";
  if (ct.includes("javascript")) return ".js";
  if (ct.includes("image/png")) return ".png";
  if (ct.includes("image/jpeg")) return ".jpg";
  if (ct.includes("image/webp")) return ".webp";
  if (ct.includes("image/svg")) return ".svg";
  if (ct.includes("image/gif")) return ".gif";
  if (ct.includes("font/woff2")) return ".woff2";
  if (ct.includes("font/woff")) return ".woff";
  if (ct.includes("font/ttf")) return ".ttf";

  switch (kind) {
    case "css":
      return ".css";
    case "js":
      return ".js";
    case "font":
      return ".woff2";
    default:
      return ".bin";
  }
}

/**
 * Prefer original site pathnames (esp. /_next/* and /assets/*) so frameworks
 * like Next.js can hydrate and run animations. Fall back to hashed assets/.
 */
export function assetLocalPath(url: string, kind: AssetKind, contentType?: string): string {
  try {
    const u = new URL(url);
    const pathname = decodeURIComponent(u.pathname);

    if (
      pathname.startsWith("/_next/") ||
      pathname.startsWith("/assets/") ||
      pathname.startsWith("/static/") ||
      pathname.startsWith("/images/") ||
      pathname.startsWith("/fonts/") ||
      /^\/favicon(\.|$)/i.test(pathname)
    ) {
      // Skip Next image optimizer endpoint — callers unwrap to the real file
      if (!pathname.includes("/_next/image")) {
        return pathname.replace(/^\//, "");
      }
    }

    // Same-origin file-like paths (e.g. /logo.svg). Documents and slug-style
    // segments such as "4.door.suv.2017" must not claim a real file path, or
    // they collide with the directory a cloned page needs.
    if (isAssetFilePath(pathname) && !pathname.endsWith("/")) {
      const cleaned = pathname.replace(/^\//, "");
      if (cleaned && !cleaned.includes("..")) {
        return cleaned;
      }
    }
  } catch {
    // fall through to hashed path
  }

  const ext = extensionFor(url, kind, contentType);
  const folder =
    kind === "css"
      ? "css"
      : kind === "js"
        ? "js"
        : kind === "img"
          ? "img"
          : kind === "font"
            ? "fonts"
            : kind === "media"
              ? "media"
              : "other";
  return path.posix.join("assets", folder, `${hashUrl(url)}${ext}`);
}

/** Browser URL path for a stored asset (root-absolute when possible). */
export function assetPublicHref(localPath: string, htmlPath = "index.html"): string {
  const normalized = localPath.replace(/\\/g, "/").replace(/^\.\//, "");
  // Framework / site assets must stay root-absolute for runtime loaders
  if (
    normalized.startsWith("_next/") ||
    normalized.startsWith("assets/") ||
    normalized.startsWith("static/") ||
    normalized.startsWith("images/") ||
    normalized.startsWith("fonts/")
  ) {
    return `/${normalized}`;
  }
  return relativeFromHtml(htmlPath, normalized);
}

export function safePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split("?")[0] || url;
  }
}

export function isTrackingUrl(url: string): boolean {
  const patterns = [
    /google-analytics\.com/i,
    /googletagmanager\.com/i,
    /googleadservices\.com/i,
    /facebook\.net/i,
    /connect\.facebook\.com/i,
    /hotjar\.com/i,
    /segment\.(io|com)/i,
    /mixpanel\.com/i,
    /doubleclick\.net/i,
    /clarity\.ms/i,
    /analytics\./i,
    /sentry\.io/i,
    /fullstory\.com/i,
    /intercom\.io/i,
    /cdn\.amplitude\.com/i,
  ];
  return patterns.some((p) => p.test(url));
}

export function relativeFromHtml(htmlPath: string, assetPath: string): string {
  const htmlDir = path.posix.dirname(htmlPath.replace(/\\/g, "/"));
  let rel = path.posix.relative(htmlDir === "." ? "" : htmlDir, assetPath.replace(/\\/g, "/"));
  if (!rel.startsWith(".") && !rel.startsWith("/")) {
    rel = `./${rel}`;
  }
  return rel.replace(/\\/g, "/");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
