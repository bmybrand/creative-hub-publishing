import { extractSameOriginLinks } from "./extractor.js";
import type { PageCapture } from "./types.js";
import { normalizeUrl } from "./utils.js";

/**
 * BFS same-origin crawl queue.
 */
export class CrawlQueue {
  private seen = new Set<string>();
  private queue: Array<{ url: string; depth: number }> = [];
  private processed = 0;

  constructor(
    seedUrl: string,
    private maxDepth: number,
    private maxPages: number
  ) {
    const normalized = normalizeUrl(seedUrl);
    this.queue.push({ url: normalized, depth: 0 });
    this.seen.add(normalized);
  }

  next(): { url: string; depth: number } | null {
    if (this.processed >= this.maxPages) return null;
    const item = this.queue.shift();
    if (!item) return null;
    this.processed += 1;
    return item;
  }

  enqueueFromCapture(capture: PageCapture, depth: number): void {
    if (depth >= this.maxDepth) return;

    const links = extractSameOriginLinks(capture.html, capture.finalUrl);
    for (const link of links) {
      if (this.seen.size >= this.maxPages) break;
      const normalized = normalizeUrl(link);
      if (this.seen.has(normalized)) continue;
      this.seen.add(normalized);
      this.queue.push({ url: normalized, depth: depth + 1 });
    }
  }
}
