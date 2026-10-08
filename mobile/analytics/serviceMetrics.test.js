const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createServiceMetrics, supportsErrorCollection, installErrorCollection } = require('./serviceMetrics');
const { parsePreferences, feedSections, DEFAULT_PREFERENCES } = require('../context/dataPreferences');
const settle = () => new Promise(resolve => setImmediate(resolve));

test('profile tabs count actual changes once and never leak names or collect in VPN', async () => {
  const requests = [];
  const metrics = createServiceMetrics({ apiBase: 'https://api.example.test', fetcher: (_, options) => requests.push(JSON.parse(options.body)) });
  metrics.trackScreen('ProfileMain', 'private-profile-key');
  metrics.trackTab('ProfileOverview'); metrics.trackTab('ProfileOverview');
  metrics.trackTab('ProfileSkills'); metrics.trackTab('private-tab'); metrics.trackTab('ProfileGroups');
  await settle();
  assert.deepEqual(requests, [{ category: 'app_profile' }, { category: 'app_profile_overview' }, { category: 'app_profile_skills' }, { category: 'app_profile_groups' }]);
  metrics.trackScreen('VPN', 'private-key'); metrics.trackTab('ProfileOverview');
  await settle(); assert.equal(requests.length, 4);
  metrics.trackScreen('ProfileMain', 'private-profile-key'); metrics.trackTab('ProfileGroups');
  await settle(); assert.deepEqual(requests.slice(-2), [{ category: 'app_profile' }, { category: 'app_profile_groups' }]);
  metrics.dispose();
});

test('preferences default safely and ignore invalid or unrelated stored fields', () => {
  for (const raw of [null, 'null', '[]', '{', '42', '{"dataSaver":"true","performanceInsights":1}']) {
    assert.deepEqual(parsePreferences(raw), DEFAULT_PREFERENCES);
  }
  assert.deepEqual(parsePreferences('{"dataSaver":true,"performanceInsights":true,"token":"private"}'),
    {dataSaver:true, autoplayPreviews:true, performanceInsights:true});
  assert.deepEqual(feedSections(true, 'jobs'), ['jobs']);
  assert.deepEqual(feedSections(false, 'jobs'), ['groups', 'social', 'jobs']);
});

test('required usage sends only fixed categories and deduplicates repeated navigation state', async () => {
  const requests = [];
  const metrics = createServiceMetrics({apiBase:'https://api.example.test',fetcher: (...args) => requests.push(args)});
  metrics.trackScreen('Login','secret-key');
  metrics.trackScreen('Login','secret-key');
  metrics.trackScreen('Conversation','private-conversation-id');
  metrics.trackScreen('Privacy','private-state');
  metrics.trackScreen('Private person?token=secret');
  await settle();
  assert.deepEqual(requests.map(([, options]) => JSON.parse(options.body)), [{category:'app_login'}, {category:'app_conversation'}, {category:'app_privacy'}]);
  for (const [url, options] of requests) {
    assert.equal(url,'https://api.example.test/analytics/pageview');
    assert.equal(options.credentials,'omit');
    assert.equal(options.referrerPolicy,'no-referrer');
    assert.equal(options.redirect,'error');
    assert.deepEqual(options.headers, {'Content-Type':'application/json'});
    assert.equal(JSON.stringify(options).includes('private'),false);
  }
  metrics.dispose();
});

test('VPN screens and failures never generate service metrics even after performance opt-in', async () => {
  const requests = [];
  const metrics = createServiceMetrics({ apiBase: 'https://api.example.test', fetcher: (url, options) => requests.push({ url, body: JSON.parse(options.body) }) });
  metrics.setPerformanceEnabled(true);
  metrics.trackScreen('VPN', 'private-device-key');
  metrics.reportError('script_error');
  await settle();
  assert.deepEqual(requests, []);
  metrics.trackScreen('ProfileMain', 'profile');
  await settle();
  metrics.trackScreen('VPN', 'another-private-key');
  metrics.reportError('request_failed');
  metrics.reportError('unhandled_rejection');
  await settle();
  assert.deepEqual(requests.map(request => request.body), [{ category: 'app_profile' }], 'VPN errors cannot inherit the previous screen category');
  metrics.trackScreen('Feed', 'feed');
  metrics.reportError('script_error');
  await settle();
  assert.deepEqual(requests.slice(1).map(request => request.body), [{ category: 'app_feed' }, { category: 'app_feed', kind: 'client_error', code: 'script_error' }]);
  metrics.dispose();
});

test('performance collection requires opt-in, accepts only fixed codes and rate-limits duplicates', async () => {
  const requests = [];
  let now = 1000;
  const metrics = createServiceMetrics({apiBase:'https://api.example.test',fetcher: (url, options) => requests.push({url,body:JSON.parse(options.body)}),now:()=>now});
  metrics.trackScreen('Security','key');
  metrics.reportError('script_error');
  await settle();
  assert.equal(requests.length,1);
  metrics.setPerformanceEnabled(true);
  metrics.reportError('private error details');
  metrics.reportError('script_error');
  metrics.reportError('script_error');
  await settle();
  assert.deepEqual(requests[1].body,{category:'app_security',kind:'client_error',code:'script_error'});
  assert.equal(requests.length,2);
  now += 60001;
  metrics.reportError('script_error');
  await settle();
  assert.equal(requests.length,3);
  metrics.setPerformanceEnabled(false);
  metrics.reportError('unhandled_rejection');
  metrics.trackScreen('Feed','new-key');
  await settle();
  assert.equal(requests.length,4,'required screen counts continue after optional withdrawal');
  metrics.dispose();
});

test('withdrawal aborts optional requests but leaves required usage requests independent', async () => {
  const signals = [];
  const metrics = createServiceMetrics({apiBase:'https://api.example.test',fetcher: (url, options) => {signals.push([url,options.signal]); return new Promise(resolve => options.signal.addEventListener('abort',resolve));}});
  metrics.trackScreen('Feed','key');
  metrics.setPerformanceEnabled(true);
  metrics.reportError('script_error');
  await settle();
  metrics.setPerformanceEnabled(false);
  assert.equal(signals[0][1].aborted,false);
  assert.equal(signals[1][1].aborted,true);
  metrics.dispose();
  assert.equal(signals[0][1].aborted,true);
});

test('browser error listeners discard event contents and detach on withdrawal', () => {
  const listeners = new Map(), reports = [];
  const runtime = { addEventListener:(type, callback)=>listeners.set(type,callback),removeEventListener:(type)=>listeners.delete(type) };
  assert.equal(supportsErrorCollection(runtime),true);
  const cleanup = installErrorCollection(runtime,code=>reports.push(code));
  listeners.get('error')({message:'private email',filename:'private-url'});
  listeners.get('unhandledrejection')({reason:'private message'});
  assert.deepEqual(reports,['script_error','unhandled_rejection']);
  cleanup();
  assert.equal(listeners.size,0);
});

test('native error hook counts fixed failures while preserving the existing runtime handler', () => {
  const originalCalls = [], reports = [];
  const original = (...args)=>originalCalls.push(args);
  let handler = original;
  const runtime = {ErrorUtils:{getGlobalHandler:()=>handler,setGlobalHandler:next=>{handler=next;}}};
  const cleanup = installErrorCollection(runtime,code=>reports.push(code));
  const privateError = new Error('private error');
  handler(privateError,true);
  assert.deepEqual(reports,['script_error']);
  assert.deepEqual(originalCalls,[[privateError,true]]);
  cleanup();
  assert.equal(handler,original);
  assert.equal(supportsErrorCollection({}),false);
});

test('rejected requests and disposed collectors never interfere with the app', async () => {
  let requests=0;
  const metrics=createServiceMetrics({apiBase:'https://api.example.test',fetcher:()=>{requests++;throw new Error('offline');}});
  metrics.trackScreen('Feed','one');
  await settle();
  metrics.dispose();
  metrics.trackScreen('Login','two');
  await settle();
  assert.equal(requests,1);
});

test('preference withdrawal notifies collectors synchronously and orders persistence writes', async () => {
  const path = require('node:path'), vm = require('node:vm');
  const filename = path.join(__dirname,'../context/PreferencesContext.js');
  const source = require('@babel/core').transformFileSync(filename, {babelrc:false,configFile:false,
    plugins:[require.resolve('@babel/plugin-transform-react-jsx'),require.resolve('@babel/plugin-transform-modules-commonjs')]}).code;
  const effects=[], saved=[], observed=[];
  const react={createContext:()=>({Provider:'Provider'}),createElement:(type,props)=>({type,props}),useContext:()=>{},
    useEffect:effect=>effects.push(effect),useRef:value=>({current:value}),useState:value=>[value,()=>{}],useCallback:callback=>callback};
  const sandbox={exports:{},require(name){
    if(name==='react')return react;
    if(name==='react-native')return {Platform:{OS:'android'}};
    if(name==='@react-native-async-storage/async-storage')return {getItem:async()=>null,setItem:async(key,value)=>saved.push(JSON.parse(value))};
    if(name==='./dataPreferences')return require('../context/dataPreferences');
    throw new Error('Unexpected import: '+name);
  }};
  vm.runInNewContext(source,sandbox,{filename});
  const tree=sandbox.exports.default({children:null});
  const value=tree.props.value;
  const cleanup=effects[0]();
  await settle();
  const unsubscribe=value.subscribe((preferences,ready)=>observed.push(ready&&preferences.performanceInsights));
  value.updatePreference('performanceInsights',true);
  assert.equal(observed.at(-1),true);
  value.updatePreference('performanceInsights',false);
  assert.equal(observed.at(-1),false,'Collector is notified before an effect or storage write can run');
  await settle();
  assert.deepEqual(saved.map(item=>item.performanceInsights),[true,false]);
  unsubscribe();cleanup();
});
