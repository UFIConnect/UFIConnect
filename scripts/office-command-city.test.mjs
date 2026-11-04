import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildCommandDistricts, buildControlLinks, filterDistrictCommands } from '../office/src/office-command-city.mjs';

const require = createRequire(import.meta.url);
const { buildOfficeControlCatalog } = require('../backend/office-controls.js');

test('every registered control and generated source action belongs to a map group', () => {
  const catalog = buildOfficeControlCatalog(Array.from({ length: 80 }, (_, index) => ({ id: `source-${index}`, label: `Source ${index}` })));
  const districts = buildCommandDistricts(catalog);
  const all = filterDistrictCommands(districts);
  assert.equal(all.length, catalog.length);
  assert.deepEqual(new Set(all.map(item => item.control.id)), new Set(catalog.map(control => control.id)));
  assert.equal(districts.length, new Set(catalog.map(control => control.category)).size);
  for (const district of districts) {
    assert.ok(district.controls.every(control => control.category === district.id));
    assert.equal(filterDistrictCommands(districts, '', district.id).length, district.controls.length);
  }
});

test('purpose links and catalog hub connect every group without inventing dependencies for new categories', () => {
  const catalog = [...buildOfficeControlCatalog([{ id: 'news', label: 'News' }]), { id: 'future.check', label: 'Check future service', category: 'Future service' }];
  const groups = buildCommandDistricts(catalog), links = buildControlLinks(groups);
  const groupIds = new Set(groups.map(group => group.id)), visited = new Set(['@all']);
  assert.ok(links.some(link => link.from === 'Frontend changes' && link.to === 'Deployments' && link.label === 'Code releases'));
  assert.ok(links.some(link => link.from === 'Individual sources' && link.to === 'Public feed' && link.label === 'Content intake'));
  assert.ok(links.some(link => link.kind === 'catalog' && link.to === 'Future service'));
  assert.ok(!links.some(link => link.kind === 'related' && [link.from, link.to].includes('Future service')));
  for (let pass = 0; pass <= groups.length; pass++) for (const link of links) {
    assert.ok(groupIds.has(link.to));
    assert.ok(link.from === '@all' || groupIds.has(link.from));
    if (visited.has(link.from)) visited.add(link.to);
    if (visited.has(link.to)) visited.add(link.from);
  }
  assert.equal(visited.size, groupIds.size + 1);
});

test('new categories and unconfigured commands remain reachable', () => {
  const controls = [
    { id: 'future.run', label: 'Future command', category: 'Future service', available: false, unavailableReason: 'Connect account' },
    { id: 'misc.run', label: 'Uncategorized command' },
    { id: 'constructor.run', label: 'Constructor command', category: 'constructor' },
  ];
  const districts = buildCommandDistricts(controls);
  assert.deepEqual(districts.map(district => district.id), ['Future service', 'Other commands', 'constructor']);
  assert.equal(districts[0].available, 0);
  assert.equal(filterDistrictCommands(districts, 'future').length, 1);
  assert.equal(filterDistrictCommands(districts)[0].control.unavailableReason, 'Connect account');
  assert.equal(filterDistrictCommands(districts, '', 'constructor')[0].control.id, 'constructor.run');
  assert.equal(districts[2].place, 'constructor');
});

test('search locates a command by multiple terms, target, category, or exact ID', () => {
  const catalog = buildOfficeControlCatalog([{ id: 'news', label: 'News source' }]);
  const districts = buildCommandDistricts(catalog);
  assert.ok(filterDistrictCommands(districts, 'news block').some(item => item.control.id === 'source.block.news'));
  assert.equal(filterDistrictCommands(districts, 'source.block.news')[0].control.id, 'source.block.news');
  assert.equal(filterDistrictCommands(districts, 'feed audit', 'Feed audit').length, districts.find(district => district.id === 'Feed audit').controls.length);
  assert.equal(filterDistrictCommands(districts, 'api source.block.news')[0].control.id, 'source.block.news');
  assert.equal(filterDistrictCommands(districts, 'no-such-command').length, 0);
  assert.equal(filterDistrictCommands(districts, 'news', 'Deployments').length, 0);
});

test('malformed or duplicate catalog entries do not break navigation', () => {
  const command = { id: 'check.one', label: 'Check one', category: 'Checks' };
  assert.deepEqual(buildCommandDistricts(null), []);
  const districts = buildCommandDistricts([null, {}, { id: 3 }, command, command]);
  assert.equal(districts.length, 1);
  assert.equal(filterDistrictCommands(districts).length, 1);
});
