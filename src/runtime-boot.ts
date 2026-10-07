/**
 * Static-clone runtime:
 * - Fix Next image URLs
 * - Keep layout stable (no Next/GSAP hydration)
 * - Load standalone GSAP + ScrollTrigger for Revonix-like scroll animations
 */
export const RUNTIME_BOOT_SCRIPT = `
(function () {
  if (window.__SITE_CLONE_BOOT__) return;
  window.__SITE_CLONE_BOOT__ = true;

  function unwrapNextImage(url) {
    try {
      var u = new URL(url, location.href);
      if (u.pathname.indexOf("/_next/image") === -1) return null;
      var inner = u.searchParams.get("url");
      if (!inner) return null;
      return inner.indexOf("http") === 0 ? inner : new URL(inner, location.origin).pathname;
    } catch (e) {
      return null;
    }
  }

  function fixUrl(url) {
    if (!url || typeof url !== "string") return url;
    return unwrapNextImage(url) || url;
  }

  function fixSrcset(value) {
    return String(value)
      .split(",")
      .map(function (part) {
        var bits = part.trim().split(/\\s+/);
        bits[0] = fixUrl(bits[0]);
        return bits.join(" ");
      })
      .join(", ");
  }

  function fixElementMedia(el) {
    if (!el || !el.getAttribute) return;
    ["src", "href"].forEach(function (attr) {
      var v = el.getAttribute(attr);
      if (!v) return;
      var fixed = fixUrl(v);
      if (fixed !== v) el.setAttribute(attr, fixed);
    });
    ["srcset", "imagesrcset"].forEach(function (attr) {
      var v = el.getAttribute(attr);
      if (v) el.setAttribute(attr, fixSrcset(v));
    });
  }

  document.querySelectorAll("img, source, link, video").forEach(fixElementMedia);

  try {
    var rawSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (name === "src" || name === "href") value = fixUrl(String(value));
      if (name === "srcset" || name === "imagesrcset") value = fixSrcset(value);
      return rawSetAttribute.call(this, name, value);
    };
  } catch (e) {}

  try {
    var desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
    if (desc && desc.set) {
      Object.defineProperty(HTMLImageElement.prototype, "src", {
        configurable: true,
        enumerable: true,
        get: desc.get,
        set: function (value) { desc.set.call(this, fixUrl(String(value))); },
      });
    }
  } catch (e) {}

  if (window.fetch) {
    var _fetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : input && input.url;
      if (url) {
        var fixed = fixUrl(url);
        if (fixed !== url) input = typeof input === "string" ? fixed : new Request(fixed, input);
        else if (String(url).indexOf("_rsc=") !== -1 || String(url).indexOf("/_next/data/") !== -1) {
          return Promise.resolve(new Response("{}", { status: 200, headers: { "content-type": "text/x-component" } }));
        }
      }
      return _fetch(input, init);
    };
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function preparePath(path) {
    if (!path) return 0;
    var len = 0;
    try { len = path.getTotalLength(); } catch (e) { len = 1200; }
    path.style.strokeDasharray = String(len);
    path.style.strokeDashoffset = String(len);
    return len;
  }

  function sectionOf(el) {
    return el ? el.closest("main section, footer section, section") : null;
  }

  function installScrollAnimations() {
    if (window.__SITE_CLONE_ANIMS__ || !window.gsap || !window.ScrollTrigger) return;
    window.__SITE_CLONE_ANIMS__ = true;

    var gsap = window.gsap;
    var ScrollTrigger = window.ScrollTrigger;
    gsap.registerPlugin(ScrollTrigger);

    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      gsap.set(".gsap-init, .journey-card, .work-card, .founder-card, .over-icon, .over-container, .over-inner-text", {
        clearProps: "all",
      });
      return;
    }

    // Clear leftover GSAP-init hide from original CSS
    gsap.set(".gsap-init", { opacity: 1, visibility: "visible", clearProps: "transform" });

    // ---------- HERO ----------
    var hero = document.querySelector("main > section");
    if (hero) {
      var heroTl = gsap.timeline({ defaults: { ease: "power3.out" } });
      var nav = hero.querySelector("nav");
      var heading = hero.querySelector(".hero-heading, h1");
      var text = hero.querySelector(".hero-text, p");
      var btn = hero.querySelector(".hero-button, button");
      if (nav) heroTl.from(nav, { y: -24, opacity: 0, duration: 0.7 }, 0);
      if (heading) heroTl.from(heading, { y: 40, opacity: 0, duration: 0.85 }, 0.15);
      if (text) heroTl.from(text, { y: 24, opacity: 0, duration: 0.7 }, 0.32);
      if (btn) heroTl.from(btn, { y: 18, opacity: 0, duration: 0.65 }, 0.45);
      gsap.utils.toArray(hero.querySelectorAll("img.pointer-events-none, img.absolute")).forEach(function (img, i) {
        gsap.fromTo(
          img,
          { y: i % 2 ? 30 : -20, opacity: 0 },
          {
            y: i % 2 ? -20 : 20,
            opacity: 0.5,
            duration: 1.2,
            delay: 0.3 + i * 0.08,
            ease: "power2.out",
          }
        );
        gsap.to(img, {
          y: i % 2 ? 40 : -40,
          ease: "none",
          scrollTrigger: {
            trigger: hero,
            start: "top top",
            end: "bottom top",
            scrub: true,
          },
        });
      });
    }

    // ---------- OVERWHELMING (reversible scrub, matches live curve) ----------
    var overHeading = document.querySelector(".over-heading");
    var overSection = sectionOf(overHeading);
    if (overSection) {
      var overContainer = overSection.querySelector(".over-container");
      var overChips = Array.prototype.slice.call(
        overSection.querySelectorAll(".over-icon")
      );
      var overInner = overSection.querySelector(".over-inner-text");

      gsap.from(overHeading, {
        y: 30,
        opacity: 0,
        duration: 0.8,
        immediateRender: false,
        scrollTrigger: {
          trigger: overSection,
          start: "top 88%",
          toggleActions: "play none none reverse",
        },
      });

      // Reveal: pill container scales in, then chips pop in staggered
      var overIn = gsap.timeline({
        scrollTrigger: {
          trigger: overSection,
          start: "top 82%",
          end: "top 45%",
          scrub: true,
        },
      });
      if (overContainer) {
        overIn.fromTo(
          overContainer,
          { opacity: 0, scale: 0.8 },
          { opacity: 1, scale: 1, ease: "none", duration: 1 },
          0
        );
      }
      if (overChips.length) {
        overIn.fromTo(
          overChips,
          { opacity: 0, scale: 0.8 },
          { opacity: 1, scale: 1, ease: "none", duration: 0.8, stagger: 0.15 },
          0.2
        );
      }

      // "We cut through that." hidden until chips settle, then fades in
      if (overInner) {
        gsap.set(overInner, { opacity: 0 });
        gsap.fromTo(
          overInner,
          { opacity: 0 },
          {
            opacity: 1,
            ease: "none",
            immediateRender: false,
            scrollTrigger: {
              trigger: overSection,
              start: "top 35%",
              end: "top 18%",
              scrub: true,
            },
          }
        );
        gsap.fromTo(
          overInner,
          { opacity: 1 },
          {
            opacity: 0,
            ease: "none",
            immediateRender: false,
            scrollTrigger: {
              trigger: overSection,
              start: "bottom 12%",
              end: "bottom 1%",
              scrub: true,
            },
          }
        );
      }

      // Fade back out only after the section scrolls above the viewport (live behavior)
      var overOutTargets = (overContainer ? [overContainer] : []).concat(overChips);
      if (overOutTargets.length) {
        gsap.fromTo(
          overOutTargets,
          { opacity: 1, scale: 1 },
          {
            opacity: 0,
            scale: 0.8,
            ease: "none",
            immediateRender: false,
            scrollTrigger: {
              trigger: overSection,
              start: "bottom 5%",
              end: "bottom -18%",
              scrub: true,
            },
          }
        );
      }
    }

    // ---------- JOURNEY ----------
    var journeyHeading = document.querySelector(".journey-heading");
    var journeySection = sectionOf(journeyHeading);
    if (journeySection) {
      gsap.from(journeyHeading, {
        y: 50,
        opacity: 0,
        duration: 0.85,
        scrollTrigger: { trigger: journeySection, start: "top 75%" },
      });

      var journeyPath = journeySection.querySelector("#journey-path");
      var journeyCards = journeySection.querySelectorAll(".journey-card");

      gsap.from(journeyCards, {
        y: 60,
        opacity: 0,
        scale: 0.94,
        duration: 0.75,
        stagger: 0.15,
        ease: "power3.out",
        immediateRender: false,
        clearProps: "transform",
        scrollTrigger: {
          trigger: journeySection,
          start: "top 75%",
          toggleActions: "play none none none",
        },
      });

      // Live pins this section (~900px) and cycles active card + draws path while pinned
      if (journeyCards.length) {
        journeyCards[0].classList.add("is-active");
        var journeyTl = gsap.timeline({
          scrollTrigger: {
            trigger: journeySection,
            start: "top 15%",
            end: "+=900",
            pin: true,
            scrub: true,
            anticipatePin: 1,
            invalidateOnRefresh: true,
            onUpdate: function (self) {
              var idx = Math.min(
                journeyCards.length - 1,
                Math.floor(self.progress * journeyCards.length)
              );
              journeyCards.forEach(function (card, i) {
                card.classList.toggle("is-active", i === idx);
              });
            },
          },
        });
        if (journeyPath) {
          preparePath(journeyPath);
          journeyTl.to(journeyPath, { strokeDashoffset: 0, ease: "none", duration: 1 }, 0);
        }
      } else if (journeyPath) {
        preparePath(journeyPath);
        gsap.to(journeyPath, {
          strokeDashoffset: 0,
          ease: "none",
          scrollTrigger: {
            trigger: journeySection,
            start: "top 60%",
            end: "bottom 45%",
            scrub: 1,
          },
        });
      }
    }

    // ---------- COMPANIES ----------
    var companiesHeading = document.querySelector(".companies-heading");
    var companiesSection = sectionOf(companiesHeading);
    if (companiesSection) {
      gsap.from(companiesHeading, {
        y: 40,
        opacity: 0,
        duration: 0.8,
        scrollTrigger: { trigger: companiesSection, start: "top 75%" },
      });
      var logos = companiesSection.querySelectorAll("img");
      gsap.from(logos, {
        y: 30,
        opacity: 0,
        scale: 0.92,
        duration: 0.6,
        stagger: 0.08,
        ease: "power2.out",
        scrollTrigger: { trigger: companiesSection, start: "top 70%" },
      });
    }

    // ---------- WORK / PROCESS (zigzag + path + active card) ----------
    var workHeading = document.querySelector(".work-heading");
    var workSection = document.querySelector("#process") || sectionOf(workHeading);
    if (workSection) {
      gsap.from(workHeading || workSection.querySelector("h1"), {
        y: 45,
        opacity: 0,
        duration: 0.85,
        scrollTrigger: { trigger: workSection, start: "top 75%" },
      });

      var workTrack = workSection.querySelector("div.relative.flex.w-full");
      var workPath = workSection.querySelector("#work-path");
      var workSvg = workPath ? workPath.closest("svg") : null;
      if (workSvg) {
        workSvg.classList.remove("hidden");
        // Do not force left/top — keep original absolute static position so path aligns with cards
        workSvg.style.pointerEvents = "none";
        workSvg.style.zIndex = "1";
      }
      if (workPath) {
        preparePath(workPath);
        workPath.style.opacity = "1";
        gsap.to(workPath, {
          strokeDashoffset: 0,
          ease: "none",
          scrollTrigger: {
            trigger: workTrack || workSection,
            start: "top 75%",
            end: "bottom 30%",
            scrub: 0.8,
          },
        });
      }

      var workCards = Array.prototype.slice.call(
        workSection.querySelectorAll(".work-card")
      );
      workCards.forEach(function (card, i) {
        // Keep original self-start / self-end from markup; only fill if missing
        if (!card.classList.contains("self-start") && !card.classList.contains("self-end")) {
          card.classList.add(i % 2 === 0 ? "self-start" : "self-end");
        }
        gsap.from(card, {
          x: i % 2 === 0 ? -48 : 48,
          opacity: 0,
          duration: 0.85,
          ease: "power3.out",
          immediateRender: false,
          clearProps: "transform",
          scrollTrigger: {
            trigger: card,
            start: "top 90%",
            toggleActions: "play none none none",
          },
        });
      });

      function setWorkActive(activeIdx) {
        workCards.forEach(function (card, i) {
          var on = i === activeIdx;
          card.classList.toggle("is-active", on);
          card.style.backgroundColor = on ? "#ffffff" : "#F5F7F9";
          var icon = card.querySelector(".icon-wrapper");
          if (icon) {
            // Match live: blue tile + white glyph when active
            icon.style.backgroundColor = on ? "#3558DA" : "#ffffff";
            icon.style.border = on ? "1px solid #3558DA" : "1px solid rgba(1,1,1,0.08)";
            icon.style.color = on ? "#ffffff" : "#010101";
          }
        });
      }
      if (workCards.length) {
        setWorkActive(0);
        workCards.forEach(function (card, i) {
          ScrollTrigger.create({
            trigger: card,
            start: "top 55%",
            end: "bottom 45%",
            onEnter: function () { setWorkActive(i); },
            onEnterBack: function () { setWorkActive(i); },
          });
        });
      }
    }

    // ---------- TECH / SERVICES (pin + class toggle like Revonix) ----------
    var techHeading = document.querySelector(".tech-heading");
    var techContainer = document.querySelector(".tech-container");
    var techSection = document.querySelector("#services") || sectionOf(techContainer);
    if (techSection && techContainer) {
      gsap.from(techContainer, {
        opacity: 0,
        scale: 0.96,
        duration: 0.9,
        ease: "power3.out",
        immediateRender: false,
        scrollTrigger: {
          trigger: techSection,
          start: "top 85%",
          toggleActions: "play none none none",
        },
      });
      var techIntro = [
        techHeading,
        techSection.querySelector(".tech-text"),
        techSection.querySelector(".tech-left button"),
      ].filter(Boolean);
      if (techIntro.length) {
        gsap.from(techIntro, {
          y: 40,
          opacity: 0,
          duration: 0.75,
          stagger: 0.1,
          immediateRender: false,
          scrollTrigger: {
            trigger: techSection,
            start: "top 85%",
            toggleActions: "play none none none",
          },
        });
      }

      var techRight = techContainer.querySelector(":scope > .relative.flex.w-full.flex-col");
      var techCards = techRight
        ? Array.prototype.slice.call(
            techRight.querySelectorAll(":scope > .flex.w-full.flex-col.gap-8.rounded-3xl")
          )
        : [];
      if (!techCards.length) {
        techCards = Array.prototype.slice.call(
          techContainer.querySelectorAll(".rounded-3xl.border.p-6")
        );
      }

      var lastTechIdx = -1;
      function setTechActive(activeIdx) {
        if (activeIdx === lastTechIdx) return;
        lastTechIdx = activeIdx;
        techCards.forEach(function (card, i) {
          var on = i === activeIdx;
          card.style.opacity = "1";
          if (on) {
            card.style.background = "#ffffff";
            card.style.borderColor = "rgba(53,88,218,0.2)";
            card.style.boxShadow = "0 44px 44px rgba(55,90,217,0.09)";
          } else {
            card.style.background =
              "linear-gradient(90deg, rgba(255,255,255,0.1) 0%, rgba(153,153,153,0.1) 100%)";
            card.style.borderColor = "#ffffff";
            card.style.boxShadow = "0 11px 24px rgba(55,90,217,0.1)";
          }
          var title = card.querySelector("h1, h2, h3");
          var text = card.querySelector("p");
          if (title) title.style.color = on ? "#000000" : "#ffffff";
          if (text) {
            text.style.color = on ? "rgba(0,0,0,0.6)" : "#ffffff";
            text.style.opacity = "1";
          }
          // Live site: inactive footer logos render monochrome white; header icon keeps color
          var headerRow = title ? title.parentElement : null;
          card.querySelectorAll("img").forEach(function (img) {
            var inHeader = headerRow && headerRow.contains(img);
            img.style.filter = on || inHeader ? "none" : "brightness(0) invert(1)";
            img.style.opacity = "1";
          });
        });
      }

      if (techCards.length) {
        setTechActive(0);
        // Live site pins ~1000px total for 3 cards
        var pinEnd = function () {
          return "+=" + Math.max(window.innerHeight * 1.15, techCards.length * 350);
        };
        ScrollTrigger.create({
          trigger: techSection,
          start: "top top",
          end: pinEnd,
          pin: true,
          pinSpacing: true,
          scrub: 0.6,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onUpdate: function (self) {
            var idx = Math.min(
              techCards.length - 1,
              Math.floor(self.progress * techCards.length + 0.001)
            );
            setTechActive(idx);
          },
        });

        var techPath = techContainer.querySelector("#tech-path");
        if (techPath) {
          var techSvg = techPath.closest("svg");
          if (techSvg) {
            techSvg.style.display = "block";
            techSvg.style.opacity = "0.9";
          }
          preparePath(techPath);
          gsap.to(techPath, {
            strokeDashoffset: 0,
            ease: "none",
            scrollTrigger: {
              trigger: techSection,
              start: "top top",
              end: pinEnd,
              scrub: 1,
            },
          });
        }
      }
    }

    // ---------- FEATURES ----------
    var featureHeading = document.querySelector(".feature-heading");
    var featureSection = sectionOf(featureHeading);
    if (featureSection) {
      gsap.from(featureHeading, {
        y: 40,
        opacity: 0,
        duration: 0.8,
        scrollTrigger: { trigger: featureSection, start: "top 75%" },
      });
      var featureCards = featureSection.querySelectorAll(
        ".rounded-4xl, [class*='rounded-4xl'], .border-dashed"
      );
      gsap.from(featureCards, {
        y: 50,
        opacity: 0,
        duration: 0.7,
        stagger: 0.1,
        ease: "power3.out",
        scrollTrigger: { trigger: featureSection, start: "top 70%" },
      });
    }

    // ---------- TESTIMONIALS ----------
    var testimonialHeading = document.querySelector(".testimonial-heading");
    var testimonialSection = sectionOf(testimonialHeading) || document.querySelector("#reviews");
    if (testimonialSection) {
      gsap.from(testimonialHeading, {
        y: 40,
        opacity: 0,
        duration: 0.8,
        scrollTrigger: { trigger: testimonialSection, start: "top 75%" },
      });
      var slide = testimonialSection.querySelector(".testimonial-slide-content");
      if (slide) {
        gsap.from(slide, {
          y: 50,
          opacity: 0,
          duration: 0.85,
          scrollTrigger: { trigger: slide, start: "top 80%" },
        });
      }
      var founders = testimonialSection.querySelectorAll(".founder-card, [class*='founder-card']");
      gsap.from(founders, {
        y: 45,
        opacity: 0,
        duration: 0.7,
        stagger: 0.12,
        ease: "power3.out",
        scrollTrigger: { trigger: testimonialSection, start: "top 60%" },
      });
    }

    // ---------- FOOTER CTA ----------
    var footer = document.querySelector("footer");
    if (footer) {
      var footerSections = footer.querySelectorAll("section");
      footerSections.forEach(function (sec, i) {
        gsap.from(sec, {
          y: 50,
          opacity: 0,
          duration: 0.8,
          delay: i * 0.05,
          scrollTrigger: { trigger: sec, start: "top 85%" },
        });
      });
    }

    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      a.addEventListener("click", function (e) {
        var id = a.getAttribute("href");
        if (!id || id === "#") return;
        var target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });

    ScrollTrigger.refresh();
    setTimeout(function () { ScrollTrigger.refresh(); }, 400);
    window.addEventListener("load", function () { ScrollTrigger.refresh(); });
    Array.prototype.forEach.call(document.images, function (img) {
      if (!img.complete) img.addEventListener("load", function () { ScrollTrigger.refresh(); });
    });
  }

  function boot() {
    var gsapUrl = "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js";
    var stUrl = "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js";
    loadScript(gsapUrl)
      .then(function () { return loadScript(stUrl); })
      .then(installScrollAnimations)
      .catch(function () {
        // Offline fallback: simple CSS reveals
        document.documentElement.classList.add("sc-fallback-anim");
      });
  }

  if (document.readyState === "complete") boot();
  else window.addEventListener("load", boot);
})();
`;

/** Layout safety — keep sections flowing; allow GSAP to own transforms/opacity. */
export const LAYOUT_SAFE_CSS = `
html, body {
  /* overflow-x:hidden breaks ScrollTrigger pin — use clip */
  overflow-x: clip;
  height: auto !important;
  max-height: none !important;
}

/* Leave .pin-spacer alone — ScrollTrigger needs it for pin scrub */

/* Keep decorative path SVGs available for GSAP drawing (match original breakpoints) */
svg:has(#journey-path),
svg:has(#work-path),
svg:has(#tech-path) {
  pointer-events: none;
}
@media (min-width: 1280px) {
  svg:has(#journey-path) { display: block !important; }
}
@media (min-width: 768px) {
  svg:has(#work-path) { display: block !important; }
}

/* Journey cards: keep original Tailwind layout (48% width, middle lg:mt-25 stagger) */
.journey-card {
  position: relative !important;
  z-index: 2 !important;
  visibility: visible !important;
  transition: background-color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease !important;
}
.journey-card.is-active {
  border-color: rgba(53, 88, 218, 0.2) !important;
  background: #fff !important;
  box-shadow: 0 44px 44px rgba(55, 90, 217, 0.09) !important;
}

/* Work: preserve original zigzag + path alignment (no left:0 on SVG) */
#process .work-card {
  position: relative !important;
  z-index: 2 !important;
  visibility: visible !important;
  transition: background-color 0.35s ease, box-shadow 0.35s ease !important;
}
#process .work-card.is-active {
  background-color: #ffffff !important;
  box-shadow: 0 24px 48px rgba(55, 90, 217, 0.1) !important;
}
#process .work-card .icon-wrapper {
  transition: background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease !important;
}
#process svg:has(#work-path) {
  z-index: 1 !important;
  pointer-events: none !important;
}
@media (min-width: 768px) {
  #process svg:has(#work-path).hidden,
  #process svg:has(#work-path) {
    display: block !important;
  }
}

/* Tech: preserve two-column dark panel + card toggle */
#services {
  width: 100% !important;
}
.tech-container {
  position: relative !important;
  overflow: visible !important;
}
.tech-container > img[alt="Background"] {
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  object-fit: cover !important;
  pointer-events: none !important;
}
.tech-container .rounded-3xl.border.p-6,
.tech-container .flex.w-full.flex-col.gap-8.rounded-3xl {
  position: relative !important;
  visibility: visible !important;
  transition: opacity 0.35s ease, background-color 0.35s ease, border-color 0.35s ease, box-shadow 0.35s ease !important;
}

.founder-card,
[class*="founder-card"] {
  position: relative !important;
  visibility: visible !important;
}

/* Unhide GSAP wait-state until our timeline takes over */
.gsap-init {
  visibility: visible !important;
}

.hero-heading,
.over-heading,
.journey-heading,
.companies-heading,
.work-heading,
.feature-heading,
.testimonial-heading {
  background-clip: text !important;
  -webkit-background-clip: text !important;
  color: transparent !important;
  -webkit-text-fill-color: transparent !important;
}

main > section:first-of-type { isolation: isolate; }
main > section:first-of-type > img.pointer-events-none,
main > section:first-of-type > img.absolute {
  z-index: 0 !important;
  opacity: 0.45 !important;
}
main > section:first-of-type > section,
main > section:first-of-type > div {
  position: relative !important;
  z-index: 2 !important;
}

/* CDN/offline fallback */
.sc-fallback-anim .gsap-init,
.sc-fallback-anim .journey-card,
.sc-fallback-anim .work-card,
.sc-fallback-anim .founder-card {
  opacity: 1 !important;
  transform: none !important;
}
`;
