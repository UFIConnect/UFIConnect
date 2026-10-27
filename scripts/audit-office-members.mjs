import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createServer } from '../office/node_modules/vite/dist/node/index.js';
const require = createRequire(import.meta.url);
const express = require('../backend/node_modules/express');
const { PGlite } = require('../backend/node_modules/@electric-sql/pglite');
const { OFFICE_MEMBERS_SCHEMA, registerOfficeMemberRoutes } = require('../backend/office-members');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'office/.cache/member-audit');
const output = path.join(root, '.cache/audit-office-members');
await fs.mkdir(fixture, { recursive: true }); await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(fixture,'index.html'), '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#080e18"><div id="root"></div><script type="module" src="./main.jsx"></script></body></html>');
await fs.writeFile(path.join(fixture,'main.jsx'), `import React from 'react';import {createRoot} from 'react-dom/client';import OfficeUsers from '../../src/OfficeUsers.jsx';const request=(url,options={})=>fetch(url,{...options,headers:{...options.headers,'x-office-token':'synthetic-office'}});createRoot(document.getElementById('root')).render(<OfficeUsers apiBase="/api" request={request}/>);`);
const pg = new PGlite();
await pg.exec(`CREATE TABLE users(id UUID PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW(),onboarding_complete BOOLEAN DEFAULT FALSE,profile_hidden BOOLEAN DEFAULT FALSE,role_settings JSONB DEFAULT '{}')`);
for(const sql of OFFICE_MEMBERS_SCHEMA) await pg.exec(sql);
const ids=[];
for(let i=1;i<=55;i++) { const id=randomUUID();ids.push(id);await pg.query('INSERT INTO users(id,name,email,onboarding_complete,created_at) VALUES($1,$2,$3,$4,$5)', [id,`Member ${String(i).padStart(2,'0')}`,`member${i}@example.invalid`,i<=30,new Date(Date.now()-i*1000).toISOString()]); }
let cached=[], sends=[];
const app=express();app.use(express.json());
registerOfficeMemberRoutes(app,{db:{isConnected:()=>true,query:(...args)=>pg.query(...args)},schedule:()=>null,
  getCachedUserIds:()=>cached,clearUserCache:()=>{const n=cached.length;cached=[];return n;},mailAvailable:()=>true,
  sendMail:async message=>{sends.push(message);return {accepted:[message.to]};},
  requireOfficeToken:(req,res,next)=>req.get('x-office-token')==='synthetic-office'?next():res.status(401).json({message:'Unauthorized'})});
const api=app.listen(0,'127.0.0.1');await new Promise(resolve=>api.once('listening',resolve));
const server=await createServer({root:path.join(root,'office'),configFile:path.join(root,'office/vite.config.js'),envDir:false,
  server:{host:'127.0.0.1',port:5242,strictPort:false,proxy:{'/api':{target:`http://127.0.0.1:${api.address().port}`,rewrite:value=>value.replace(/^\/api/,'')}}}});
let browser, checks=0;
const check=(condition,message)=>{assert.ok(condition,message);checks++;};
try {
  await server.listen();browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
  for(const width of [1440,390]) {
    cached=[ids[0],'orphan-cache-entry'];
    const context=await browser.newContext({viewport:{width,height:950}}), page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await context.route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
    await page.goto(server.resolvedUrls.local[0]+'.cache/member-audit/');
    await page.getByText('55 matching accounts', {exact:false}).waitFor();
    const accountRows=page.locator('.ou-table-wrap').first().locator('tbody tr');
    check(await accountRows.count()===50,'Account page shows fifty persisted accounts');
    await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByText('Page 2 of 2').waitFor();
    check(await accountRows.count()===5,'Pagination shows remaining accounts');
    await page.getByLabel('Status',{exact:true}).selectOption('incomplete');await page.getByText('25 matching accounts',{exact:false}).waitFor();
    check(await accountRows.count()===25,'Incomplete onboarding remains registered');
    await page.getByLabel('Status',{exact:true}).selectOption('all');
    await page.getByLabel('Find an account').fill('Member 01');await page.getByRole('button',{name:'Search',exact:true}).click();
    await page.getByText('1 matching accounts',{exact:false}).waitFor();check(await accountRows.count()===1,'Search finds registered account');
    await page.getByRole('button',{name:'Check user cache',exact:true}).click();await page.locator('.ou-cache').waitFor();
    check(await page.locator('.ou-cache').innerText().then(text=>text.includes('Cache entries without a database account')),'Cache diagnostic identifies orphan entries');
    await page.getByRole('button',{name:'Clear user caches',exact:true}).click();await page.getByText('2 entries cleared on this worker.',{exact:true}).waitFor();
    check((await pg.query('SELECT COUNT(*) FROM users')).rows[0].count===55,'Cache clearing preserves database accounts');
    await page.getByRole('button',{name:'Email',exact:true}).click();await page.getByLabel('Subject',{exact:true}).fill('Synthetic support message');
    await page.getByLabel('Message',{exact:true}).fill('Local audit only. No external messages are sent.');
    const before=sends.length;await page.getByRole('button',{name:'Review and send email',exact:true}).click();
    await page.getByText('Accepted by the email provider.',{exact:false}).waitFor();
    check(sends.length===before+1,'One email sent to local stub');check(sends.at(-1).to==='member1@example.invalid','Stored recipient used');
    check(await page.getByRole('button',{name:'Review and send email',exact:true}).isDisabled(),'Accepted submission cannot be resubmitted');
    await page.screenshot({path:path.join(output,`members-${width}.png`),fullPage:true});
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'No document overflow');
    await page.evaluate(()=>window.dispatchEvent(new Event('office-token-changed')));
    check(await page.locator('.ou-composer').count()===0,'Changing Office credential removes recipient draft');
    check(errors.length===0,'No browser runtime errors');await context.close();
  }
  console.log(JSON.stringify({checks,localStubEmails:sends.length,productionEmails:0,accountsDeleted:0}));
} finally { await browser?.close();await server.close();api.closeAllConnections();await new Promise(resolve=>api.close(resolve));await pg.close(); }
