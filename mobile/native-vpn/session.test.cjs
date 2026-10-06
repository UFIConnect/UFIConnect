const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const file = path.join(__dirname,'../context/AuthContext.js');
const code = require('@babel/core').transformFileSync(file,{babelrc:false,configFile:false,plugins:[require.resolve('@babel/plugin-transform-react-jsx'),require.resolve('@babel/plugin-transform-modules-commonjs')]}).code;
function fixture({stopFails=false,stored=null,platform='android'}={}) {
  const calls=[], effects=[];let onResponseError;
  const react={createContext:()=>({Provider:'Provider'}),useRef:value=>({current:value}),useState:value=>[value,()=>{}],useEffect:fn=>effects.push(fn),useCallback:fn=>fn,createElement:(type,props)=>({type,props})};
  const axios={get:async()=>({data:{id:'fictional-account'}}),delete:async()=>{calls.push('server-delete-account');return{data:{deleted:true}};},post:async(url)=>{calls.push(url.endsWith('/auth/login')?'login':'server-logout');return{data:{token:'fictional-session',profile:{id:'fictional-account'}}};},interceptors:{response:{use:(_success,error)=>{onResponseError=error;return 1;},eject:()=>{}}}};
  const storage={read:async()=>stored,write:async()=>{calls.push('save-session');},clear:async()=>{calls.push('clear-session');}};
  const sandbox={exports:{},__DEV__:false,require(name){
    if(name==='react')return react;if(name==='react-native')return{Platform:{OS:platform}};
    if(name==='axios')return axios;if(name==='expo-constants')return{expoConfig:{extra:{apiUrl:'https://api.uficonnect.org'}}};
    if(name.includes('async-storage')||name==='expo-secure-store')return{};
    if(name==='../security/apiConfig')return{resolveApiBase:()=> 'https://api.uficonnect.org'};
    if(name==='../security/sessionStorage')return{createSessionStorage:()=>storage};
    if(name==='../security/accountDeletion')return require('../security/accountDeletion');
    if(name==='../native-vpn/client')return{disconnectVpnSession:async token=>{calls.push(token?'vpn-stop-signed-in':'vpn-stop-no-session');if(stopFails)throw Error('native stop failed');return{stopped:true,revoked:true};}};
    throw Error('Unexpected import');
  }};
  vm.runInNewContext(code,sandbox,{filename:file});const value=sandbox.exports.AuthProvider({children:null}).props.value;
  return{calls,value,effects,setStopFails:value=>{stopFails=value;},responseError:error=>onResponseError(error)};
}
test('sign out stops VPN while authenticated, clears local session, then revokes server session',async()=>{
  const f=fixture();await f.value.login('fixture@example.test','fixture password');f.calls.length=0;
  const result=await f.value.logout();assert.deepEqual(f.calls,['vpn-stop-signed-in','clear-session','server-logout']);assert.equal(result.vpnDisconnected,true);
});
test('failed native stop still clears and revokes sign-in but honestly reports VPN requiring attention',async()=>{
  const f=fixture();await f.value.login('fixture@example.test','fixture password');f.setStopFails(true);f.calls.length=0;
  const result=await f.value.logout();assert.equal(result.localCleared,true);assert.equal(result.serverRevoked,true);assert.equal(result.vpnDisconnected,false);assert.deepEqual(f.calls,['vpn-stop-signed-in','clear-session','server-logout']);
});
test('session rejection disconnects VPN without recursive authenticated cleanup',async()=>{
  const f=fixture();await f.value.login('fixture@example.test','fixture password');f.effects[1]();f.calls.length=0;
  await assert.rejects(f.responseError({response:{status:401},config:{url:'https://api.uficonnect.org/profile',headers:{Authorization:'Bearer fictional-session'}}}));
  assert.deepEqual(f.calls,['vpn-stop-signed-in','clear-session']);
});
test('incorrect current password is not a session revoke and leaves VPN alone',async()=>{
  const f=fixture();await f.value.login('fixture@example.test','fixture password');f.effects[1]();f.calls.length=0;
  await assert.rejects(f.responseError({response:{status:401},config:{url:'https://api.uficonnect.org/profile/password',headers:{Authorization:'Bearer fictional-session'}}}));assert.deepEqual(f.calls,[]);
});
test('new sign-in cannot inherit a VPN whose stop failed; its new token is revoked',async()=>{
  const f=fixture({stopFails:true});await assert.rejects(f.value.login('fixture@example.test','fixture password'));
  assert.deepEqual(f.calls,['login','vpn-stop-no-session','server-logout']);
});
test('logout-all attempts authenticated VPN removal before revoking sessions',async()=>{
  const f=fixture();await f.value.login('fixture@example.test','fixture password');f.calls.length=0;
  const result=await f.value.logoutAll();assert.deepEqual(f.calls,['vpn-stop-signed-in','server-logout','vpn-stop-signed-in','clear-session']);assert.equal(result.vpnDisconnected,true);
});
test('a local VPN failure cannot prevent remote logout-all',async()=>{
  const f=fixture();await f.value.login('fixture@example.test','fixture password');f.setStopFails(true);f.calls.length=0;
  const result=await f.value.logoutAll();assert.ok(f.calls.includes('server-logout'));assert.equal(result.vpnDisconnected,false);assert.equal(result.localCleared,true);
});

test('confirmed account deletion stops native VPN and clears the same account session',async()=>{
  const f=fixture();await f.value.login('fixture@example.test','fixture password');f.calls.length=0;
  const result=await f.value.deleteAccount();
  assert.equal(result.deleted,true);assert.equal(result.localCleared,true);
  assert.deepEqual(f.calls,['server-delete-account','vpn-stop-signed-in','clear-session']);
});

test('iOS sign-in and sign-out never claim control of the external WireGuard tunnel',async()=>{
  const f=fixture({platform:'ios',stopFails:true});
  await f.value.login('fixture@example.test','fixture password');
  assert.deepEqual(f.calls,['login','save-session']); f.calls.length=0;
  const result=await f.value.logout();
  assert.deepEqual(f.calls,['clear-session','server-logout']);
  assert.equal(result.vpnDisconnected,null); assert.equal(result.localCleared,true);
});
test('iOS logout-all still invalidates server access without a native disconnect call',async()=>{
  const f=fixture({platform:'ios'});await f.value.login('fixture@example.test','fixture password');f.calls.length=0;
  const result=await f.value.logoutAll();assert.deepEqual(f.calls,['server-logout','clear-session']);assert.equal(result.vpnDisconnected,null);
});
