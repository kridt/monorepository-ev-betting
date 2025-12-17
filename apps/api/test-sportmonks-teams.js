// Test script to explore SportMonks API for team/match statistics
import 'dotenv/config';

const API_KEY = process.env.SPORTMONKS_API_KEY;
const BASE_URL = 'https://api.sportmonks.com/v3/football';

async function fetchAPI(endpoint, params = {}) {
  const url = new URL(`${BASE_URL}${endpoint}`);
  url.searchParams.set('api_token', API_KEY);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString());

  if (!response.ok) {
    console.error(`Error: ${response.status} - ${endpoint}`);
    return null;
  }

  const data = await response.json();
  return data.data;
}

async function main() {
  console.log('=== SportMonks API Deep Research for All Markets ===\n');

  // Get recent fixtures with more data
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  console.log('Step 1: Get fixtures with all statistics...');
  const fixtures = await fetchAPI(`/fixtures/between/${startDate}/${endDate}`, {
    include: 'participants;scores;statistics',
    per_page: '100'
  });

  if (!fixtures || fixtures.length === 0) {
    console.error('No fixtures found');
    return;
  }

  console.log(`Found ${fixtures.length} fixtures`);

  // Find completed fixtures
  const completedFixtures = fixtures.filter(f => f.state_id === 5);
  console.log(`Completed fixtures: ${completedFixtures.length}`);

  // Group by league
  const byLeague = {};
  for (const f of completedFixtures) {
    if (!byLeague[f.league_id]) byLeague[f.league_id] = [];
    byLeague[f.league_id].push(f);
  }
  console.log('Leagues found:', Object.keys(byLeague).join(', '));

  // Analyze a fixture with full stats
  const fixtureWithStats = completedFixtures.find(f => f.statistics && f.statistics.length > 20);

  if (fixtureWithStats) {
    console.log(`\n=== Analyzing: ${fixtureWithStats.name} ===`);

    // Get full fixture details
    const full = await fetchAPI(`/fixtures/${fixtureWithStats.id}`, {
      include: 'participants;scores;statistics;periods'
    });

    if (full) {
      console.log('\n--- SCORES ---');
      const scoreTypes = {};
      for (const score of full.scores || []) {
        const team = full.participants?.find(p => p.id === score.participant_id);
        console.log(`  ${score.description} (type ${score.type_id}): ${team?.name} = ${score.score?.goals}`);
        scoreTypes[score.description] = score.type_id;
      }
      console.log('\nScore type reference:', scoreTypes);

      console.log('\n--- STATISTICS ---');
      // Collect all stat types
      const allStatTypes = {};
      for (const stat of full.statistics || []) {
        const value = stat.data?.value ?? stat.value?.total ?? stat.value;
        if (!allStatTypes[stat.type_id]) {
          allStatTypes[stat.type_id] = {
            count: 0,
            hasPeriod: false,
            sample: value
          };
        }
        allStatTypes[stat.type_id].count++;
        if (stat.period_id) allStatTypes[stat.type_id].hasPeriod = true;
      }

      console.log(`\nAll stat type IDs (${Object.keys(allStatTypes).length} types):`);
      for (const [typeId, info] of Object.entries(allStatTypes)) {
        console.log(`  Type ${typeId}: ${info.count} entries, hasPeriod: ${info.hasPeriod}, sample: ${info.sample}`);
      }

      // Print key stats with team names
      console.log('\n--- KEY STATISTICS ---');
      const keyStats = [
        [34, 'Corners'],
        [52, 'Goals'],
        [56, 'Fouls'],
        [42, 'Total Shots'],
        [86, 'Shots on Target'],
        [41, 'Shots Off Target'],
        [84, 'Yellow Cards'],
        [83, 'Red Cards'],
        [45, 'Ball Possession'],
        [51, 'Offsides'],
        [57, 'Saves'],
        [58, 'Blocked Shots'],
        [80, 'Passes'],
        [116, 'Accurate Passes']
      ];

      for (const [typeId, name] of keyStats) {
        const stats = full.statistics?.filter(s => s.type_id === typeId);
        if (stats && stats.length > 0) {
          const values = stats.map(s => {
            const team = full.participants?.find(p => p.id === s.participant_id);
            const value = s.data?.value ?? s.value?.total ?? s.value;
            return `${team?.name?.slice(0, 12) || s.participant_id}: ${value}`;
          });
          console.log(`  ${name}: ${values.join(' | ')}`);
        }
      }

      // Check periods
      console.log('\n--- PERIODS ---');
      if (full.periods && full.periods.length > 0) {
        for (const period of full.periods) {
          console.log(`  ID ${period.id}: ${period.description} (type ${period.type_id})`);
        }
      } else {
        console.log('  No periods data');
      }
    }
  }

  // Step 2: Check if half-time stats are available anywhere
  console.log('\n\n=== Step 2: Looking for Half-Time Statistics ===');

  // Try different includes
  const testFixture = completedFixtures[0];
  if (testFixture) {
    console.log(`\nTesting with: ${testFixture.name}`);

    // Try with periods include
    const withPeriods = await fetchAPI(`/fixtures/${testFixture.id}`, {
      include: 'statistics.period'
    });

    if (withPeriods?.statistics) {
      const periodsInStats = [...new Set(withPeriods.statistics.map(s => s.period_id))];
      console.log(`Periods in statistics: ${periodsInStats.join(', ')}`);
    }
  }

  // Step 3: Calculate what we CAN validate
  console.log('\n\n=== Step 3: Validation Capabilities ===');
  console.log('\nBased on available data, we can validate:');
  console.log('');
  console.log('PLAYER PROPS (via player fixture stats):');
  console.log('  ✓ Player Goals');
  console.log('  ✓ Player Assists');
  console.log('  ✓ Player Shots');
  console.log('  ✓ Player Shots on Target');
  console.log('  ✓ Player Goals + Assists');
  console.log('  ✓ Anytime Goal Scorer');
  console.log('');
  console.log('TEAM/MATCH PROPS (via fixture statistics):');
  console.log('  ✓ Total Goals (from scores)');
  console.log('  ✓ Total Corners (stat type 34)');
  console.log('  ✓ Team Corners (stat type 34)');
  console.log('  ✓ Total Cards (stat types 84, 83)');
  console.log('  ✓ BTTS (from scores)');
  console.log('  ✓ Total Shots (stat type 42)');
  console.log('');
  console.log('HALF-SPECIFIC (scores have 1ST_HALF, 2ND_HALF types):');
  console.log('  ✓ 1st Half Total Goals (score type 1)');
  console.log('  ✓ 2nd Half Total Goals (score type 2 or 48996)');
  console.log('  ~ 1st Half Corners - NOT directly available (stats are full-match only)');
  console.log('  ~ 2nd Half Corners - NOT directly available');

  console.log('\n=== Research Complete ===');
}

main().catch(console.error);
