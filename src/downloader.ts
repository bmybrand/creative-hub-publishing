import fs from "fs-extra";
import path from "node:path";
import { extractUrlsFromCss } from "./extractor.js";
import type { AssetKind, AssetMap, AssetRecord } from "./types.js";
import {
  DEFAULT_USER_AGENT,
  assetLocalPath,
  guessKind,
  isTrackingUrl,
} from "./utils.js";

export class AssetDownloader {
  private assets: AssetMap = new Map();
  private warnings: string[] = [];
  private inFlight = new Map<string, Promise<AssetRecord | null>>();
  private origins = new Set<string>();

  constructor(
    private outDir: string,
    private userAgent?: string
  ) {}

  addOrigin(url: string): void {
    try {
      this.origins.add(new URL(url).origin);
    } catch {
      // ignore
    }
  }

  getAssetMap(): AssetMap {
    return this.assets;
  }

  getWarnings(): string[] {
    return this.warnings;
  }

  async ensureAsset(remoteUrl: string, preferredKind?: AssetKind): Promise<AssetRecord | null> {
    const cleaned = decodeHtmlEntities(remoteUrl).trim();
    if (!cleaned.startsWith("http")) return null;
    if (isTrackingUrl(cleaned)) {
      this.warnings.push(`Skipped tracking asset: ${cleaned}`);
      return null;
    }

    const existing = this.assets.get(cleaned);
    if (existing) return existing;

    const pending = this.inFlight.get(cleaned);
    if (pending) return pending;

    // Prefer original file behind Next.js image optimizer
    const original = unwrapNextImageUrl(cleaned);
    if (original && original !== cleaned) {
      const originalRecord = await this.ensureAsset(original, preferredKind || "img");
      if (originalRecord) {
        this.assets.set(cleaned, originalRecord);
        return originalRecord;
      }
    }

    const job = this.download(cleaned, preferredKind);
    this.inFlight.set(cleaned, job);
    try {
      return await job;
    } finally {
      this.inFlight.delete(cleaned);
    }
  }

  async ensureMany(urls: string[]): Promise<void> {
    const unique = [...new Set(urls)];
    // Keep concurrency modest — hosts like WP Engine return 429 under burst load
    const concurrency = 3;
    for (let i = 0; i < unique.length; i += concurrency) {
      const batch = unique.slice(i, i + concurrency);
      await Promise.all(batch.map((u) => this.ensureAsset(u)));
      if (i + concurrency < unique.length) {
        await new Promise((r) => setTimeout(r, 120));
      }
    }
  }

  /** Second pass: rewrite absolute origin URLs inside JS/CSS to local paths. */
  async rewriteTextAssets(): Promise<void> {
    for (const record of this.assets.values()) {
      if (record.kind !== "js" && record.kind !== "css") continue;
      const absPath = path.join(this.outDir, record.localPath);
      if (!(await fs.pathExists(absPath))) continue;
      let text = await fs.readFile(absPath, "utf8");
      const before = text;
      text = rewriteTextAssetUrls(text, this.assets, this.origins);
      if (text !== before) {
        await fs.writeFile(absPath, text, "utf8");
      }
    }
  }

  private async download(
    remoteUrl: string,
    preferredKind?: AssetKind
  ): Promise<AssetRecord | null> {
    const maxAttempts = 5;
    let lastStatus = 0;

    try {
      let buffer: Buffer | null = null;
      let contentType: string | undefined;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const headers: Record<string, string> = {
          "User-Agent": this.userAgent || DEFAULT_USER_AGENT,
          Accept: "*/*",
        };
        try {
          const origin = new URL(remoteUrl).origin;
          headers.Referer = `${origin}/`;
        } catch {
          // ignore
        }

        const res = await fetch(remoteUrl, { headers, redirect: "follow" });
        lastStatus = res.status;

        if (res.status === 429 || res.status === 503) {
          const retryAfter = Number(res.headers.get("retry-after") || 0);
          const waitMs = Math.max(retryAfter * 1000, 400 * 2 ** (attempt - 1));
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }

        if (!res.ok) {
          this.warnings.push(`Failed to download (${res.status}): ${remoteUrl}`);
          return null;
        }

        contentType = res.headers.get("content-type") || undefined;
        buffer = Buffer.from(await res.arrayBuffer());
        break;
      }

      if (!buffer) {
        this.warnings.push(
          `Failed to download (${lastStatus || "rate-limited"}): ${remoteUrl}`
        );
        return null;
      }

      // HTML documents are written as cloned pages, not hashed .bin assets.
      // Storing them here used to rewrite <a href> into downloadable .bin links.
      const ct = (contentType || "").toLowerCase();
      if (
        !preferredKind &&
        (ct.includes("text/html") || ct.includes("application/xhtml"))
      ) {
        return null;
      }

      const kind = preferredKind || guessKind(remoteUrl, contentType);
      const localPath = assetLocalPath(remoteUrl, kind, contentType);
      const absPath = path.join(this.outDir, localPath);
      await fs.ensureDir(path.dirname(absPath));
      await fs.writeFile(absPath, buffer);

      const record: AssetRecord = {
        remoteUrl,
        localPath,
        kind,
        contentType,
      };
      this.assets.set(remoteUrl, record);
      // Also index without querystring when safe
      try {
        const u = new URL(remoteUrl);
        if (u.search) {
          const noQuery = `${u.origin}${u.pathname}`;
          if (!this.assets.has(noQuery)) this.assets.set(noQuery, record);
        }
      } catch {
        // ignore
      }

      if (kind === "css") {
        const cssText = buffer.toString("utf8");
        const nested = extractUrlsFromCss(cssText, remoteUrl);
        await this.ensureMany(nested);
        const rewritten = rewriteCssUrls(cssText, remoteUrl, this.assets);
        await fs.writeFile(absPath, rewritten, "utf8");
      }

      return record;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.warnings.push(`Error downloading ${remoteUrl}: ${message}`);
      return null;
    }
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function unwrapNextImageUrl(remoteUrl: string): string | null {
  try {
    const u = new URL(remoteUrl);
    if (!u.pathname.includes("/_next/image")) return null;
    const inner = u.searchParams.get("url");
    if (!inner) return null;
    if (inner.startsWith("http")) return inner;
    return new URL(inner, u.origin).href;
  } catch {
    return null;
  }
}

export function rewriteCssUrls(
  cssText: string,
  cssRemoteUrl: string,
  assets: AssetMap
): string {
  return cssText.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
    (full, quote: string, raw: string) => {
      const trimmed = raw.trim();
      if (
        !trimmed ||
        trimmed.startsWith("data:") ||
        trimmed.startsWith("blob:") ||
        trimmed.startsWith("#")
      ) {
        return full;
      }
      let absolute: string;
      try {
        absolute = new URL(trimmed, cssRemoteUrl).href;
      } catch {
        return full;
      }
      const asset = assets.get(absolute) || assets.get(stripQuery(absolute));
      if (!asset) {
        // Keep root-absolute /_next and /assets refs as-is (path-preserved on disk)
        if (trimmed.startsWith("/_next/") || trimmed.startsWith("/assets/")) {
          return full;
        }
        return full;
      }
      // Root-absolute, not HTML-relative: url() resolves against the
      // stylesheet's own location, which is rarely the site root.
      const href = `/${asset.localPath.replace(/\\/g, "/").replace(/^\//, "")}`;
      return `url(${quote}${href}${quote})`;
    }
  );
}

function rewriteTextAssetUrls(
  text: string,
  assets: AssetMap,
  origins: Set<string>
): string {
  let out = text;

  // Rewrite absolute URLs for known origins to root-absolute local paths
  for (const origin of origins) {
    const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`${escaped}(\\/(?:_next|assets|static|images|fonts)[^"'\\s)]*)`, "g");
    out = out.replace(re, (_m, pathname: string) => {
      try {
        const absolute = origin + pathname.split("?")[0];
        const withQuery = origin + pathname;
        const asset = assets.get(withQuery) || assets.get(absolute);
        if (asset) return `/${asset.localPath.replace(/\\/g, "/").replace(/^\//, "")}`;
        if (pathname.startsWith("/_next/") || pathname.startsWith("/assets/")) {
          return pathname.split("?")[0];
        }
      } catch {
        // ignore
      }
      return origin + pathname;
    });
  }

  return out;
}

function stripQuery(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    return u.href;
  } catch {
    return url;
  }
}
