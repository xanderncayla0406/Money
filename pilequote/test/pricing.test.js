import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tierPrices,
  volumeToEighths,
  priceForEighths,
  quotePrice,
  rangeLabel,
  tierLabel,
  formatPriceRange,
  DEFAULT_PRICES,
} from '../src/pricing.js';
import { normalizeEstimate } from '../src/estimate.js';

const company = {
  truckYards: 16,
  prices: { min: 100, quarter: 240, half: 400, threeQuarter: 520, full: 640 },
  fees: { mattress: 25, freon: 40, tv: 20, tire: 15, piano: 0, hot_tub: 0 },
};

test('tier prices fill odd eighths halfway and never go down', () => {
  assert.deepEqual(tierPrices(company.prices), [100, 170, 240, 320, 400, 460, 520, 580, 640]);
  const odd = tierPrices({ min: 300, quarter: 200, half: 400, threeQuarter: 350, full: 600 });
  for (let i = 1; i < odd.length; i++) assert.ok(odd[i] >= odd[i - 1], `tier ${i} went down`);
  assert.deepEqual(tierPrices({}).length, 9);
  assert.equal(tierPrices({})[8], Math.round(DEFAULT_PRICES.full / 5) * 5);
});

test('volume to eighths', () => {
  assert.equal(volumeToEighths(0, 16), 0);
  assert.equal(volumeToEighths(0.9, 16), 0); // under 1/16 truck = minimum charge
  assert.equal(volumeToEighths(2, 16), 1);
  assert.equal(volumeToEighths(4, 16), 2);
  assert.equal(volumeToEighths(4.1, 16), 2); // small tolerance, still 1/4
  assert.equal(volumeToEighths(4.5, 16), 3); // clearly over 1/4 rounds up
  assert.equal(volumeToEighths(4.5, 16, 'nearest'), 2);
  assert.equal(volumeToEighths(16, 16), 8);
  assert.equal(volumeToEighths(20, 16), 10);
});

test('multi-truck prices', () => {
  assert.equal(priceForEighths(8, company.prices), 640);
  assert.equal(priceForEighths(10, company.prices), 640 + 240);
  assert.equal(priceForEighths(16, company.prices), 1280);
});

test('labels', () => {
  assert.equal(tierLabel(0), 'a minimum load');
  assert.equal(tierLabel(3), '3/8 of a truck');
  assert.equal(tierLabel(8), 'a full truck');
  assert.equal(tierLabel(10), 'a full truck + 1/4');
  assert.equal(tierLabel(16), '2 full trucks');
  assert.equal(rangeLabel(3, 4), 'About 3/8 to 1/2 of a truck');
  assert.equal(rangeLabel(4, 4), 'About 1/2 of a truck');
  assert.equal(rangeLabel(0, 2), 'About a minimum load to 1/4 of a truck');
  assert.equal(rangeLabel(6, 8), 'About 3/4 of a truck to a full truck');
  assert.equal(formatPriceRange(300, 300), '$300');
  assert.equal(formatPriceRange(300, 1250), '$300–$1,250');
});

test('quote combines load price and item fees', () => {
  const q = quotePrice(
    {
      volumeLow: 5,
      volumeHigh: 7,
      items: [
        { name: 'Sofa', quantity: 1, feeType: 'none' },
        { name: 'Queen mattress', quantity: 1, feeType: 'mattress' },
        { name: 'Box spring', quantity: 1, feeType: 'mattress' },
        { name: 'Fridge', quantity: 1, feeType: 'freon' },
        { name: 'Piano', quantity: 1, feeType: 'piano' }, // $0 fee: not listed
      ],
    },
    company,
  );
  // 5 yd of 16 = 2.5 eighths -> nearest 3 (low); 7 yd = 3.5 -> up 4 (high)
  assert.equal(q.lowEighths, 3);
  assert.equal(q.highEighths, 4);
  assert.equal(q.feesTotal, 25 * 2 + 40);
  assert.equal(q.low, 320 + 90);
  assert.equal(q.high, 400 + 90);
  assert.deepEqual(q.fees.map((f) => [f.key, f.count]), [['mattress', 2], ['freon', 1]]);
  assert.equal(q.sizeLabel, 'About 3/8 to 1/2 of a truck');
  assert.ok(q.highFill > q.lowFill);
});

test('swapped or empty volumes are handled', () => {
  const q = quotePrice({ volumeLow: 8, volumeHigh: 4, items: [] }, company);
  assert.ok(q.low <= q.high);
  const tiny = quotePrice({ volumeLow: 0.3, volumeHigh: 0.5, items: [] }, company);
  assert.equal(tiny.low, 100);
  assert.equal(tiny.high, 100);
});

test('normalizeEstimate cleans model output', () => {
  const e = normalizeEstimate({
    usable: true,
    unusable_reason: '',
    items: [
      { name: '  Sofa ', quantity: 1.6, fee_type: 'none' },
      { name: 'Mattress', quantity: -3, fee_type: 'mattress' },
      { name: '', quantity: 1, fee_type: 'none' },
      { name: 'Weird', quantity: 1, fee_type: 'spaceship' },
    ],
    volume_low_cubic_yards: 9,
    volume_high_cubic_yards: 6,
    confidence: 'very',
    heavy_materials: false,
    not_accepted_items: ['paint cans'],
    customer_summary: 'A sofa and a mattress.',
    owner_notes: 'Ground floor.',
    photo_tips: '',
  });
  assert.equal(e.items.length, 3);
  assert.equal(e.items[0].name, 'Sofa');
  assert.equal(e.items[0].quantity, 2);
  assert.equal(e.items[1].quantity, 1);
  assert.equal(e.items[2].feeType, 'none');
  assert.equal(e.volumeLow, 6);
  assert.equal(e.volumeHigh, 9);
  assert.equal(e.confidence, 'medium');
  assert.deepEqual(e.notAccepted, ['paint cans']);

  const bad = normalizeEstimate({ usable: false, unusable_reason: 'Too dark to see.' });
  assert.equal(bad.usable, false);
  assert.equal(bad.unusableReason, 'Too dark to see.');

  const empty = normalizeEstimate({ usable: true, items: [], volume_low_cubic_yards: 0, volume_high_cubic_yards: 0 });
  assert.equal(empty.usable, false);
});
