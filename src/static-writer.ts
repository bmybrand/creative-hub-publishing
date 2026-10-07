import fs from "fs-extra";
import path from "node:path";
import type { AssetMap, CloneManifest, ClonedPage } from "./types.js";

export async function writeClonedPage(
  outDir: string,
  page: ClonedPage
): Promise<void> {
  const abs = path.join(outDir, page.relativeHtmlPath);
  await fs.ensureDir(path.dirname(abs));
  await fs.writeFile(abs, page.html, "utf8");
}

export async function writeManifest(
  outDir: string,
  manifest: CloneManifest
): Promise<void> {
  await fs.writeJson(path.join(outDir, "manifest.json"), manifest, { spaces: 2 });
}

export function buildManifest(args: {
  sourceUrl: string;
  pages: ClonedPage[];
  assets: AssetMap;
  warnings: string[];
}): CloneManifest {
  return {
    sourceUrl: args.sourceUrl,
    clonedAt: new Date().toISOString(),
    pages: args.pages.map((p) => ({
      url: p.finalUrl,
      path: p.relativeHtmlPath,
      title: p.title,
    })),
    assets: [...args.assets.values()].map((a) => ({
      remoteUrl: a.remoteUrl,
      localPath: a.localPath,
      kind: a.kind,
    })),
    warnings: args.warnings,
  };
}
