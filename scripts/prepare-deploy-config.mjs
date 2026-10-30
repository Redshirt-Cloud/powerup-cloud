import { readFileSync, writeFileSync } from 'node:fs';

const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
if (!databaseId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(databaseId)) {
  throw new Error('CLOUDFLARE_D1_DATABASE_ID must be a D1 database UUID');
}
const staffToken = process.env.STAFF_API_TOKEN;
const authPepper = process.env.AUTH_PEPPER;
if (!staffToken || staffToken.length < 32 || !authPepper || authPepper.length < 32 || staffToken === authPepper) {
  throw new Error('STAFF_API_TOKEN and AUTH_PEPPER must be distinct secrets of at least 32 characters');
}

const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
config.d1_databases[0].database_id = databaseId;
writeFileSync(new URL('../wrangler.deploy.json', import.meta.url), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
writeFileSync(new URL('../wrangler.secrets.json', import.meta.url), JSON.stringify({ STAFF_API_TOKEN: staffToken, AUTH_PEPPER: authPepper }) + '\n', { mode: 0o600 });
