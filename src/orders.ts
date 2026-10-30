import type { Env } from './auth';
import { object, optional } from './input';
import { parseOrderInput, type OrderInput } from './order-input';
import { addDays, kitchenToday, validDate } from './recurrence';
import { priceSelections } from './variations';

type Product = { id: string; name: string; price_cents: number; active: number; kind: 'individual' | 'combo' };
type ComboComponent = { product_id: string; product_name: string; quantity: number };

export async function pricedItems(env: Env, input: OrderInput) {
  const products = await Promise.all(input.items.map(item => env.DB.prepare('SELECT id, name, price_cents, active, kind FROM products WHERE id = ?').bind(item.productId).first<Product>()));
  if (products.some(product => !product || product.active !== 1)) throw new Error('One or more products are unavailable');
  const components = await Promise.all(products.map(product => product!.kind === 'combo'
    ? env.DB.prepare('SELECT cp.product_id, p.name AS product_name, cp.quantity FROM combo_products cp JOIN products p ON p.id = cp.product_id WHERE cp.combo_id = ?').bind(product!.id).all<ComboComponent>()
    : Promise.resolve({ results: [] as ComboComponent[] })));
  const selections = await Promise.all(input.items.map(item => priceSelections(env, item.productId, item.selections)));
  const items = input.items.map((item, index) => {
    const unitPriceCents = products[index]!.price_cents + selections[index].deltaCents;
    return { ...item, product: products[index]!, components: components[index].results, variations: selections[index].snapshots, unitPriceCents, lineTotalCents: item.quantity * unitPriceCents };
  });
  const totalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
  if (!Number.isSafeInteger(totalCents)) throw new Error('Order total is too large');
  return { items, totalCents };
}

export function itemStatements(env: Env, orderId: string, items: Awaited<ReturnType<typeof pricedItems>>['items'], deterministic = false): D1PreparedStatement[] {
  return items.flatMap((item, index) => {
    const itemId = deterministic ? `${orderId}:${index}` : crypto.randomUUID();
    const insert = deterministic ? 'INSERT OR IGNORE' : 'INSERT';
    return [
      env.DB.prepare(`${insert} INTO order_items (id, order_id, product_id, product_name, unit_price_cents, quantity, line_total_cents) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(itemId, orderId, item.product.id, item.product.name, item.unitPriceCents, item.quantity, item.lineTotalCents),
      ...item.components.map(component => env.DB.prepare(`${insert} INTO order_item_components (order_item_id, product_id, product_name, quantity) VALUES (?, ?, ?, ?)`)
        .bind(itemId, component.product_id, component.product_name, component.quantity * item.quantity)),
      ...item.variations.map(variation => env.DB.prepare(`${insert} INTO order_item_variations (order_item_id, group_id, group_name, option_id, option_name, price_delta_cents, group_order, option_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(itemId, variation.groupId, variation.groupName, variation.optionId, variation.optionName, variation.priceDeltaCents, variation.groupOrder, variation.optionOrder))
    ];
  });
}

export async function createOrder(env: Env, raw: unknown): Promise<Response> {
  const input = parseOrderInput(raw);
  const { items, totalCents } = await pricedItems(env, input);
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO orders (id, source, customer_name, customer_email, customer_phone, fulfillment_date, fulfillment_method, notes, total_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, input.source, input.customerName, input.customerEmail, input.customerPhone, input.fulfillmentDate, input.fulfillmentMethod, input.notes, totalCents),
    ...itemStatements(env, id, items)
  ]);
  return Response.json({ id, totalCents, status: 'new', paymentStatus: 'unpaid' }, { status: 201 });
}

export async function listOrders(env: Env, url: URL): Promise<Response> {
  const from = url.searchParams.get('from') ?? kitchenToday();
  const through = url.searchParams.get('through') ?? addDays(from, 31);
  if (!validDate(from) || !validDate(through) || through < from || through > addDays(from, 93)) throw new Error('Order date range must be valid and no longer than 93 days');
  const rows = await env.DB.prepare('SELECT id, source, customer_name AS customerName, customer_email AS customerEmail, customer_phone AS customerPhone, fulfillment_date AS fulfillmentDate, fulfillment_method AS fulfillmentMethod, status, payment_status AS paymentStatus, notes, total_cents AS totalCents, subscription_id AS subscriptionId, created_at AS createdAt FROM orders WHERE fulfillment_date BETWEEN ? AND ? ORDER BY fulfillment_date, created_at LIMIT 2000')
    .bind(from, through).all();
  return Response.json({ from, through, orders: rows.results });
}

export async function getOrder(env: Env, id: string): Promise<Response> {
  const order = await env.DB.prepare('SELECT id, source, customer_name AS customerName, customer_email AS customerEmail, customer_phone AS customerPhone, fulfillment_date AS fulfillmentDate, fulfillment_method AS fulfillmentMethod, status, payment_status AS paymentStatus, notes, total_cents AS totalCents, subscription_id AS subscriptionId, created_at AS createdAt FROM orders WHERE id = ?').bind(id).first();
  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 });
  const items = await env.DB.prepare('SELECT id, product_id AS productId, product_name AS productName, unit_price_cents AS unitPriceCents, quantity, line_total_cents AS lineTotalCents FROM order_items WHERE order_id = ?').bind(id).all();
  const components = await env.DB.prepare('SELECT c.order_item_id AS orderItemId, c.product_id AS productId, c.product_name AS productName, c.quantity FROM order_item_components c JOIN order_items i ON i.id = c.order_item_id WHERE i.order_id = ?').bind(id).all<{ orderItemId: string; productId: string; productName: string; quantity: number }>();
  const variations = await env.DB.prepare('SELECT v.order_item_id AS orderItemId, v.group_id AS groupId, v.group_name AS groupName, v.option_id AS optionId, v.option_name AS optionName, v.price_delta_cents AS priceDeltaCents FROM order_item_variations v JOIN order_items i ON i.id = v.order_item_id WHERE i.order_id = ? ORDER BY v.group_order, v.option_order').bind(id).all<{ orderItemId: string; groupId: string; groupName: string; optionId: string; optionName: string; priceDeltaCents: number }>();
  return Response.json({ order: { ...order, items: items.results.map(item => {
    const choices = variations.results.filter(variation => variation.orderItemId === item.id);
    const selections = Object.fromEntries([...new Set(choices.map(choice => choice.groupId))].map(groupId => [groupId, choices.filter(choice => choice.groupId === groupId).map(choice => choice.optionId)]));
    return { ...item, components: components.results.filter(component => component.orderItemId === item.id), variations: choices, selections };
  }) } });
}

export async function updateOrder(env: Env, id: string, raw: unknown): Promise<Response> {
  const data = object(raw);
  const existing = await env.DB.prepare('SELECT id, status, subscription_id, fulfillment_date FROM orders WHERE id = ?').bind(id).first<{ id: string; status: string; subscription_id: string | null; fulfillment_date: string }>();
  if (!existing) return Response.json({ error: 'Order not found' }, { status: 404 });
  if (data.items !== undefined) {
    if (existing.status === 'fulfilled' || existing.status === 'cancelled') throw new Error('Completed orders cannot be edited');
    const input = parseOrderInput(data);
    if (existing.subscription_id && input.fulfillmentDate !== existing.fulfillment_date) throw new Error('Recurring order date cannot be changed; edit the subscription');
    const { items, totalCents } = await pricedItems(env, input);
    await env.DB.batch([
      env.DB.prepare('UPDATE orders SET source = ?, customer_name = ?, customer_email = ?, customer_phone = ?, fulfillment_date = ?, fulfillment_method = ?, notes = ?, total_cents = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(input.source, input.customerName, input.customerEmail, input.customerPhone, input.fulfillmentDate, input.fulfillmentMethod, input.notes, totalCents, id),
      env.DB.prepare('DELETE FROM order_items WHERE order_id = ?').bind(id),
      ...itemStatements(env, id, items)
    ]);
    return Response.json({ id, totalCents });
  }
  const status = data.status;
  const paymentStatus = data.paymentStatus;
  if (status !== undefined && !['new', 'confirmed', 'preparing', 'ready', 'fulfilled', 'cancelled'].includes(String(status))) throw new Error('Invalid order status');
  if (paymentStatus !== undefined && !['unpaid', 'paid', 'refunded'].includes(String(paymentStatus))) throw new Error('Invalid payment status');
  if (status === undefined && paymentStatus === undefined && data.notes === undefined) throw new Error('No order changes provided');
  const notes = data.notes === undefined ? undefined : optional(data.notes, 'notes');
  await env.DB.prepare('UPDATE orders SET status = COALESCE(?, status), payment_status = COALESCE(?, payment_status), notes = CASE WHEN ? = 1 THEN ? ELSE notes END, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(status ?? null, paymentStatus ?? null, notes === undefined ? 0 : 1, notes ?? null, id).run();
  return Response.json({ id, updated: true });
}
