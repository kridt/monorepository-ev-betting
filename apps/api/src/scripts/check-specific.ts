import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function check() {
  // Check Nathan Collins opportunities
  const nathan = await client.execute("SELECT selection, market, nba_validation_json FROM opportunities WHERE selection LIKE '%Nathan Collins%' LIMIT 5");
  console.log('Nathan Collins opportunities:');
  nathan.rows.forEach(r => {
    const hasValidation = r.nba_validation_json && !String(r.nba_validation_json).includes('error');
    console.log('  ', r.selection, '|', r.market, '| Validated:', hasValidation ? 'YES' : 'NO');
    if (hasValidation) {
      const v = JSON.parse(r.nba_validation_json as string);
      console.log('    ->', v.hits + '/' + v.matchesChecked, '(' + v.hitRate + '%)');
    }
  });

  // Check Jhon Arias opportunities
  const jhon = await client.execute("SELECT selection, market, nba_validation_json FROM opportunities WHERE selection LIKE '%Jhon Arias%' LIMIT 5");
  console.log('\nJhon Arias opportunities:');
  jhon.rows.forEach(r => {
    const hasValidation = r.nba_validation_json && !String(r.nba_validation_json).includes('error');
    console.log('  ', r.selection, '|', r.market, '| Validated:', hasValidation ? 'YES' : 'NO');
    if (hasValidation) {
      const v = JSON.parse(r.nba_validation_json as string);
      console.log('    ->', v.hits + '/' + v.matchesChecked, '(' + v.hitRate + '%)');
    }
  });

  // Total validation stats
  const total = await client.execute("SELECT COUNT(*) as c FROM opportunities WHERE sport = 'soccer'");
  const validated = await client.execute("SELECT COUNT(*) as c FROM opportunities WHERE sport = 'soccer' AND nba_validation_json IS NOT NULL AND nba_validation_json NOT LIKE '%error%'");
  const errors = await client.execute("SELECT COUNT(*) as c FROM opportunities WHERE sport = 'soccer' AND nba_validation_json LIKE '%error%'");
  const pending = await client.execute("SELECT COUNT(*) as c FROM opportunities WHERE sport = 'soccer' AND nba_validation_json IS NULL");

  console.log('\nOverall Stats:');
  console.log('  Total soccer:', total.rows[0].c);
  console.log('  Validated:', validated.rows[0].c);
  console.log('  Errors:', errors.rows[0].c);
  console.log('  Pending:', pending.rows[0].c);

  client.close();
}

check().catch(console.error);
