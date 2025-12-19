import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function check() {
  // Sample soccer card markets with full details
  const cardMarkets = await client.execute("SELECT player_id, player_name, market, selection FROM opportunities WHERE market LIKE '%Card%' LIMIT 10");
  console.log('Card opportunities:');
  cardMarkets.rows.forEach(r => {
    console.log('  Selection:', r.selection);
    console.log('    player_id:', r.player_id || 'NULL');
    console.log('    player_name:', r.player_name || 'NULL');
    console.log('');
  });

  client.close();
}

check().catch(console.error);
