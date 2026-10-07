import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import { rewriteHtmlFaithful } from "../src/rewriter.js";

// Serialized tracker markup is page data, not a standalone tracking script.
const flight = 'self.__next_f.push([1,"serialized https://www.googletagmanager.com/gtag/js"]);';
const html = `<html><head>
<script src="https://www.googletagmanager.com/gtag/js?id=test"></script>
<script>gtag('config', 'test');</script>
<script src="/_next/static/chunks/app.js"></script>
</head><body><script>${flight}</script></body></html>`;
const $ = cheerio.load(rewriteHtmlFaithful(html, "https://example.com/"));
assert.equal($("script").toArray().filter(el => $(el).html() === flight).length, 1);
assert.equal($("script[src*='googletagmanager']").length, 0);
assert.equal($("script[src*='/_next/']").length, 1);
assert.equal($("script").toArray().some(el => $(el).html() === "gtag('config', 'test');"), false);
console.log("Faithful rewrite preserves Flight data and strips standalone trackers.");
