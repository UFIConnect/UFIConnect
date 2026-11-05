'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDataTool, DATA_ANALYSIS_CODE } = require('./office-ai-data');

// Execute only the repository's static helper here. User/model code still runs
// exclusively in the configured Cloudflare sandbox in production.
const analyze = new Function('input', DATA_ANALYSIS_CODE);

test('data analysis reports exact coverage when grouped results exceed the first 100 categories', () => {
  const rows = Array.from({ length: 125 }, (_, index) => ({ team: `Team ${index}`, amount: index + 1 }));
  rows.push({ team: 'Team 0', amount: 10 }, { team: 'Team 124', amount: 20 });
  const result = analyze({ format: 'json', data: JSON.stringify(rows), groupBy: 'team' });
  assert.equal(result.rowCount, 127);
  assert.equal(result.groups.length, 100);
  assert.deepEqual(result.groups[0], { value: 'Team 0', count: 2 });
  assert.deepEqual(result.groups.at(-1), { value: 'Team 99', count: 1 });
  assert.deepEqual(result.groupCoverage, { column: 'team', inputRows: 127, totalGroups: 125,
    returnedGroups: 100, omittedGroups: 25, returnedRows: 101, omittedRows: 26, truncated: true });
  assert.equal(result.statistics.amount.sum, 125 * 126 / 2 + 30,
    'Numeric statistics still include every input row, including omitted groups');
});

test('data analysis distinguishes complete grouping, empty input and ungrouped output', () => {
  const result = analyze({ format: 'csv', data: 'team,amount\r\nred,10\r\nblue,20\r\nred,\r\n', groupBy: 'team' });
  assert.deepEqual(result.groups, [{ value: 'red', count: 2 }, { value: 'blue', count: 1 }]);
  assert.deepEqual(result.groupCoverage, { column: 'team', inputRows: 3, totalGroups: 2,
    returnedGroups: 2, omittedGroups: 0, returnedRows: 3, omittedRows: 0, truncated: false });
  assert.equal(result.statistics.amount.mean, 15); assert.equal(result.statistics.amount.missing, 1);
  const plain = analyze({ format: 'json', data: '[]' });
  assert.deepEqual(plain, { rowCount: 0, columns: [], statistics: {}, sample: [] });
  assert.equal(Object.hasOwn(plain, 'groupCoverage'), false);
});

test('numeric overflow fails clearly instead of being serialized as fabricated null statistics', () => {
  assert.throws(() => analyze({ format: 'json', data: '[{"amount":1e309}]' }), /finite number range.*Rescale/);
  assert.throws(() => analyze({ format: 'json', data: '[{"nested":{"amount":1e309}}]' }), /finite number range.*Rescale/);
  assert.throws(() => analyze({ format: 'csv', data: 'amount\n1e309\n2' }), /finite number range.*Rescale/);
  assert.throws(() => analyze({ format: 'csv', data: 'amount\n-1e309\n2' }), /finite number range.*Rescale/);
  for (const amounts of [[1e308, 1e308], [1e200, -1e200]]) {
    assert.throws(() => analyze({ format: 'json', data: JSON.stringify(amounts.map(amount => ({ amount }))) }),
      /finite number range.*Rescale.*no numeric result/);
  }
  const ordinary = analyze({ format: 'json', data: JSON.stringify([{ amount: -12.5 }, { amount: 0 }, { amount: 12.5 }]) });
  assert.equal(ordinary.statistics.amount.sum, 0);
  assert.equal(ordinary.statistics.amount.mean, 0);
  assert.ok(Number.isFinite(ordinary.statistics.amount.standardDeviation));
  const mixed = analyze({ format: 'csv', data: 'label\n1e309\npending' });
  assert.equal(mixed.statistics.label.type, 'categorical');
  assert.equal(mixed.statistics.label.distinct, 2);
});

test('the data tool returns computed coverage through its actual execution adapter', async () => {
  let executions = 0; const controller = new AbortController();
  const runtime = { execute: async ({ code, input }, context) => {
    executions++;
    assert.equal(code, DATA_ANALYSIS_CODE); assert.equal(context.signal, controller.signal);
    return { result: new Function('input', code)(input), logs: [], runtime: 'test static helper' };
  } };
  const tool = createDataTool(runtime);
  const output = await tool.execute({ format: 'json', data: '[{"team":"red","amount":4}]', groupBy: 'team' }, { signal: controller.signal });
  assert.equal(executions, 1); assert.equal(output.result.statistics.amount.sum, 4);
  assert.equal(output.result.groupCoverage.truncated, false);
  assert.equal(output.result.groupCoverage.returnedRows, 1);
});

test('JSON column analysis and grouping never count inherited properties as observed data', () => {
  const result = analyze({ format: 'json', data: '[{"constructor":4,"toString":"own label","__proto__":3},{"amount":9}]', groupBy: 'constructor' });
  assert.equal(result.statistics.constructor.type, 'numeric');
  assert.equal(result.statistics.constructor.sum, 4);
  assert.equal(result.statistics.constructor.count, 1);
  assert.equal(result.statistics.constructor.missing, 1);
  assert.equal(result.statistics.toString.count, 1);
  assert.equal(result.statistics.toString.missing, 1);
  assert.deepEqual(result.statistics.toString.top, [{ value: 'own label', count: 1 }]);
  assert.equal(result.statistics.__proto__.sum, 3);
  assert.equal(result.statistics.__proto__.missing, 1);
  assert.deepEqual(result.groups, [{ value: '4', count: 1 }, { value: '', count: 1 }]);
  assert.equal(result.groupCoverage.returnedRows, 2);
});
