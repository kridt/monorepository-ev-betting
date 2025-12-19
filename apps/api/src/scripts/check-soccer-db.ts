/**
 * Check soccer database and get Tottenham player stats
 */

import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function main() {
  console.log('='.repeat(60));
  console.log('Soccer Database Check');
  console.log('='.repeat(60));

  // Check table counts
  console.log('\n📊 Table Counts:');

  const tables = [
    'soccer_leagues',
    'soccer_teams',
    'soccer_players',
    'soccer_player_game_stats',
    'player_id_mapping',
  ];

  for (const table of tables) {
    try {
      const result = await client.execute(`SELECT COUNT(*) as count FROM ${table}`);
      console.log(`  ${table}: ${result.rows[0].count}`);
    } catch (e) {
      console.log(`  ${table}: Error - ${(e as Error).message}`);
    }
  }

  // Check leagues
  console.log('\n🏆 Leagues in DB:');
  const leagues = await client.execute(`SELECT id, name, current_season_id FROM soccer_leagues LIMIT 10`);
  leagues.rows.forEach((l: any) => {
    console.log(`  - ${l.name} (ID: ${l.id}, Season: ${l.current_season_id})`);
  });

  // Check teams
  console.log('\n⚽ Teams in DB:');
  const teams = await client.execute(`SELECT id, name, league_id FROM soccer_teams LIMIT 10`);
  teams.rows.forEach((t: any) => {
    console.log(`  - ${t.name} (ID: ${t.id}, League: ${t.league_id})`);
  });

  // Find any team with players
  console.log('\n🔍 Looking for teams with players...');
  const teamsWithPlayers = await client.execute(`
    SELECT DISTINCT t.id, t.name FROM soccer_teams t
    INNER JOIN soccer_players p ON p.team_id = t.id
  `);

  // Find Tottenham
  const tottenham = await client.execute(`
    SELECT * FROM soccer_teams
    WHERE LOWER(name) LIKE '%tottenham%' OR LOWER(name) LIKE '%spurs%'
  `);

  if (tottenham.rows.length === 0) {
    console.log('  Tottenham not found yet (cache still building)');

    // Use first available team with players instead
    if (teamsWithPlayers.rows.length > 0) {
      const availableTeam = teamsWithPlayers.rows[0] as any;
      console.log(`  Using available team instead: ${availableTeam.name}`);

      const teamId = availableTeam.id;

      // Get players
      console.log(`\n👤 ${availableTeam.name} Players:`);
      const players = await client.execute(`
        SELECT id, name, position, games_played, avg_goals, avg_assists, avg_shots_on_target
        FROM soccer_players
        WHERE team_id = ${teamId}
        ORDER BY games_played DESC
        LIMIT 10
      `);

      players.rows.forEach((p: any) => {
        console.log(`  - ${p.name} (${p.position || 'N/A'}) - ${p.games_played} games`);
        console.log(`    Avg: ${p.avg_goals?.toFixed(2) || 0} goals, ${p.avg_assists?.toFixed(2) || 0} assists, ${p.avg_shots_on_target?.toFixed(2) || 0} SOT`);
      });

      // Get random player detailed stats
      if (players.rows.length > 0) {
        const randomPlayer = players.rows[Math.floor(Math.random() * players.rows.length)] as any;
        console.log(`\n📈 Player Deep Dive: ${randomPlayer.name}`);

        const playerDetail = await client.execute(`
          SELECT * FROM soccer_players WHERE id = ${randomPlayer.id}
        `);

        if (playerDetail.rows.length > 0) {
          const p = playerDetail.rows[0] as any;
          console.log(`  Team: ${p.team_name}`);
          console.log(`  Position: ${p.position}`);
          console.log(`  Games Played: ${p.games_played}`);
          console.log('\n  Season Averages:');
          console.log(`    Shots: ${p.avg_shots?.toFixed(2) || 'N/A'}`);
          console.log(`    Shots on Target: ${p.avg_shots_on_target?.toFixed(2) || 'N/A'}`);
          console.log(`    Goals: ${p.avg_goals?.toFixed(2) || 'N/A'}`);
          console.log(`    Assists: ${p.avg_assists?.toFixed(2) || 'N/A'}`);
          console.log(`    Passes: ${p.avg_passes?.toFixed(2) || 'N/A'}`);
          console.log(`    Tackles: ${p.avg_tackles?.toFixed(2) || 'N/A'}`);
          console.log('\n  Last 5 Games:');
          console.log(`    Shots: ${p.last5_shots?.toFixed(2) || 'N/A'}`);
          console.log(`    Goals: ${p.last5_goals?.toFixed(2) || 'N/A'}`);
          console.log(`    Assists: ${p.last5_assists?.toFixed(2) || 'N/A'}`);
          console.log('\n  Home/Away Splits:');
          console.log(`    Home Goals: ${p.home_goals?.toFixed(2) || 'N/A'}`);
          console.log(`    Away Goals: ${p.away_goals?.toFixed(2) || 'N/A'}`);

          // Get recent games
          console.log('\n  Recent Games:');
          const games = await client.execute(`
            SELECT game_date, opponent, goals, assists, shots_on_target, shots, passes, tackles, minutes
            FROM soccer_player_game_stats
            WHERE player_id = ${randomPlayer.id}
            ORDER BY game_date DESC
            LIMIT 5
          `);

          games.rows.forEach((g: any) => {
            console.log(`    ${g.game_date} vs ${g.opponent}`);
            console.log(`      ${g.goals}G ${g.assists}A | ${g.shots}S ${g.shots_on_target}SOT | ${g.passes}P ${g.tackles}T | ${g.minutes}'`);
          });
        }
      }
    } else {
      console.log('  No teams with players cached yet.');
    }
  } else {
    const teamId = tottenham.rows[0].id;
    console.log(`  Found: ${tottenham.rows[0].name} (ID: ${teamId})`);

    // Get Tottenham players
    console.log('\n👤 Tottenham Players:');
    const players = await client.execute(`
      SELECT id, name, position, games_played, avg_goals, avg_assists, avg_shots_on_target
      FROM soccer_players
      WHERE team_id = ${teamId}
      ORDER BY games_played DESC
      LIMIT 10
    `);

    if (players.rows.length === 0) {
      console.log('  No players found for Tottenham yet.');
    } else {
      players.rows.forEach((p: any) => {
        console.log(`  - ${p.name} (${p.position || 'N/A'}) - ${p.games_played} games`);
        console.log(`    Avg: ${p.avg_goals?.toFixed(2) || 0} goals, ${p.avg_assists?.toFixed(2) || 0} assists, ${p.avg_shots_on_target?.toFixed(2) || 0} SOT`);
      });

      // Get random player detailed stats
      const randomPlayer = players.rows[Math.floor(Math.random() * players.rows.length)] as any;
      console.log(`\n📈 Random Player Deep Dive: ${randomPlayer.name}`);

      const playerDetail = await client.execute(`
        SELECT * FROM soccer_players WHERE id = ${randomPlayer.id}
      `);

      if (playerDetail.rows.length > 0) {
        const p = playerDetail.rows[0] as any;
        console.log(`  Team: ${p.team_name}`);
        console.log(`  Position: ${p.position}`);
        console.log(`  Games Played: ${p.games_played}`);
        console.log('\n  Season Averages:');
        console.log(`    Shots: ${p.avg_shots?.toFixed(2) || 'N/A'}`);
        console.log(`    Shots on Target: ${p.avg_shots_on_target?.toFixed(2) || 'N/A'}`);
        console.log(`    Goals: ${p.avg_goals?.toFixed(2) || 'N/A'}`);
        console.log(`    Assists: ${p.avg_assists?.toFixed(2) || 'N/A'}`);
        console.log(`    Passes: ${p.avg_passes?.toFixed(2) || 'N/A'}`);
        console.log(`    Tackles: ${p.avg_tackles?.toFixed(2) || 'N/A'}`);
        console.log('\n  Last 5 Games:');
        console.log(`    Shots: ${p.last5_shots?.toFixed(2) || 'N/A'}`);
        console.log(`    Goals: ${p.last5_goals?.toFixed(2) || 'N/A'}`);
        console.log(`    Assists: ${p.last5_assists?.toFixed(2) || 'N/A'}`);
        console.log('\n  Home/Away Splits:');
        console.log(`    Home Goals: ${p.home_goals?.toFixed(2) || 'N/A'}`);
        console.log(`    Away Goals: ${p.away_goals?.toFixed(2) || 'N/A'}`);

        // Get recent games
        console.log('\n  Recent Games:');
        const games = await client.execute(`
          SELECT game_date, opponent, goals, assists, shots_on_target, minutes
          FROM soccer_player_game_stats
          WHERE player_id = ${randomPlayer.id}
          ORDER BY game_date DESC
          LIMIT 5
        `);

        games.rows.forEach((g: any) => {
          console.log(`    ${g.game_date} vs ${g.opponent}: ${g.goals}G ${g.assists}A ${g.shots_on_target}SOT (${g.minutes}')`);
        });
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  client.close();
}

main().catch(console.error);
