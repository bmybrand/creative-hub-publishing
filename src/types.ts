export type Framework = "next";

export interface Viewport {
  width: number;
  height: number;
}

export interface CloneOptions {
  url: string;
  out: string;
  crawl: boolean;
  depth: number;
  maxPages: number;
  framework?: Framework;
  wait: number;
  viewport: Viewport;
  userAgent?: string;
  /** Keep the site's own JS (exact behavior/animations). Default true. */
  faithful?: boolean;
  /** Extra URLs captured into the same output, e.g. other SPA routes. */
  extraUrls?: string[];
}

export type AssetKind = "css" | "js" | "img" | "font" | "media" | "other";

export interface AssetRecord {
  remoteUrl: string;
  localPath: string;
  kind: AssetKind;
  contentType?: string;
}

export type AssetMap = Map<string, AssetRecord>;

export interface PageCapture {
  url: string;
  finalUrl: string;
  html: string;
  title: string;
  networkUrls: string[];
}

export interface ClonedPage {
  url: string;
  finalUrl: string;
  relativeHtmlPath: string;
  title: string;
  html: string;
}

export interface CloneManifest {
  sourceUrl: string;
  clonedAt: string;
  pages: Array<{
    url: string;
    path: string;
    title: string;
  }>;
  assets: Array<{
    remoteUrl: string;
    localPath: string;
    kind: AssetKind;
  }>;
  warnings: string[];
}

export interface CloneResult {
  outDir: string;
  pages: ClonedPage[];
  assets: AssetMap;
  warnings: string[];
  manifest: CloneManifest;
}
