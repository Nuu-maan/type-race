import assert from 'node:assert/strict';
import { estimateCost } from './dist/pricing.js';
assert.equal(estimateCost(.5, 100000), 50);
assert.equal(estimateCost(.1, 1000), .1);
assert.equal(estimateCost(10, 1000000), 10000);
assert.equal(estimateCost(.5, 0), 0);
assert.throws(() => estimateCost(-1, 1000), RangeError);
assert.throws(() => estimateCost(.5, NaN), RangeError);
console.log('Pricing checks passed');
