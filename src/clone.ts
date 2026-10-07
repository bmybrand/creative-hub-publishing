import fs from "fs-extra";
import path from "node:path";
import { CrawlQueue } from "./crawler.js";
import { AssetDownloader } from "./downloader.js";
import { extractUrlsFromHtml } from "./extractor.js";
import { BrowserSession } from "./renderer.js";
import { rewriteHtml, rewriteHtmlFaithful } from "./rewriter.js";
import { buildManifest, writeClonedPage, writeManifest } from "./static-writer.js";
import type { CloneOptions, CloneResult, ClonedPage, PageCapture } from "./types.js";
import { normalizeUrl, urlToLocalHtmlPath } from "./utils.js";

export async function cloneSite(options: CloneOptions): Promise<CloneResult> {
  const rootUrl = normalizeUrl(options.url);
  const outDir = path.resolve(options.out);
  const warnings: string[] = [];

  await fs.emptyDir(outDir);

  const session = new BrowserSession();
  const downloader = new AssetDownloader(outDir, options.userAgent);
  downloader.addOrigin(rootUrl);

  const captures: PageCapture[] = [];
  const htmlPathByUrl = new Map<string, string>();

  try {
    await session.start(options);

    if (options.crawl) {
      const queue = new CrawlQueue(rootUrl, options.depth, options.maxPages);

      for (;;) {
        const next = queue.next();
        if (!next) break;

        try {
          const capture = await session.capturePage(next.url, options.wait);
          captures.push(capture);
          const htmlPath = urlToLocalHtmlPath(capture.finalUrl, rootUrl);
          registerPaths(htmlPathByUrl, capture.url, capture.finalUrl, htmlPath);
          queue.enqueueFromCapture(capture, next.depth);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          warnings.push(`Failed to capture ${next.url}: ${message}`);
        }
      }
    } else {
      const targets = [rootUrl, ...(options.extraUrls || []).map(normalizeUrl)];
      const seen = new Set<string>();

      for (const target of targets) {
        if (seen.has(target)) continue;
        seen.add(target);
        try {
          const capture = await session.capturePage(target, options.wait);
          captures.push(capture);
          const htmlPath = urlToLocalHtmlPath(capture.finalUrl, rootUrl);
          registerPaths(htmlPathByUrl, capture.url, capture.finalUrl, htmlPath);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          warnings.push(`Failed to capture ${target}: ${message}`);
        }
      }
    }
  } finally {
    await session.close();
  }

  if (captures.length === 0) {
    throw new Error("No pages were captured. Check the URL and network access.");
  }

  const allAssetUrls = new Set<string>();
  for (const capture of captures) {
    for (const u of capture.networkUrls) {
      allAssetUrls.add(u);
      const unwrapped = unwrapNextImageFromString(u);
      if (unwrapped) allAssetUrls.add(unwrapped);
    }
    for (const u of extractUrlsFromHtml(capture.html, capture.finalUrl)) {
      allAssetUrls.add(u);
      const unwrapped = unwrapNextImageFromString(u);
      if (unwrapped) allAssetUrls.add(unwrapped);
    }
  }
  await downloader.ensureMany([...allAssetUrls]);
  await downloader.rewriteTextAssets();
  warnings.push(...downloader.getWarnings());

  const assets = downloader.getAssetMap();
  const pages: ClonedPage[] = [];

  for (const capture of captures) {
    const relativeHtmlPath =
      htmlPathByUrl.get(normalizeUrl(capture.finalUrl)) ||
      htmlPathByUrl.get(normalizeUrl(capture.url)) ||
      urlToLocalHtmlPath(capture.finalUrl, rootUrl);

    const rewritten =
      options.faithful === false
        ? rewriteHtml(capture.html, capture.finalUrl, relativeHtmlPath, assets, htmlPathByUrl)
        : rewriteHtmlFaithful(capture.html, capture.finalUrl, assets, htmlPathByUrl);

    const page: ClonedPage = {
      url: capture.url,
      finalUrl: capture.finalUrl,
      relativeHtmlPath,
      title: capture.title,
      html: rewritten,
    };
    await writeClonedPage(outDir, page);
    pages.push(page);
  }

  const manifest = buildManifest({
    sourceUrl: rootUrl,
    pages,
    assets,
    warnings,
  });
  await writeManifest(outDir, manifest);

  return {
    outDir,
    pages,
    assets,
    warnings,
    manifest,
  };
}

function unwrapNextImageFromString(remoteUrl: string): string | null {
  try {
    const decoded = remoteUrl.replace(/&amp;/gi, "&");
    const u = new URL(decoded);
    if (!u.pathname.includes("/_next/image")) return null;
    const inner = u.searchParams.get("url");
    if (!inner) return null;
    if (inner.startsWith("http")) return inner;
    return new URL(inner, u.origin).href;
  } catch {
    return null;
  }
}

function registerPaths(
  map: Map<string, string>,
  requestUrl: string,
  finalUrl: string,
  htmlPath: string
): void {
  const keys = new Set([
    normalizeUrl(requestUrl),
    normalizeUrl(finalUrl),
    requestUrl,
    finalUrl,
  ]);
  for (const key of keys) {
    map.set(key, htmlPath);
    try {
      const u = new URL(key);
      if (!u.pathname.endsWith("/")) {
        u.pathname = `${u.pathname}/`;
        map.set(u.href, htmlPath);
      }
    } catch {
      // ignore
    }
  }
}
