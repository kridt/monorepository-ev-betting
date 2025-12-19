/**
 * Manually validate soccer opportunities
 * Bypasses the slow pipeline to test soccer validation
 */
import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { createClient } from '@libsql/client';
import { getSoccerPlayerByName, calculateSoccerHitRate } from '../services/soccerPlayerCache.js';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

// Extract player name from selection like "Jacob Murphy Over 0.5"
function extractPlayerName(selection: string): string | undefined {
  const match = selection.match(/^(.+?)\s+(over|under)\s+[\d.]+$/i);
  if (match) return match[1].trim();
  // Also try without Over/Under (e.g., "Josh Acheampong")
  if (!selection.toLowerCase().includes('over') && !selection.toLowerCase().includes('under')) {
    return selection.trim();
  }
  return undefined;
}

// Map market to stat key
function mapMarketToStat(market: string): string | null {
  const m = market.toLowerCase();
  if (m.includes('shot') && m.includes('target')) return 'shots_on_target';
  if (m.includes('shot')) return 'shots';
  if (m.includes('goal')) return 'goals';
  if (m.includes('assist')) return 'assists';
  if (m.includes('tackle')) return 'tackles';
  if (m.includes('card')) return 'yellow_cards';
  if (m.includes('foul')) return 'fouls';
  if (m.includes('pass')) return 'passes';
  return null;
}

async function main() {
  console.log('🔍 Manual Soccer Validation');
  console.log('='.repeat(50));

  // Get unvalidated soccer player prop opportunities
  const opps = await client.execute(`
    SELECT id, player_id, selection, market, line, home_team, away_team
    FROM opportunities
    WHERE sport = 'soccer'
      AND nba_validation_json IS NULL
      AND (market LIKE '%Player%' OR market LIKE '%Card%' OR market LIKE '%Shot%')
    LIMIT 500
  `);

  console.log(`Found ${opps.rows.length} soccer opportunities to validate\n`);

  let validated = 0;
  let failed = 0;

  for (const opp of opps.rows) {
    const selection = opp.selection as string;
    const market = opp.market as string;
    const line = (opp.line as number) || 0.5;
    const homeTeam = opp.home_team as string;
    const awayTeam = opp.away_team as string;

    const playerName = extractPlayerName(selection);
    if (!playerName) {
      console.log(`❌ Can't extract player from: ${selection}`);
      failed++;
      continue;
    }

    const statKey = mapMarketToStat(market);
    if (!statKey) {
      console.log(`❌ Unknown market: ${market}`);
      failed++;
      continue;
    }

    const direction = selection.toLowerCase().includes('under') ? 'under' : 'over';

    // Try to find player in SportMonks cache
    const cachedPlayer = await getSoccerPlayerByName(playerName, homeTeam || awayTeam);

    if (!cachedPlayer) {
      console.log(`❌ Player not found: ${playerName} (${homeTeam} vs ${awayTeam})`);
      failed++;
      continue;
    }

    // Calculate hit rate
    const result = await calculateSoccerHitRate(cachedPlayer.id, statKey, line, direction, 10);

    if (!result) {
      console.log(`❌ No stats for: ${playerName} - ${statKey}`);
      failed++;
      continue;
    }

    // Create validation JSON
    const validation = {
      playerId: cachedPlayer.id.toString(),
      playerName: cachedPlayer.name,
      market,
      line,
      direction,
      matchesChecked: result.total,
      hits: result.hits,
      hitRate: result.hitRate,
      avgValue: result.avgValue,
      recentGames: result.recentGames,
    };

    // Update database
    await client.execute({
      sql: `UPDATE opportunities SET nba_validation_json = ? WHERE id = ?`,
      args: [JSON.stringify(validation), opp.id],
    });

    console.log(`✅ ${playerName} | ${market} | ${result.hits}/${result.total} (${result.hitRate}%)`);
    validated++;
  }

  console.log('\n' + '='.repeat(50));
  console.log(`✅ Validated: ${validated}`);
  console.log(`❌ Failed: ${failed}`);

  client.close();
}

main().catch(console.error);
