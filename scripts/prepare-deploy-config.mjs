import { readFileSync, writeFileSync } from 'node:fs';

const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
if (!databaseId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(databaseId)) {
  throw new Error('CLOUDFLARE_D1_DATABASE_ID must be a D1 database UUID');
}

const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
config.d1_databases[0].database_id = databaseId;
writeFileSync(new URL('../wrangler.deploy.json', import.meta.url), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
