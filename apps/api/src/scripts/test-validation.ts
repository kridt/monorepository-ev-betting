/**
 * Comprehensive Validation System Test
 *
 * This script tests the accuracy of the statistics and validation system using OpticOdds:
 * 1. NBA player props validation (points, rebounds, assists, etc.)
 * 2. NBA spread/moneyline validation
 * 3. Soccer player props validation (shots, goals, assists, etc.)
 * 4. Hit rate calculation accuracy
 */

import {
  searchPlayer,
  searchTeam,
  getPlayerLastXStats,
  getTeamLastXResults,
  validatePlayerProp,
  validateSpreadBet,
  validateMoneylineBet,
  validateBTTS,
  validateTotalGoals,
  type PlayerSearchResult,
  type TeamSearchResult,
  type ValidationResult,
} from '../services/opticOddsStatsClient.js';

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
  data?: unknown;
}

const results: TestResult[] = [];

function log(message: string) {
  console.log(`\n${'='.repeat(60)}\n${message}\n${'='.repeat(60)}`);
}

function logTest(name: string, passed: boolean, details: string, data?: unknown) {
  const status = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`\n${status}: ${name}`);
  console.log(`   ${details}`);
  if (data) {
    console.log(`   Data:`, JSON.stringify(data, null, 2).split('\n').map(l => '   ' + l).join('\n'));
  }
  results.push({ name, passed, details, data });
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// TEST 1: NBA Player Search
// ============================================================================
async function testPlayerSearch() {
  log('TEST 1: NBA Player Search');

  const testCases = [
    { input: 'LeBron James', sport: 'basketball' as const },
    { input: 'Stephen Curry', sport: 'basketball' as const },
    { input: 'Jayson Tatum', sport: 'basketball' as const },
    { input: 'Luka Doncic', sport: 'basketball' as const },
    { input: 'Giannis Antetokounmpo', sport: 'basketball' as const },
  ];

  for (const tc of testCases) {
    const player = await searchPlayer(tc.input, tc.sport);
    const passed = player !== null;
    logTest(
      `Search: ${tc.input}`,
      passed,
      player ? `Found: ${player.name} (Team: ${player.team?.name || 'Unknown'})` : 'Not found',
      player ? { id: player.id, team: player.team?.name } : null
    );
    await sleep(300);
  }
}

// ============================================================================
// TEST 2: Player Game Stats Retrieval
// ============================================================================
async function testPlayerGameStats() {
  log('TEST 2: Player Game Stats Retrieval');

  // Test with a known player
  const player = await searchPlayer('LeBron James', 'basketball');
  if (!player) {
    logTest('Get LeBron Stats', false, 'Could not find LeBron James');
    return;
  }

  const stats = await getPlayerLastXStats(player.id, 10);

  // Verify we got stats
  const hasStats = stats.length > 0;
  logTest(
    'Get Player Stats',
    hasStats,
    `Retrieved ${stats.length} games for LeBron James`,
    stats.length > 0 ? {
      latestPoints: stats[0]?.points,
      latestRebounds: stats[0]?.rebounds,
      latestAssists: stats[0]?.assists,
    } : null
  );

  // Verify stats have valid values
  if (stats.length > 0) {
    const hasValidValues = stats.every(s =>
      typeof s.points === 'number' && s.points >= 0 &&
      typeof s.rebounds === 'number' && s.rebounds >= 0 &&
      typeof s.assists === 'number' && s.assists >= 0
    );
    logTest(
      'Stats Have Valid Values',
      hasValidValues,
      `All ${stats.length} games have valid pts/reb/ast values`
    );
  }
}

// ============================================================================
// TEST 3: Player Props Validation - Hit Rate Calculation
// ============================================================================
async function testPlayerPropsValidation() {
  log('TEST 3: Player Props Validation - Hit Rate Calculation');

  // Test LeBron James points over/under
  const player = await searchPlayer('LeBron James', 'basketball');
  if (!player) {
    logTest('LeBron Points Validation', false, 'Could not find player');
    return;
  }

  const lebronPoints = await validatePlayerProp(
    player.id,
    player.name,
    'player_points',
    25.5,
    'over',
    'basketball',
    20
  );

  if (lebronPoints) {
    // Manually verify hit rate
    const manualHits = lebronPoints.recentGames.filter(g => g.hit).length;
    const calculatedHitRate = Math.round((manualHits / lebronPoints.matchesChecked) * 100);
    const hitRateMatches = calculatedHitRate === lebronPoints.hitRate;

    logTest(
      'LeBron Points Over 25.5 - Hit Rate',
      hitRateMatches,
      `Calculated: ${calculatedHitRate}%, API: ${lebronPoints.hitRate}%, Hits: ${lebronPoints.hits}/${lebronPoints.matchesChecked}`,
      {
        avgValue: lebronPoints.avgValue,
        recentGames: lebronPoints.recentGames.slice(0, 5).map(g => ({
          date: g.date,
          value: g.value,
          hit: g.hit
        }))
      }
    );

    // Verify hit logic is correct
    const hitLogicCorrect = lebronPoints.recentGames.every(g =>
      (g.value > 25.5) === g.hit
    );
    logTest(
      'LeBron Points - Hit Logic Correct',
      hitLogicCorrect,
      `All ${lebronPoints.matchesChecked} games have correct hit/miss calculation`
    );
  } else {
    logTest('LeBron Points Validation', false, 'Failed to get validation data');
  }

  await sleep(500);

  // Test Stephen Curry threes
  const curryPlayer = await searchPlayer('Stephen Curry', 'basketball');
  if (curryPlayer) {
    const curryThrees = await validatePlayerProp(
      curryPlayer.id,
      curryPlayer.name,
      'player_threes',
      4.5,
      'over',
      'basketball',
      20
    );

    if (curryThrees) {
      const manualHits = curryThrees.recentGames.filter(g => g.hit).length;
      const calculatedHitRate = Math.round((manualHits / curryThrees.matchesChecked) * 100);

      logTest(
        'Curry 3PM Over 4.5 - Hit Rate',
        calculatedHitRate === curryThrees.hitRate,
        `Calculated: ${calculatedHitRate}%, API: ${curryThrees.hitRate}%, Hits: ${curryThrees.hits}/${curryThrees.matchesChecked}`,
        {
          avgValue: curryThrees.avgValue,
          last5: curryThrees.recentGames.slice(0, 5).map(g => g.value)
        }
      );
    }
  }

  await sleep(500);

  // Test combined props (PRA)
  const tatumPlayer = await searchPlayer('Jayson Tatum', 'basketball');
  if (tatumPlayer) {
    const tatumPRA = await validatePlayerProp(
      tatumPlayer.id,
      tatumPlayer.name,
      'player_pts_reb_ast',
      40.5,
      'over',
      'basketball',
      20
    );

    if (tatumPRA) {
      logTest(
        'Tatum PRA Over 40.5',
        tatumPRA.matchesChecked >= 10,
        `${tatumPRA.hits}/${tatumPRA.matchesChecked} (${tatumPRA.hitRate}%), Avg: ${tatumPRA.avgValue}`,
        {
          last5: tatumPRA.recentGames.slice(0, 5).map(g => ({ date: g.date, value: g.value, hit: g.hit }))
        }
      );
    }
  }
}

// ============================================================================
// TEST 4: Team Search
// ============================================================================
async function testTeamSearch() {
  log('TEST 4: Team Search');

  const testCases = [
    { input: 'Atlanta Hawks', sport: 'basketball' as const },
    { input: 'Boston Celtics', sport: 'basketball' as const },
    { input: 'Los Angeles Lakers', sport: 'basketball' as const },
    { input: 'Golden State Warriors', sport: 'basketball' as const },
  ];

  for (const tc of testCases) {
    const team = await searchTeam(tc.input, tc.sport);
    logTest(
      `Team Search: ${tc.input}`,
      team !== null,
      team ? `Found: ${team.name} (ID: ${team.id})` : 'Not found'
    );
    await sleep(200);
  }
}

// ============================================================================
// TEST 5: Team Games Retrieval
// ============================================================================
async function testTeamGames() {
  log('TEST 5: Team Games Retrieval');

  const team = await searchTeam('Boston Celtics', 'basketball');
  if (!team) {
    logTest('Get Celtics Games', false, 'Could not find Boston Celtics');
    return;
  }

  const games = await getTeamLastXResults(team.id, 20);

  logTest(
    'Get Team Games',
    games.length >= 10,
    `Retrieved ${games.length} games for Boston Celtics`,
    games.length > 0 ? {
      latestGame: games[0]?.fixtureDate,
      teamScore: games[0]?.teamScore,
      opponentScore: games[0]?.opponentScore,
      opponent: games[0]?.opponent,
      margin: games[0]?.margin,
    } : null
  );

  // Verify games have valid scores
  if (games.length > 0) {
    const hasValidScores = games.every(g =>
      typeof g.teamScore === 'number' && g.teamScore >= 0 &&
      typeof g.opponentScore === 'number' && g.opponentScore >= 0
    );
    logTest(
      'Games Have Valid Scores',
      hasValidScores,
      `All ${games.length} games have valid scores`
    );
  }
}

// ============================================================================
// TEST 6: Spread Validation - Margin Calculation
// ============================================================================
async function testSpreadValidation() {
  log('TEST 6: Spread Validation - Margin Calculation');

  // Test a team that should have positive margin (good team)
  const team = await searchTeam('Boston Celtics', 'basketball');
  if (!team) {
    logTest('Celtics Spread Validation', false, 'Could not find team');
    return;
  }

  const celticsSpread = await validateSpreadBet(team.id, team.name, 5.5, 'over', 20);

  if (celticsSpread) {
    logTest(
      'Celtics Spread -5.5 Over - Validation',
      celticsSpread.matchesChecked >= 10,
      `Hits: ${celticsSpread.hits}/${celticsSpread.matchesChecked} (${celticsSpread.hitRate}%), Avg Margin: ${celticsSpread.avgValue}`,
      {
        recentGames: celticsSpread.recentGames.slice(0, 5).map(g => ({
          date: g.date,
          opponent: g.opponent,
          margin: g.value,
          covered: g.hit
        }))
      }
    );
  } else {
    logTest('Celtics Spread Validation', false, 'Failed to get validation data');
  }

  await sleep(500);

  // Test moneyline
  const lakersTeam = await searchTeam('Los Angeles Lakers', 'basketball');
  if (lakersTeam) {
    const lakersML = await validateMoneylineBet(lakersTeam.id, lakersTeam.name, 20);

    if (lakersML) {
      logTest(
        'Lakers Moneyline - Win Rate',
        lakersML.matchesChecked >= 10,
        `Win rate: ${lakersML.hitRate}%`,
        {
          wins: lakersML.hits,
          games: lakersML.matchesChecked,
          last5: lakersML.recentGames.slice(0, 5).map(g => ({
            date: g.date,
            won: g.hit
          }))
        }
      );
    }
  }
}

// ============================================================================
// TEST 7: Soccer Player Props
// ============================================================================
async function testSoccerPlayerProps() {
  log('TEST 7: Soccer Player Props');

  // Test a known soccer player
  const player = await searchPlayer('Mohamed Salah', 'soccer');
  if (!player) {
    logTest('Soccer Player Search', false, 'Could not find Mohamed Salah');
    return;
  }

  logTest(
    'Soccer Player Search: Mohamed Salah',
    true,
    `Found: ${player.name} (Team: ${player.team?.name || 'Unknown'})`
  );

  await sleep(300);

  // Test shots validation
  const shotsValidation = await validatePlayerProp(
    player.id,
    player.name,
    'player_shots',
    2.5,
    'over',
    'soccer',
    10
  );

  if (shotsValidation) {
    logTest(
      'Salah Shots Over 2.5',
      shotsValidation.matchesChecked >= 5,
      `${shotsValidation.hits}/${shotsValidation.matchesChecked} (${shotsValidation.hitRate}%), Avg: ${shotsValidation.avgValue}`,
      {
        recentGames: shotsValidation.recentGames.slice(0, 5).map(g => ({
          date: g.date,
          value: g.value,
          hit: g.hit
        }))
      }
    );
  } else {
    logTest('Salah Shots Validation', false, 'Failed to get validation data (may not have enough data)');
  }

  await sleep(300);

  // Test shots on target
  const sotValidation = await validatePlayerProp(
    player.id,
    player.name,
    'player_shots_on_target',
    1.5,
    'over',
    'soccer',
    10
  );

  if (sotValidation) {
    logTest(
      'Salah SOT Over 1.5',
      sotValidation.matchesChecked >= 5,
      `${sotValidation.hits}/${sotValidation.matchesChecked} (${sotValidation.hitRate}%), Avg: ${sotValidation.avgValue}`
    );
  }
}

// ============================================================================
// TEST 8: Soccer Team Markets (BTTS, Total Goals)
// ============================================================================
async function testSoccerTeamMarkets() {
  log('TEST 8: Soccer Team Markets');

  const homeTeam = await searchTeam('Liverpool', 'soccer');
  const awayTeam = await searchTeam('Manchester City', 'soccer');

  if (!homeTeam || !awayTeam) {
    logTest('Soccer Teams Search', false, 'Could not find Liverpool or Manchester City');
    return;
  }

  logTest(
    'Soccer Teams Found',
    true,
    `Home: ${homeTeam.name}, Away: ${awayTeam.name}`
  );

  await sleep(300);

  // Test BTTS
  const bttsResult = await validateBTTS(homeTeam.id, awayTeam.id, 'yes', 10);
  if (bttsResult) {
    logTest(
      'BTTS Validation',
      true,
      `Home BTTS Rate: ${bttsResult.homeRate}%, Away BTTS Rate: ${bttsResult.awayRate}%, Combined: ${bttsResult.combinedRate}%`
    );
  } else {
    logTest('BTTS Validation', false, 'Failed to get BTTS data');
  }

  await sleep(300);

  // Test Total Goals
  const totalGoals = await validateTotalGoals(homeTeam.id, awayTeam.id, 2.5, 'over', 10);
  if (totalGoals) {
    logTest(
      'Total Goals Over 2.5 Validation',
      true,
      `Hit Rate: ${totalGoals.hitRate}%, Avg Total Goals: ${totalGoals.avgTotal}`
    );
  } else {
    logTest('Total Goals Validation', false, 'Failed to get total goals data');
  }
}

// ============================================================================
// TEST 9: Edge Cases
// ============================================================================
async function testEdgeCases() {
  log('TEST 9: Edge Cases');

  // Test player that doesn't exist
  const fakePlayer = await searchPlayer('Fake Player Name XYZ', 'basketball');
  logTest(
    'Non-existent Player',
    fakePlayer === null,
    fakePlayer ? `Unexpectedly found: ${fakePlayer.name}` : 'Correctly returned null'
  );

  await sleep(300);

  // Test team that doesn't exist
  const fakeTeam = await searchTeam('Fake Team XYZ', 'basketball');
  logTest(
    'Non-existent Team',
    fakeTeam === null,
    fakeTeam ? `Unexpectedly found: ${fakeTeam.name}` : 'Correctly returned null'
  );
}

// ============================================================================
// TEST 10: Statistical Sanity Checks
// ============================================================================
async function testStatisticalSanity() {
  log('TEST 10: Statistical Sanity Checks');

  const player = await searchPlayer('LeBron James', 'basketball');
  if (!player) {
    logTest('Statistical Sanity', false, 'Could not find player');
    return;
  }

  // Test that setting a very low line results in high hit rate for "over"
  const lowLine = await validatePlayerProp(player.id, player.name, 'player_points', 5.5, 'over', 'basketball', 20);
  if (lowLine) {
    logTest(
      'Low Line = High Hit Rate',
      lowLine.hitRate >= 80,
      `LeBron over 5.5 points: ${lowLine.hitRate}% (should be very high)`
    );
  }

  await sleep(500);

  // Test that setting a very high line results in low hit rate for "over"
  const highLine = await validatePlayerProp(player.id, player.name, 'player_points', 50.5, 'over', 'basketball', 20);
  if (highLine) {
    logTest(
      'High Line = Low Hit Rate',
      highLine.hitRate <= 20,
      `LeBron over 50.5 points: ${highLine.hitRate}% (should be very low)`
    );
  }

  await sleep(500);

  // Test that "under" is inverse of "over"
  const over25 = await validatePlayerProp(player.id, player.name, 'player_points', 25.5, 'over', 'basketball', 20);
  await sleep(300);
  const under25 = await validatePlayerProp(player.id, player.name, 'player_points', 25.5, 'under', 'basketball', 20);

  if (over25 && under25) {
    const sumTo100 = Math.abs((over25.hitRate + under25.hitRate) - 100) <= 1;
    logTest(
      'Over + Under = 100%',
      sumTo100,
      `Over: ${over25.hitRate}% + Under: ${under25.hitRate}% = ${over25.hitRate + under25.hitRate}%`
    );
  }
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  console.log('\n' + '🏀⚽'.repeat(15));
  console.log('\n   COMPREHENSIVE VALIDATION SYSTEM TEST (OpticOdds)');
  console.log('\n' + '🏀⚽'.repeat(15));

  const startTime = Date.now();

  try {
    await testPlayerSearch();
    await testPlayerGameStats();
    await testPlayerPropsValidation();
    await testTeamSearch();
    await testTeamGames();
    await testSpreadValidation();
    await testSoccerPlayerProps();
    await testSoccerTeamMarkets();
    await testEdgeCases();
    await testStatisticalSanity();
  } catch (error) {
    console.error('\n❌ FATAL ERROR:', error);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('                    TEST SUMMARY');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  console.log(`\n   Total Tests: ${total}`);
  console.log(`   ✅ Passed:   ${passed}`);
  console.log(`   ❌ Failed:   ${failed}`);
  console.log(`   Success Rate: ${((passed / total) * 100).toFixed(1)}%`);
  console.log(`   Time Elapsed: ${elapsed}s`);

  if (failed > 0) {
    console.log('\n   Failed Tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`   - ${r.name}: ${r.details}`);
    });
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

main().catch(console.error);
