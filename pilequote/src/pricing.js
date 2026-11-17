// Turns an estimated volume into a price using the hauler's own price sheet.
// Pure functions only, so they are easy to test.

export const DEFAULT_PRICES = Object.freeze({
  min: 99, // minimum charge / single item
  quarter: 229,
  half: 379,
  threeQuarter: 499,
  full: 629,
});

export const PRICE_FIELDS = [
  { key: 'min', label: 'Minimum / single item' },
  { key: 'quarter', label: '1/4 truck' },
  { key: 'half', label: '1/2 truck' },
  { key: 'threeQuarter', label: '3/4 truck' },
  { key: 'full', label: 'Full truck' },
];

// Per-item fees. Keys must match the fee_type enum the AI returns.
export const FEE_TYPES = [
  { key: 'mattress', label: 'Mattress or box spring', default: 25 },
  { key: 'freon', label: 'Fridge, freezer or AC unit', default: 40 },
  { key: 'tv', label: 'TV or computer monitor', default: 20 },
  { key: 'tire', label: 'Tire', default: 15 },
  { key: 'piano', label: 'Piano', default: 0 },
  { key: 'hot_tub', label: 'Hot tub or spa', default: 0 },
];

export const DEFAULT_TRUCK_YARDS = 15;

export function defaultFees() {
  return Object.fromEntries(FEE_TYPES.map((f) => [f.key, f.default]));
}

const roundTo5 = (n) => Math.round(n / 5) * 5;

/**
 * Price for each tier: index 0 = minimum charge, 1..8 = eighths of a truck.
 * Owners enter min, 1/4, 1/2, 3/4 and full; odd eighths sit halfway between.
 * Prices never go down as the load gets bigger, even if the sheet is odd.
 */
export function tierPrices(prices) {
  const p = { ...DEFAULT_PRICES, ...prices };
  const mid = (a, b) => (a + b) / 2;
  const tiers = [
    p.min,
    mid(p.min, p.quarter),
    p.quarter,
    mid(p.quarter, p.half),
    p.half,
    mid(p.half, p.threeQuarter),
    p.threeQuarter,
    mid(p.threeQuarter, p.full),
    p.full,
  ].map((n) => roundTo5(Math.max(0, Number(n) || 0)));
  for (let i = 1; i < tiers.length; i++) tiers[i] = Math.max(tiers[i], tiers[i - 1]);
  return tiers;
}

/**
 * Number of eighths of a truck a volume needs. 0 means "minimum charge"
 * (roughly a single item, under 1/16 of a truck).
 * rounding 'up' (high end of a range): next eighth up, with a small tolerance
 * so 3.9 yd in a 15 yd truck is 1/4, not 3/8. 'nearest' (low end): closest eighth.
 */
export function volumeToEighths(yards, truckYards = DEFAULT_TRUCK_YARDS, rounding = 'up') {
  const y = Math.max(0, Number(yards) || 0);
  const truck = Math.max(1, Number(truckYards) || DEFAULT_TRUCK_YARDS);
  const eighths = (y / truck) * 8;
  if (eighths <= 0.5) return 0;
  const n = rounding === 'nearest' ? Math.round(eighths) : Math.ceil(eighths - 0.1);
  return Math.max(1, n);
}

export function priceForEighths(eighths, prices) {
  const tiers = tierPrices(prices);
  if (eighths <= 8) return tiers[eighths];
  const fullLoads = Math.floor(eighths / 8);
  const rest = eighths % 8;
  return fullLoads * tiers[8] + (rest > 0 ? tiers[rest] : 0);
}

const FRACTIONS = ['', '1/8', '1/4', '3/8', '1/2', '5/8', '3/4', '7/8'];

/** "a minimum load", "3/8 of a truck", "a full truck", "2 full trucks + 1/4" */
export function tierLabel(eighths) {
  if (eighths <= 0) return 'a minimum load';
  if (eighths < 8) return `${FRACTIONS[eighths]} of a truck`;
  const fullLoads = Math.floor(eighths / 8);
  const rest = eighths % 8;
  const loads = fullLoads === 1 ? 'a full truck' : `${fullLoads} full trucks`;
  return rest ? `${loads} + ${FRACTIONS[rest]}` : loads;
}

/** "About 3/8 to 1/2 of a truck", "About a full truck" */
export function rangeLabel(lowEighths, highEighths) {
  if (lowEighths === highEighths) return `About ${tierLabel(lowEighths)}`;
  const bothPartial = lowEighths >= 1 && highEighths <= 7;
  if (bothPartial) return `About ${FRACTIONS[lowEighths]} to ${FRACTIONS[highEighths]} of a truck`;
  return `About ${tierLabel(lowEighths)} to ${tierLabel(highEighths)}`;
}

/**
 * Combine the AI's volume range and item counts with the company's rates.
 * estimate: { volumeLow, volumeHigh, items: [{ name, quantity, feeType }] }
 * company:  { prices, fees, truckYards }
 */
export function quotePrice(estimate, company) {
  const truckYards = company.truckYards || DEFAULT_TRUCK_YARDS;
  let lowY = Number(estimate.volumeLow) || 0;
  let highY = Number(estimate.volumeHigh) || 0;
  if (lowY > highY) [lowY, highY] = [highY, lowY];

  const lowEighths = volumeToEighths(lowY, truckYards, 'nearest');
  const highEighths = Math.max(lowEighths, volumeToEighths(highY, truckYards, 'up'));

  const feeRates = { ...defaultFees(), ...(company.fees || {}) };
  const counts = {};
  for (const item of estimate.items || []) {
    if (!item.feeType || item.feeType === 'none') continue;
    counts[item.feeType] = (counts[item.feeType] || 0) + Math.max(0, Math.round(item.quantity || 0));
  }
  const fees = FEE_TYPES.filter((f) => counts[f.key] > 0 && Number(feeRates[f.key]) > 0).map(
    (f) => ({
      key: f.key,
      label: f.label,
      count: counts[f.key],
      each: Number(feeRates[f.key]),
      total: counts[f.key] * Number(feeRates[f.key]),
    }),
  );
  const feesTotal = fees.reduce((sum, f) => sum + f.total, 0);

  const low = priceForEighths(lowEighths, company.prices) + feesTotal;
  const high = priceForEighths(highEighths, company.prices) + feesTotal;

  return {
    low,
    high,
    lowEighths,
    highEighths,
    sizeLabel: rangeLabel(lowEighths, highEighths),
    // Share of one truck, for the truck picture (capped at 1).
    lowFill: Math.min(1, lowY / truckYards),
    highFill: Math.min(1, highY / truckYards),
    fees,
    feesTotal,
  };
}

export function formatMoney(n) {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

export function formatPriceRange(low, high) {
  return low === high ? formatMoney(low) : `${formatMoney(low)}–${formatMoney(high)}`;
}
