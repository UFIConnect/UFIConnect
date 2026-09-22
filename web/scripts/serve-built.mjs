import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dynamicRoutes,redirectRoutes} from '../src/seo-routes.mjs';
import {browserSecurityPolicy} from '../securityPolicy.mjs';
const defaultRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../dist');
const dynamicPatterns=dynamicRoutes.map(route=>new RegExp(`^${route.replace(/:[^/]+/g,'[^/]+')}/?$`));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.xml':'application/xml','.txt':'text/plain; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.webp':'image/webp','.woff2':'font/woff2','.mp4':'video/mp4','.vtt':'text/vtt'};
export async function startBuiltServer({host='127.0.0.1',port=0,root=defaultRoot}={}){
 root=path.resolve(root);
 const policy=browserSecurityPolicy(await fs.readFile(path.join(root,'index.html'),'utf8'));
 const server=createServer(async(req,res)=>{
  const headers={'Content-Security-Policy':policy,'X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN','Referrer-Policy':'no-referrer','X-XSS-Protection':'0','Cache-Control':'no-store'};
  try{
   if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{...headers,Allow:'GET, HEAD'});return res.end();}
   const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
   const redirect=redirectRoutes.find(route=>pathname.replace(/\/$/,'')===route.source);
   if(redirect){res.writeHead(301,{...headers,Location:redirect.destination});return res.end();}
   let file=path.resolve(root,'.'+(pathname==='/health'?'/health.json':pathname));
   let status=200;
   if(file!==root&&!file.startsWith(root+path.sep))throw new Error('Invalid path');
   let stat=await fs.stat(file).catch(()=>null);
   if(stat?.isDirectory()){file=path.join(file,'index.html');stat=await fs.stat(file).catch(()=>null);}
   if(!stat?.isFile()){
    if(dynamicPatterns.some(pattern=>pattern.test(pathname)))file=path.join(root,'app.html');
    else{file=path.join(root,'404.html');status=404;}
   }
   const content=await fs.readFile(file);
   res.writeHead(status,{...headers,'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Length':content.length});
   res.end(req.method==='HEAD'?undefined:content);
  }catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8',...headers});res.end('Page not found');}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
 return {origin:`http://${host}:${server.address().port}`,close:()=>new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();})};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const server=await startBuiltServer({port:Number(process.env.PORT)||4173});console.log(`Built website: ${server.origin}`);
}
