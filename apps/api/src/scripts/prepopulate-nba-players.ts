/**
 * Pre-populate NBA Player Cache
 *
 * This script fetches ALL active NBA players from Ball Don't Lie
 * and caches their stats in the database for instant lookups.
 *
 * Run with: npx tsx src/scripts/prepopulate-nba-players.ts
 */

import { prePopulateAllPlayers, getCacheStats } from '../services/ballDontLie.js';
import { initDatabase } from '../db/index.js';

async function main() {
  console.log('='.repeat(60));
  console.log('NBA Player Cache Pre-Population');
  console.log('='.repeat(60));

  // Initialize database
  console.log('\nInitializing database...');
  await initDatabase();

  // Show current stats
  const statsBefore = await getCacheStats();
  console.log(`\nCurrent cache stats:`);
  console.log(`  Players: ${statsBefore.players}`);
  console.log(`  Aliases: ${statsBefore.aliases}`);
  console.log(`  Game records: ${statsBefore.games}`);

  // Run pre-population
  console.log('\n' + '-'.repeat(60));
  console.log('Starting pre-population...');
  console.log('-'.repeat(60) + '\n');

  const result = await prePopulateAllPlayers();

  // Show results
  console.log('\n' + '='.repeat(60));
  console.log('Results:');
  console.log('='.repeat(60));
  console.log(`  Total players found: ${result.totalPlayers}`);
  console.log(`  Players added: ${result.playersAdded}`);
  console.log(`  Players failed: ${result.playersFailed}`);
  console.log(`  Aliases created: ${result.aliasesCreated}`);
  console.log(`  Duration: ${Math.round(result.duration / 1000)}s`);

  if (result.errors.length > 0) {
    console.log(`\nErrors (first 10):`);
    result.errors.slice(0, 10).forEach(e => console.log(`  - ${e}`));
  }

  // Show final stats
  const statsAfter = await getCacheStats();
  console.log(`\nFinal cache stats:`);
  console.log(`  Players: ${statsAfter.players} (+${statsAfter.players - statsBefore.players})`);
  console.log(`  Aliases: ${statsAfter.aliases} (+${statsAfter.aliases - statsBefore.aliases})`);
  console.log(`  Game records: ${statsAfter.games} (+${statsAfter.games - statsBefore.games})`);

  console.log('\nDone!');
  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
