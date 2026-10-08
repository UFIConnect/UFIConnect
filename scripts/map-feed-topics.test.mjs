import test from 'node:test';
import assert from 'node:assert/strict';
import { appendMapPosts, mapSourceTopicScope, mapTopicMatches, mapPostTarget, parseMapSourceTopics } from '../shared/map-feed-topics.mjs';
import { CITY_SITES, CITY_RAMPS, CITY_TOP_EXITS, CITY_SIDE_EXITS, CITY_LOCAL_LINKS, CITY_END_ROADS, CITY_END_JUNCTIONS, CITY_HIGHWAY_LINKS, CITY_HIGHWAY_KINDS, CITY_LANDMARKS, CITY_HIGHWAY_PIERS, CITY_GROUND_ROADS, cityCollectorPoints, citySegmentDistance, cityHighwayJourney, cityRoadPoint, cityRoadPoints, cityRoadPosition, cityDriveOrigin, cityDriveWaypoints } from '../web/src/local/cityEngineering.mjs';

const post = (id, source, topic) => ({ key: source + ':' + id, id, source, topic, category: 'technology' });
test('map filtering expands supported labels without unrelated text matches', () => {
  assert.equal(mapTopicMatches(post('1', 'reddit', 'Frontend Dev'), 'Web Development'), true);
  assert.equal(mapTopicMatches({ title: 'Artificial intelligence article', topic: 'AI & Machine Learning' }, 'Art'), false);
  assert.equal(mapTopicMatches(post('1', 'reddit', 'TRAVEL & ADVENTURE'), 'Travel'), true);
  assert.equal(mapPostTarget(2), 20); assert.equal(mapPostTarget(600), 500);
});
test('city and source filters intersect; completed topics leave the next query', () => {
  const settings = { topicSelections: { 'technology:city': ['Open Source', 'Web Development'], 'technology:github': ['Open Source'] }, topicTargets: {} };
  const previous = Array.from({ length: 20 }, (_, i) => post(i, 'github', 'Open Source'));
  const scope = mapSourceTopicScope(settings, 'technology', ['github', 'reddit'], previous);
  assert.deepEqual(scope.github, []);
  assert.ok(scope.reddit.includes('frontend dev')); assert.ok(!scope.reddit.includes('open source'));
  const next = appendMapPosts(previous, [post(40, 'github', 'Frontend Dev'), post(50, 'reddit', 'Frontend Dev')], settings, 'technology', ['github', 'reddit']);
  assert.equal(next.length, 21); assert.equal(next.at(-1).id, 50);
});
test('500-post quota survives multiple pages and deduplicates repeated pages', () => {
  const settings = { topicSelections: { 'technology:city': ['Open Source'] }, topicTargets: { 'technology:city': { 'Open Source': 500 } } };
  let accumulated = [];
  for (let page = 0; page < 15; page++) {
    const incoming = Array.from({ length: 40 }, (_, i) => post(page * 40 + i, i % 2 ? 'reddit' : 'github', 'Open Source'));
    accumulated = appendMapPosts(accumulated, incoming, settings, 'technology', ['github', 'reddit']);
    accumulated = appendMapPosts(accumulated, incoming, settings, 'technology', ['github', 'reddit']);
  }
  assert.equal(accumulated.length, 500);
  assert.deepEqual(mapSourceTopicScope(settings, 'technology', ['github', 'reddit'], accumulated), { github: [], reddit: [] });
});
test('unfiltered post target and an individual source limit both work', () => {
  const settings = { topicSelections: {}, topicTargets: { 'technology:city': { '*': 500 }, 'technology:github': { '*': 20 } } };
  const incoming = Array.from({ length: 1000 }, (_, i) => post(i, i % 2 ? 'reddit' : 'github', 'Open Source'));
  const result = appendMapPosts([], incoming, settings, 'technology', ['github', 'reddit']);
  assert.equal(result.length, 500); assert.equal(result.filter(item => item.source === 'github').length, 20);
});
test('map query input is bounded and preserves an empty scope', () => {
  assert.deepEqual(parseMapSourceTopics('{"github":[],"reddit":null}', ['github', 'reddit']), { github: [], reddit: null });
  assert.throws(() => parseMapSourceTopics('{"github":"anything"}', ['github']));
  assert.throws(() => parseMapSourceTopics('x'.repeat(16001), ['github']));
});
test('an explicit source post count remains active when the city selects topics', () => {
  const settings = { topicSelections: { 'technology:city': ['Open Source'] }, topicTargets: { 'technology:city': { 'Open Source': 500 }, 'technology:github': { '*': 20 } } };
  const result = appendMapPosts([], Array.from({ length: 100 }, (_, i) => post(i, i % 2 ? 'reddit' : 'github', 'Open Source')), settings, 'technology', ['github', 'reddit']);
  assert.equal(result.filter(item => item.source === 'github').length, 20);
  assert.equal(result.filter(item => item.source === 'reddit').length, 50);
  const scope = mapSourceTopicScope(settings, 'technology', ['github', 'reddit'], result);
  assert.deepEqual(scope.github, []); assert.ok(scope.reddit.includes('open source'));
});
test('every city and landmark route stays on collectors and arterial roads', () => {
  assert.equal(CITY_SITES.length, 16);
  const arterial = cityRoadPoints('arterial').map(([x, , z]) => [x, z]);
  const distanceToSegment = (point, a, b) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], denominator = dx * dx + dz * dz;
    const t = denominator ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / denominator)) : 0;
    return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dz);
  };
  const destinations = [...CITY_SITES, ...CITY_LANDMARKS];
  const roads = [...arterial.slice(1).map((point, i) => [arterial[i], point]), ...destinations.flatMap(site => {
    const points = cityCollectorPoints(site).map(([x, , z]) => [x, z]);
    return points.slice(1).map((point, i) => [points[i], point]);
  })];
  for (const from of [null, ...destinations]) for (const to of destinations) {
    const points = cityDriveWaypoints(from, to);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      assert.ok(Math.min(...roads.map(([start, end]) => distanceToSegment(middle, start, end))) < .025, 'Routes must remain on a rendered road, including between samples');
    }
    assert.deepEqual(points.at(-1), to.entrance);
  }
  for (const site of CITY_SITES) {
    const collector = cityCollectorPoints(site), point = collector[24], origin = cityDriveOrigin([point[0], point[2]]);
    const route = cityDriveWaypoints(origin, CITY_LANDMARKS[0]);
    assert.ok(Math.hypot(route[0][0] - point[0], route[0][1] - point[2]) < .001, 'Retargeting keeps the current position on a curved collector');
    for (let i = 1; i < route.length; i++) {
      const mid = [(route[i - 1][0] + route[i][0]) / 2, (route[i - 1][1] + route[i][1]) / 2];
      assert.ok(Math.min(...roads.map(([a, b]) => distanceToSegment(mid, a, b))) < .025, 'Retargeting follows existing road geometry');
    }
  }
});
test('district setbacks, expressway clearance and ramp grades support the curved layout', () => {
  const highway = cityRoadPoints('highway');
  assert.ok(Object.values(CITY_HIGHWAY_PIERS).every(piers => piers.length > 10), 'Both expressways retain supports along their corridors');
  for (const [x, , z] of Object.values(CITY_HIGHWAY_PIERS).flat()) for (const [a, b] of CITY_GROUND_ROADS) {
    assert.ok(citySegmentDistance([x, z], a, b) > 3, 'Bridge piers must clear city and landmark collectors, the arterial and rail');
  }
  assert.ok(Math.hypot(highway[0][0] - highway.at(-1)[0], highway[0][2] - highway.at(-1)[2]) > 250, 'The highway must remain an open corridor');
  for (const kind of CITY_HIGHWAY_KINDS) for (const site of CITY_SITES) {
    for (const other of CITY_SITES) if (other !== site) assert.ok(Math.hypot(site.x - other.x, site.z - other.z) > 26, 'Wide district plots need a gap between neighbors');
    const roadDistance = Math.min(...cityRoadPoints(kind).map(([x, , z]) => Math.hypot(site.x - x, site.z - z)));
    assert.ok(roadDistance > 13, 'The elevated expressway must clear district buildings');
  }
  for (const ramp of [...CITY_HIGHWAY_LINKS, ...CITY_RAMPS]) for (let i = 1; i < ramp.length; i++) {
    const a = ramp[i - 1], b = ramp[i], grade = Math.abs(b[1] - a[1]) / Math.hypot(b[0] - a[0], b[2] - a[2]);
    assert.ok(grade <= .08, 'Exit ramp grade must remain below 8%');
    for (const site of CITY_SITES) assert.ok(Math.hypot(b[0] - site.x, b[2] - site.z) > 11, 'Ramps must pass through gaps between district buildings');
  }
  for (const [index, link] of CITY_HIGHWAY_LINKS.entries()) {
    for (const [point, kind] of [[link[0], 'highway'], [link.at(-1), 'highway-return']]) {
      const road = cityRoadPoint(kind, cityRoadPosition(kind, point[0]));
      assert.ok(Math.hypot(point[0] - road[0], point[2] - road[1]) < .001, 'Elevated connectors must join both highway centerlines');
      assert.equal(point[1], 2.9, 'Connections meet the deck at the same elevation');
    }
    const journey = cityHighwayJourney(index);
    assert.ok(journey.some(point => point === link[40]), 'Cross-highway traffic uses the shared connector geometry');
  }
  for (const exit of CITY_TOP_EXITS) {
    assert.ok(Math.hypot(exit.points.at(-1)[0] - exit.rear[0], exit.points.at(-1)[2] - exit.rear[1]) < .001, 'Upper exits join the rear boulevard');
    for (let i = 1; i < exit.points.length; i++) {
      const a = exit.points[i - 1], b = exit.points[i], grade = Math.abs(b[1] - a[1]) / Math.hypot(b[0] - a[0], b[2] - a[2]);
      assert.ok(grade <= .08, 'Direct city exits stay below 8% grade');
      for (const [index, site] of CITY_SITES.entries()) if (index !== exit.index) assert.ok(Math.hypot(b[0] - site.x, b[2] - site.z) > 11, 'Direct exits clear neighboring cities');
    }
  }
  assert.equal(CITY_END_JUNCTIONS.length, 4, 'Both ends of each major highway have a junction');
  for (const junction of CITY_END_JUNCTIONS) {
    const end = cityRoadPoint(junction.kind, junction.side > 0 ? 1 : 0), road = CITY_END_ROADS.find(road => road.side === junction.side);
    assert.deepEqual(junction.points[0], [end[0], 2.9, end[1]]);
    const to = junction.points.at(-1), distance = Math.min(...road.points.slice(1).map((point, i) => citySegmentDistance([to[0], to[2]], [road.points[i][0], road.points[i][2]], [point[0], point[2]])));
    assert.ok(distance < .01, 'Highway ends join the curved side road at deck height');
    for (const [x, z] of junction.island) {
      const clearance = Math.min(...junction.points.slice(1).map((point, i) => citySegmentDistance([x, z], [junction.points[i][0], junction.points[i][2]], [point[0], point[2]])));
      assert.ok(clearance > 1.8, 'Corner traffic islands leave both lanes clear');
    }
  }
  assert.equal(CITY_LOCAL_LINKS.length, 14);
  for (const landmark of CITY_LANDMARKS) {
    const road = cityCollectorPoints(landmark);
    for (const site of CITY_SITES) for (let i = 1; i < road.length; i++) {
      assert.ok(citySegmentDistance([site.x, site.z], [road[i - 1][0], road[i - 1][2]], [road[i][0], road[i][2]]) > 13, 'Airport and shopping access roads pass between district blocks');
    }
  }
  for (const exit of CITY_SIDE_EXITS) {
    const to = exit.points.at(-1), entrance = CITY_SITES[exit.index].entrance;
    assert.ok(Math.hypot(to[0] - entrance[0], to[2] - entrance[1]) < .001, 'Side exits reach the city boulevard');
    for (let i = 1; i < exit.points.length; i++) {
      const a = exit.points[i - 1], b = exit.points[i];
      assert.ok(Math.abs(b[1] - a[1]) / Math.hypot(b[0] - a[0], b[2] - a[2]) <= .08, 'Side exits maintain a smooth grade');
      for (const [index, site] of CITY_SITES.entries()) if (index !== exit.index) assert.ok(Math.hypot(b[0] - site.x, b[2] - site.z) > 11, 'Side exits clear neighboring districts');
    }
  }
  for (const road of CITY_END_ROADS) {
    const joins = [...CITY_END_JUNCTIONS.filter(junction => junction.side === road.side).map(junction => junction.points.at(-1)), ...CITY_SIDE_EXITS.filter(exit => exit.side === road.side).map(exit => exit.points[0])];
    for (const point of [road.points[0], road.points.at(-1)]) assert.ok(joins.some(join => Math.hypot(...point.map((value, i) => value - join[i])) < .001), 'Side roads end at a highway or city exit, without unused extensions');
  }
  const cityRoad = cityRoadPoints('arterial');
  for (const point of [cityRoad[0], cityRoad.at(-1)]) assert.ok([...CITY_SITES, ...CITY_LANDMARKS].some(site => Math.hypot(point[0] - site.junction[0], point[2] - site.junction[1]) < .001), 'The main city road ends at an outer district or landmark junction');
});
