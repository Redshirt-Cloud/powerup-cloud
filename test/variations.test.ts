import { describe, expect, it } from 'vitest';
import { calculateSelections, type ProductVariation } from '../src/variations';

const groups: ProductVariation[] = [
  { groupId: 'portion', name: 'Protein Portion', selectionType: 'single', sortOrder: 0, minRequired: 1, maxAllowed: 1,
    options: [
      { id: 'small', label: '3 oz', sku: null, priceCents: 0, basePriceCents: 0, isDefault: false, sortOrder: 0 },
      { id: 'large', label: '6 oz', sku: null, priceCents: 470, basePriceCents: 300, isDefault: false, sortOrder: 1 }
    ] },
  { groupId: 'sauce', name: 'Add Sauce', selectionType: 'single', sortOrder: 1, minRequired: 0, maxAllowed: 1,
    options: [{ id: 'none', label: 'No Thanks!', sku: null, priceCents: 0, basePriceCents: 0, isDefault: true, sortOrder: 0 }] }
];

describe('variation pricing', () => {
  it('adds product-specific option prices and snapshots selected labels', () => {
    const priced = calculateSelections(groups, { portion: ['large'] });
    expect(priced.deltaCents).toBe(470);
    expect(priced.snapshots.map(row => [row.groupName, row.optionName, row.priceDeltaCents])).toEqual([
      ['Protein Portion', '6 oz', 470], ['Add Sauce', 'No Thanks!', 0]
    ]);
  });
  it('requires a protein portion and rejects unknown options', () => {
    expect(() => calculateSelections(groups, {})).toThrow('Protein Portion');
    expect(() => calculateSelections(groups, { portion: ['other'] })).toThrow('Protein Portion');
  });
});
