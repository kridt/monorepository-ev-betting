import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function check() {
  const total = await client.execute('SELECT COUNT(*) as c FROM opportunities WHERE nba_validation_json IS NOT NULL');
  console.log('Opportunities with validation:', total.rows[0].c);

  const soccer = await client.execute("SELECT COUNT(*) as c FROM opportunities WHERE sport = 'soccer' AND nba_validation_json IS NOT NULL");
  console.log('Soccer with validation:', soccer.rows[0].c);

  const sample = await client.execute("SELECT selection, market, nba_validation_json FROM opportunities WHERE sport = 'soccer' AND nba_validation_json IS NOT NULL LIMIT 5");
  console.log('\nSample validated soccer opportunities:');
  sample.rows.forEach(r => {
    const v = JSON.parse(r.nba_validation_json as string);
    console.log('  ', v.playerName, '|', r.market, '|', v.hits + '/' + v.matchesChecked, '(' + v.hitRate + '%)');
  });

  client.close();
}

check().catch(console.error);
