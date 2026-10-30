export interface Env {
  DB: D1Database;
  STAFF_API_TOKEN?: string;
  AUTH_PEPPER?: string;
}

type StaffUser = { id: string; email: string; display_name: string; password_hash: string };

function bytesToBase64(bytes: Uint8Array<ArrayBufferLike>): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

async function hashToken(token: string): Promise<string> {
  return bytesToBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
}

export async function hashPassword(password: string, pepper: string, salt: Uint8Array<ArrayBufferLike> = crypto.getRandomValues(new Uint8Array(16))): Promise<string> {
  const pepperKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mixed = await crypto.subtle.sign('HMAC', pepperKey, new TextEncoder().encode(password));
  const key = await crypto.subtle.importKey('raw', mixed, 'PBKDF2', false, ['deriveBits']);
  const hash = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return `pbkdf2-sha256-hmac:100000:${bytesToBase64(salt)}:${bytesToBase64(new Uint8Array(hash))}`;
}

async function verifyPassword(password: string, pepper: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256-hmac' || parts[1] !== '100000') return false;
  const actual = await hashPassword(password, pepper, base64ToBytes(parts[2]));
  return constantTimeEqual(actual, stored);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

function sessionCookieName(request: Request): string {
  return new URL(request.url).protocol === 'https:' ? '__Host-powerup_session' : 'powerup_session';
}

function getSessionToken(request: Request): string | null {
  const cookies = request.headers.get('Cookie') ?? '';
  const name = sessionCookieName(request);
  return cookies.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
}

export async function staffIdentity(request: Request, env: Env): Promise<{ id: string; email: string; displayName: string } | null> {
  const token = getSessionToken(request);
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    const row = await env.DB.prepare('SELECT u.id, u.email, u.display_name AS displayName FROM staff_sessions s JOIN staff_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
      .bind(await hashToken(token), new Date().toISOString()).first<{ id: string; email: string; displayName: string }>();
    if (row) return row;
  }
  const supplied = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (supplied && env.STAFF_API_TOKEN && env.STAFF_API_TOKEN.length >= 32 && constantTimeEqual(await hashToken(supplied), await hashToken(env.STAFF_API_TOKEN))) {
    return { id: 'service-token', email: 'service', displayName: 'Service token' };
  }
  return null;
}

export function sameOriginMutation(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return !request.headers.has('Cookie');
  return origin === new URL(request.url).origin;
}

export async function bootstrapUser(request: Request, env: Env, data: Record<string, unknown>): Promise<Response> {
  const supplied = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!supplied || !env.STAFF_API_TOKEN || env.STAFF_API_TOKEN.length < 32 || !constantTimeEqual(await hashToken(supplied), await hashToken(env.STAFF_API_TOKEN))) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.AUTH_PEPPER || env.AUTH_PEPPER.length < 32) return Response.json({ error: 'Authentication secret is not configured' }, { status: 503 });
  const existing = await env.DB.prepare('SELECT COUNT(*) AS count FROM staff_users').first<{ count: number }>();
  if (existing?.count) return Response.json({ error: 'First user already exists' }, { status: 409 });
  const email = normalizeEmail(data.email);
  const displayName = typeof data.displayName === 'string' ? data.displayName.trim() : '';
  const password = typeof data.password === 'string' ? data.password : '';
  if (!email || !displayName || displayName.length > 120 || password.length < 12 || password.length > 256) return Response.json({ error: 'Valid email, display name, and password of at least 12 characters are required' }, { status: 400 });
  await env.DB.prepare('INSERT INTO staff_users (id, email, display_name, password_hash) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), email, displayName, await hashPassword(password, env.AUTH_PEPPER)).run();
  return Response.json({ created: true }, { status: 201 });
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export async function login(request: Request, env: Env, data: Record<string, unknown>): Promise<Response> {
  if (!env.AUTH_PEPPER || env.AUTH_PEPPER.length < 32) return Response.json({ error: 'Authentication secret is not configured' }, { status: 503 });
  const email = normalizeEmail(data.email);
  const password = typeof data.password === 'string' ? data.password : '';
  if (!email || !password || password.length > 256) return Response.json({ error: 'Invalid credentials' }, { status: 401 });
  const now = new Date();
  const attempts = await env.DB.prepare('SELECT count, window_start FROM login_attempts WHERE email = ?').bind(email).first<{ count: number; window_start: string }>();
  if (attempts && attempts.count >= 5 && now.getTime() - Date.parse(attempts.window_start) < 15 * 60000) return Response.json({ error: 'Too many attempts; try again later' }, { status: 429 });
  const user = await env.DB.prepare('SELECT id, email, display_name, password_hash FROM staff_users WHERE email = ?').bind(email).first<StaffUser>();
  const valid = user && await verifyPassword(password, env.AUTH_PEPPER, user.password_hash);
  if (!valid) {
    const count = attempts && now.getTime() - Date.parse(attempts.window_start) < 15 * 60000 ? attempts.count + 1 : 1;
    const windowStart = count === 1 ? now.toISOString() : attempts!.window_start;
    await env.DB.prepare('INSERT INTO login_attempts (email, count, window_start) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET count = excluded.count, window_start = excluded.window_start').bind(email, count, windowStart).run();
    return Response.json({ error: 'Invalid credentials' }, { status: 401 });
  }
  await env.DB.prepare('DELETE FROM login_attempts WHERE email = ?').bind(email).run();
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
  const expiry = new Date(now.getTime() + 7 * 86400000).toISOString();
  await env.DB.prepare('INSERT INTO staff_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await hashToken(token), user.id, expiry).run();
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return Response.json({ user: { id: user.id, email: user.email, displayName: user.display_name } }, {
    headers: { 'Set-Cookie': `${sessionCookieName(request)}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=604800${secure}`, 'Cache-Control': 'no-store' }
  });
}

export async function logout(request: Request, env: Env): Promise<Response> {
  const token = getSessionToken(request);
  if (token) await env.DB.prepare('DELETE FROM staff_sessions WHERE token_hash = ?').bind(await hashToken(token)).run();
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': `${sessionCookieName(request)}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${secure}`, 'Cache-Control': 'no-store' } });
}
