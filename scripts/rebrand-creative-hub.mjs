import fs from 'node:fs/promises';
import path from 'node:path';
import {load} from 'cheerio';
import {renderHomeBanner, installHomeBanner} from './creative-hub/home-banner.js';

const root = path.resolve('output/bookwhisk');
const backup = path.resolve('output/bookwhisk-before-creative-hub');
try { await fs.access(backup); } catch { await fs.cp(root, backup, {recursive:true}); }
async function walk(dir) {
  const files = [];
  for (const e of await fs.readdir(dir,{withFileTypes:true})) {
    if (e.name === 'brand') continue;
    const file=path.join(dir,e.name);
    if(e.isDirectory()) files.push(...await walk(file)); else files.push(file);
  }
  return files;
}
const replacements = [
  ['info@bookwhisk.com','hello@example.com'],
  ['4700 Millenia Blvd','123 Example Street'],
  ['Orlando, FL 32839, USA','Sample City, ST 00000, USA'],
  ['/assets/brand/home-publishing-studio.png','/assets/brand/home-book-collection.png'],
  ['+1 (407) 966-4443','+1 (202) 555-0147'],
  ['+1 (407) 966-9398','+1 (202) 555-0148'],
  ['+1-407-966-4443','+1-202-555-0147'],
  ['+1-407-966-9398','+1-202-555-0148'],
  ['14079664443','12025550147'],
  ['14079669398','12025550148'],
  ['(max-width: 1023px) 0px, 50vw','(max-width: 1023px) 100vw, 50vw'],
  ['Explore Creative Hub Publishing Services','Publishing services for every chapter.'],
  ['From Concept to Publication and Beyond','From your first draft to your finished book.'],
  ['The Whisk Behind the Words','The People Behind the Pages'],
  ['A publishing experience crafted for authors who care about quality. From the first edit to the final sale,','Your story deserves a beautiful book.'],
  ['Creative Hub Publishing blends precision and passion, brought together in one intuitive platform made for indie authors.','Creative Hub Publishing brings editing, design, and publishing together, so you can focus on creating.'],
  ['Whisk Your Book To Life','Bring Your Story to Life'],
  ['Whisk Your Story to Readers Around the World','Bring Your Story to Readers Around the World'],
  ['We whisk away the hard parts of publishing.','Your creativity. Our publishing expertise.'],
  ['all whisked together','brought together'],
];
let changed=0;
const runtimeImages = {
  '/imgs/laptop-1.avif':'/assets/brand/home-book-collection.png',
  '/imgs/ser_1.avif':'/assets/brand/editorial-studio.png',
  '/imgs/ser_2.avif':'/assets/brand/publishing-hero.png',
  '/imgs/ser_3.webp':'/assets/brand/editorial-studio.png',
  '/imgs/s1.avif':'/assets/brand/publishing-team.png',
  '/imgs/s2.avif':'/assets/brand/editorial-studio.png',
  '/imgs/s3.avif':'/assets/brand/publishing-hero.png',
  '/imgs/s4.avif':'/assets/brand/home-book-collection.png',
};
for(const file of await walk(root)) {
  if(!/\.(html|js|css)$/.test(file)) continue;
  let text=await fs.readFile(file,'utf8'); const before=text;
  // Responsive images built at runtime also need the branded replacements.
  // Include every scroll state and process tab, not only initially visible images.
  text=text.replace(/const brand=\{[^}]*\};if\(brand\[e\]\)return brand\[e\];/g,'');
  text=text.replace('l=(e,t)=>{let r=e.replace(/^\\/imgs\\//,"")',
    `l=(e,t)=>{const brand=${JSON.stringify(runtimeImages)};if(brand[e])return brand[e];let r=e.replace(/^\\/imgs\\//,"")`);
  for(const [from,to] of replacements) text=text.replaceAll(from,to);
  text=text.replace(/BookWhisk|Bookwhisk|BOOKWHISK/g,'Creative Hub Publishing');
  const palette={ff6900:'9500d5',ff820a:'b303ff',fff8ec:'fcf7ff',fff0d3:'f4e8fc',ffdda5:'e9cff9',ffc46d:'d8a0f5',cc4b02:'7900ad',a13a0b:'542375','82320c':'372351',ff2355:'9c42d0',fff0f2:'f8f3fc',ffe2e7:'eee3f6',ffcad4:'dbc2ee',ff9fb0:'c39be0',c80842:'64268b',f97316:'9500d5',fb923c:'bc77e8'};
  text=text.replace(/#([a-f\d]{6})([a-f\d]{2})?\b/gi,(match,rgb,alpha)=>palette[rgb.toLowerCase()] ? '#'+palette[rgb.toLowerCase()]+(alpha||'') : match);
  for (const [from,to] of [
    ['/_next/static/media/child-banner.05cb57c4.avif','/assets/brand/storybook-hero.png'],
    ['/_next/static/media/logo.65782874.avif','/assets/brand/logo-dark.svg'],
    ['/_next/static/media/serv_hero.d4e0a530.avif','/assets/brand/publishing-hero.png'],
  ]) {
    text=text.replaceAll(from,to).replaceAll(encodeURIComponent(from),encodeURIComponent(to));
  }
  text=text.replace(/\/imgs\/generated\/laptop-1-\d+\.avif/g,'/assets/brand/publishing-hero.png');
  if(file===path.join(root,'index.html')) {
    text=text.replaceAll('/assets/brand/publishing-hero.png','/assets/brand/home-book-collection.png');
    if(!text.includes('src="/assets/brand/home-banner.js"')) text=text.replace('</head>','<script defer src="/assets/brand/home-banner.js"></script></head>');
    if(!text.includes('src="/assets/brand/home-counters.js"')) text=text.replace('</head>','<script defer src="/assets/brand/home-counters.js"></script></head>');
    const $ = load(text);
    $('#publishing-banner').remove();
    $('img[alt="Hero"]').closest('section').before(renderHomeBanner());
    // Keep the inherited hero hidden even while scripts and images are loading.
    if (!$('#home-banner-critical').length) $('head').append('<style id="home-banner-critical">section:has(img[alt="Hero"]){display:none!important}</style>');
    text = $.html();
  }
  // The About page has its own team-focused hero, including its Flight payload.
  if(file.replaceAll('\\','/').includes('/about-us/')) {
    text=text.replaceAll('/assets/brand/publishing-hero.png','/assets/brand/publishing-team.png')
      .replaceAll(encodeURIComponent('/assets/brand/publishing-hero.png'),encodeURIComponent('/assets/brand/publishing-team.png'));
  }
  text=text.replace(/\/imgs\/generated\/(ser_1|s[1-4])-\d+\.avif/g,(_,name)=>runtimeImages[`/imgs/${name}.avif`]);
  if(file.endsWith('.html') && text.includes('How It Works')) {
    const $ = load(text);
    $('h2').filter((_,el)=>$(el).text()==='How It Works').closest('section').find('img').each((_,el)=>{
      const img=$(el);
      img.attr('src',runtimeImages['/imgs/s1.avif']);
      img.attr('srcset',(img.attr('srcset')||'').replace(/\/assets\/brand\/[^\s,]+/g,runtimeImages['/imgs/s1.avif']));
    });
    text=$.html();
  }
  text=text.replaceAll('/favicon.ico','/assets/brand/icon.svg').replaceAll('/icon0.svg','/assets/brand/icon.svg').replaceAll('/icon1.png','/assets/brand/icon.png').replaceAll('/apple-icon.png','/assets/brand/icon.png');
  if(file.endsWith('.html') && !text.includes('creative-hub.css')) {
    text=text.replace('</head>','<link rel="stylesheet" href="/assets/brand/creative-hub.css"><link rel="icon" type="image/svg+xml" href="/assets/brand/icon.svg"><meta name="theme-color" content="#251533"></head>');
  }
  if(text!==before) {await fs.writeFile(file,text);changed++;}
}
await fs.copyFile(path.resolve('scripts/creative-hub/theme.css'),path.join(root,'assets/brand/creative-hub.css'));
await fs.writeFile(path.join(root,'assets/brand/home-banner.js'),`(${installHomeBanner.toString()})(${renderHomeBanner.toString()});`);
await fs.copyFile(path.resolve('scripts/creative-hub/home-counters.js'),path.join(root,'assets/brand/home-counters.js'));
console.log(`Creative Hub branding applied to ${changed} HTML, CSS and runtime files. Original saved at ${backup}`);

