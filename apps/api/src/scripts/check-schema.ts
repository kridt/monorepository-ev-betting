import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function check() {
  const schema = await client.execute("PRAGMA table_info(opportunities)");
  console.log('Opportunities table columns:');
  schema.rows.forEach(r => console.log('  -', r.name));
  client.close();
}

check().catch(console.error);
