/**
 * Soccer Player Cache Update Script
 *
 * Manually update the soccer player cache from SportMonks.
 * Run with: npm run update-soccer-cache
 * Check stats: npm run soccer-cache-stats
 *
 * Note: This can take several hours due to API rate limits (3000 calls/hour).
 * The cache scheduler runs automatically at 3:00 AM daily.
 */

import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { initDatabase } from '../db/index.js';
import { updateSoccerCache, getSoccerCacheStats } from '../services/soccerPlayerCache.js';
import { getMappingStats } from '../services/playerIdMapping.js';

async function main() {
  const args = process.argv.slice(2);
  const showStatsOnly = args.includes('--stats');

  console.info('='.repeat(60));
  console.info('Soccer Player Cache');
  console.info('='.repeat(60));

  // Initialize database
  await initDatabase();

  // Get current stats
  const stats = await getSoccerCacheStats();
  const mappingStats = await getMappingStats();

  console.info('\nCurrent Cache Status:');
  console.info(`  Leagues: ${stats.totalLeagues}`);
  console.info(`  Teams: ${stats.totalTeams}`);
  console.info(`  Players: ${stats.totalPlayers}`);
  console.info(`  Games: ${stats.totalGames}`);
  console.info(`  Last Update: ${stats.lastUpdate || 'Never'}`);
  console.info(`  Last Status: ${stats.lastStatus || 'N/A'}`);

  console.info('\nPlayer ID Mappings:');
  console.info(`  Total: ${mappingStats.totalMappings}`);
  console.info(`  High Confidence: ${mappingStats.highConfidenceMappings}`);
  console.info(`  Verified: ${mappingStats.verifiedMappings}`);

  if (showStatsOnly) {
    console.info('\n(Use without --stats to run a full update)');
    process.exit(0);
  }

  console.info('\n' + '='.repeat(60));
  console.info('Starting Full Cache Update...');
  console.info('This may take several hours due to API rate limits.');
  console.info('='.repeat(60) + '\n');

  try {
    const result = await updateSoccerCache();

    console.info('\n' + '='.repeat(60));
    console.info('Update Complete!');
    console.info('='.repeat(60));
    console.info(`  Leagues processed: ${result.leaguesProcessed}`);
    console.info(`  Teams processed: ${result.teamsProcessed}`);
    console.info(`  Players added: ${result.playersAdded}`);
    console.info(`  Players updated: ${result.playersUpdated}`);
    console.info(`  Games added: ${result.gamesAdded}`);
    console.info(`  Mappings created: ${result.mappingsCreated}`);
    console.info(`  Duration: ${Math.round(result.duration / 1000 / 60)} minutes`);

    if (result.errors.length > 0) {
      console.warn(`\n  Errors: ${result.errors.length}`);
      result.errors.slice(0, 10).forEach((err, i) => {
        console.warn(`    ${i + 1}. ${err}`);
      });
      if (result.errors.length > 10) {
        console.warn(`    ... and ${result.errors.length - 10} more`);
      }
    }

    process.exit(0);
  } catch (error) {
    console.error('\nUpdate failed:', error);
    process.exit(1);
  }
}

main();
