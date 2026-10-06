const test = require('node:test');
const assert = require('node:assert/strict');
const {createVpnController, safeStatus, validateLease} = require('./controller.cjs');
const now = 1800000000000;
const key = Buffer.alloc(32, 7).toString('base64');
const lease = () => ({deviceId:'device-1',gatewayId:'gateway-1',publicKey:key,serverPublicKey:Buffer.alloc(32,9).toString('base64'),addresses:['10.80.0.2/32','fd80:80:0::2/128'],dns:['10.80.0.1'],allowedIPs:['0.0.0.0/0','::/0'],endpoint:'vpn.example.test:51820',persistentKeepalive:25,leaseExpiresAt:new Date(now+300000).toISOString(),ipv6Egress:'blocked'});
function harness(overrides = {}) {
  const calls = []; let state = {tunnelState:'down'};
  const native = {prepare:async()=>{calls.push('permission');},createIdentity:async()=>{calls.push('key');return{publicKey:key};},
    connect:async(text,token)=>{calls.push('native-connect');assert.equal(token,'fixture-session');assert.equal(JSON.parse(text).privateKey,undefined);state={...JSON.parse(text),tunnelState:'up',lastHandshakeAt:0};},
    disconnect:async()=>{calls.push('native-stop');state={tunnelState:'down'};},status:async()=>state,...overrides.native};
  const request=async(method,path,token,body)=>{
    calls.push(`${method} ${path}`); assert.equal(token,'fixture-session');
    if(overrides.request) { const response=await overrides.request(method,path,body); if(response!==undefined)return response; }
    if(method==='GET')return{available:true,protocol:'wireguard',gateways:[{id:'gateway-1'}]};
    if(method==='POST'){assert.deepEqual(Object.keys(body).sort(),['label','publicKey']);return{state:'enrolled',device:lease()};}
    return{removed:true};
  };
  return {calls,native,controller:createVpnController({native,request,platform:'ios',now:()=>now}),setState:value=>{state=value;}};
}
test('enrollment and OS up without handshake never become Connected',async()=>{
  const h=harness();const result=await h.controller.connect('fixture-session');assert.equal(result.state,'connecting');
  assert.deepEqual(h.calls,['GET /vpn/config','permission','key','POST /vpn/devices','native-connect']);
});
test('connected requires a recent handshake, an OS tunnel, and an unexpired lease',()=>{
  const base={tunnelState:'up',lastHandshakeAt:now-1000,...lease()};
  assert.equal(safeStatus(base,now).state,'connected');
  for(const change of [{tunnelState:'down'},{lastHandshakeAt:0},{lastHandshakeAt:now-180000},{lastHandshakeAt:now+6000},{leaseExpiresAt:new Date(now-1).toISOString()}])assert.notEqual(safeStatus({...base,...change},now).state,'connected');
});
test('lease validation rejects missing IPv6 route, DNS, addresses, mismatched identity, injection and expired lease',()=>{
  for(const changes of [{allowedIPs:['0.0.0.0/0']},{dns:[]},{addresses:['10.80.0.2/32']},{publicKey:Buffer.alloc(32,8).toString('base64')},{endpoint:'host:123\nPrivateKey=leak'},{leaseExpiresAt:new Date(now-1).toISOString()},{ipv6Egress:'routed'}])assert.throws(()=>validateLease({...lease(),...changes},key,now));
});
test('only allowlisted public configuration goes to native bridge',()=>{
  const result=validateLease({...lease(),privateKey:'never accept this',session:'never accept this'},key,now);
  assert.equal(result.privateKey,undefined);assert.equal(result.session,undefined);
});
test('web and Expo Go cannot enroll or report a tunnel',async()=>{
  const controller=createVpnController({native:null,platform:'web',request:()=>{throw Error('network called');}});
  assert.equal((await controller.status()).state,'unavailable');await assert.rejects(controller.connect('fixture-session'));
});
test('unavailable gateway does not create keys or enroll',async()=>{
  const h=harness({request:async(method)=>method==='GET'?{available:false}:undefined});
  await assert.rejects(h.controller.connect('fixture-session'));assert.equal(h.calls.includes('key'),false);assert.equal(h.calls.includes('POST /vpn/devices'),false);
});
test('declined OS permission cannot enroll',async()=>{
  const h=harness({native:{prepare:async()=>{throw Error('denied');}}});
  await assert.rejects(h.controller.connect('fixture-session'));assert.equal(h.calls.includes('POST /vpn/devices'),false);
});
test('disconnect stops locally before authenticated remote revocation',async()=>{
  const h=harness();await h.controller.connect('fixture-session');h.calls.length=0;
  assert.deepEqual(await h.controller.disconnect('fixture-session'),{stopped:true,revoked:true});
  assert.deepEqual(h.calls,['native-stop','DELETE /vpn/devices/device-1']);
});
test('failed server revocation still stops native tunnel and returns honest result',async()=>{
  const h=harness({request:async(method)=>{if(method==='DELETE')throw Error('offline');}});
  await h.controller.connect('fixture-session');assert.deepEqual(await h.controller.disconnect('fixture-session'),{stopped:true,revoked:false});assert.equal((await h.controller.status()).state,'disconnected');
});
test('native stop failure is not reported as stopped',async()=>{
  const h=harness({native:{disconnect:async()=>{throw Error('OS failure');}}});
  await h.controller.connect('fixture-session');await assert.rejects(h.controller.disconnect('fixture-session'));assert.equal(h.calls.includes('DELETE /vpn/devices/device-1'),false);
});
test('late enrollment after cancellation is revoked and never starts native tunnel',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  let enrolled;const started=new Promise(resolve=>{enrolled=resolve;});
  const h=harness({request:async(method)=>{if(method==='POST'){enrolled();await gate;}return undefined;}});
  const pending=h.controller.connect('fixture-session');const caught=assert.rejects(pending,/cancelled/);
  await started;await h.controller.disconnect('fixture-session');release();await caught;
  assert.equal(h.calls.includes('native-connect'),false);assert.equal(h.calls.includes('DELETE /vpn/devices/device-1'),true);
});
test('duplicate Connect requests do not generate another key or enrollment',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const h=harness({native:{prepare:async()=>{await gate;}}});const first=h.controller.connect('fixture-session');
  await assert.rejects(h.controller.connect('fixture-session'),/already/);release();await first;
  assert.equal(h.calls.filter(x=>x==='POST /vpn/devices').length,1);
});
