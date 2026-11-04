import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceRateMetrics, sourceRateSummary } from './source-rate-display.mjs';

test('source policy ceilings remain separate from the actual collection interval', () => {
  assert.deepEqual(sourceRateMetrics({pullLimit:{windowSeconds:180,maxPulls:3},pullLimitLabel:'3 pulls / 180s',collectionIntervalMs:45000,interval:'30s × 12 shards'}), [
    {label:'Pull limit',value:'3 pulls / 180s',text:true},
    {label:'Collection interval',value:'45s',text:true},
  ]);
});

test('missing collection telemetry never invents a schedule from a limit or legacy shards', () => {
  assert.equal(sourceRateSummary({interval:'30s × 12 shards',cadence:'30s',pullLimit:{windowSeconds:240,maxPulls:1}},{source:true}), 'Pull limit: 1 pull / 240s · Collection interval: Not reported');
  assert.equal(sourceRateSummary({interval:'15s × 8 shards'},{source:true}), 'Pull limit: Not reported · Collection interval: Not reported');
});

test('backend labels update directly and non-source stages retain their schedule', () => {
  assert.equal(sourceRateMetrics({pullLimitLabel:'2 pulls / 360s',collectionIntervalMs:2250})[0].value,'2 pulls / 360s');
  assert.deepEqual(sourceRateMetrics({interval:'on demand'}),[{label:'Schedule',value:'on demand',text:true}]);
});
