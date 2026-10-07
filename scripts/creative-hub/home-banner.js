export function renderHomeBanner() {
    const covers = Array.from({length:36}, (_,i) => {
      const number = 1 + (i * 7) % 34;
      return `<img src="/imgs/generated/books/${number}-480.avif" alt="" width="250" height="373" decoding="async">`;
    }).join('');

 return '<section id="publishing-banner" aria-labelledby="publishing-banner-title">' + `<div class="publishing-cover-wall" aria-hidden="true">${covers}</div>
      <div class="publishing-banner-shade" aria-hidden="true"></div>
      <div class="publishing-banner-content">
        <span class="publishing-banner-badge"><span aria-hidden="true">★</span> Made for independent authors</span>
        <h1 id="publishing-banner-title">Self-Publishing Company in the USA</h1>
        <h2>Your Story, Our Expertise, Extraordinary Results</h2>
        <p>From editing and cover design to print and global distribution, we bring your book to life—while you keep your rights and creative control.</p>
        <ul aria-label="Publishing benefits"><li>Professional editing & design</li><li>Global distribution</li><li>Author ownership</li></ul>
        <div class="publishing-banner-actions"><a href="/services/">Explore publishing services <span aria-hidden="true">→</span></a><a href="/contact/">Get a free consultation</a></div>
      </div>` + '</section>';
}

export function installHomeBanner(render) {
 if (!['/', '/index.html'].includes(location.pathname)) return;
 function mount() {
  const original = document.querySelector('img[alt="Hero"]')?.closest('section');
  if (!original) return;
  if (!document.getElementById('publishing-banner')) original.insertAdjacentHTML('beforebegin', render());
 }
 // React can restore the cloned markup during hydration. Repair it before paint.
 new MutationObserver(mount).observe(document.documentElement, {childList:true, subtree:true});
 mount();
}
