/**
 * Validate ALL soccer player prop opportunities
 */
import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { createClient } from '@libsql/client';
import { getSoccerPlayerByName, calculateSoccerHitRate } from '../services/soccerPlayerCache.js';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

// Extract player name from selection
function extractPlayerName(selection: string): string | undefined {
  // "Jacob Murphy Over 0.5" -> "Jacob Murphy"
  const match = selection.match(/^(.+?)\s+(over|under)\s+[\d.]+$/i);
  if (match) return match[1].trim();

  // "Josh Acheampong" (no Over/Under)
  if (!selection.toLowerCase().includes('over') && !selection.toLowerCase().includes('under')) {
    // Filter out team names and totals
    if (!selection.toLowerCase().includes(' fc') &&
        !selection.toLowerCase().includes('united') &&
        !selection.toLowerCase().includes('city') &&
        selection.length < 40) {
      return selection.trim();
    }
  }
  return undefined;
}

// Map market to stat key
function mapMarketToStat(market: string): string | null {
  const m = market.toLowerCase();
  if (m.includes('shot') && m.includes('target')) return 'shots_on_target';
  if (m.includes('shot')) return 'shots';
  if (m.includes('goal') && m.includes('assist')) return 'goals'; // goals+assists use goals
  if (m.includes('score') && m.includes('assist')) return 'goals'; // to score or assist
  if (m.includes('goal')) return 'goals';
  if (m.includes('assist')) return 'assists';
  if (m.includes('tackle')) return 'tackles';
  if (m.includes('card')) return 'yellow_cards';
  if (m.includes('foul')) return 'fouls';
  if (m.includes('pass')) return 'passes';
  if (m.includes('cross')) return 'passes';
  return null;
}

async function main() {
  console.log('🔍 Validating ALL Soccer Player Props');
  console.log('='.repeat(50));

  let offset = 0;
  const batchSize = 100;
  let totalValidated = 0;
  let totalFailed = 0;

  while (true) {
    // Get batch of unvalidated opportunities
    const opps = await client.execute({
      sql: `
        SELECT id, player_id, selection, market, line, home_team, away_team
        FROM opportunities
        WHERE sport = 'soccer'
          AND nba_validation_json IS NULL
          AND (market LIKE '%Player%' OR market LIKE '%Card%' OR market LIKE '%Shot%'
               OR market LIKE '%Goal%' OR market LIKE '%Assist%' OR market LIKE '%Foul%'
               OR market LIKE '%Tackle%' OR market LIKE '%Pass%')
        LIMIT ?
      `,
      args: [batchSize],
    });

    if (opps.rows.length === 0) {
      console.log('\nNo more opportunities to validate.');
      break;
    }

    console.log(`\nProcessing batch of ${opps.rows.length} opportunities...`);

    for (const opp of opps.rows) {
      const selection = opp.selection as string;
      const market = opp.market as string;
      const line = (opp.line as number) || 0.5;
      const homeTeam = opp.home_team as string;
      const awayTeam = opp.away_team as string;

      const playerName = extractPlayerName(selection);
      if (!playerName) {
        // Mark as validated with null to avoid re-processing
        await client.execute({
          sql: `UPDATE opportunities SET nba_validation_json = '{"error":"no_player"}' WHERE id = ?`,
          args: [opp.id],
        });
        totalFailed++;
        continue;
      }

      const statKey = mapMarketToStat(market);
      if (!statKey) {
        await client.execute({
          sql: `UPDATE opportunities SET nba_validation_json = '{"error":"unknown_market"}' WHERE id = ?`,
          args: [opp.id],
        });
        totalFailed++;
        continue;
      }

      const direction = selection.toLowerCase().includes('under') ? 'under' : 'over';

      // Try to find player - try both home and away team
      let cachedPlayer = await getSoccerPlayerByName(playerName, homeTeam);
      if (!cachedPlayer) {
        cachedPlayer = await getSoccerPlayerByName(playerName, awayTeam);
      }
      if (!cachedPlayer) {
        // Try without team (broader search)
        cachedPlayer = await getSoccerPlayerByName(playerName);
      }

      if (!cachedPlayer) {
        await client.execute({
          sql: `UPDATE opportunities SET nba_validation_json = '{"error":"player_not_found"}' WHERE id = ?`,
          args: [opp.id],
        });
        totalFailed++;
        continue;
      }

      // Calculate hit rate
      const result = await calculateSoccerHitRate(cachedPlayer.id, statKey, line, direction, 10);

      if (!result) {
        await client.execute({
          sql: `UPDATE opportunities SET nba_validation_json = '{"error":"no_stats"}' WHERE id = ?`,
          args: [opp.id],
        });
        totalFailed++;
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

      totalValidated++;
    }

    console.log(`  Validated: ${totalValidated}, Failed: ${totalFailed}`);
  }

  console.log('\n' + '='.repeat(50));
  console.log(`✅ Total Validated: ${totalValidated}`);
  console.log(`❌ Total Failed: ${totalFailed}`);

  client.close();
}

main().catch(console.error);
