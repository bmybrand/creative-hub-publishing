import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser=await chromium.launch();
try {
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]) {
    const page=await browser.newPage({viewport});
    const missing=[];
    page.on('response',r=>{if(r.request().resourceType()==='image' && r.status()>=400) missing.push(r.url());});
    await page.goto('http://localhost:3456',{waitUntil:'domcontentloaded'});
    const section=page.locator('section').filter({has:page.getByRole('heading',{name:'How It Works',exact:true})});
    await section.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    const buttons=section.locator('button:visible');
    assert.equal(await buttons.count(),4);
    const sources = new Set();
    for(const step of [0,1,2,3,0]) {
      await buttons.nth(step).click();
      const img=section.locator('img:visible');
      await img.evaluate(async el=>{if(!el.complete)await el.decode();});
      await page.waitForFunction(() => {
        const section=[...document.querySelectorAll('section')].find(e=>e.querySelector('h2')?.textContent==='How It Works');
        return [...section.querySelectorAll('img')].filter(i=>i.getBoundingClientRect().width>0).every(i=>i.complete&&i.naturalWidth>0);
      });
      const state=await img.evaluate(el=>({src:el.currentSrc,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}));
      assert(state.width>100 && state.height>100,'Tab image must occupy visible space');
      assert(state.src.includes('/assets/brand/'),'Tab image must use the local branded asset');
      if(step !== 0 || sources.size === 0) sources.add(state.src);
      console.log(`${viewport.width}px step ${step+1}: image loaded (${Math.round(state.width)} × ${Math.round(state.height)})`);
    }
    assert.equal(sources.size,4,'Each publishing step must have its own image');
    assert.deepEqual(missing,[],'No missing image requests');
    await page.close();
  }
} finally {await browser.close();}
