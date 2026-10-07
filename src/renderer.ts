import { chromium, type Browser, type BrowserContext } from "playwright";
import type { CloneOptions, PageCapture } from "./types.js";
import { sleep } from "./utils.js";

export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  async start(options: Pick<CloneOptions, "viewport" | "userAgent">): Promise<void> {
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      viewport: options.viewport,
      userAgent: options.userAgent,
      ignoreHTTPSErrors: true,
    });
  }

  async capturePage(url: string, waitMs: number): Promise<PageCapture> {
    if (!this.context) {
      throw new Error("Browser session not started");
    }

    const page = await this.context.newPage();
    const networkUrls = new Set<string>();
    let ssrHtml = "";

    page.on("response", (response) => {
      try {
        const resUrl = response.url();
        if (resUrl.startsWith("http")) networkUrls.add(resUrl);
      } catch {
        // ignore
      }
    });

    // Capture SSR HTML as early as possible (before GSAP mutates the DOM)
    const earlyHtmlPromise = page
      .waitForResponse(
        (res) =>
          res.request().resourceType() === "document" &&
          (res.headers()["content-type"] || "").includes("text/html") &&
          res.ok(),
        { timeout: 60_000 }
      )
      .then(async (res) => {
        try {
          ssrHtml = await res.text();
        } catch {
          ssrHtml = "";
        }
      })
      .catch(() => {
        ssrHtml = "";
      });

    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: Math.max(60_000, waitMs + 30_000),
      });
    } catch {
      await page.goto(url, {
        waitUntil: "commit",
        timeout: 60_000,
      });
    }

    await earlyHtmlPromise;
    await sleep(Math.max(800, waitMs));

    try {
      await page.waitForLoadState("networkidle", { timeout: 30_000 });
    } catch {
      // ignore sites that never idle
    }

    // Discover lazy-loaded network assets
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let total = 0;
        const step = Math.max(300, Math.floor(window.innerHeight * 0.8));
        const timer = setInterval(() => {
          window.scrollBy(0, step);
          total += step;
          if (total >= document.body.scrollHeight) {
            clearInterval(timer);
            window.scrollTo(0, 0);
            resolve();
          }
        }, 80);
      });
    });

    await sleep(500);

    let html = ssrHtml;
    if (html.length < 500) {
      html = await page.evaluate(() => {
        document.querySelectorAll(".pin-spacer").forEach((spacer) => {
          const child = spacer.firstElementChild;
          if (child) spacer.parentNode?.replaceChild(child, spacer);
        });
        document.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
          el.style.removeProperty("opacity");
          el.style.removeProperty("transform");
          el.style.removeProperty("translate");
          el.style.removeProperty("rotate");
          el.style.removeProperty("scale");
          el.style.removeProperty("visibility");
          if (!(el.getAttribute("style") || "").trim()) el.removeAttribute("style");
        });
        return document.documentElement.outerHTML;
      });
    }

    const title = await page.title();
    const finalUrl = page.url();
    await page.close();

    const normalized =
      html.startsWith("<!DOCTYPE") || html.startsWith("<!doctype")
        ? html
        : html.startsWith("<html")
          ? `<!DOCTYPE html>\n${html}`
          : html;

    return {
      url,
      finalUrl,
      html: normalized,
      title,
      networkUrls: [...networkUrls],
    };
  }

  async close(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
    this.context = null;
    this.browser = null;
  }
}
