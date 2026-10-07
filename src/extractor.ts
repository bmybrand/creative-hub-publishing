import * as cheerio from "cheerio";
import { resolveUrl } from "./utils.js";

const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
const CSS_IMPORT_RE = /@import\s+(?:url\()?['"]?([^'"\);]+)['"]?\)?/gi;

export function extractUrlsFromHtml(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const found = new Set<string>();

  const add = (raw: string | undefined) => {
    if (!raw) return;
    const resolved = resolveUrl(baseUrl, raw.trim());
    if (resolved) found.add(resolved);
  };

  $("link[href]").each((_, el) => add($(el).attr("href")));
  $("script[src]").each((_, el) => add($(el).attr("src")));
  $("img[src]").each((_, el) => add($(el).attr("src")));
  $("img[srcset], source[srcset]").each((_, el) => {
    const srcset = $(el).attr("srcset");
    if (!srcset) return;
    for (const part of srcset.split(",")) {
      const candidate = part.trim().split(/\s+/)[0];
      add(candidate);
    }
  });
  $("video[src], audio[src], source[src], track[src]").each((_, el) =>
    add($(el).attr("src"))
  );
  $("video[poster]").each((_, el) => add($(el).attr("poster")));
  $("image[href], image[xlink\\:href], use[href], use[xlink\\:href]").each((_, el) => {
    add($(el).attr("href") || $(el).attr("xlink:href"));
  });
  $("[style]").each((_, el) => {
    const style = $(el).attr("style");
    if (style) extractUrlsFromCss(style, baseUrl).forEach((u) => found.add(u));
  });
  $("style").each((_, el) => {
    const css = $(el).html();
    if (css) extractUrlsFromCss(css, baseUrl).forEach((u) => found.add(u));
  });
  $("meta[property='og:image'], meta[name='twitter:image']").each((_, el) =>
    add($(el).attr("content"))
  );

  // Tailwind arbitrary values / inline class URLs: bg-[url('/assets/...')]
  const classUrlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  $("[class]").each((_, el) => {
    const cls = $(el).attr("class") || "";
    let m: RegExpExecArray | null;
    classUrlRe.lastIndex = 0;
    while ((m = classUrlRe.exec(cls)) !== null) {
      add(m[2]);
    }
  });

  // Root-relative asset hints in the raw HTML
  const rootAssetRe = /(?:src|href)=["'](\/(?:_next|assets)\/[^"']+)["']/gi;
  let rm: RegExpExecArray | null;
  while ((rm = rootAssetRe.exec(html)) !== null) {
    add(rm[1]);
  }

  return [...found];
}

export function extractUrlsFromCss(css: string, baseUrl: string): string[] {
  const found = new Set<string>();
  let match: RegExpExecArray | null;

  CSS_URL_RE.lastIndex = 0;
  while ((match = CSS_URL_RE.exec(css)) !== null) {
    const resolved = resolveUrl(baseUrl, match[2].trim());
    if (resolved) found.add(resolved);
  }

  CSS_IMPORT_RE.lastIndex = 0;
  while ((match = CSS_IMPORT_RE.exec(css)) !== null) {
    const resolved = resolveUrl(baseUrl, match[1].trim());
    if (resolved) found.add(resolved);
  }

  return [...found];
}

export function extractSameOriginLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const origin = new URL(baseUrl).origin;
  const links = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const resolved = resolveUrl(baseUrl, href);
    if (!resolved) return;
    try {
      const u = new URL(resolved);
      if (u.origin !== origin) return;
      // Skip non-document links
      if (/\.(pdf|zip|png|jpe?g|gif|svg|webp|css|js|json|xml|mp4|mp3)$/i.test(u.pathname)) {
        return;
      }
      u.hash = "";
      links.add(u.href);
    } catch {
      // ignore
    }
  });

  return [...links];
}
