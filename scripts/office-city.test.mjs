import assert from 'node:assert/strict';
import { test } from 'node:test';
import { observeAgentPayload, mergeObservedAgents } from '../office/src/office-telemetry.mjs';
import { buildCityModel, observationState, CITY_FRESH_MS, CITY_DISTRICTS } from '../office/src/city-model.mjs';
import { buildCityStreets, cityJourney } from '../office/src/city-streets.mjs';

test('city blends 71 homes with workplaces and connects each commute and lunch route', () => {
  const homes = Array.from({ length: 71 }, (_, i) => ({ id: `resident_${i}`, district: i < 37 ? 'sources' : 'runtime' }));
  const city = buildCityStreets({ districts: CITY_DISTRICTS, homes });
  assert.equal(city.homes.length, 71);
  assert.equal(new Set(city.homes.map(home => `${home.x}:${home.y}`)).size, 71);
  assert.ok(city.blocks.every(block => block.homes.length <= 6));
  assert.equal(city.blocks.filter(block => block.homes.length).length, 12);
  for (const home of city.homes) {
    assert.ok(home.x > 40 && home.x < city.width - 40 && home.y > 40 && home.y < city.bottom);
    assert.deepEqual(home.commutePoints[0], [home.x, home.y + 20]);
    assert.deepEqual(home.commutePoints.at(-1), home.arrivalBay);
    assert.deepEqual(home.returnPoints[0], home.arrivalBay);
    assert.deepEqual(home.returnPoints.at(-1), home.commutePoints[0]);
    assert.ok(home.commuteStop > 0 && home.commuteStop < 100);
    assert.notDeepEqual(home.returnPoints, [...home.commutePoints].reverse(), 'Opposing commutes use separate lanes');
    assert.ok(home.lunchPoints[0][1] < home.arrivalBay[1], 'Pedestrians leave the building independently of car arrivals');
    assert.deepEqual(home.lunchPoints.at(-1), [home.cafe.x, home.cafe.y + 24]);
  }
  const expanded = buildCityStreets({ districts: CITY_DISTRICTS, homes: [...homes, ...homes.map(home => ({ ...home, id: `extra_${home.id}` }))] });
  assert.equal(expanded.homes.length, 142);
  assert.ok(expanded.height > city.height);
  assert.ok(expanded.homes.every(home => home.y < expanded.bottom));
});

test('busy source and runtime buildings distribute arrivals without parking crowds at entrances', () => {
  const homes = Array.from({ length: 71 }, (_, i) => ({ id: `resident_${i}`, district: i < 37 ? 'sources' : 'runtime' }));
  const city = buildCityStreets({ districts: CITY_DISTRICTS, homes });
  for (const id of ['sources', 'runtime']) {
    const residents = city.homes.filter(home => home.district === id);
    assert.equal(city.byId[id].residents, residents.length);
    assert.equal(new Set(residents.map(home => home.arrivalBay.join(':'))).size, 8, 'Busy buildings distribute arrivals among eight bays');
    for (const home of residents) for (const [x, y] of [...home.commutePoints, ...home.returnPoints, ...home.lunchPoints]) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y) && x > 0 && x < city.width && y > 0 && y < city.height, 'Every trip stays inside the city');
    }
  }
  assert.equal(cityJourney(.1).carVisible, true, 'Arriving residents remain visible');
  assert.equal(cityJourney(.24).carVisible, false, 'Cars move into indoor parking after arrival');
  assert.equal(cityJourney(.5).carVisible, false, 'Parked cars do not accumulate outside the entrance');
  assert.equal(cityJourney(.5).walkerVisible, false, 'Cafe visitors enter rather than stack at the doorway');
  assert.equal(cityJourney(.7).carVisible, true, 'Cars reappear for the return trip');
  assert.equal(cityJourney(.7).returning, true);
});

test('Source collection has a west entrance and east exit used by its residents', () => {
  const city = buildCityStreets({ districts: CITY_DISTRICTS, homes: Array.from({ length: 37 }, (_, i) => ({ id: `source_${i}`, district: 'sources' })) });
  const source = city.byId.sources;
  assert.equal(source.entry[0], city.blocks[source.block].x - 180);
  assert.equal(source.exit[0], city.blocks[source.block].x + 180);
  assert.deepEqual(source.accessRoutes.map(route => route.id), ['in', 'out']);
  for (const home of city.homes) {
    assert.ok(home.commutePoints.some(([x, y]) => Math.abs(x - source.entry[0]) <= 6 && Math.abs(y - source.entry[1]) <= 6));
    assert.ok(home.returnPoints.some(([x, y]) => Math.abs(x - source.exit[0]) <= 6 && Math.abs(y - source.exit[1]) <= 6));
    assert.deepEqual(home.returnPoints.at(-1), home.commutePoints[0]);
  }
});

const earlier = Date.parse('2026-09-15T10:00:00Z');
const later = earlier + 60000;
const iso = value => new Date(value).toISOString();

test('an explicit pipeline owner wins over a newer API heartbeat and both observations remain inspectable', () => {
  const api = observeAgentPayload({agents:{reddit:{name:'Reddit Agent',executionRole:'pipeline',
    health:{status:'healthy'},lastAction:{ts:iso(later),msg:'API presence heartbeat'}}}},'api',later);
  const pipeline = observeAgentPayload({agents:{reddit:{name:'Reddit Agent',executionRole:'pipeline',
    health:{status:'degraded',lastSuccess:iso(earlier)},lastAction:{ts:iso(earlier),msg:'Fetch failed'}}}},'pipeline',earlier);
  const merged = mergeObservedAgents(api,pipeline);
  assert.equal(merged.reddit.serviceRole,'pipeline');
  assert.equal(merged.reddit.health.status,'degraded','A heartbeat cannot replace the owning process failure');
  assert.deepEqual(Object.keys(merged.reddit.instances).sort(),['api','pipeline']);
  assert.equal(merged.reddit.instances.api.lastAction.msg,'API presence heartbeat');
  assert.equal(merged.reddit.instances.pipeline.lastAction.msg,'Fetch failed');
  assert.equal(merged.reddit.ownerAvailable,true);
});

test('a shared guard preserves separate API and pipeline identities without mutating the source registries', () => {
  const api = observeAgentPayload({agents:{stability:{name:'Stability Guard',executionRole:'both',postCount:0}}},'api',earlier);
  const pipeline = observeAgentPayload({agents:{stability:{name:'Stability Guard',executionRole:'both',postCount:17}}},'pipeline',later);
  const merged = mergeObservedAgents(api,pipeline);
  assert.equal(merged.stability.instances.api.serviceRole,'api');
  assert.equal(merged.stability.instances.pipeline.serviceRole,'pipeline');
  assert.equal(merged.stability.instances.api.postCount,0,'A reported zero is retained');
  assert.equal(merged.stability.instances.pipeline.postCount,17);
  assert.equal(api.stability.instances,undefined);
  assert.equal(pipeline.stability.instances,undefined);
});

test('an unavailable owner remains explicitly unavailable even when another process reports the agent', () => {
  const api = observeAgentPayload({agents:{reddit:{executionRole:'pipeline',health:{status:'healthy'}}}},'api',later);
  const merged = mergeObservedAgents(api,{});
  assert.equal(merged.reddit.ownerAvailable,false);
  assert.equal(merged.reddit.instances.pipeline,undefined);
  assert.equal(merged.reddit.serviceRole,'api');
});

test('older backend actual work wins over a fresh presence heartbeat without assuming health', () => {
  const api = observeAgentPayload({agents:{reddit:{lastAction:{ts:iso(later)},health:{status:'healthy'}}}},'api',later);
  const pipeline = observeAgentPayload({agents:{reddit:{lastFetch:iso(earlier),health:{status:'paused'}}}},'pipeline',earlier);
  const merged = mergeObservedAgents(api,pipeline);
  assert.equal(merged.reddit.serviceRole,'pipeline');
  assert.equal(merged.reddit.health.status,'paused');
});

test('numeric work timestamps are compared as times rather than parsed as date strings', () => {
  const api = observeAgentPayload({agents:{feed:{health:{lastSuccess:earlier},lastAction:{ts:iso(later)}}}},'api',later);
  const pipeline = observeAgentPayload({agents:{feed:{health:{lastSuccess:later},lastAction:{ts:iso(earlier)}}}},'pipeline',earlier);
  assert.equal(mergeObservedAgents(api,pipeline).feed.serviceRole,'pipeline');
});

test('invalid registry envelopes cannot create a fresh agent observation', () => {
  for (const payload of [null,{},[],{agents:null},{agents:[]},{agents:'healthy'}]) {
    assert.throws(()=>observeAgentPayload(payload,'api',later),/Agent telemetry unavailable/);
  }
  assert.throws(()=>observeAgentPayload({agents:{}},'untrusted',later),/Agent telemetry unavailable/);
  const observed = observeAgentPayload({agents:{'../private':{},valid:null,also_valid:[],accepted:{id:'forged',receivedAt:0}}},'api',later);
  assert.deepEqual(Object.keys(observed),['accepted']);
  assert.equal(observed.accepted.id,'accepted');
  assert.equal(observed.accepted.serviceRole,'api','Service ownership comes from the trusted request origin');
  assert.equal(observed.accepted.receivedAt,later);
  assert.equal(observed.accepted.observedAt,iso(later));
});

test('agent registry envelopes reject explicit wrong or invalid service roles, even when empty', () => {
  for (const role of ['api','pipeline']) {
    for (const reportedRole of [role==='api'?'pipeline':'api','external','',null,0]) {
      assert.throws(()=>observeAgentPayload({serviceRole:reportedRole,agents:{}},role,later),/Agent telemetry unavailable/,
        `An explicit ${String(reportedRole)} response cannot be accepted for ${role}`);
    }
  }
});

test('one explicitly mismatched agent rejects the entire registry instead of returning partial healthy data', () => {
  for (const role of ['api','pipeline']) {
    for (const envelope of [{},{serviceRole:role}]) {
      for (const reportedRole of [role==='api'?'pipeline':'api','external','',null,0]) {
        const payload={...envelope,agents:{correct:{serviceRole:role,postCount:2},wrong:{serviceRole:reportedRole,postCount:999}}};
        const before=structuredClone(payload);
        assert.throws(()=>observeAgentPayload(payload,role,later),/Agent telemetry unavailable/);
        assert.deepEqual(payload,before,'Rejecting a registry cannot mutate the existing payload');
      }
    }
  }
});

test('matching modern roles and omitted legacy roles remain readable without confusing service with execution ownership', () => {
  for (const role of ['api','pipeline']) {
    for (const envelope of [{},{serviceRole:role}]) {
      for (const reported of [{},{serviceRole:role}]) {
        const observed=observeAgentPayload({...envelope,agents:{worker:{...reported,executionRole:role==='api'?'pipeline':'both',postCount:0}}},role,later);
        assert.deepEqual(Object.keys(observed),['worker']);
        assert.equal(observed.worker.serviceRole,role);
        assert.equal(observed.worker.executionRole,role==='api'?'pipeline':'both');
        assert.equal(observed.worker.postCount,0);
        assert.equal(observed.worker.receivedAt,later);
      }
    }
  }
});

const fresh = {api:{updatedAt:later},pipeline:{updatedAt:later},agents:{byService:{api:{updatedAt:later},pipeline:{updatedAt:later}}}};
const metricValue = (model, district, label) => model.byId[district].metrics.find(item=>item.label===label)?.value;

test('city metrics use their owning process and preserve unknown values separately from zero', () => {
  const model=buildCityModel({now:later,telemetry:fresh,
    status:{server:{db:'connected'},feed:{postCount:4000},staging:{pendingCount:0},sources:{total:999}},
    pipelineStatus:{sources:{total:2,healthy:0},feed:{postCount:812},equalizer:{pendingTotal:'120'}}});
  assert.equal(metricValue(model,'sources','Registered sources'),2);
  assert.equal(metricValue(model,'sources','Healthy sources'),0);
  assert.equal(metricValue(model,'staging','Waiting for promotion'),0);
  assert.equal(metricValue(model,'feed','Posts in memory'),4000);
  assert.equal(metricValue(model,'equalizer','Buffered now'),null,'A malformed numeric string is unknown');
  assert.equal(metricValue(model,'filter','Last input'),null);
  assert.equal(model.byId.filter.state,'unknown');
  assert.equal(model.byId.filter.active,false);
});

test('fresh measured work activates roads but an agent heartbeat alone does not', () => {
  const model=buildCityModel({now:later,telemetry:fresh,status:{server:{db:'connected'},staging:{pendingCount:1}},
    pipelineStatus:{sources:{workers:[{id:'reddit',status:'healthy'}]},equalizer:{},filterAgent:{lastRun:iso(later),lastInput:3,lastOutput:2},sortAgent:{lastRun:iso(later),lastInput:2,lastOutput:2}},
    agents:{reddit:{id:'reddit',serviceRole:'pipeline',receivedAt:later,lastAction:{ts:iso(later),msg:'Heartbeat'}}}});
  assert.equal(model.byId.sources.active,false);
  assert.equal(model.byId.filter.active,true);
  assert.equal(model.edges.find(edge=>edge.from==='filter'&&edge.to==='sort').active,true);
  assert.equal(model.edges.find(edge=>edge.from==='sources').active,false);
});

test('stale and unavailable snapshots stop all roads while retaining the last reported count as stale', () => {
  const args={status:{server:{db:'connected'},staging:{inFlight:true,pendingCount:37}},pipelineStatus:{filterAgent:{lastRun:iso(later),lastInput:3},sortAgent:{}},telemetry:fresh};
  const stale=buildCityModel({...args,now:later+CITY_FRESH_MS});
  assert.equal(stale.byId.staging.state,'stale');
  assert.equal(metricValue(stale,'staging','Waiting for promotion'),37);
  assert.equal(stale.edges.some(edge=>edge.active),false);
  const offline=buildCityModel({...args,now:later,telemetry:{api:{updatedAt:later,error:'Unavailable'},pipeline:{updatedAt:later,error:'Unavailable'}}});
  assert.equal(offline.byId.staging.state,'unavailable');
  assert.equal(offline.edges.some(edge=>edge.active),false);
  assert.equal(observationState({updatedAt:later+5001},later),'stale','Future timestamps cannot simulate freshness');
});

test('a paused stage cannot animate as active work', () => {
  const model=buildCityModel({now:later,telemetry:fresh,status:{server:{db:'connected'}},
    pipelineStatus:{filterAgent:{status:'paused',lastRun:iso(later),lastInput:3,lastOutput:3},sortAgent:{}}});
  assert.equal(model.byId.filter.state,'paused');
  assert.equal(model.byId.filter.active,false);
  assert.equal(model.edges.find(edge=>edge.from==='filter').active,false);
  const pausedTarget=buildCityModel({now:later,telemetry:fresh,status:{server:{db:'connected'}},
    pipelineStatus:{filterAgent:{status:'healthy',lastRun:iso(later),lastInput:3,lastOutput:3},sortAgent:{status:'paused'}}});
  assert.equal(pausedTarget.byId.filter.active,true,'The source has measured work, isolating the target pause guard');
  assert.equal(pausedTarget.edges.find(edge=>edge.from==='filter').active,false,'Roads cannot imply flow into a paused stage');
});

test('a completed stage with zero output does not animate outgoing content', () => {
  const model=buildCityModel({now:later,telemetry:fresh,
    status:{server:{serviceRole:'api',db:'connected'},staging:{},feed:{},topicFilterAgent:{lastRun:iso(later),lastInput:3,lastOutput:0}},
    pipelineStatus:{server:{serviceRole:'pipeline'},filterAgent:{lastRun:iso(later),lastInput:3,lastOutput:0},sortAgent:{lastRun:iso(later),lastInput:3,lastOutput:0}}});
  for (const id of ['filter','sort','topics']) {
    assert.equal(model.byId[id].active,true,`${id} processed real input`);
    assert.equal(metricValue(model,id,'Last output'),0,`${id} reports its explicit zero output`);
    assert.equal(model.edges.find(edge=>edge.from===id).active,false,`${id} cannot imply posts reached the next stage`);
  }
});

test('explicitly mismatched service snapshots cannot supply the other process metrics or motion', () => {
  const api={server:{serviceRole:'api',db:'connected'},feed:{postCount:4000},sources:{total:999},filterAgent:{lastRun:iso(later),lastInput:3,lastOutput:3}};
  const pipeline={server:{serviceRole:'pipeline'},feed:{postCount:812},sources:{total:2},staging:{inFlight:true,pendingCount:888}};
  const wrongPipeline=buildCityModel({now:later,telemetry:fresh,status:api,pipelineStatus:api});
  assert.equal(wrongPipeline.observations.pipeline.state,'unavailable');
  assert.equal(metricValue(wrongPipeline,'sources','Registered sources'),null,'API counters cannot masquerade as pipeline work');
  assert.equal(metricValue(wrongPipeline,'feed','Posts in memory'),4000,'The correctly identified API remains usable');
  assert.equal(wrongPipeline.byId.filter.active,false);
  assert.equal(wrongPipeline.edges.some(edge=>edge.active),false);
  const wrongApi=buildCityModel({now:later,telemetry:fresh,status:pipeline,pipelineStatus:pipeline});
  assert.equal(wrongApi.observations.api.state,'unavailable');
  assert.equal(metricValue(wrongApi,'feed','Posts in memory'),null,'Pipeline cache counts cannot masquerade as API feed counts');
  assert.equal(metricValue(wrongApi,'staging','Waiting for promotion'),null);
  assert.equal(metricValue(wrongApi,'sources','Registered sources'),2,'The correctly identified pipeline remains usable');
  assert.equal(wrongApi.byId.staging.active,false);
});

test('registry failures mark only the affected service instances unavailable', () => {
  const api=observeAgentPayload({agents:{stability:{name:'Stability Guard',executionRole:'both'}}},'api',later);
  const pipeline=observeAgentPayload({agents:{stability:{name:'Stability Guard',executionRole:'both'}}},'pipeline',later);
  const model=buildCityModel({now:later,agents:mergeObservedAgents(api,pipeline),telemetry:{...fresh,agents:{byService:{api:{updatedAt:later,error:'Offline'},pipeline:{updatedAt:later}}}}});
  assert.equal(model.agents.length,2);
  assert.equal(model.agents.find(agent=>agent.key==='api:stability').observation,'unavailable');
  assert.equal(model.agents.find(agent=>agent.key==='pipeline:stability').observation,'fresh');
});

test('the city gives every one of 71 canonical agents one home while retaining both service views', () => {
  const definitions=Object.fromEntries(Array.from({length:71},(_,index)=>[`agent_${String(index+1).padStart(2,'0')}`,{
    name:`Agent ${index+1}`,executionRole:'pipeline',health:{status:index===1?'idle':index===2?'degraded':'healthy',lastSuccess:iso(later)},
  }]));
  const api=observeAgentPayload({agents:definitions},'api',later);
  const pipeline=observeAgentPayload({agents:definitions},'pipeline',later);
  const model=buildCityModel({now:later,agents:mergeObservedAgents(api,pipeline),telemetry:fresh,
    pipelineStatus:{sources:{workers:[]}}});
  assert.equal(model.homes.length,71,'Canonical definitions become permanent unique homes');
  assert.equal(new Set(model.homes.map(home=>home.id)).size,71,'Homes never duplicate a multi-service agent');
  assert.equal(model.agents.length,142,'Both service observations remain available for diagnostics');
  assert.ok(model.homes.every(home=>home.instanceCount===2));
  assert.equal(model.homes.find(home=>home.id==='agent_01').homeState,'working');
  assert.equal(model.homes.find(home=>home.id==='agent_02').homeState,'inactive');
  assert.equal(model.homes.find(home=>home.id==='agent_03').homeState,'attention');
});

test('missing owner observations keep an agent home visible and explicitly unobserved', () => {
  const api=observeAgentPayload({agents:{collector:{name:'Collector',executionRole:'pipeline',health:{status:'healthy'}}}},'api',later);
  const model=buildCityModel({now:later,agents:mergeObservedAgents(api,{}),telemetry:fresh});
  assert.equal(model.homes.length,1);
  assert.equal(model.homes[0].homeState,'unobserved');
  assert.equal(model.homes[0].ownerAvailable,false);
});

test('every city building exposes detailed levels backed by its own metrics, including primary recovery', () => {
  const model=buildCityModel({now:later,telemetry:fresh,status:{server:{db:'connected'}},pipelineStatus:{server:{}}});
  assert.equal(model.districts.length,12);
  for (const district of model.districts) {
    assert.equal(district.levels.length,district.id === 'backup' ? 5 : 4,`${district.id} exposes all its scrollable levels`);
    for (const [index,level] of district.levels.entries()) {
      assert.equal(level.number,index+1);
      assert.ok(level.title&&level.purpose);
      assert.ok(level.pulls.length&&level.process.length&&level.outputs.length,`${district.id} level ${level.number} explains the full handoff`);
      assert.ok(level.metrics.length,`${district.id} level ${level.number} attaches live evidence`);
    }
  }
});
