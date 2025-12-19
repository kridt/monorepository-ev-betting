import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function check() {
  // Get Haaland's validation data for total shots
  const result = await client.execute("SELECT selection, market, line, nba_validation_json FROM opportunities WHERE selection LIKE '%Haaland%' AND market = 'Player Shots' LIMIT 1");

  if (result.rows.length > 0) {
    const validation = JSON.parse(result.rows[0].nba_validation_json as string);
    console.log('Haaland Total Shots Validation:');
    console.log('  Selection:', result.rows[0].selection);
    console.log('  Line:', result.rows[0].line);
    console.log('  Matches checked:', validation.matchesChecked);
    console.log('  Hit rate:', validation.hitRate + '%');
    console.log('  Avg total shots:', validation.avgValue);
    console.log('\nGame-by-game:');
    validation.recentGames.forEach((g: any) => {
      console.log(`  ${g.date} vs ${g.opponent}: ${g.value} total shots`);
    });
  }

  // Also get Bowen's stats
  const bowen = await client.execute("SELECT selection, market, line, nba_validation_json FROM opportunities WHERE selection LIKE '%Bowen%' AND market = 'Player Shots' LIMIT 1");

  if (bowen.rows.length > 0) {
    const validation = JSON.parse(bowen.rows[0].nba_validation_json as string);
    console.log('\n\nBowen Total Shots Validation:');
    console.log('  Selection:', bowen.rows[0].selection);
    console.log('  Line:', bowen.rows[0].line);
    console.log('  Matches checked:', validation.matchesChecked);
    console.log('  Hit rate:', validation.hitRate + '%');
    console.log('  Avg total shots:', validation.avgValue);
    console.log('\nGame-by-game:');
    validation.recentGames.forEach((g: any) => {
      console.log(`  ${g.date} vs ${g.opponent}: ${g.value} total shots`);
    });
  }

  client.close();
}

check().catch(console.error);
