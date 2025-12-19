import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { createClient } from '@libsql/client';
import { calculateSoccerHitRate, getSoccerPlayerByName } from '../services/soccerPlayerCache.js';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function check() {
  // Test with Richarlison
  const player = await getSoccerPlayerByName('Richarlison', 'Tottenham');
  if (!player) {
    console.log('Player not found');
    return;
  }

  console.log('Testing Richarlison TOTAL SHOTS calculation:');
  console.log('Player ID:', player.id);
  console.log('');

  // Calculate with the function (should now use shots + shots_on_target)
  const result = await calculateSoccerHitRate(player.id, 'shots', 0.5, 'over', 18);

  if (result) {
    console.log('Validation Result:');
    console.log('  Total games:', result.total);
    console.log('  Hits (Over 0.5):', result.hits);
    console.log('  Hit Rate:', result.hitRate + '%');
    console.log('  Avg Value:', result.avgValue);
    console.log('');
    console.log('Game-by-game TOTAL shots (should be shots + SOT):');
    result.recentGames.forEach(g => {
      console.log(`  ${g.date} vs ${g.opponent}: ${g.value} total shots ${g.hit ? '✓' : '✗'}`);
    });
  }

  // Also check a stored validation
  const stored = await client.execute("SELECT selection, nba_validation_json FROM opportunities WHERE selection LIKE '%Richarlison%' AND market LIKE '%Shot%' AND nba_validation_json IS NOT NULL LIMIT 1");
  if (stored.rows.length > 0) {
    console.log('\nStored validation for Richarlison:');
    const v = JSON.parse(stored.rows[0].nba_validation_json as string);
    console.log('  Avg shots:', v.avgValue);
    console.log('  Hit rate:', v.hitRate + '%');
  }

  client.close();
}

check().catch(console.error);
