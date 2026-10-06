import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { publicRoutes, memberRoutes } from '../src/seo-routes.mjs';
import { browserSecurityPolicy } from '../securityPolicy.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dist=path.join(root,'dist');
const template=await fs.readFile(path.join(dist,'index.html'),'utf8');
const manifest=JSON.parse(await fs.readFile(path.join(dist,'.vite/manifest.json'),'utf8'));
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const base=process.env.GH_PAGES==='true'?'/UFIConnect/':'/';
const server=await createServer({root,configFile:path.join(root,'vite.config.js'),mode:'production',server:{middlewareMode:true},appType:'custom'});
try {
 const {renderPage}=await server.ssrLoadModule('/src/entry-prerender.jsx');
 const css=new Set();
 const seen=new Set();
 function collectCss(key){if(seen.has(key))return;seen.add(key);const entry=manifest[key];if(!entry)return;for(const file of entry.css||[])css.add(file);for(const imported of entry.imports||[])collectCss(imported);}
 for(const name of ['Landing','Login','Register','GuestFeed','PrivacyPolicy','TermsOfService','ChildSafety','ForgotPassword','SearchGuide','NotFound','Policies','CopyrightPolicy','VaultDeviceOverview','OfficeOverview'])collectCss(`src/pages/${name}.jsx`);
 const styles=[...css].filter(file=>!template.includes(file)).map(file=>`<link rel="stylesheet" href="${base}${file}">`).join('\n');
 function documentFor(route,markup){
  // React 19 hoists Helmet's native metadata into the server string. Route
  // metadata belongs in the document head, never duplicated inside #root.
  markup=markup.replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi,'').replace(/<meta\b[^>]*>/gi,'').replace(/<link\b(?=[^>]*\brel="canonical")[^>]*>/gi,'');
  // A pre-rendered form has no event handlers. Disable it until React mounts
  // so a no-JS browser can never send a password in a default GET request.
  markup=markup.replace(/<form\b([^>]*)>/g,'<form$1><noscript><p>Enable JavaScript to use this form securely. You can still read this page and browse the links below.</p></noscript><fieldset disabled style="border:0;padding:0;margin:0;min-width:0">').replace(/<\/form>/g,'</fieldset></form>');
  const canonical=`https://uficonnect.org${route.path==='/'?'/':route.path}`;
  const robots=route.index?'index, follow, max-image-preview:large':'noindex, follow';
  let html=template.replace(/<title>[\s\S]*?<\/title>/i,`<title>${escape(route.title)}</title>`)
   .replace(/<meta\s+[^>]*(?:name="(?:description|robots|googlebot|bingbot|twitter:title|twitter:description)"|property="(?:og:title|og:description|og:url)")[^>]*>\s*/gi,'')
   .replace(/<link\s+[^>]*rel="canonical"[^>]*>\s*/gi,'');
  html=html.replace('</head>',`<meta name="description" content="${escape(route.description)}">\n<meta name="robots" content="${robots}">\n<link rel="canonical" href="${escape(canonical)}">\n<meta property="og:title" content="${escape(route.title)}">\n<meta property="og:description" content="${escape(route.description)}">\n<meta property="og:url" content="${escape(canonical)}">\n<meta name="twitter:title" content="${escape(route.title)}">\n<meta name="twitter:description" content="${escape(route.description)}">\n${styles}\n</head>`);
  html=html.replace(/<title>/g,'<title data-prerender-meta>')
   .replace(/<(meta|link) (?=(?:name="(?:description|robots|twitter:title|twitter:description)"|property="(?:og:title|og:description|og:url)"|rel="canonical"))/g,'<$1 data-prerender-meta ');
  const sessionShell = route.path === '/' || route.path === '/search' || memberRoutes.includes(route.path);
  html = html.replace(/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*>/i,
    `<meta http-equiv="Content-Security-Policy" content="${escape(browserSecurityPolicy(template, { meta: true, video: true, advertising: route.page === 'landing' }))}">`);
  return html.replace('<div id="root"></div>',`<div id="root" data-prerendered="true"${sessionShell ? ' data-session-shell="true"' : ''}>${markup}</div>${sessionShell ? '<div class="static-session-loading" role="status">Opening UFIconnect…</div>' : ''}`);
 }
 for(const route of publicRoutes){
  const html=documentFor(route,renderPage(route.path,route.page));
  const destination=path.join(dist,route.path.slice(1),'index.html');
  await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,html);
 }
 const memberMarkup=renderPage('/login','login');
 for(const routePath of memberRoutes){
  const route={path:routePath,title:'Sign in to continue | UFIconnect',description:'Sign in to your UFIconnect account to open this member page, or browse public posts without an account.',index:false};
  const destination=path.join(dist,routePath.slice(1),'index.html');
  await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,documentFor(route,memberMarkup));
 }
 await fs.writeFile(path.join(dist,'app.html'),documentFor({path:'/',title:'Open UFIconnect',description:'Open a shared post or sign in to access a member page.',index:false},renderPage('/search','search')));
 await fs.writeFile(path.join(dist,'404.html'),documentFor({path:'/404',title:'Page not found | UFIconnect',description:'This page could not be found. Return home or explore the public feed.',index:false},renderPage('/404','notFound')));
 const sitemap=`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${publicRoutes.filter(route=>route.index).map(route=>`  <url><loc>https://uficonnect.org${route.path}</loc></url>`).join('\n')}\n</urlset>\n`;
 await fs.writeFile(path.join(dist,'sitemap.xml'),sitemap);
 console.log(`Pre-rendered ${publicRoutes.length} public pages, ${memberRoutes.length} private sign-in shells, and a real 404 document. No API data fetched.`);
}finally{await server.close();}
