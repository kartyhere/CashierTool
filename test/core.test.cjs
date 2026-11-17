'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DENOMS, totalValue } = require('../src/core/denoms');
const { group, inr, parseAmount, digitsOnly } = require('../src/core/format');

test('eleven denominations, notes before coins', () => {
  assert.equal(DENOMS.length, 11);
  assert.deepEqual(DENOMS.map((d) => d.value), [500, 200, 100, 50, 20, 10, 20, 10, 5, 2, 1]);
});
test('totalValue', () => {
  assert.equal(totalValue({ N500: 2, C1: 3 }), 1003);
  assert.throws(() => totalValue({ N999: 1 }));
  assert.throws(() => totalValue({ N500: 1.5 }));
});
test('Indian grouping and rupee format', () => {
  assert.equal(group(125000), '1,25,000');
  assert.equal(group(999), '999');
  assert.equal(inr(-250), '−₹250');
});
test('parseAmount', () => {
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('1,250'), 1250);
  assert.ok(Number.isNaN(parseAmount('1'.repeat(13))));
  assert.equal(digitsOnly('a1b2'), '12');
});
