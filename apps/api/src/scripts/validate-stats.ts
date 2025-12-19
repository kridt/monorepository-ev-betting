/**
 * Stats Validator Script
 *
 * Validates that:
 * 1. Basketball opportunities have validation stats from OpticOdds
 * 2. Soccer opportunities correctly show no stats (OpticOdds doesn't support soccer)
 * 3. Stats data is accurate by cross-checking with OpticOdds API
 */

import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../db/schema.js';
import { desc, eq, isNotNull } from 'drizzle-orm';
import { config } from '../config.js';

// Create database connection for validator (WAL mode allows concurrent reads)
const client = createClient({
  url: `file:${config.dbPath}`,
});
const db = drizzle(client, { schema });

interface ValidationResult {
  opportunityId: string;
  sport: string;
  market: string;
  playerName: string | null;
  selection: string;
  line: number | null;
  hasValidation: boolean;
  validationData: {
    hitRate: number;
    matchesChecked: number;
    avgValue: number;
    hits: number;
  } | null;
  status: 'PASS' | 'FAIL' | 'WARNING' | 'SKIPPED';
  message: string;
}

interface CrossCheckResult {
  opportunityId: string;
  playerName: string;
  market: string;
  line: number;
  storedValidation: {
    hitRate: number;
    matchesChecked: number;
    avgValue: number;
  };
  freshValidation: {
    hitRate: number;
    matchesChecked: number;
    avgValue: number;
  } | null;
  match: boolean;
  message: string;
}

// OpticOdds API helpers
const OPTIC_ODDS_BASE = 'https://api.opticodds.com/api/v3';

async function fetchFromOpticOdds(endpoint: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`${OPTIC_ODDS_BASE}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.append(key, value));

  const response = await fetch(url.toString(), {
    headers: {
      'X-Api-Key': config.opticOddsApiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`OpticOdds API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function searchPlayer(name: string, sport: string): Promise<{ id: string; name: string } | null> {
  try {
    // Use /players endpoint with name filter (matches opticOddsStatsClient)
    const data = await fetchFromOpticOdds('/players', {
      name,
      sport,
    });

    if (data.data && data.data.length > 0) {
      // Try exact match first
      const searchLower = name.toLowerCase().trim();
      let match = data.data.find((p: any) => p.name?.toLowerCase() === searchLower);

      // Try contains match
      if (!match) {
        match = data.data.find((p: any) =>
          p.name?.toLowerCase().includes(searchLower) ||
          searchLower.includes(p.name?.toLowerCase())
        );
      }

      if (match) {
        return {
          id: match.id,
          name: match.name,
        };
      }
    }
    return null;
  } catch (error) {
    console.error(`[Validator] Error searching player ${name}:`, error);
    return null;
  }
}

async function getPlayerStats(
  playerId: string,
  market: string,
  numGames: number = 10
): Promise<{ games: any[]; avgValue: number } | null> {
  try {
    const data = await fetchFromOpticOdds('/fixtures/player-results/last-x', {
      player_id: playerId,
      num_games: numGames.toString(),
    });

    if (!data.data || data.data.length === 0) {
      return null;
    }

    // Map market to stat key
    const marketToStat: Record<string, string> = {
      'player_points_over_under': 'points',
      'player_rebounds_over_under': 'rebounds',
      'player_assists_over_under': 'assists',
      'player_threes_over_under': 'three_pointers_made',
      'player_steals_over_under': 'steals',
      'player_blocks_over_under': 'blocks',
      'player_turnovers_over_under': 'turnovers',
      'player_pra_over_under': 'pra',
      'player_pr_over_under': 'pr',
      'player_pa_over_under': 'pa',
      'player_ra_over_under': 'ra',
    };

    const statKey = marketToStat[market] || market.replace('player_', '').replace('_over_under', '');

    const games = data.data;
    let values: number[] = [];

    for (const game of games) {
      let value: number | null = null;

      // Handle combined stats
      if (statKey === 'pra') {
        value = (game.points || 0) + (game.rebounds || 0) + (game.assists || 0);
      } else if (statKey === 'pr') {
        value = (game.points || 0) + (game.rebounds || 0);
      } else if (statKey === 'pa') {
        value = (game.points || 0) + (game.assists || 0);
      } else if (statKey === 'ra') {
        value = (game.rebounds || 0) + (game.assists || 0);
      } else if (game[statKey] !== undefined) {
        value = game[statKey];
      }

      if (value !== null) {
        values.push(value);
      }
    }

    if (values.length === 0) {
      return null;
    }

    const avgValue = values.reduce((a, b) => a + b, 0) / values.length;

    return {
      games: data.data,
      avgValue: Math.round(avgValue * 10) / 10,
    };
  } catch (error) {
    console.error(`[Validator] Error getting player stats:`, error);
    return null;
  }
}

function calculateHitRate(
  games: any[],
  market: string,
  line: number,
  direction: 'over' | 'under'
): { hits: number; total: number; hitRate: number } {
  const marketToStat: Record<string, string> = {
    'player_points_over_under': 'points',
    'player_rebounds_over_under': 'rebounds',
    'player_assists_over_under': 'assists',
    'player_threes_over_under': 'three_pointers_made',
    'player_steals_over_under': 'steals',
    'player_blocks_over_under': 'blocks',
    'player_turnovers_over_under': 'turnovers',
    'player_pra_over_under': 'pra',
    'player_pr_over_under': 'pr',
    'player_pa_over_under': 'pa',
    'player_ra_over_under': 'ra',
  };

  const statKey = marketToStat[market] || market.replace('player_', '').replace('_over_under', '');

  let hits = 0;
  let total = 0;

  for (const game of games) {
    let value: number | null = null;

    if (statKey === 'pra') {
      value = (game.points || 0) + (game.rebounds || 0) + (game.assists || 0);
    } else if (statKey === 'pr') {
      value = (game.points || 0) + (game.rebounds || 0);
    } else if (statKey === 'pa') {
      value = (game.points || 0) + (game.assists || 0);
    } else if (statKey === 'ra') {
      value = (game.rebounds || 0) + (game.assists || 0);
    } else if (game[statKey] !== undefined) {
      value = game[statKey];
    }

    if (value !== null) {
      total++;
      const hit = direction === 'over' ? value > line : value < line;
      if (hit) hits++;
    }
  }

  return {
    hits,
    total,
    hitRate: total > 0 ? Math.round((hits / total) * 100) : 0,
  };
}

function isPlayerProp(market: string): boolean {
  const m = market.toLowerCase();

  // Exclude team/match-level markets
  if (m.includes('total points') ||
      m.includes('total_points') ||
      m.includes('1st half') ||
      m.includes('2nd half') ||
      m.includes('1st_half') ||
      m.includes('2nd_half') ||
      m.includes('quarter') ||
      m.includes('spread') ||
      m.includes('moneyline') ||
      m.includes('money_line') ||
      m.includes('handicap')) {
    return false;
  }

  // Player props start with "player_" or "Player "
  return m.startsWith('player_') ||
    m.startsWith('player ') ||
    (m.includes('player') && (
      m.includes('points') ||
      m.includes('rebounds') ||
      m.includes('assists') ||
      m.includes('steals') ||
      m.includes('blocks') ||
      m.includes('threes') ||
      m.includes('turnovers') ||
      m.includes('pra')
    ));
}

function extractPlayerName(selection: string, playerName?: string | null): string | null {
  if (playerName) return playerName;
  const match = selection.match(/^(.+?)\s+(over|under)\s+[\d.]+$/i);
  return match ? match[1].trim() : null;
}

async function validateOpportunities(): Promise<{
  results: ValidationResult[];
  summary: {
    total: number;
    basketball: { total: number; withStats: number; withoutStats: number };
    soccer: { total: number; correctlyNoStats: number; unexpectedStats: number };
    passed: number;
    failed: number;
    warnings: number;
    skipped: number;
  };
}> {
  console.log('\n========================================');
  console.log('    STATS VALIDATOR - Checking All Opportunities');
  console.log('========================================\n');

  // Fetch recent opportunities
  const opportunities = await db.query.opportunities.findMany({
    orderBy: [desc(schema.opportunities.createdAt)],
    limit: 100,
  });

  console.log(`[Validator] Found ${opportunities.length} opportunities to check\n`);

  const results: ValidationResult[] = [];
  const summary = {
    total: opportunities.length,
    basketball: { total: 0, withStats: 0, withoutStats: 0 },
    soccer: { total: 0, correctlyNoStats: 0, unexpectedStats: 0 },
    passed: 0,
    failed: 0,
    warnings: 0,
    skipped: 0,
  };

  for (const opp of opportunities) {
    const isBasketball = opp.sport.toLowerCase().includes('basket');
    const isSoccer = opp.sport.toLowerCase().includes('soccer') || opp.sport.toLowerCase().includes('football');
    const isPlayerMarket = isPlayerProp(opp.market);

    // Parse validation JSON
    let validationData: any = null;
    if (opp.nbaValidationJson) {
      try {
        validationData = typeof opp.nbaValidationJson === 'string'
          ? JSON.parse(opp.nbaValidationJson)
          : opp.nbaValidationJson;
      } catch (e) {
        // Invalid JSON
      }
    }

    const result: ValidationResult = {
      opportunityId: opp.id,
      sport: opp.sport,
      market: opp.market,
      playerName: opp.playerName,
      selection: opp.selection,
      line: opp.line,
      hasValidation: !!validationData,
      validationData: validationData ? {
        hitRate: validationData.hitRate,
        matchesChecked: validationData.matchesChecked,
        avgValue: validationData.avgValue,
        hits: validationData.hits,
      } : null,
      status: 'SKIPPED',
      message: '',
    };

    if (isBasketball) {
      summary.basketball.total++;

      if (isPlayerMarket && opp.line !== null) {
        if (validationData) {
          summary.basketball.withStats++;

          // Validate the data makes sense
          if (validationData.matchesChecked > 0 &&
              validationData.hitRate >= 0 && validationData.hitRate <= 100 &&
              validationData.avgValue >= 0) {
            result.status = 'PASS';
            result.message = `Basketball player prop has valid stats: ${validationData.hits}/${validationData.matchesChecked} (${validationData.hitRate}%), avg: ${validationData.avgValue}`;
            summary.passed++;
          } else {
            result.status = 'WARNING';
            result.message = `Basketball player prop has stats but values seem off`;
            summary.warnings++;
          }
        } else {
          summary.basketball.withoutStats++;
          result.status = 'FAIL';
          result.message = `Basketball player prop MISSING stats - should have validation data`;
          summary.failed++;
        }
      } else {
        // Non-player prop basketball (spread, moneyline, etc.)
        if (validationData) {
          summary.basketball.withStats++;
          result.status = 'PASS';
          result.message = `Basketball market has stats`;
          summary.passed++;
        } else {
          summary.basketball.withoutStats++;
          result.status = 'WARNING';
          result.message = `Basketball non-player market without stats (may be expected)`;
          summary.warnings++;
        }
      }
    } else if (isSoccer) {
      summary.soccer.total++;

      if (!validationData) {
        summary.soccer.correctlyNoStats++;
        result.status = 'PASS';
        result.message = `Soccer correctly has no stats (OpticOdds doesn't support soccer)`;
        summary.passed++;
      } else {
        summary.soccer.unexpectedStats++;
        result.status = 'WARNING';
        result.message = `Soccer unexpectedly HAS stats - verify source`;
        summary.warnings++;
      }
    } else {
      result.status = 'SKIPPED';
      result.message = `Unknown sport: ${opp.sport}`;
      summary.skipped++;
    }

    results.push(result);
  }

  return { results, summary };
}

async function crossCheckWithOpticOdds(limit: number = 5): Promise<CrossCheckResult[]> {
  console.log('\n========================================');
  console.log('    CROSS-CHECK - Verifying Against OpticOdds API');
  console.log('========================================\n');

  // Get basketball opportunities with validation
  const opportunities = await db.query.opportunities.findMany({
    where: isNotNull(schema.opportunities.nbaValidationJson),
    orderBy: [desc(schema.opportunities.createdAt)],
    limit: limit * 3, // Get more to filter
  });

  const basketballPlayerProps = opportunities.filter(opp => {
    const isBasketball = opp.sport.toLowerCase().includes('basket');
    const isPlayerMarket = isPlayerProp(opp.market);
    return isBasketball && isPlayerMarket && opp.line !== null;
  }).slice(0, limit);

  console.log(`[CrossCheck] Checking ${basketballPlayerProps.length} basketball player props against live API\n`);

  const results: CrossCheckResult[] = [];

  for (const opp of basketballPlayerProps) {
    const playerName = extractPlayerName(opp.selection, opp.playerName);
    if (!playerName) continue;

    let storedValidation: any;
    try {
      storedValidation = typeof opp.nbaValidationJson === 'string'
        ? JSON.parse(opp.nbaValidationJson)
        : opp.nbaValidationJson;
    } catch (e) {
      continue;
    }

    console.log(`[CrossCheck] Checking: ${playerName} - ${opp.market} ${opp.line}`);

    // Search for player in OpticOdds
    const player = await searchPlayer(playerName, 'basketball');
    if (!player) {
      console.log(`  -> Could not find player in OpticOdds`);
      results.push({
        opportunityId: opp.id,
        playerName,
        market: opp.market,
        line: opp.line!,
        storedValidation: {
          hitRate: storedValidation.hitRate,
          matchesChecked: storedValidation.matchesChecked,
          avgValue: storedValidation.avgValue,
        },
        freshValidation: null,
        match: false,
        message: 'Player not found in OpticOdds API',
      });
      continue;
    }

    // Get fresh stats
    const stats = await getPlayerStats(player.id, opp.market, 10);
    if (!stats) {
      console.log(`  -> No stats available from OpticOdds`);
      results.push({
        opportunityId: opp.id,
        playerName,
        market: opp.market,
        line: opp.line!,
        storedValidation: {
          hitRate: storedValidation.hitRate,
          matchesChecked: storedValidation.matchesChecked,
          avgValue: storedValidation.avgValue,
        },
        freshValidation: null,
        match: false,
        message: 'No stats available from OpticOdds API',
      });
      continue;
    }

    // Calculate hit rate
    const direction = opp.selection.toLowerCase().includes('over') ? 'over' : 'under';
    const hitCalc = calculateHitRate(stats.games, opp.market, opp.line!, direction);

    const freshValidation = {
      hitRate: hitCalc.hitRate,
      matchesChecked: hitCalc.total,
      avgValue: stats.avgValue,
    };

    // Compare stored vs fresh
    const hitRateMatch = Math.abs(storedValidation.hitRate - freshValidation.hitRate) <= 10; // 10% tolerance
    const avgMatch = Math.abs(storedValidation.avgValue - freshValidation.avgValue) <= 2; // 2 point tolerance
    const match = hitRateMatch && avgMatch;

    console.log(`  -> Stored: ${storedValidation.hitRate}% (avg ${storedValidation.avgValue})`);
    console.log(`  -> Fresh:  ${freshValidation.hitRate}% (avg ${freshValidation.avgValue})`);
    console.log(`  -> Match: ${match ? 'YES' : 'NO'}\n`);

    results.push({
      opportunityId: opp.id,
      playerName,
      market: opp.market,
      line: opp.line!,
      storedValidation: {
        hitRate: storedValidation.hitRate,
        matchesChecked: storedValidation.matchesChecked,
        avgValue: storedValidation.avgValue,
      },
      freshValidation,
      match,
      message: match
        ? 'Stats match within tolerance'
        : `Stats mismatch: hitRate diff=${Math.abs(storedValidation.hitRate - freshValidation.hitRate)}%, avg diff=${Math.abs(storedValidation.avgValue - freshValidation.avgValue)}`,
    });

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return results;
}

function printReport(
  validationResults: { results: ValidationResult[]; summary: any },
  crossCheckResults: CrossCheckResult[]
) {
  console.log('\n========================================');
  console.log('           VALIDATION REPORT');
  console.log('========================================\n');

  const { summary } = validationResults;

  console.log('SUMMARY:');
  console.log('--------');
  console.log(`Total Opportunities: ${summary.total}`);
  console.log(`  Passed:   ${summary.passed} (${Math.round(summary.passed / summary.total * 100)}%)`);
  console.log(`  Failed:   ${summary.failed} (${Math.round(summary.failed / summary.total * 100)}%)`);
  console.log(`  Warnings: ${summary.warnings} (${Math.round(summary.warnings / summary.total * 100)}%)`);
  console.log(`  Skipped:  ${summary.skipped}`);
  console.log('');

  console.log('BASKETBALL:');
  console.log(`  Total: ${summary.basketball.total}`);
  console.log(`  With Stats: ${summary.basketball.withStats}`);
  console.log(`  Without Stats: ${summary.basketball.withoutStats}`);
  if (summary.basketball.total > 0) {
    const coverage = Math.round(summary.basketball.withStats / summary.basketball.total * 100);
    console.log(`  Coverage: ${coverage}%`);
  }
  console.log('');

  console.log('SOCCER:');
  console.log(`  Total: ${summary.soccer.total}`);
  console.log(`  Correctly No Stats: ${summary.soccer.correctlyNoStats}`);
  console.log(`  Unexpected Stats: ${summary.soccer.unexpectedStats}`);
  console.log('');

  // Print failures
  const failures = validationResults.results.filter(r => r.status === 'FAIL');
  if (failures.length > 0) {
    console.log('FAILURES:');
    console.log('---------');
    failures.slice(0, 10).forEach(f => {
      console.log(`  [${f.sport}] ${f.playerName || f.selection}`);
      console.log(`    Market: ${f.market}, Line: ${f.line}`);
      console.log(`    Reason: ${f.message}`);
      console.log('');
    });
    if (failures.length > 10) {
      console.log(`  ... and ${failures.length - 10} more failures`);
    }
    console.log('');
  }

  // Print cross-check results
  if (crossCheckResults.length > 0) {
    console.log('CROSS-CHECK RESULTS:');
    console.log('--------------------');
    const matches = crossCheckResults.filter(r => r.match);
    const mismatches = crossCheckResults.filter(r => !r.match && r.freshValidation);
    const notFound = crossCheckResults.filter(r => !r.freshValidation);

    console.log(`  Matches: ${matches.length}/${crossCheckResults.length}`);
    console.log(`  Mismatches: ${mismatches.length}`);
    console.log(`  Not Found: ${notFound.length}`);
    console.log('');

    if (mismatches.length > 0) {
      console.log('  Mismatched Stats:');
      mismatches.forEach(m => {
        console.log(`    ${m.playerName} - ${m.market} ${m.line}`);
        console.log(`      Stored: ${m.storedValidation.hitRate}% avg ${m.storedValidation.avgValue}`);
        console.log(`      Fresh:  ${m.freshValidation!.hitRate}% avg ${m.freshValidation!.avgValue}`);
      });
    }
    console.log('');
  }

  // Overall status
  console.log('========================================');
  const overallPass = summary.failed === 0 &&
    crossCheckResults.filter(r => !r.match && r.freshValidation).length === 0;

  if (overallPass) {
    console.log('  STATUS: ✅ ALL CHECKS PASSED');
  } else {
    console.log('  STATUS: ❌ SOME CHECKS FAILED');
  }
  console.log('========================================\n');
}

async function main() {
  console.log('Starting Stats Validator...\n');

  try {
    // Run validation
    const validationResults = await validateOpportunities();

    // Run cross-check (limit to 5 to avoid rate limits)
    const crossCheckResults = await crossCheckWithOpticOdds(5);

    // Print report
    printReport(validationResults, crossCheckResults);

    process.exit(0);
  } catch (error) {
    console.error('Validator error:', error);
    process.exit(1);
  }
}

main();
