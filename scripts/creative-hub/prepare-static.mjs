import fs from 'node:fs/promises';
import path from 'node:path';
import {load} from 'cheerio';

const root=path.resolve(process.argv[2] || 'output/bookwhisk');
async function walk(dir) {
  const entries=await fs.readdir(dir,{withFileTypes:true});
  return (await Promise.all(entries.map(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]))).flat();
}
for(const file of await walk(root)) {
  if(!/\.(html|js)$/.test(file)) continue;
  let text=await fs.readFile(file,'utf8');
  text=text.replaceAll('function l({config:e,src:t,width:r,quality:a}){let o=', 'function l({config:e,src:t,width:r,quality:a}){return t;let o=');
  for(const url of ['https://www.googletagmanager.com/gtag/js?id=AW-17674619114','https://cdn.livechatinc.com/tracking.js']) {
    text=text.replaceAll(url,'/assets/brand/disabled-integration.js');
  }
  if(file.endsWith('.html')) {
    const $=load(text);
    $('[src], [srcset], [imagesrcset], link[href]').each((_,el)=>{
      for(const attr of ['src','srcset','imagesrcset','href']) {
        const value=$(el).attr(attr);
        if(value?.includes('/_next/image?')) $(el).attr(attr,value.replace(/\/_next\/image\?url=([^&\s,]+)(?:&(?:w|q|dpl)=[^&\s,]+)*/g,(_,url)=>decodeURIComponent(url)));
      }
    });
    text=$.html();
  }
  await fs.writeFile(file,text);
}
await fs.writeFile(path.join(root,'assets/brand/disabled-integration.js'),'/* Inherited third-party integration disabled for this static site. */\n');
console.log('Static image URLs and integration settings prepared.');
