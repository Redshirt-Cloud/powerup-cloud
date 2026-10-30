import type { Env } from './auth';
import { date, object, optional } from './input';
import { parseOrderInput, type OrderInput } from './order-input';
import { itemStatements, pricedItems } from './orders';
import { addDays, kitchenToday, occurrenceDates, type Cadence } from './recurrence';
import type { Selection } from './variations';

type Subscription = {
  id: string; customer_name: string; customer_email: string | null; customer_phone: string | null;
  start_date: string; end_date: string | null; cadence: Cadence; fulfillment_method: 'pickup' | 'delivery';
  status: 'active' | 'paused' | 'cancelled'; notes: string | null;
};

type SubscriptionItem = { product_id: string; quantity: number; selections: Selection };

async function subscriptionItems(env: Env, id: string): Promise<SubscriptionItem[]> {
  const rows = await env.DB.prepare('SELECT product_id, quantity, selections_json AS selectionsJson FROM subscription_lines WHERE subscription_id = ? ORDER BY sort_order').bind(id).all<{ product_id: string; quantity: number; selectionsJson: string }>();
  return rows.results.map(row => ({ product_id: row.product_id, quantity: row.quantity, selections: JSON.parse(row.selectionsJson) as Selection }));
}

export async function listSubscriptions(env: Env): Promise<Response> {
  const rows = await env.DB.prepare('SELECT id, customer_name AS customerName, customer_email AS customerEmail, customer_phone AS customerPhone, start_date AS startDate, end_date AS endDate, cadence, fulfillment_method AS fulfillmentMethod, status, notes FROM subscriptions ORDER BY created_at DESC LIMIT 500').all();
  return Response.json({ subscriptions: rows.results });
}

export async function getSubscription(env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT id, customer_name AS customerName, customer_email AS customerEmail, customer_phone AS customerPhone, start_date AS startDate, end_date AS endDate, cadence, fulfillment_method AS fulfillmentMethod, status, notes FROM subscriptions WHERE id = ?').bind(id).first();
  if (!row) return Response.json({ error: 'Subscription not found' }, { status: 404 });
  const items = await subscriptionItems(env, id);
  return Response.json({ subscription: { ...row, items: items.map(item => ({ productId: item.product_id, quantity: item.quantity, selections: item.selections })) } });
}

export async function saveSubscription(env: Env, raw: unknown, id?: string): Promise<Response> {
  const data = object(raw);
  const startDate = date(data.startDate, 'startDate');
  const endDate = data.endDate === null || data.endDate === '' || data.endDate === undefined ? null : date(data.endDate, 'endDate');
  if (endDate && endDate < startDate) throw new Error('endDate must be on or after startDate');
  const cadence = data.cadence;
  if (cadence !== 'weekly' && cadence !== 'monthly') throw new Error('Invalid cadence');
  const status = data.status ?? 'active';
  if (status !== 'active' && status !== 'paused' && status !== 'cancelled') throw new Error('Invalid subscription status');
  const input = parseOrderInput({ ...data, fulfillmentDate: startDate, source: 'staff' });
  await pricedItems(env, input);
  const subscriptionId = id ?? crypto.randomUUID();
  if (id) {
    const existing = await env.DB.prepare('SELECT id FROM subscriptions WHERE id = ?').bind(id).first();
    if (!existing) return Response.json({ error: 'Subscription not found' }, { status: 404 });
  }
  const today = kitchenToday();
  const statements = [
    ...(id ? [env.DB.prepare("DELETE FROM orders WHERE subscription_id = ? AND fulfillment_date >= ? AND status = 'new'").bind(id, today)] : []),
    id ? env.DB.prepare('UPDATE subscriptions SET customer_name = ?, customer_email = ?, customer_phone = ?, start_date = ?, end_date = ?, cadence = ?, fulfillment_method = ?, status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(input.customerName, input.customerEmail, input.customerPhone, startDate, endDate, cadence, input.fulfillmentMethod, status, optional(data.notes, 'notes'), id)
      : env.DB.prepare('INSERT INTO subscriptions (id, customer_name, customer_email, customer_phone, start_date, end_date, cadence, fulfillment_method, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(subscriptionId, input.customerName, input.customerEmail, input.customerPhone, startDate, endDate, cadence, input.fulfillmentMethod, status, optional(data.notes, 'notes')),
    env.DB.prepare('DELETE FROM subscription_lines WHERE subscription_id = ?').bind(subscriptionId),
    ...input.items.map((item, index) => env.DB.prepare('INSERT INTO subscription_lines (id, subscription_id, product_id, quantity, selections_json, sort_order) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), subscriptionId, item.productId, item.quantity, JSON.stringify(item.selections), index))
  ];
  await env.DB.batch(statements);
  if (status === 'active') await syncSubscription(env, subscriptionId, today, addDays(today, 45));
  return Response.json({ id: subscriptionId, status }, { status: id ? 200 : 201 });
}

export async function syncSubscriptions(env: Env, from = kitchenToday(), through = addDays(from, 45)): Promise<void> {
  const rows = await env.DB.prepare("SELECT * FROM subscriptions WHERE status = 'active' AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)").bind(through, from).all<Subscription>();
  for (const row of rows.results) await syncSubscription(env, row.id, from, through, row);
}

async function syncSubscription(env: Env, id: string, from: string, through: string, existing?: Subscription): Promise<void> {
  const sub = existing ?? await env.DB.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(id).first<Subscription>();
  if (!sub || sub.status !== 'active') return;
  const items = await subscriptionItems(env, id);
  if (!items.length) return;
  for (const fulfillmentDate of occurrenceDates(sub.start_date, sub.cadence, from, through, sub.end_date)) {
    const orderId = `${id}:${fulfillmentDate}`;
    const found = await env.DB.prepare('SELECT id FROM orders WHERE subscription_id = ? AND fulfillment_date = ?').bind(id, fulfillmentDate).first();
    if (found) continue;
    const input: OrderInput = {
      source: 'staff', customerName: sub.customer_name, customerEmail: sub.customer_email, customerPhone: sub.customer_phone,
      fulfillmentDate, fulfillmentMethod: sub.fulfillment_method, notes: sub.notes,
      items: items.map(item => ({ productId: item.product_id, quantity: item.quantity, selections: item.selections }))
    };
    const priced = await pricedItems(env, input);
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO orders (id, source, customer_name, customer_email, customer_phone, fulfillment_date, fulfillment_method, notes, total_cents, subscription_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(orderId, 'staff', sub.customer_name, sub.customer_email, sub.customer_phone, fulfillmentDate, sub.fulfillment_method, sub.notes, priced.totalCents, id),
      ...itemStatements(env, orderId, priced.items, true)
    ]);
  }
}
