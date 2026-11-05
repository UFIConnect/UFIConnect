import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

// Match Cloudflare's documented _headers subset used by Office: path blocks,
// one splat, and comma joining for overlapping headers. The browser below
// verifies policy enforcement, not only the spelling of configuration text.
function rulesOf(source) {
  const rules=[];let current;
  for(const line of source.split(/\r?\n/)){
    assert.ok(line.length<=2000,'Cloudflare header line capacity');
    if(!line.trim()||line.trim().startsWith('#'))continue;
    if(!/^\s/.test(line)){
      assert.ok(line.startsWith('/')&&!line.startsWith('//'));
      assert.ok((line.match(/\*/g)||[]).length<=1);
      current={pattern:line,headers:{}};rules.push(current);continue;
    }
    assert.ok(current,'Header has a URL pattern');
    const match=/^\s+([^:]+):\s*(.+)$/.exec(line);assert.ok(match,'Header syntax');
    const name=match[1].toLowerCase();assert.equal(current.headers[name],undefined,'No duplicate header in a block');current.headers[name]=match[2];
  }
  assert.ok(rules.length<=100);return rules;
}
function headersFor(rules,urlPath) {
  const headers={};
  for(const rule of rules){const pattern='^'+rule.pattern.split('*').map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$';
    if(!new RegExp(pattern).test(urlPath))continue;
    for(const [key,value]of Object.entries(rule.headers))headers[key]=headers[key]?headers[key]+', '+value:value;
  }
  return headers;
}

export async function auditOfficeStaticSecurity({browser,root}) {
  const source=await fs.readFile(path.join(root,'office/public/_headers'),'utf8');
  const built=await fs.readFile(path.join(root,'office/dist/_headers'),'utf8');
  assert.equal(built,source,'Vite build carries static security headers into deployed assets');
  const rules=rulesOf(built),security=headersFor(rules,'/');
  assert.match(security['strict-transport-security'],/^max-age=31536000$/);
  assert.equal(security['x-content-type-options'],'nosniff');assert.equal(security['x-frame-options'],'SAMEORIGIN');
  assert.equal(security['referrer-policy'],'no-referrer');assert.ok(security['cache-control'].includes('no-store'));
  assert.match(security['content-security-policy'],/frame-ancestors 'self'/);
  assert.match(security['content-security-policy'],/object-src 'none'/);
  assert.match(security['content-security-policy'],/base-uri 'self'/);
  assert.match(headersFor(rules,'/assets/app-123.js')['cache-control'],/immutable/);
  assert.doesNotMatch(headersFor(rules,'/assets/app-123.js')['cache-control'],/no-store|no-cache/);
  const pageHtml=`<!doctype html><html><head></head><body><h1>Office header fixture</h1><script>
    window.violations=[];document.addEventListener('securitypolicyviolation',event=>window.violations.push(event.effectiveDirective));
    const base=document.createElement('base');base.href='https://invalid.example/';document.head.append(base);
    const object=document.createElement('object');object.data='data:text/html,blocked';document.body.append(object);
    window.parent.postMessage('office-header-app-ready','*');
    window.addEventListener('message',event=>{if(event.data==='preview-script-ready')window.previewReady=true;});
    const preview=document.createElement('iframe');preview.sandbox='allow-scripts';preview.srcdoc='<script>parent.postMessage("preview-script-ready","*")<'+ '/script>';document.body.append(preview);
  </script><script src='/assets/good.js'></script><script src='/assets/wrong-mime.js'></script></body></html>`;
  const app=http.createServer((req,res)=>{
    const urlPath=new URL(req.url,'http://localhost').pathname,headers=headersFor(rules,urlPath);
    res.writeHead(200,{...headers,'Content-Type':urlPath==='/assets/good.js'?'application/javascript':urlPath==='/assets/wrong-mime.js'?'text/plain':'text/html'});
    res.end(urlPath==='/assets/good.js'?'window.goodScript=true;':urlPath==='/assets/wrong-mime.js'?'window.wrongMimeExecuted=true;':pageHtml);
  });
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${app.address().port}`;
  const hostile=http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(`<script>window.embedded=false;window.addEventListener('message',event=>{if(event.data==='office-header-app-ready')window.embedded=true;});</script><iframe src='${origin}/'></iframe>`);});
  await new Promise(resolve=>hostile.listen(0,'127.0.0.1',resolve));
  const context=await browser.newContext();
  try{
    const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>window.goodScript&&window.previewReady);
    assert.equal(await page.evaluate(()=>window.wrongMimeExecuted),undefined,'nosniff blocks script with the wrong content type');
    assert.equal(await page.evaluate(()=>document.baseURI),origin+'/','CSP rejects an injected external base URI');
    await page.waitForFunction(()=>window.violations.includes('object-src'));
    const embedded=await context.newPage();await embedded.goto(`http://127.0.0.1:${hostile.address().port}`);
    await embedded.waitForLoadState('networkidle');
    assert.equal(await embedded.evaluate(()=>window.embedded),false,'Cross-origin framing cannot execute Office');
    return['Built Office static headers block external framing, plugin objects, base injection and wrong-MIME scripts',
      'Office sandbox preview scripts still execute and versioned assets retain immutable caching'];
  }finally{await context.close();await Promise.all([new Promise(resolve=>app.close(resolve)),new Promise(resolve=>hostile.close(resolve))]);}
}
