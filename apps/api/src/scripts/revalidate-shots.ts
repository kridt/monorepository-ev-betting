/**
 * Re-validate all shot opportunities with corrected total shots calculation
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
  const match = selection.match(/^(.+?)\s+(over|under)\s+[\d.]+$/i);
  if (match) return match[1].trim();
  if (!selection.toLowerCase().includes('over') && !selection.toLowerCase().includes('under')) {
    if (!selection.toLowerCase().includes(' fc') &&
        !selection.toLowerCase().includes('united') &&
        !selection.toLowerCase().includes('city') &&
        selection.length < 40) {
      return selection.trim();
    }
  }
  return undefined;
}

async function main() {
  console.log('🔄 Re-validating ALL shot opportunities with corrected calculation');
  console.log('='.repeat(60));

  // First, clear all shot market validations to recalculate
  console.log('\n1. Clearing old shot validations...');
  await client.execute("UPDATE opportunities SET nba_validation_json = NULL WHERE market LIKE '%Shot%' AND sport = 'soccer'");

  // Get count
  const shotCount = await client.execute("SELECT COUNT(*) as c FROM opportunities WHERE market LIKE '%Shot%' AND sport = 'soccer'");
  console.log(`   Cleared ${shotCount.rows[0].c} shot opportunities`);

  // Now validate ALL unvalidated soccer player props
  console.log('\n2. Validating all soccer player props...');

  let totalValidated = 0;
  let totalFailed = 0;
  let batchNum = 0;

  while (true) {
    batchNum++;
    const opps = await client.execute({
      sql: `
        SELECT id, player_id, selection, market, line, home_team, away_team
        FROM opportunities
        WHERE sport = 'soccer'
          AND nba_validation_json IS NULL
          AND (market LIKE '%Player%' OR market LIKE '%Card%' OR market LIKE '%Shot%'
               OR market LIKE '%Goal%' OR market LIKE '%Assist%' OR market LIKE '%Foul%'
               OR market LIKE '%Tackle%' OR market LIKE '%Pass%')
        LIMIT 100
      `,
      args: [],
    });

    if (opps.rows.length === 0) break;

    console.log(`   Batch ${batchNum}: Processing ${opps.rows.length} opportunities...`);

    for (const opp of opps.rows) {
      const selection = opp.selection as string;
      const market = opp.market as string;
      const line = (opp.line as number) || 0.5;
      const homeTeam = opp.home_team as string;
      const awayTeam = opp.away_team as string;

      const playerName = extractPlayerName(selection);
      if (!playerName) {
        await client.execute({ sql: `UPDATE opportunities SET nba_validation_json = '{"error":"no_player"}' WHERE id = ?`, args: [opp.id] });
        totalFailed++;
        continue;
      }

      // Map market to stat
      const m = market.toLowerCase();
      let statKey: string | null = null;
      if (m.includes('shot') && m.includes('target')) statKey = 'shots_on_target';
      else if (m.includes('shot')) statKey = 'shots';
      else if (m.includes('goal') && m.includes('assist')) statKey = 'goals';
      else if (m.includes('score') && m.includes('assist')) statKey = 'goals';
      else if (m.includes('goal')) statKey = 'goals';
      else if (m.includes('assist')) statKey = 'assists';
      else if (m.includes('tackle')) statKey = 'tackles';
      else if (m.includes('card')) statKey = 'yellow_cards';
      else if (m.includes('foul')) statKey = 'fouls';
      else if (m.includes('pass')) statKey = 'passes';

      if (!statKey) {
        await client.execute({ sql: `UPDATE opportunities SET nba_validation_json = '{"error":"unknown_market"}' WHERE id = ?`, args: [opp.id] });
        totalFailed++;
        continue;
      }

      const direction = selection.toLowerCase().includes('under') ? 'under' : 'over';

      // Find player
      let cachedPlayer = await getSoccerPlayerByName(playerName, homeTeam);
      if (!cachedPlayer) cachedPlayer = await getSoccerPlayerByName(playerName, awayTeam);
      if (!cachedPlayer) cachedPlayer = await getSoccerPlayerByName(playerName);

      if (!cachedPlayer) {
        await client.execute({ sql: `UPDATE opportunities SET nba_validation_json = '{"error":"player_not_found"}' WHERE id = ?`, args: [opp.id] });
        totalFailed++;
        continue;
      }

      // Calculate hit rate
      const result = await calculateSoccerHitRate(cachedPlayer.id, statKey, line, direction, 10);

      if (!result) {
        await client.execute({ sql: `UPDATE opportunities SET nba_validation_json = '{"error":"no_stats"}' WHERE id = ?`, args: [opp.id] });
        totalFailed++;
        continue;
      }

      // Store validation
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

      await client.execute({
        sql: `UPDATE opportunities SET nba_validation_json = ? WHERE id = ?`,
        args: [JSON.stringify(validation), opp.id],
      });

      totalValidated++;
    }

    console.log(`      Done. Total: ${totalValidated} validated, ${totalFailed} failed`);
  }

  console.log('\n' + '='.repeat(60));
  console.log(`✅ Complete! Validated: ${totalValidated}, Failed: ${totalFailed}`);

  client.close();
}

main().catch(console.error);
