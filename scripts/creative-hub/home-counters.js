(() => {
  if (!['/', '/index.html'].includes(location.pathname)) return;
  const selector = 'main > section.bg-primary-50.py-14';
  const registered = new WeakSet();
  let completed = false;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  function register() {
    const section = document.querySelector(selector);
    if (!section || registered.has(section)) return;
    registered.add(section);
    const numbers = [...section.querySelectorAll('.text-4xl')];
    if (completed || reducedMotion.matches) return;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      const counters = numbers.map(element => {
        const label = element.textContent.trim();
        const value = Number.parseInt(label, 10);
        const suffix = label.replace(/^\d+/, '');
        const visual = document.createElement('span');
        visual.setAttribute('aria-hidden', 'true');
        const accessible = document.createElement('span');
        accessible.className = 'sr-only';
        accessible.textContent = label;
        element.replaceChildren(visual, accessible);
        return {visual, value, suffix};
      });
      const start = performance.now();
      function frame(now) {
        const progress = Math.min((now - start) / 1600, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        for (const {visual, value, suffix} of counters) visual.textContent = Math.round(value * eased) + suffix;
        if (progress < 1 && section.isConnected) requestAnimationFrame(frame);
        else if (progress === 1) completed = true;
      }
      requestAnimationFrame(frame);
    }, {threshold: 0.35});
    observer.observe(section);
  }
  new MutationObserver(register).observe(document.documentElement, {childList:true, subtree:true});
  register();
})();
