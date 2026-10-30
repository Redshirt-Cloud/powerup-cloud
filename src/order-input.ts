import { validDate } from './recurrence';
import type { Selection } from './variations';

export type OrderInput = {
  source: 'staff' | 'website' | 'facebook' | 'phone' | 'other';
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  fulfillmentDate: string;
  fulfillmentMethod: 'pickup' | 'delivery';
  notes: string | null;
  items: { productId: string; quantity: number; selections: Selection }[];
};

export function parseOrderInput(value: unknown): OrderInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an order object');
  const data = value as Record<string, unknown>;
  const customerName = requiredString(data.customerName, 'customerName', 120);
  const customerEmail = optionalString(data.customerEmail, 'customerEmail', 254);
  const customerPhone = optionalString(data.customerPhone, 'customerPhone', 40);
  if (!customerEmail && !customerPhone) throw new Error('Provide customerEmail or customerPhone');
  const fulfillmentDate = requiredString(data.fulfillmentDate, 'fulfillmentDate', 10);
  if (!validDate(fulfillmentDate)) {
    throw new Error('fulfillmentDate must be a valid YYYY-MM-DD date');
  }
  if (data.fulfillmentMethod !== 'pickup' && data.fulfillmentMethod !== 'delivery') throw new Error('Invalid fulfillmentMethod');
  const source = data.source ?? 'staff';
  if (!['staff', 'website', 'facebook', 'phone', 'other'].includes(String(source))) throw new Error('Invalid source');
  if (!Array.isArray(data.items) || data.items.length < 1 || data.items.length > 100) throw new Error('items must contain 1 to 100 products');
  const items = data.items.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid item');
    const row = item as Record<string, unknown>;
    const productId = requiredString(row.productId, 'productId', 100);
    if (!Number.isInteger(row.quantity) || (row.quantity as number) < 1 || (row.quantity as number) > 1000) throw new Error('quantity must be 1 to 1000');
    const selections: Selection = {};
    if (row.selections !== undefined && row.selections !== null) {
      if (typeof row.selections !== 'object' || Array.isArray(row.selections) || Object.keys(row.selections).length > 30) throw new Error('Invalid selections');
      for (const [groupId, optionIds] of Object.entries(row.selections)) {
        requiredString(groupId, 'groupId', 100);
        if (!Array.isArray(optionIds) || optionIds.length > 20) throw new Error('Invalid selected options');
        selections[groupId] = optionIds.map(optionId => requiredString(optionId, 'optionId', 100));
      }
    }
    return { productId, quantity: row.quantity as number, selections };
  });
  return {
    source: source as OrderInput['source'], customerName, customerEmail, customerPhone,
    fulfillmentDate, fulfillmentMethod: data.fulfillmentMethod, notes: optionalString(data.notes, 'notes', 2000), items
  };
}

export function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) throw new Error(`${field} must be 1 to ${maxLength} characters`);
  return value.trim();
}

function optionalString(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > maxLength) throw new Error(`${field} must be at most ${maxLength} characters`);
  return value.trim() || null;
}
