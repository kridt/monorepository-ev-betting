import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function check() {
  // Find Richarlison
  const player = await client.execute("SELECT id, name, team_name, games_played, avg_shots_on_target FROM soccer_players WHERE name LIKE '%Richarlison%'");

  if (player.rows.length === 0) {
    console.log('Richarlison not found in database');
    return;
  }

  const p = player.rows[0];
  console.log('Player:', p.name);
  console.log('Team:', p.team_name);
  console.log('Games Played:', p.games_played);
  console.log('Avg Shots On Target:', p.avg_shots_on_target);
  console.log('');

  // Get game-by-game shots on target
  const games = await client.execute({
    sql: "SELECT game_date, opponent, is_home, shots_on_target, shots, goals FROM soccer_player_game_stats WHERE player_id = ? ORDER BY game_date DESC",
    args: [p.id],
  });

  console.log('Game-by-Game Shots On Target:');
  console.log('='.repeat(60));

  let totalSOT = 0;
  games.rows.forEach(g => {
    const loc = g.is_home ? 'H' : 'A';
    totalSOT += (g.shots_on_target as number) || 0;
    console.log(`  ${g.game_date} | ${loc} vs ${g.opponent} | SOT: ${g.shots_on_target} | Shots: ${g.shots} | Goals: ${g.goals}`);
  });

  console.log('='.repeat(60));
  console.log(`Total Shots On Target: ${totalSOT} in ${games.rows.length} games`);
  console.log(`Average: ${(totalSOT / games.rows.length).toFixed(2)} per game`);

  // Count games with 1+ SOT
  const gamesWithSOT = games.rows.filter(g => (g.shots_on_target as number) >= 1).length;
  console.log(`Games with 1+ SOT: ${gamesWithSOT}/${games.rows.length} (${(gamesWithSOT/games.rows.length*100).toFixed(0)}%)`);

  client.close();
}

check().catch(console.error);
