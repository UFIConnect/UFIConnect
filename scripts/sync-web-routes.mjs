import fs from 'node:fs/promises';
import {publicRoutes,memberRoutes,dynamicRoutes,redirectRoutes} from '../web/src/seo-routes.mjs';

const routes=[{type:'rewrite',source:'/health',destination:'/health.json'},
 ...redirectRoutes.flatMap(route=>[{type:'redirect',...route},{type:'redirect',source:route.source+'/',destination:route.destination}]),
 ...[...publicRoutes.map(route=>route.path),...memberRoutes].filter(route=>route!=='/').flatMap(route=>[
  {type:'rewrite',source:route,destination:`${route}/index.html`},{type:'rewrite',source:route+'/',destination:`${route}/index.html`}]),
 ...dynamicRoutes.flatMap(source=>[{type:'rewrite',source,destination:'/app.html'},{type:'rewrite',source:source+'/',destination:'/app.html'}])];
const serialized=JSON.stringify(routes,null,2)+'\n';
const sitemap=`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${publicRoutes.filter(route=>route.index).map(route=>`  <url><loc>https://uficonnect.org${route.path}</loc></url>`).join('\n')}\n</urlset>\n`;
const config=await fs.readFile(new URL('../render.yaml',import.meta.url),'utf8');
const ruleBlock=routes.map(route=>`      - type: ${route.type}\n        source: ${route.source}\n        destination: ${route.destination}`).join('\n');
const next=config.replace(/(name: uficonnect-web\r?\n[\s\S]*?    routes:\r?\n)[\s\S]*?(    headers:)/,`$1${ruleBlock}\n$2`);
const output=new URL('../web/render-routes.json',import.meta.url);
if(process.argv.includes('--check')){
 if(next!==config||(await fs.readFile(output,'utf8'))!==serialized||(await fs.readFile(new URL('../web/public/sitemap.xml',import.meta.url),'utf8'))!==sitemap)throw new Error('Static web routes are out of sync; run node scripts/sync-web-routes.mjs');
}else{await fs.writeFile(new URL('../render.yaml',import.meta.url),next);await fs.writeFile(output,serialized);await fs.writeFile(new URL('../web/public/sitemap.xml',import.meta.url),sitemap);}
console.log(`Web routing: ${routes.length} explicit rules, no catch-all rewrite.`);
