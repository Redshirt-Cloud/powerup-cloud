import { describe, expect, it } from 'vitest';
import { parseOrderInput } from '../src/order-input';

const valid = {
  customerName: '  Jane Doe  ', customerPhone: '304-555-0100',
  fulfillmentDate: '2026-11-06', fulfillmentMethod: 'pickup',
  items: [{ productId: 'product-1', quantity: 2 }]
};

describe('order input', () => {
  it('normalizes a staff order and keeps product pricing out of the request', () => {
    expect(parseOrderInput(valid)).toMatchObject({ source: 'staff', customerName: 'Jane Doe', items: [{ productId: 'product-1', quantity: 2 }] });
  });
  it('requires a contact method', () => {
    expect(() => parseOrderInput({ ...valid, customerPhone: null })).toThrow('Provide customerEmail or customerPhone');
  });
  it('allows the same product with different choices as separate lines', () => {
    const items = [
      { productId: 'product-1', quantity: 1, selections: { portion: ['small'] } },
      { productId: 'product-1', quantity: 1, selections: { portion: ['large'] } }
    ];
    expect(parseOrderInput({ ...valid, items }).items).toEqual(items);
  });
  it('rejects malformed variation choices', () => {
    expect(() => parseOrderInput({ ...valid, items: [{ productId: 'product-1', quantity: 1, selections: { portion: 'large' } }] })).toThrow('Invalid selected options');
  });
  it('rejects a calendar date that rolls into the next month', () => {
    expect(() => parseOrderInput({ ...valid, fulfillmentDate: '2026-02-31' })).toThrow('fulfillmentDate');
  });
});
