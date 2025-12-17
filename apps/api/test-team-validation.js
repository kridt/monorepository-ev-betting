// Test script to debug team validation
import 'dotenv/config';

const API_KEY = process.env.SPORTMONKS_API_KEY;
const BASE_URL = 'https://api.sportmonks.com/v3/football';

async function fetchAPI(endpoint, params = {}) {
  const url = new URL(`${BASE_URL}${endpoint}`);
  url.searchParams.set('api_token', API_KEY);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  console.log('Fetching:', url.toString().replace(API_KEY, 'API_KEY').slice(0, 150) + '...');
  const response = await fetch(url.toString());

  if (!response.ok) {
    console.error(`Error: ${response.status} - ${endpoint}`);
    const text = await response.text();
    console.error('Response:', text.slice(0, 500));
    return null;
  }

  const data = await response.json();
  return data.data;
}

async function main() {
  console.log('=== Testing Team Validation ===\n');

  // Step 1: Search for team
  console.log('Step 1: Search for Manchester City...');
  const teams = await fetchAPI('/teams/search/Manchester%20City');

  if (!teams || teams.length === 0) {
    console.error('Team not found');
    return;
  }

  console.log(`Found ${teams.length} teams:`);
  for (const t of teams.slice(0, 5)) {
    console.log(`  - ID: ${t.id}, Name: ${t.name}, Short: ${t.short_code}`);
  }

  const team = teams[0];
  console.log(`\nUsing team: ${team.name} (ID: ${team.id})`);

  // Step 1b: Get team with seasons
  console.log('\nStep 1b: Get team with seasons...');
  const teamWithSeasons = await fetchAPI(`/teams/${team.id}`, {
    include: 'activeSeasons;currentSeason'
  });

  if (teamWithSeasons) {
    console.log('Team data:', JSON.stringify(teamWithSeasons, null, 2).slice(0, 1500));
    console.log('activeSeasons:', teamWithSeasons.activeSeasons);
    console.log('currentSeason:', teamWithSeasons.currentSeason);
  }

  // Step 2: Use Premier League season fixtures with date filter
  console.log('\nStep 2: Get recent Premier League fixtures for team...');

  // API limits to 100 days range, so use last 90 days
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Use a date range with league filter
  const PREMIER_LEAGUE_ID = 8;
  const fixtures = await fetchAPI(`/fixtures/between/${startDate}/${endDate}`, {
    include: 'participants;scores;statistics',
    filters: `fixtureLeagues:${PREMIER_LEAGUE_ID}`,
    per_page: '200'
  });

  let teamFixtures = [];
  if (fixtures && fixtures.length > 0) {
    console.log(`Found ${fixtures.length} Premier League fixtures in date range`);
    // Filter for team
    teamFixtures = fixtures.filter(f => {
      if (!f.participants) return false;
      return f.participants.some(p => p.id === team.id);
    });
    console.log(`Found ${teamFixtures.length} fixtures for ${team.name}`);
  }

  // Get completed fixtures
  let fixturesToAnalyze = teamFixtures
    .filter(f => f.state_id === 5)
    .sort((a, b) => new Date(b.starting_at).getTime() - new Date(a.starting_at).getTime())
    .slice(0, 10);

  console.log(`Got ${fixturesToAnalyze.length} completed fixtures with stats`);

  // Analyze first few fixtures
  for (const fixture of fixturesToAnalyze) {
    console.log(`\n--- Fixture: ${fixture.name} ---`);
    console.log(`ID: ${fixture.id}, Date: ${fixture.starting_at}`);
    console.log(`State: ${fixture.state_id} (5=finished)`);

    if (fixture.participants) {
      console.log('Participants:');
      for (const p of fixture.participants) {
        console.log(`  - ${p.name} (ID: ${p.id}), Location: ${p.meta?.location}`);
      }
    }

    if (fixture.scores && fixture.scores.length > 0) {
      console.log('Scores:');
      for (const s of fixture.scores.slice(0, 4)) {
        console.log(`  - ${s.description}: participant ${s.participant_id} = ${s.score?.goals}`);
      }
    }

    if (fixture.statistics && fixture.statistics.length > 0) {
      console.log(`Statistics (${fixture.statistics.length} total):`);
      // Group by type
      const byType = {};
      for (const stat of fixture.statistics) {
        const typeId = stat.type_id;
        if (!byType[typeId]) byType[typeId] = [];
        byType[typeId].push(stat);
      }

      // Show key stats
      const keyTypes = { 34: 'Corners', 42: 'Total Shots', 52: 'Goals' };
      for (const [typeId, name] of Object.entries(keyTypes)) {
        const stats = byType[typeId];
        if (stats) {
          console.log(`  Type ${typeId} (${name}):`);
          for (const s of stats) {
            // Log raw stat to see structure
            console.log(`    Raw stat: ${JSON.stringify(s).slice(0, 200)}`);
            const value = s.data?.value ?? (typeof s.value === 'object' ? s.value?.total : s.value);
            console.log(`    - participant/model ${s.participant_id || s.model_id || s.relation_id}: ${value}`);
          }
        }
      }
    } else {
      console.log('No statistics available');
    }
  }

  console.log('\n=== Test Complete ===');
}

main().catch(console.error);
