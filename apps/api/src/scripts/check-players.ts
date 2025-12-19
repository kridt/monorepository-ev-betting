import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function check() {
  // Search for Jacob Murphy
  const murphy = await client.execute("SELECT id, name, team_name, games_played FROM soccer_players WHERE name LIKE '%Murphy%'");
  console.log('Jacob Murphy search:');
  murphy.rows.forEach(r => console.log('  ', r.name, '|', r.team_name, '| Games:', r.games_played));

  // Search for Acheampong
  const josh = await client.execute("SELECT id, name, team_name, games_played FROM soccer_players WHERE name LIKE '%Acheampong%'");
  console.log('\nAcheampong search:');
  josh.rows.forEach(r => console.log('  ', r.name, '|', r.team_name, '| Games:', r.games_played));

  // Check if we have yellow card stats for Murphy
  const murphyStats = await client.execute("SELECT player_id, yellow_cards, game_date FROM soccer_player_game_stats WHERE player_id IN (SELECT id FROM soccer_players WHERE name LIKE '%Murphy%') ORDER BY game_date DESC LIMIT 5");
  console.log('\nMurphy yellow card stats (last 5 games):');
  murphyStats.rows.forEach(r => console.log('  Date:', r.game_date, '| Yellow Cards:', r.yellow_cards));

  // Check opportunities with validation
  const oppsWithValidation = await client.execute("SELECT COUNT(*) as count FROM opportunities WHERE sport = 'soccer' AND nbaValidationJson IS NOT NULL");
  console.log('\nSoccer opportunities with validation:', oppsWithValidation.rows[0].count);

  const oppsWithoutValidation = await client.execute("SELECT COUNT(*) as count FROM opportunities WHERE sport = 'soccer' AND nbaValidationJson IS NULL");
  console.log('Soccer opportunities without validation:', oppsWithoutValidation.rows[0].count);

  client.close();
}

check().catch(console.error);
