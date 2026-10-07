import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch();
try {
  for (const viewport of [{width:1440,height:900},{width:390,height:844}]) {
    const page = await browser.newPage({viewport});
    await page.goto('http://localhost:3456', {waitUntil:'domcontentloaded'});
    const section = page.locator('section').filter({has:page.getByRole('heading',{name:'Who We Are',exact:true})});
    await page.waitForTimeout(800);
    for (const step of [0,1,2,1,0]) {
      await section.evaluate((el, step) => {
        const offset = el.offsetHeight * (step + 0.12) / 3;
        window.scrollTo({top:scrollY+el.getBoundingClientRect().top+offset,behavior:'instant'});
      },step);
      await page.waitForFunction(({step}) => {
        const section=document.querySelector('.service-image')?.closest('section');
        return section?.querySelector('[aria-current="true"] > span')?.textContent === String(step+1);
      },{step});
      await section.locator('img').evaluate(img => img.decode());
      const state=await section.evaluate(el => ({
        top:el.firstElementChild.getBoundingClientRect().top,
        imageWidth:el.querySelector('img').naturalWidth,
        button:el.querySelector('a').getBoundingClientRect().toJSON(),
        heading:el.querySelector('[aria-current="true"] h3').textContent,
      }));
      assert(Math.abs(state.top)<2,'Panel must stay pinned while steps advance');
      assert(state.imageWidth>0,'Every step image must load');
      assert(state.button.bottom<=viewport.height,'CTA must fit in the viewport');
      assert(state.button.right<=viewport.width,'CTA must not overflow horizontally');
      console.log(`${viewport.width}px step ${step+1}: ${state.heading} — pinned, image loaded, CTA visible`);
    }
    await section.evaluate(el => window.scrollTo({top:scrollY+el.getBoundingClientRect().bottom+50,behavior:'instant'}));
    assert(await section.evaluate(el => el.firstElementChild.getBoundingClientRect().bottom<0),'Panel must release after the section');
    await page.close();
  }
} finally { await browser.close(); }
