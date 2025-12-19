import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function check() {
  // Check Nathan Collins
  const nathan = await client.execute("SELECT id, name, team_name, games_played FROM soccer_players WHERE name LIKE '%Collins%' OR name LIKE '%Nathan%'");
  console.log('Nathan Collins search:');
  nathan.rows.forEach(r => console.log('  ', r.name, '|', r.team_name, '| Games:', r.games_played));

  // Check Jhon Arias
  const jhon = await client.execute("SELECT id, name, team_name, games_played FROM soccer_players WHERE name LIKE '%Arias%' OR name LIKE '%Jhon%'");
  console.log('\nJhon Arias search:');
  jhon.rows.forEach(r => console.log('  ', r.name, '|', r.team_name, '| Games:', r.games_played));

  // Check unvalidated opportunities for these players
  const unvalidated = await client.execute("SELECT selection, home_team, away_team FROM opportunities WHERE sport = 'soccer' AND nba_validation_json IS NULL AND (selection LIKE '%Collins%' OR selection LIKE '%Arias%') LIMIT 10");
  console.log('\nUnvalidated opportunities for Collins/Arias:');
  unvalidated.rows.forEach(r => console.log('  ', r.selection, '|', r.home_team, 'vs', r.away_team));

  // Total unvalidated soccer player props
  const totalUnvalidated = await client.execute("SELECT COUNT(*) as c FROM opportunities WHERE sport = 'soccer' AND nba_validation_json IS NULL AND (market LIKE '%Player%' OR market LIKE '%Card%' OR market LIKE '%Shot%' OR market LIKE '%Goal%' OR market LIKE '%Assist%' OR market LIKE '%Foul%' OR market LIKE '%Tackle%')");
  console.log('\nTotal unvalidated soccer player props:', totalUnvalidated.rows[0].c);

  client.close();
}

check().catch(console.error);
