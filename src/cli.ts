#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import path from "node:path";
import fs from "fs-extra";
import { cloneSite } from "./clone.js";
import { convertToNext } from "./frameworks/next.js";
import { startPreviewServer } from "./preview-server.js";
import type { CloneOptions, Framework } from "./types.js";
import { DEFAULT_USER_AGENT, parseViewport } from "./utils.js";

const LEGAL_NOTICE =
  "Use site-clone only on websites you own or have permission to copy. You are responsible for complying with copyright and site terms.";

async function runClone(url: string, opts: Record<string, unknown>): Promise<void> {
  console.log(chalk.yellow(LEGAL_NOTICE));
  console.log();

  let framework: Framework | undefined;
  if (opts.framework) {
    if (opts.framework !== "next") {
      throw new Error(`Unsupported framework "${opts.framework}". Use "next".`);
    }
    framework = "next";
  }

  const options: CloneOptions = {
    url,
    out: path.resolve(String(opts.out || "./cloned-site")),
    crawl: Boolean(opts.crawl),
    depth: Number(opts.depth ?? 1),
    maxPages: Number(opts.maxPages ?? 25),
    framework,
    wait: Number(opts.wait ?? 1500),
    viewport: parseViewport(String(opts.viewport || "1440x900")),
    userAgent: opts.userAgent ? String(opts.userAgent) : DEFAULT_USER_AGENT,
    faithful: !(opts.legacyAnimations || opts.editable),
    extraUrls: Array.isArray(opts.extraUrls) ? (opts.extraUrls as string[]) : [],
  };

  if (!Number.isFinite(options.depth) || options.depth < 0) {
    throw new Error("--depth must be a non-negative number");
  }
  if (!Number.isFinite(options.maxPages) || options.maxPages < 1) {
    throw new Error("--max-pages must be >= 1");
  }
  if (!Number.isFinite(options.wait) || options.wait < 0) {
    throw new Error("--wait must be a non-negative number");
  }

  try {
    new URL(options.url);
  } catch {
    throw new Error(`Invalid URL: ${options.url}`);
  }

  const staticOut = framework
    ? path.join(path.dirname(options.out), `.site-clone-work-${Date.now()}`)
    : options.out;

  const spinner = ora(`Cloning ${options.url}`).start();

  try {
    const result = await cloneSite({ ...options, out: staticOut });
    spinner.succeed(
      chalk.green(`Captured ${result.pages.length} page(s), ${result.assets.size} asset(s)`)
    );

    if (result.warnings.length) {
      console.log(chalk.dim(`\n${result.warnings.length} warning(s) (see manifest.json)`));
    }

    if (framework === "next") {
      const nextSpinner = ora("Converting to Next.js project").start();
      await convertToNext(result, options.out);
      if (staticOut !== options.out) {
        await fs.remove(staticOut);
      }
      nextSpinner.succeed(chalk.green(`Next.js project written to ${options.out}`));
      console.log();
      console.log(chalk.cyan("Next steps:"));
      console.log(`  cd ${options.out}`);
      console.log("  npm install");
      console.log("  npm run dev");
    } else {
      console.log();
      console.log(chalk.cyan("Preview (recommended — supports /_next/image):"));
      console.log(`  npm run preview -- ${options.out}`);
    }

    console.log();
    console.log(chalk.green(`Done → ${options.out}`));
  } catch (err) {
    spinner.fail("Clone failed");
    if (staticOut !== options.out) {
      await fs.remove(staticOut).catch(() => undefined);
    }
    throw err;
  }
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("site-clone")
    .description("Clone a website into a static site or Next.js project")
    .version("1.0.0");

  program
    .command("clone", { isDefault: true })
    .description("Clone a website")
    .argument("<url>", "URL to clone")
    .argument("[extraUrls...]", "Additional URLs to clone into the same output")
    .option("-o, --out <dir>", "Output directory", "./cloned-site")
    .option("--crawl", "Crawl same-origin linked pages", false)
    .option("--depth <n>", "Crawl depth (with --crawl)", "1")
    .option("--max-pages <n>", "Maximum pages to clone", "25")
    .option("--framework <name>", "Optional framework conversion (next)")
    .option("--wait <ms>", "Extra settle wait after load (ms)", "1500")
    .option("--viewport <WxH>", "Viewport size", "1440x900")
    .option("--user-agent <ua>", "Custom User-Agent")
    .option(
      "--legacy-animations",
      "Strip site JS and use rebuilt GSAP animations instead of the original code",
      false
    )
    .option(
      "--editable",
      "Same as --legacy-animations: strip Next.js so edits to index.html stick",
      false
    )
    .action(async (url: string, extraUrls: string[], opts) => {
      await runClone(url, { ...opts, extraUrls });
    });

  program
    .command("preview")
    .description("Serve a cloned site with /_next/image + RSC stubs")
    .argument("<dir>", "Cloned site directory")
    .option("-p, --port <n>", "Port", "3456")
    .action(async (dir: string, opts) => {
      const root = path.resolve(dir);
      if (!(await fs.pathExists(root))) {
        throw new Error(`Directory not found: ${root}`);
      }
      const port = Number(opts.port);
      const server = await startPreviewServer(root, port);
      console.log(chalk.green(`Previewing ${root}`));
      console.log(chalk.cyan(server.url));
      console.log(chalk.dim("Press Ctrl+C to stop"));
    });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(chalk.red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
