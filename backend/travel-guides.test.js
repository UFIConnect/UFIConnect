const test = require('node:test');
const assert = require('node:assert/strict');
const { createTravelGuides, guideSections } = require('./travel-guides');
const { fetchTravelResource } = require('./travel-providers');
const cities = [{slug:'Seattle',city:'Seattle',country:'United States',countryCode:'US',fallback:'Waterfront and city walks.'}];
const response = {query:{pages:[{ns:0,title:'Seattle',extract:'City introduction.\n\n== Get around ==\nUse local transit.\n\n=== On foot ===\nWalk the waterfront.'}]}};
test('guide excerpts preserve sections and keep provider markup inert as text', () => {
  const sections = guideSections(response.query.pages[0].extract + '\n<script>alert(1)</script>');
  assert.equal(sections.length,3);
  assert.equal(sections[1].heading,'Get around');
  assert.match(sections[2].text,/<script>/);
  assert.equal(guideSections('a'.repeat(5000))[0].text.length,4000);
  assert.throws(() => guideSections(''),/Empty/);
});
test('only catalog IDs fetch guides, coalesce requests, and cache attributed excerpts', async () => {
  let calls=0;
  const read=createTravelGuides(cities,async(url,options)=>{
    calls++;
    assert.equal(new URL(url).hostname,'en.wikivoyage.org');
    assert.equal(new URL(url).searchParams.get('titles'),'Seattle');
    assert.equal(options.maxBytes,2*1024*1024);
    return response;
  });
  assert.equal(await read('https://example.invalid'),null);
  assert.equal(calls,0);
  const [a,b]=await Promise.all([read('US:Seattle'),read('US:Seattle')]);
  assert.deepEqual(a,b);
  assert.equal(a.available,true);
  assert.match(a.historyUrl,/Seattle&action=history$/);
  assert.equal(a.licenseUrl,'https://creativecommons.org/licenses/by-sa/4.0/');
  await read('US:Seattle'); assert.equal(calls,1);
});
test('outages return a brief overview, retry after 30 seconds, and retain an earlier guide', async () => {
  let clock=0, fail=true, calls=0;
  const read=createTravelGuides(cities,()=>{calls++;if(fail)throw Error('private provider error');return response;},()=>clock);
  const first=await read('US:Seattle');
  assert.equal(first.available,false); assert.equal(first.overview,cities[0].fallback);
  assert.ok(!JSON.stringify(first).includes('private'));
  clock=30001; fail=false;
  assert.equal((await read('US:Seattle')).available,true);
  clock+=6*60*60*1000+1; fail=true;
  const saved=await read('US:Seattle');
  assert.equal(saved.stale,true); assert.equal(saved.sections.length,3); assert.equal(calls,3);
});
test('missing and non-article provider pages never become a guide', async () => {
  for(const page of [{ns:0,missing:true,extract:'wrong'}, {ns:1,extract:'wrong'}, {ns:0,extract:''}]) {
    const read=createTravelGuides(cities,async()=>({query:{pages:[page]}}));
    assert.equal((await read('US:Seattle')).available,false);
  }
});
test('provider body limits apply before JSON parsing', async () => {
  await assert.rejects(fetchTravelResource('https://example.invalid',{maxBytes:8,fetchImpl:async()=>new Response('a'.repeat(9))}),/too large/);
  assert.deepEqual(await fetchTravelResource('https://example.invalid',{maxBytes:20,fetchImpl:async()=>new Response('{"ok":true}')}),{ok:true});
});

test('different-city requests are bounded while duplicate requests share work', async () => {
  const catalog=Array.from({length:5},(_,i)=>({...cities[0],slug:'City_'+i}));
  const releases=[];
  const read=createTravelGuides(catalog,()=>new Promise(resolve=>releases.push(()=>resolve(response))));
  const requests=[0,1,2,3].map(i=>read('US:City_'+i));
  assert.equal((await read('US:City_4')).available,false);
  assert.equal(releases.length,4);
  releases.forEach(resolve=>resolve());
  assert.ok((await Promise.all(requests)).every(guide=>guide.available));
});
