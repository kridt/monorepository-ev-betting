import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function check() {
  const player = await client.execute("SELECT id, name, team_name, avg_shots FROM soccer_players WHERE name LIKE '%Richarlison%'");
  const p = player.rows[0];

  console.log('Player:', p.name);
  console.log('Team:', p.team_name);
  console.log('Avg Shots:', p.avg_shots);
  console.log('');

  const games = await client.execute({
    sql: 'SELECT game_date, opponent, is_home, shots, shots_on_target, goals FROM soccer_player_game_stats WHERE player_id = ? ORDER BY game_date DESC',
    args: [p.id],
  });

  console.log('Game-by-Game SHOTS:');
  console.log('='.repeat(70));

  let totalShots = 0;
  games.rows.forEach(g => {
    const loc = g.is_home ? 'H' : 'A';
    totalShots += (g.shots as number) || 0;
    console.log(`  ${g.game_date} | ${loc} vs ${String(g.opponent).padEnd(22)} | Shots: ${g.shots} | SOT: ${g.shots_on_target} | Goals: ${g.goals}`);
  });

  console.log('='.repeat(70));
  console.log(`Total Shots: ${totalShots} in ${games.rows.length} games`);
  console.log(`Average: ${(totalShots / games.rows.length).toFixed(2)} per game`);

  const with1 = games.rows.filter(g => (g.shots as number) >= 1).length;
  const with2 = games.rows.filter(g => (g.shots as number) >= 2).length;
  const with3 = games.rows.filter(g => (g.shots as number) >= 3).length;

  console.log('');
  console.log(`Over 0.5 shots: ${with1}/${games.rows.length} (${(with1/games.rows.length*100).toFixed(0)}%)`);
  console.log(`Over 1.5 shots: ${with2}/${games.rows.length} (${(with2/games.rows.length*100).toFixed(0)}%)`);
  console.log(`Over 2.5 shots: ${with3}/${games.rows.length} (${(with3/games.rows.length*100).toFixed(0)}%)`);

  client.close();
}

check().catch(console.error);
