const test=require('node:test');
const assert=require('node:assert/strict');
const {PROFILE_URL,INSTALL_URL,hasPaidAccess,checkProfileAccess,openMemberVpnProfile,openProfileManagement}=require('./officialWireGuard.cjs');
const paid = () => ({vpnConnectorAddon:true,subscriptions:[{kind:'vpn_connector',status:'active',currentPeriodEnd:Date.now()/1000+3600}]});
test('only a current active membership opens the fixed HTTPS profile destination',async()=>{
  const calls=[];
  const result=await openMemberVpnProfile({session:'private-app-session',getMembership:async token=>{assert.equal(token,'private-app-session');return paid();},isCurrent:()=>true,openURL:async(...args)=>calls.push(args)});
  assert.equal(result,'opened');assert.deepEqual(calls,[[PROFILE_URL]]);
  assert.equal(PROFILE_URL,'https://uficonnect.org/vault#vpn');
  assert.equal(new URL(PROFILE_URL).search,'');
  assert.equal(new URL(INSTALL_URL).hostname,'apps.apple.com');
});
test('inactive, trial-like, unknown or malformed access never opens a profile page',async()=>{
  for(const status of [null,{}, {vpnConnectorAddon:false},{vpnConnectorAddon:'true'},{trial:true}]) {
    assert.equal(await openMemberVpnProfile({session:'session',getMembership:async()=>status,isCurrent:()=>true,openURL:()=>assert.fail('must not open')}),'inactive');
  }
  assert.equal(await checkProfileAccess({session:null,getMembership:()=>assert.fail('must not request')}),'inactive');
});
test('membership errors fail closed without opening the browser',async()=>{
  await assert.rejects(openMemberVpnProfile({session:'session',getMembership:async()=>{throw Error('offline');},isCurrent:()=>true,openURL:()=>assert.fail('must not open')}),/offline/);
});
test('a delayed membership response cannot open the browser after an account switch',async()=>{
  let resolve,current=true;
  const work=openMemberVpnProfile({session:'old-session',getMembership:()=>new Promise(done=>resolve=done),isCurrent:()=>current,openURL:()=>assert.fail('must not open')});
  current=false;resolve(paid());assert.equal(await work,'stale');
});
test('membership is freshly checked for each open, including a canceled subscription',async()=>{
  let active=true,opened=0,checked=0;
  const args={session:'session',getMembership:async()=>{checked++;return{...paid(),vpnConnectorAddon:active};},isCurrent:()=>true,openURL:async()=>opened++};
  assert.equal(await openMemberVpnProfile(args),'opened');active=false;
  assert.equal(await openMemberVpnProfile(args),'inactive');assert.equal(checked,2);assert.equal(opened,1);
});
test('paid access rejects trials, past-due, expired, duplicate and inconsistent subscription records',()=>{
  assert.equal(hasPaidAccess(paid()),true);
  for (const status of ['trialing','past_due','canceled','unpaid','incomplete']) {
    const value=paid();value.subscriptions[0].status=status;assert.equal(hasPaidAccess(value),false);
  }
  for (const end of [0,Date.now()/1000-1,null,undefined,Infinity,NaN,'9999999999']) {
    const value=paid();value.subscriptions[0].currentPeriodEnd=end;assert.equal(hasPaidAccess(value),false);
  }
  const duplicate=paid();duplicate.subscriptions.push({...duplicate.subscriptions[0]});assert.equal(hasPaidAccess(duplicate),false);
  assert.equal(hasPaidAccess({vpnConnectorAddon:true,subscriptions:[]}),false);
  assert.equal(hasPaidAccess({...paid(),vpnConnectorAddon:false}),false);
});
test('saved-profile management needs no active billing and cannot open after sign-out',async()=>{
  const calls=[];
  assert.equal(await openProfileManagement({session:'signed-in',isCurrent:()=>true,openURL:async(...args)=>calls.push(args)}),'managed');
  assert.deepEqual(calls,[[PROFILE_URL]]);
  for(const session of [null,'stale']) assert.equal(await openProfileManagement({session,isCurrent:()=>false,openURL:()=>assert.fail('must not open')}),'stale');
});
