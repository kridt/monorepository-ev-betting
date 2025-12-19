#!/usr/bin/env npx tsx

/**
 * Player Cache Update Script
 *
 * Run this script to update the player stats cache.
 * Recommended to run once daily after NBA games complete.
 *
 * Usage:
 *   npm run update-cache         # Full update
 *   npm run update-cache -- --stats  # Show cache stats only
 */

import { initDatabase } from '../db/index.js';
import {
  updateAllPlayers,
  getCacheStats,
} from '../services/playerCache.js';

async function main() {
  const args = process.argv.slice(2);
  const showStatsOnly = args.includes('--stats');

  console.log('\n========================================');
  console.log('    PLAYER CACHE UPDATE');
  console.log('========================================\n');

  // Initialize database
  await initDatabase();

  if (showStatsOnly) {
    // Just show current cache stats
    const stats = await getCacheStats();
    console.log('Current Cache Statistics:');
    console.log('-------------------------');
    console.log(`  Total Players: ${stats.totalPlayers}`);
    console.log(`  Total Game Records: ${stats.totalGames}`);
    console.log(`  Last Update: ${stats.lastUpdate || 'Never'}`);
    console.log(`  Oldest Player Data: ${stats.oldestPlayer || 'N/A'}`);
    console.log('');
    process.exit(0);
  }

  // Run full update
  console.log('Starting full cache update...\n');
  console.log('This will fetch stats for all NBA players from OpticOdds.');
  console.log('This may take several minutes.\n');

  const startTime = Date.now();

  try {
    const result = await updateAllPlayers();

    const duration = Math.round((Date.now() - startTime) / 1000);

    console.log('\n========================================');
    console.log('           UPDATE COMPLETE');
    console.log('========================================\n');

    console.log('Results:');
    console.log('--------');
    console.log(`  Players Updated: ${result.playersUpdated}`);
    console.log(`  Players Added: ${result.playersAdded}`);
    console.log(`  Games Added: ${result.gamesAdded}`);
    console.log(`  Duration: ${duration}s (${result.duration}ms)`);

    if (result.errors.length > 0) {
      console.log(`\n  Errors: ${result.errors.length}`);
      result.errors.slice(0, 5).forEach((e) => console.log(`    - ${e}`));
      if (result.errors.length > 5) {
        console.log(`    ... and ${result.errors.length - 5} more`);
      }
    }

    // Show updated stats
    const stats = await getCacheStats();
    console.log('\nCache Statistics:');
    console.log('-----------------');
    console.log(`  Total Players: ${stats.totalPlayers}`);
    console.log(`  Total Game Records: ${stats.totalGames}`);
    console.log('');

    process.exit(result.errors.length > 10 ? 1 : 0);
  } catch (error) {
    console.error('\nFatal error:', error);
    process.exit(1);
  }
}

main();
