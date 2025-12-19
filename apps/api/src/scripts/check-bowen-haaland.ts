import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function check() {
  // Check specific opportunities from screenshot - Bowen Over 3.5, Haaland Over 5.5
  const opps = await client.execute("SELECT id, selection, market, line, nba_validation_json FROM opportunities WHERE (selection LIKE '%Bowen%' AND market LIKE '%Shot%') OR (selection LIKE '%Haaland%' AND market LIKE '%Shot%')");
  console.log('Shot opportunities:');
  opps.rows.forEach(r => {
    const hasValidation = r.nba_validation_json && !String(r.nba_validation_json).includes('error');
    console.log('  ', r.selection, '| Line:', r.line, '| Validated:', hasValidation ? 'YES' : 'NO');
    if (r.nba_validation_json) {
      console.log('    Data:', String(r.nba_validation_json).substring(0, 100));
    }
  });

  client.close();
}

check().catch(console.error);
