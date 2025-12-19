/**
 * Priority validation - validate specific players first, then process remaining
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

async function validateOpportunity(opp: any): Promise<boolean> {
  const selection = opp.selection as string;
  const market = opp.market as string;
  const line = (opp.line as number) || 0.5;
  const homeTeam = opp.home_team as string;
  const awayTeam = opp.away_team as string;

  const playerName = extractPlayerName(selection);
  if (!playerName) {
    await client.execute({ sql: `UPDATE opportunities SET nba_validation_json = '{"error":"no_player"}' WHERE id = ?`, args: [opp.id] });
    return false;
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
    return false;
  }

  const direction = selection.toLowerCase().includes('under') ? 'under' : 'over';

  // Find player
  let cachedPlayer = await getSoccerPlayerByName(playerName, homeTeam);
  if (!cachedPlayer) cachedPlayer = await getSoccerPlayerByName(playerName, awayTeam);
  if (!cachedPlayer) cachedPlayer = await getSoccerPlayerByName(playerName);

  if (!cachedPlayer) {
    await client.execute({ sql: `UPDATE opportunities SET nba_validation_json = '{"error":"player_not_found"}' WHERE id = ?`, args: [opp.id] });
    return false;
  }

  // Calculate hit rate
  const result = await calculateSoccerHitRate(cachedPlayer.id, statKey, line, direction, 10);

  if (!result) {
    await client.execute({ sql: `UPDATE opportunities SET nba_validation_json = '{"error":"no_stats"}' WHERE id = ?`, args: [opp.id] });
    return false;
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

  return true;
}

async function main() {
  console.log('🎯 PRIORITY VALIDATION - Bowen & Haaland first');
  console.log('='.repeat(60));

  // First: Get and validate Bowen and Haaland shot opportunities
  const priority = await client.execute(`
    SELECT id, selection, market, line, home_team, away_team
    FROM opportunities
    WHERE (selection LIKE '%Bowen%' OR selection LIKE '%Haaland%')
      AND market LIKE '%Shot%'
      AND sport = 'soccer'
  `);

  console.log(`\n1. Processing ${priority.rows.length} priority opportunities (Bowen & Haaland)...`);

  let validated = 0;
  let failed = 0;

  for (const opp of priority.rows) {
    const success = await validateOpportunity(opp);
    if (success) {
      validated++;
      console.log(`   ✓ ${opp.selection}`);
    } else {
      failed++;
      console.log(`   ✗ ${opp.selection}`);
    }
  }

  console.log(`\n   Priority done: ${validated} validated, ${failed} failed`);

  // Now process remaining unvalidated opportunities in batches
  console.log('\n2. Processing remaining unvalidated opportunities...');

  let totalValidated = validated;
  let totalFailed = failed;
  let batchNum = 0;

  while (true) {
    batchNum++;
    const opps = await client.execute({
      sql: `
        SELECT id, selection, market, line, home_team, away_team
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

    console.log(`   Batch ${batchNum}: Processing ${opps.rows.length}...`);

    for (const opp of opps.rows) {
      const success = await validateOpportunity(opp);
      if (success) totalValidated++;
      else totalFailed++;
    }

    console.log(`      Total: ${totalValidated} validated, ${totalFailed} failed`);
  }

  console.log('\n' + '='.repeat(60));
  console.log(`✅ COMPLETE! Validated: ${totalValidated}, Failed: ${totalFailed}`);

  client.close();
}

main().catch(console.error);
