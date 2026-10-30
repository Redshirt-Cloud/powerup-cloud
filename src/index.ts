import { bootstrapUser, login, logout, sameOriginMutation, staffIdentity, type Env as AuthEnv } from './auth';
import { getProduct, listCategories, listIngredients, listProducts, saveIngredient, saveProduct } from './catalog';
import { object } from './input';
import { createOrder, getOrder, listOrders, updateOrder } from './orders';
import { getSubscription, listSubscriptions, saveSubscription, syncSubscriptions } from './subscriptions';
import { addDays, kitchenToday, validDate } from './recurrence';

interface Env extends AuthEnv {
  ASSETS: Fetcher;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('Content-Length') ?? 0) > 65536) throw new Error('Request body is too large');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 65536) throw new Error('Request body is too large');
  try { return object(JSON.parse(text)); } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Expected valid JSON');
    throw error;
  }
}

function isAdminHost(hostname: string): boolean {
  return hostname === 'admin.powerupwv.com' || hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.workers.dev');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname === '/health' && request.method === 'GET') {
      try { await env.DB.prepare('SELECT 1').first(); return json({ status: 'ok', database: 'ok' }); }
      catch { return json({ status: 'unavailable' }, 503); }
    }
    if (!pathname.startsWith('/api/')) {
      if (request.method !== 'GET' || !isAdminHost(url.hostname)) return json({ error: 'Not found' }, 404);
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'");
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(response.body, { status: response.status, headers });
    }
    if (request.method !== 'GET' && !sameOriginMutation(request)) return json({ error: 'Invalid request origin' }, 403);
    try {
      if (pathname === '/api/v1/auth/login' && request.method === 'POST') return await login(request, env, await body(request));
      if (pathname === '/api/v1/bootstrap/user' && request.method === 'POST') return await bootstrapUser(request, env, await body(request));
      const staff = await staffIdentity(request, env);
      if (!staff) return json({ error: 'Unauthorized' }, 401);
      if (pathname === '/api/v1/auth/me' && request.method === 'GET') return json({ user: staff });
      if (pathname === '/api/v1/auth/logout' && request.method === 'POST') return await logout(request, env);
      if (pathname === '/api/v1/staff/ingredients' && request.method === 'GET') return await listIngredients(env);
      if (pathname === '/api/v1/staff/categories' && request.method === 'GET') return await listCategories(env);
      if (pathname === '/api/v1/staff/ingredients' && request.method === 'POST') return await saveIngredient(env, await body(request));
      const ingredientId = pathname.match(/^\/api\/v1\/staff\/ingredients\/([a-f0-9-]+)$/)?.[1];
      if (ingredientId && request.method === 'PATCH') return await saveIngredient(env, await body(request), ingredientId);
      if (pathname === '/api/v1/staff/products' && request.method === 'GET') return await listProducts(env);
      if (pathname === '/api/v1/staff/products' && request.method === 'POST') return await saveProduct(env, await body(request));
      const productId = pathname.match(/^\/api\/v1\/staff\/products\/([a-f0-9-]+)$/)?.[1];
      if (productId && request.method === 'GET') return await getProduct(env, productId);
      if (productId && request.method === 'PATCH') return await saveProduct(env, await body(request), productId);
      if (pathname === '/api/v1/staff/orders' && request.method === 'GET') {
        const from = url.searchParams.get('from') ?? kitchenToday();
        const through = url.searchParams.get('through') ?? addDays(from, 31);
        if (validDate(from) && validDate(through) && through >= kitchenToday() && through <= addDays(from, 93)) {
          await syncSubscriptions(env, from > kitchenToday() ? from : kitchenToday(), through);
        }
        return await listOrders(env, url);
      }
      if (pathname === '/api/v1/staff/orders' && request.method === 'POST') return await createOrder(env, await body(request));
      const orderId = pathname.match(/^\/api\/v1\/staff\/orders\/([a-f0-9:-]+)$/)?.[1];
      if (orderId && request.method === 'GET') return await getOrder(env, orderId);
      if (orderId && request.method === 'PATCH') return await updateOrder(env, orderId, await body(request));
      if (pathname === '/api/v1/staff/subscriptions' && request.method === 'GET') return await listSubscriptions(env);
      if (pathname === '/api/v1/staff/subscriptions' && request.method === 'POST') return await saveSubscription(env, await body(request));
      const subscriptionId = pathname.match(/^\/api\/v1\/staff\/subscriptions\/([a-f0-9-]+)$/)?.[1];
      if (subscriptionId && request.method === 'GET') return await getSubscription(env, subscriptionId);
      if (subscriptionId && request.method === 'PATCH') return await saveSubscription(env, await body(request), subscriptionId);
      return json({ error: 'Not found' }, 404);
    } catch (error) {
      if (error instanceof Error && /^(Expected|Invalid|Provide|Duplicate|A combo|Only combos|Add ingredients|Product ingredients|Combo components|One or more|Order total|Order date|Completed orders|Recurring order|No order|endDate|startDate|name|priceCents|weeklyPriceCents|categoryId|servingSize|servings|quantity|customer|fulfillment|items|notes|calories|proteinG|carbsG|fatG|fiberG|sugarG|sodiumMg|allergens|description|Request body)/.test(error.message)) return json({ error: error.message }, 400);
      console.error('Request failed', error);
      return json({ error: 'Internal server error' }, 500);
    }
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await syncSubscriptions(env);
    await env.DB.prepare('DELETE FROM staff_sessions WHERE expires_at < ?').bind(new Date().toISOString()).run();
  }
} satisfies ExportedHandler<Env>;
