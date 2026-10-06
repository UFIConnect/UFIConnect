const test = require('node:test');
const assert = require('node:assert/strict');
const {parseVpnLaunch,createVpnLaunch} = require('./launch.cjs');
const code = 'A'.repeat(43), second = 'B'.repeat(42) + 'A';
const url = value => `uficonnect-vpn://connect?code=${value}`;
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(consume = async () => ({action:'connect'})) {
  const events = []; let time = 1000;
  const launch = createVpnLaunch({consume,platform:'ios',now:()=>time});
  launch.subscribe(event => events.push(event));
  return {launch,events,advance(ms){time+=ms;}};
}
test('strictly accepts one canonical 32-byte base64url nonce', () => {
  assert.equal(parseVpnLaunch(url(code)), code);
  for (const value of [null, '', url('A'.repeat(42)), url('A'.repeat(44)), url('A'.repeat(42)+'B'), url(code)+'#x', url(code)+'&token=secret', url(code)+'&code='+code, url(code).replace('connect?', 'connect/?'), url(code).replace('uficonnect-vpn:', 'https:'), url(code).replace('connect?', 'other?'), url(code).replace('A', '%41'), ' '+url(code)]) assert.equal(parseVpnLaunch(value), null);
});
test('logged-out intent waits for authenticated onboarding and consumes once', async () => {
  const calls=[];const {launch,events}=setup(async(...args)=>{calls.push(args);return {action:'connect'};});
  launch.open(url(code));await tick();assert.equal(calls.length,0);
  launch.bindSession('session',false);await launch.flush();assert.equal(calls.length,0);
  launch.bindSession('session',true);await launch.flush();
  assert.deepEqual(calls,[[code,'ios','session']]);
  assert.equal(events[0].type,'request');
  assert.equal(launch.claim(events[0].id,'other'),false);
  assert.equal(launch.claim(events[0].id,'session'),true);
  assert.equal(launch.claim(events[0].id,'session'),false);
});
test('initial URL plus duplicate URL event cannot dispatch or consume twice', async () => {
  let calls=0;const {launch,events}=setup(async()=>{calls++;return {action:'connect'};});
  launch.bindSession('session',true);assert.equal(launch.open(url(code)),true);assert.equal(launch.open(url(code)),false);
  await tick();assert.equal(calls,1);assert.equal(events.length,1);
});
test('account change while consume is pending suppresses the old connection', async () => {
  let resolve;const {launch,events}=setup(()=>new Promise(done=>{resolve=done;}));
  launch.bindSession('first',true);launch.open(url(code));launch.bindSession('second',true);
  resolve({action:'connect'});await tick();assert.deepEqual(events,[]);
});
test('logout clears a queued signed-in intent instead of inheriting it on login', async () => {
  let calls=0;const {launch}=setup(async()=>{calls++;return {action:'connect'};});
  launch.bindSession('first',false);launch.open(url(code));launch.bindSession(null,false);launch.bindSession('second',true);await launch.flush();
  assert.equal(calls,0);
});
test('late navigation request cannot be claimed by a changed session', async () => {
  const {launch,events}=setup();launch.bindSession('first',true);launch.open(url(code));await tick();
  launch.bindSession('second',true);assert.equal(launch.claim(events[0].id,'first'),false);assert.equal(launch.claim(events[0].id,'second'),false);
});
test('expired waiting intents and late consume results never dispatch', async () => {
  let calls=0;const a=setup(async()=>{calls++;return {action:'connect'};});
  a.launch.open(url(code));a.advance(180000);a.launch.bindSession('first',true);await a.launch.flush();assert.equal(calls,0);assert.equal(a.events[0].type,'expired');
  let resolve;const b=setup(()=>new Promise(done=>{resolve=done;}));b.launch.bindSession('first',true);b.launch.open(url(code));b.advance(180000);resolve({action:'connect'});await tick();assert.equal(b.events[0].type,'expired');
});
test('server rejection or unexpected action never yields a connect request', async () => {
  for(const consume of [async()=>{throw {response:{status:403},secret:'hidden'};},async()=>({action:'disconnect'})]){
    const {launch,events}=setup(consume);launch.bindSession('session',true);launch.open(url(code));await tick();
    assert.equal(events.some(event=>event.type==='request'),false);assert.equal(JSON.stringify(events).includes('hidden'),false);
  }
});
test('a newer link supersedes an in-flight link and is consumed serially', async () => {
  const resolvers=[],calls=[];const {launch,events}=setup(value=>{calls.push(value);return new Promise(done=>resolvers.push(done));});
  launch.bindSession('session',true);launch.open(url(code));launch.open(url(second));assert.equal(calls.length,1);
  resolvers[0]({action:'connect'});await tick();assert.equal(events.length,0);assert.equal(calls.length,2);
  resolvers[1]({action:'connect'});await tick();assert.equal(events.length,1);
});
test('web cannot consume or act on native VPN links', async () => {
  const launch=createVpnLaunch({consume:()=>assert.fail('must not consume'),platform:'web'});launch.bindSession('session',true);assert.equal(launch.open(url(code)),false);await launch.flush();
});
