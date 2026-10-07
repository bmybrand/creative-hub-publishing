import * as cheerio from "cheerio";
import type { AssetMap } from "./types.js";
import { assetPublicHref, isTrackingUrl, relativeFromHtml, resolveUrl } from "./utils.js";
import { rewriteCssUrls } from "./downloader.js";
import { LAYOUT_SAFE_CSS, RUNTIME_BOOT_SCRIPT } from "./runtime-boot.js";

/**
 * Route cross-origin XHR/fetch through the preview server. The cloned app still
 * talks to the real APIs, but those allowlist the production origin, so calls
 * from localhost fail CORS and the app bails out to its error route.
 */
const CROSS_ORIGIN_PROXY_SHIM = `(function(){var P="/__clone-proxy?url=";function skip(u){try{var a=new URL(u,location.href);if(/\\/api\\/contact\\/?$/i.test(a.pathname))return true;}catch(e){}return false;}function m(u){try{if(!u)return u;if(skip(u))return u;var a=new URL(u,location.href);if(a.origin===location.origin)return u;if(a.protocol!=="http:"&&a.protocol!=="https:")return u;if(a.pathname.indexOf("/__clone-proxy")===0)return u;return P+encodeURIComponent(a.href);}catch(e){return u;}}var xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url){var a=[].slice.call(arguments);a[1]=m(url);return xo.apply(this,a);};if(window.fetch){var of=window.fetch.bind(window);window.fetch=function(input,init){try{if(typeof input==="string"){return of(m(input),init);}if(input&&input.url){var r=new Request(m(input.url),input);return of(r,init);}}catch(e){}return of(input,init);};}})();`;

const ANALYTICS_STUB = `(function(){var w=window;w.dataLayer=w.dataLayer||[];if(!w.gtag)w.gtag=function(){w.dataLayer.push(arguments);};if(!w.ga)w.ga=function(){};if(!w.fbq)w.fbq=function(){};if(!w._fbq)w._fbq=w.fbq;if(!w.hj)w.hj=function(){};if(!w.clarity)w.clarity=function(){};w.adsbygoogle=w.adsbygoogle||[];if(!w.googletag)w.googletag={cmd:[],pubads:function(){return{addEventListener:function(){},refresh:function(){}};},display:function(){},defineSlot:function(){return{addService:function(){return this;}};},enableServices:function(){}};})();`;

/**
 * Faithful mode: keep the site's own runtime so behavior and animations match
 * the live site. The SSR HTML is captured before hydration and framework chunks
 * keep their original paths. We only strip trackers, point downloaded assets at
 * their local copies, and shim the globals those trackers would have defined.
 */
export function rewriteHtmlFaithful(
  html: string,
  pageUrl: string,
  assets?: AssetMap,
  pageUrlToHtmlPath?: Map<string, string>
): string {
  const $ = cheerio.load(html, { xml: false });
  const origin = new URL(pageUrl).origin;

  // Strip analytics/trackers only — keep all framework scripts
  $("script").each((_, el) => {
    const src = $(el).attr("src");
    if (src) {
      const resolved = resolveUrl(pageUrl, src);
      if (resolved && isTrackingUrl(resolved)) $(el).remove();
      return;
    }
    const body = ($(el).html() || "").toLowerCase();
    // Flight payloads can contain serialized analytics components. Removing
    // the whole payload truncates the stream and prevents React hydration.
    if (body.includes("self.__next_f.push(") || body.includes("self.__next_f=self.__next_f")) return;
    if (
      body.includes("googletagmanager") ||
      body.includes("google-analytics") ||
      body.includes("gtag(") ||
      body.includes("fbq(") ||
      body.includes("hotjar")
    ) {
      $(el).remove();
    }
  });

  const pageHref = (resolved: string): string | null => {
    if (!pageUrlToHtmlPath) return null;
    const keys = [resolved, stripQuery(resolved), normalizeKey(resolved)];
    try {
      const u = new URL(resolved);
      const withSlash = u.pathname.endsWith("/")
        ? resolved
        : `${u.origin}${u.pathname}/${u.search}`;
      const noSlash = u.pathname.endsWith("/")
        ? `${u.origin}${u.pathname.replace(/\/$/, "")}${u.search}`
        : resolved;
      keys.push(withSlash, noSlash, normalizeKey(withSlash), normalizeKey(noSlash));
    } catch {
      // ignore
    }
    for (const key of keys) {
      const target =
        pageUrlToHtmlPath.get(key) || pageUrlToHtmlPath.get(normalizeKey(key));
      if (!target) continue;
      return target === "index.html"
        ? "/"
        : `/${target.replace(/\/index\.html$/, "/").replace(/\\/g, "/")}`;
    }
    return null;
  };

  // Point every downloaded asset at its local copy, whatever origin it came
  // from. Third-party CDN files must be served same-origin too, or the browser
  // blocks their fonts/XHR under CORS and the page renders without icons.
  // Never map navigation links to HTML-document dumps stored as .bin — those
  // trigger a file download instead of opening the cloned page.
  const localHref = (raw: string, forNavigation = false): string | null => {
    if (!assets || !raw || /^(data|blob|javascript|mailto|tel):/i.test(raw)) return null;
    const resolved = resolveUrl(pageUrl, raw);
    if (!resolved) return null;

    if (forNavigation) {
      const page = pageHref(resolved);
      if (page) return page;
    }

    const asset = assets.get(resolved) || assets.get(stripQuery(resolved));
    if (!asset) return null;
    if (forNavigation && isDocumentAsset(asset)) {
      // Prefer a cleaned same-origin path over a .bin download
      try {
        const u = new URL(resolved);
        if (u.origin === origin) {
          return `${u.pathname}${u.pathname.endsWith("/") ? "" : "/"}`;
        }
      } catch {
        // fall through
      }
      return null;
    }
    return `/${asset.localPath.replace(/\\/g, "/").replace(/^\//, "")}`;
  };

  const localSrcset = (value: string): string | null => {
    let changed = false;
    const out = value
      .split(",")
      .map((part) => {
        const trimmed = part.trim();
        if (!trimmed) return part;
        const [url, ...descriptors] = trimmed.split(/\s+/);
        const mapped = localHref(url, false);
        if (!mapped) return trimmed;
        changed = true;
        return [mapped, ...descriptors].join(" ");
      })
      .join(", ");
    return changed ? out : null;
  };

  // Resource URLs (CSS/JS/images) — never treat <a href> here
  $("link[href], script[src], img[src], video[src], audio[src], source[src], track[src], video[poster], image[href], use[href]").each(
    (_, el) => {
      const tag = ((el as { name?: string }).name || "").toLowerCase();
      const attr =
        tag === "link" || tag === "image" || tag === "use"
          ? "href"
          : tag === "video" && $(el).attr("poster") && !$(el).attr("src")
            ? "poster"
            : $(el).attr("src") != null
              ? "src"
              : $(el).attr("href") != null
                ? "href"
                : $(el).attr("poster") != null
                  ? "poster"
                  : null;
      if (!attr) return;
      const v = $(el).attr(attr);
      if (!v) return;
      const mapped = localHref(v, false);
      if (mapped) $(el).attr(attr, mapped);
    }
  );

  for (const attr of ["srcset", "imagesrcset"]) {
    $(`[${attr}]`).each((_, el) => {
      const v = $(el).attr(attr);
      if (!v) return;
      const mapped = localSrcset(v);
      if (mapped) $(el).attr(attr, mapped);
    });
  }

  // Navigation links: cloned pages first, never .bin HTML dumps
  $("a[href]").each((_, el) => {
    const v = $(el).attr("href");
    if (!v || v.startsWith("#") || /^(mailto|tel|javascript):/i.test(v)) return;
    const mapped = localHref(v, true);
    if (mapped) {
      try {
        const hash = new URL(resolveUrl(pageUrl, v) || v).hash;
        $(el).attr("href", mapped + (hash || ""));
      } catch {
        $(el).attr("href", mapped);
      }
      return;
    }
    // Same-origin absolute → root-relative so they resolve on localhost
    if (v.includes(origin)) {
      $(el).attr("href", v.split(`${origin}/`).join("/").split(origin).join("/"));
    }
  });

  // Remaining same-origin abs URLs on non-anchor attrs
  $("*").each((_, el) => {
    for (const attr of ["src", "href", "srcset", "imagesrcset", "poster", "content"]) {
      if ((el as { name?: string }).name === "a" && attr === "href") continue;
      const v = $(el).attr(attr);
      if (v && v.includes(origin) && !v.startsWith("/assets/")) {
        $(el).attr(attr, v.split(`${origin}/`).join("/").split(origin).join("/"));
      }
    }
  });

  $("base").remove();

  // The preview is served over HTTP, so protocol-relative URLs still pointing at
  // third parties resolve to http:// and get aborted as mixed/blocked content.
  // Let the browser upgrade them; requests to localhost are exempt.
  $("meta[http-equiv='Content-Security-Policy']").remove();
  $("head").prepend(
    `<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">`
  );

  // Tiny safety net for static servers without RSC stubs (preview server has them).
  // ANALYTICS_STUB matters beyond tidiness: app code often calls gtag/fbq from
  // router hooks, and removing the tracker leaves a ReferenceError that aborts
  // the route transition, so the clone hangs on its loading screen.
  const boot = `<script data-site-clone-boot>${ANALYTICS_STUB}${CROSS_ORIGIN_PROXY_SHIM}(function(){if(window.__SITE_CLONE_RSC__)return;window.__SITE_CLONE_RSC__=true;if(!window.fetch)return;var f=window.fetch.bind(window);window.fetch=function(input,init){try{var u=typeof input==="string"?input:input&&input.url;if(u&&(String(u).indexOf("_rsc=")!==-1||String(u).indexOf("/_next/data/")!==-1)){return f(input,init).catch(function(){return new Response("{}",{status:200,headers:{"content-type":"text/x-component"}});});}}catch(e){}return f(input,init);};})();</script>`;
  const head = $("head");
  if (head.length) head.prepend(boot);
  else $.root().prepend(boot);

  return $.html();
}

export function rewriteHtml(
  html: string,
  pageUrl: string,
  htmlPath: string,
  assets: AssetMap,
  pageUrlToHtmlPath: Map<string, string>
): string {
  const $ = cheerio.load(html, { xml: false });

  const hrefFor = (remote: string): string | null => {
    const asset = assets.get(remote) || assets.get(stripQuery(remote));
    if (!asset) return null;
    return assetPublicHref(asset.localPath, htmlPath);
  };

  const mapAttr = (selector: string, attr: string) => {
    $(selector).each((_, el) => {
      const raw = $(el).attr(attr);
      if (!raw) return;
      const resolved = resolveUrl(pageUrl, raw);
      if (!resolved) return;
      if (isTrackingUrl(resolved)) {
        $(el).remove();
        return;
      }
      const local = hrefFor(resolved);
      if (local) {
        $(el).attr(attr, local);
      } else if (raw.startsWith("/_next/") || raw.startsWith("/assets/")) {
        $(el).attr(attr, raw.split("?")[0]);
      }
    });
  };

  mapAttr("link[href]", "href");
  mapAttr("script[src]", "src");
  mapAttr("img[src]", "src");
  mapAttr("video[src], audio[src], source[src], track[src]", "src");
  mapAttr("video[poster]", "poster");
  mapAttr("image[href]", "href");
  mapAttr("use[href]", "href");

  const rewriteSrcsetValue = (srcset: string): string =>
    srcset
      .split(",")
      .map((part) => {
        const trimmed = part.trim();
        if (!trimmed) return trimmed;
        const [urlPart, ...rest] = trimmed.split(/\s+/);
        const resolved = resolveUrl(pageUrl, urlPart);
        if (!resolved) return trimmed;
        const local = hrefFor(resolved);
        if (!local) {
          try {
            const u = new URL(resolved);
            if (u.pathname.includes("/_next/image")) {
              const inner = u.searchParams.get("url");
              if (inner) {
                const original = inner.startsWith("http")
                  ? inner
                  : new URL(inner, pageUrl).href;
                return [hrefFor(original) || new URL(original).pathname, ...rest].join(" ");
              }
            }
          } catch {
            // ignore
          }
          return trimmed;
        }
        return [local, ...rest].join(" ");
      })
      .join(", ");

  $("img[srcset], source[srcset], link[imagesrcset]").each((_, el) => {
    const srcset = $(el).attr("srcset") || $(el).attr("imagesrcset");
    if (!srcset) return;
    const rewritten = rewriteSrcsetValue(srcset);
    if ($(el).attr("srcset")) $(el).attr("srcset", rewritten);
    if ($(el).attr("imagesrcset")) $(el).attr("imagesrcset", rewritten);
  });

  $("[style]").each((_, el) => {
    const style = $(el).attr("style");
    if (!style) return;
    $(el).attr("style", rewriteCssUrls(style, pageUrl, assets));
  });

  $("style").each((_, el) => {
    const css = $(el).html();
    if (!css) return;
    $(el).html(rewriteCssUrls(css, pageUrl, assets));
  });

  // CRITICAL: strip Next/GSAP runtime so pin/scrub animations cannot destroy layout offline
  stripFrameworkScripts($);

  // Unwrap pin-spacers left in captured markup
  unwrapPinSpacers($);

  // Remove GSAP/ScrollTrigger inline layout mutations
  sanitizeInlineLayoutStyles($);

  // Strip tracking
  $("script").each((_, el) => {
    const src = $(el).attr("src");
    if (src) {
      const resolved = resolveUrl(pageUrl, src);
      if (resolved && isTrackingUrl(resolved)) $(el).remove();
      return;
    }
    const body = ($(el).html() || "").toLowerCase();
    if (
      body.includes("googletagmanager") ||
      body.includes("google-analytics") ||
      body.includes("gtag(") ||
      body.includes("fbq(") ||
      body.includes("hotjar")
    ) {
      $(el).remove();
    }
  });

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
      return;
    }
    let resolved: string | null;
    try {
      resolved = resolveUrl(pageUrl, href);
    } catch {
      return;
    }
    if (!resolved) return;

    const url = new URL(resolved);
    const hash = url.hash;
    url.hash = "";
    const key = url.href;
    const altKey = key.endsWith("/") ? key.slice(0, -1) : `${key}/`;
    const targetPath =
      pageUrlToHtmlPath.get(key) ||
      pageUrlToHtmlPath.get(normalizeKey(key)) ||
      pageUrlToHtmlPath.get(altKey) ||
      pageUrlToHtmlPath.get(normalizeKey(altKey));

    if (targetPath) {
      const pub =
        targetPath === "index.html"
          ? "/"
          : `/${targetPath.replace(/\/index\.html$/, "/").replace(/\\/g, "/")}`;
      $(el).attr("href", pub + hash);
    }
  });

  $("meta[property='og:image'], meta[name='twitter:image']").each((_, el) => {
    const content = $(el).attr("content");
    if (!content) return;
    const resolved = resolveUrl(pageUrl, content);
    if (!resolved) return;
    const local = hrefFor(resolved);
    if (local) $(el).attr("content", local);
  });

  $("base").remove();
  $("next-route-announcer").remove();

  // Inject layout-safe CSS early
  $("head").prepend(`<style data-site-clone-layout>${LAYOUT_SAFE_CSS}</style>`);

  let output = $.html();
  output = rewriteEmbeddedUrls(output, pageUrl, htmlPath, assets);
  output = injectBoot(output);

  return output;
}

function stripFrameworkScripts($: cheerio.CheerioAPI): void {
  $("script").each((_, el) => {
    const src = ($(el).attr("src") || "").toLowerCase();
    const body = ($(el).html() || "").toLowerCase();
    const id = ($(el).attr("id") || "").toLowerCase();

    // Keep our own boot script if somehow present
    if ($(el).attr("data-site-clone-boot") != null) return;

    const isNext =
      src.includes("/_next/") ||
      src.includes("react-dom") ||
      src.includes("webpack") ||
      body.includes("__next_f") ||
      body.includes("self.__next") ||
      body.includes("$rsc") ||
      body.includes("webpackchunk") ||
      id === "_r_" ||
      ($(el).attr("nomodule") != null && src.includes("/_next/"));

    if (isNext || (src && src.endsWith(".js") && src.includes("/_next/"))) {
      $(el).remove();
      return;
    }

    // Drop preload of JS modules that would rehydrate
    // (handled below for link tags)
  });

  $('link[rel="preload"][as="script"]').remove();
  $('link[rel="modulepreload"]').remove();
}

function unwrapPinSpacers($: cheerio.CheerioAPI): void {
  $(".pin-spacer").each((_, el) => {
    const $spacer = $(el);
    $spacer.children().each((__, child) => {
      const $child = $(child);
      // Clear pin-applied inline layout
      const style = $child.attr("style");
      if (style) {
        $child.attr("style", stripLayoutStyleProps(style));
      }
      $spacer.before($child);
    });
    $spacer.remove();
  });
}

function sanitizeInlineLayoutStyles($: cheerio.CheerioAPI): void {
  // Only strip animation/pin artifacts — keep normal decorative inline styles
  $("[style]").each((_, el) => {
    const style = $(el).attr("style") || "";
    const tag = ((el as unknown as { tagName?: string }).tagName || "").toLowerCase();
    const className = ($(el).attr("class") || "").toLowerCase();

    const looksLikePinArtifact =
      /position\s*:\s*(fixed|absolute)/i.test(style) ||
      /translate\s*:/i.test(style) ||
      /transform\s*:/i.test(style) ||
      /opacity\s*:\s*0/i.test(style) ||
      /pin-spacer|gsap/i.test(className) ||
      tag === "section" ||
      className.includes("pin-spacer");

    if (!looksLikePinArtifact) return;

    const cleaned = stripLayoutStyleProps(style);
    if (cleaned.trim()) $(el).attr("style", cleaned);
    else $(el).removeAttr("style");
  });

  $('[style=""]').removeAttr("style");
}

function stripLayoutStyleProps(style: string): string {
  const kill =
    /(?:^|;)\s*(?:position|top|left|right|bottom|inset|transform|translate|rotate|scale|opacity|visibility|width|height|max-width|max-height|margin|z-index|will-change|clip-path|overflow|pointer-events)\s*:[^;]*/gi;
  return style
    .replace(kill, "")
    .replace(/;;+/g, ";")
    .replace(/^;|;$/g, "")
    .trim();
}

function injectBoot(html: string): string {
  const boot = `<script data-site-clone-boot>${RUNTIME_BOOT_SCRIPT}</script>`;
  if (html.includes("<head>")) {
    return html.replace("<head>", `<head>${boot}`);
  }
  if (html.includes("</body>")) {
    return html.replace("</body>", `${boot}</body>`);
  }
  return boot + html;
}

function rewriteEmbeddedUrls(
  html: string,
  pageUrl: string,
  htmlPath: string,
  assets: AssetMap
): string {
  const origin = new URL(pageUrl).origin;

  return html.replace(
    /(https?:\/\/[^\s"'`()<>]+|\/(?:_next|assets)\/[^\s"'`()<>]+)/g,
    (match) => {
      const decoded = match.replace(/&amp;/gi, "&");
      let absolute: string;
      try {
        absolute = decoded.startsWith("http") ? decoded : new URL(decoded, origin).href;
      } catch {
        return match;
      }

      const candidates = [absolute, decoded, stripQuery(absolute)];
      try {
        const u = new URL(absolute);
        if (u.pathname.includes("/_next/image")) {
          const inner = u.searchParams.get("url");
          if (inner) {
            const original = inner.startsWith("http")
              ? inner
              : new URL(inner, origin).href;
            candidates.push(original);
          }
        }
      } catch {
        // ignore
      }

      for (const candidate of candidates) {
        const asset = assets.get(candidate);
        if (asset) return assetPublicHref(asset.localPath, htmlPath);
      }

      if (decoded.startsWith("/_next/") || decoded.startsWith("/assets/")) {
        return decoded.split("?")[0];
      }

      return match;
    }
  );
}

function isDocumentAsset(asset: { localPath: string; kind: string; contentType?: string }): boolean {
  const ct = (asset.contentType || "").toLowerCase();
  if (ct.includes("text/html") || ct.includes("application/xhtml")) return true;
  const path = asset.localPath.replace(/\\/g, "/").toLowerCase();
  return path.endsWith(".bin") && path.includes("/assets/other/");
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

function normalizeKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    if (u.pathname !== "/" && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.href;
  } catch {
    return url;
  }
}

void relativeFromHtml;
