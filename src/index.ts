import { parseOrderInput, requiredString } from './order-input';

interface Env {
  DB: D1Database;
  STAFF_API_TOKEN?: string;
}

type Product = { id: string; name: string; price_cents: number; active: number };

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function body(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 65536) throw new Error('Request body is too large');
  try { return JSON.parse(text); } catch { throw new Error('Expected valid JSON'); }
}

async function authorized(request: Request, token?: string): Promise<boolean> {
  if (!token || token.length < 32) return false;
  const supplied = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const encoder = new TextEncoder();
  const [expectedHash, suppliedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(token)),
    crypto.subtle.digest('SHA-256', encoder.encode(supplied))
  ]);
  const expected = new Uint8Array(expectedHash);
  const actual = new Uint8Array(suppliedHash);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected[i] ^ actual[i];
  return difference === 0;
}

async function createProduct(request: Request, env: Env): Promise<Response> {
  const input = await body(request) as Record<string, unknown>;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a product object');
  const name = requiredString(input.name, 'name', 160);
  if (!Number.isInteger(input.priceCents) || (input.priceCents as number) < 0 || (input.priceCents as number) > 1000000) throw new Error('priceCents must be an integer from 0 to 1000000');
  const product = { id: crypto.randomUUID(), name, priceCents: input.priceCents as number };
  await env.DB.prepare('INSERT INTO products (id, name, price_cents) VALUES (?, ?, ?)').bind(product.id, product.name, product.priceCents).run();
  return json(product, 201);
}

async function createOrder(request: Request, env: Env): Promise<Response> {
  const input = parseOrderInput(await body(request));
  const products = await Promise.all(input.items.map(item => env.DB.prepare('SELECT id, name, price_cents, active FROM products WHERE id = ?').bind(item.productId).first<Product>()));
  if (products.some(product => !product || product.active !== 1)) return json({ error: 'One or more products are unavailable' }, 400);
  const totalCents = input.items.reduce((sum, item, index) => sum + item.quantity * products[index]!.price_cents, 0);
  if (!Number.isSafeInteger(totalCents)) throw new Error('Order total is too large');
  const id = crypto.randomUUID();
  const statements = [
    env.DB.prepare('INSERT INTO orders (id, source, customer_name, customer_email, customer_phone, fulfillment_date, fulfillment_method, notes, total_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, input.source, input.customerName, input.customerEmail, input.customerPhone, input.fulfillmentDate, input.fulfillmentMethod, input.notes, totalCents),
    ...input.items.map((item, index) => {
      const product = products[index]!;
      return env.DB.prepare('INSERT INTO order_items (id, order_id, product_id, product_name, unit_price_cents, quantity, line_total_cents) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), id, product.id, product.name, product.price_cents, item.quantity, product.price_cents * item.quantity);
    })
  ];
  await env.DB.batch(statements);
  return json({ id, totalCents, status: 'new', paymentStatus: 'unpaid' }, 201);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/health' && request.method === 'GET') {
      try {
        await env.DB.prepare('SELECT 1').first();
        return json({ status: 'ok', database: 'ok' });
      } catch {
        return json({ status: 'unavailable' }, 503);
      }
    }
    if (!pathname.startsWith('/api/v1/staff/')) return json({ error: 'Not found' }, 404);
    if (!env.STAFF_API_TOKEN || env.STAFF_API_TOKEN.length < 32) return json({ error: 'Staff API is not configured' }, 503);
    if (!await authorized(request, env.STAFF_API_TOKEN)) return json({ error: 'Unauthorized' }, 401);
    try {
      if (pathname === '/api/v1/staff/products' && request.method === 'GET') {
        const result = await env.DB.prepare('SELECT id, name, price_cents AS priceCents, active FROM products ORDER BY created_at DESC').all();
        return json({ products: result.results });
      }
      if (pathname === '/api/v1/staff/products' && request.method === 'POST') return await createProduct(request, env);
      if (pathname === '/api/v1/staff/orders' && request.method === 'GET') {
        const result = await env.DB.prepare('SELECT id, source, customer_name AS customerName, fulfillment_date AS fulfillmentDate, fulfillment_method AS fulfillmentMethod, status, payment_status AS paymentStatus, total_cents AS totalCents, created_at AS createdAt FROM orders ORDER BY created_at DESC LIMIT 100').all();
        return json({ orders: result.results });
      }
      if (pathname === '/api/v1/staff/orders' && request.method === 'POST') return await createOrder(request, env);
      return json({ error: 'Not found' }, 404);
    } catch (error) {
      if (error instanceof Error && /^(Expected|Provide|Invalid|items|Duplicate|quantity|fulfillmentDate|customerName|customerEmail|customerPhone|productId|notes|name|priceCents|Request body|Order total)/.test(error.message)) return json({ error: error.message }, 400);
      console.error('Request failed', error);
      return json({ error: 'Internal server error' }, 500);
    }
  }
} satisfies ExportedHandler<Env>;
