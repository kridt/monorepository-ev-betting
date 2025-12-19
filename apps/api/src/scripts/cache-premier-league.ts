/**
 * Quick League Cache
 * Caches a specific league's teams/players with faster rate limiting
 * Usage: npx tsx src/scripts/cache-premier-league.ts [leagueId] [leagueName]
 */

import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { createClient } from '@libsql/client';

const API_KEY = process.env.SPORTMONKS_API_KEY;
const BASE_URL = 'https://api.sportmonks.com/v3/football';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

// Faster rate limiting for single league (0.8s between requests)
const MIN_DELAY = 800;
let lastRequest = 0;

async function fetchAPI<T>(endpoint: string, params: Record<string, string> = {}): Promise<T | null> {
  const now = Date.now();
  const wait = MIN_DELAY - (now - lastRequest);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequest = Date.now();

  const url = new URL(`${BASE_URL}${endpoint}`);
  url.searchParams.set('api_token', API_KEY!);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json() as { data: T };
    return data.data;
  } catch {
    return null;
  }
}

// Stat type IDs from SportMonks
const STAT_IDS: Record<string, number> = {
  shots: 41, shotsOnTarget: 86, goals: 52, assists: 79,
  passes: 80, keyPasses: 117, tackles: 78, interceptions: 100,
  clearances: 99, blocks: 97, saves: 57, fouls: 56,
  foulsDrawn: 107, dribbles: 109, duels: 105, duelsWon: 106,
  aerialDuels: 108, aerialDuelsWon: 175, touches: 250,
  yellowCards: 84, redCards: 83, minutes: 119, rating: 118,
};

function extractStats(details: any[]): Record<string, number> {
  const stats: Record<string, number> = {};
  if (!details) return stats;

  for (const d of details) {
    for (const [name, id] of Object.entries(STAT_IDS)) {
      if (d.type_id === id) stats[name] = d.data?.value || 0;
    }
  }
  return stats;
}

function avg(arr: number[]): number | null {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}

async function main() {
  console.log('🏆 Premier League Quick Cache');
  console.log('='.repeat(50));

  const PREMIER_LEAGUE_ID = 8;
  const SEASON_ID = 23614; // 2024/2025 season

  // Get current season
  console.log('\n📅 Getting current season...');
  const league = await fetchAPI<any>(`/leagues/${PREMIER_LEAGUE_ID}`, { include: 'currentSeason' });
  const seasonId = league?.currentseason?.id || SEASON_ID;
  console.log(`  Season ID: ${seasonId}`);

  // Get teams
  console.log('\n⚽ Fetching Premier League teams...');
  const teams = await fetchAPI<any[]>(`/teams/seasons/${seasonId}`, { per_page: '50' });

  if (!teams || teams.length === 0) {
    console.log('  No teams found!');
    return;
  }

  console.log(`  Found ${teams.length} teams`);

  let totalPlayers = 0;
  let totalGames = 0;

  for (let i = 0; i < teams.length; i++) {
    const team = teams[i];
    console.log(`\n[${i + 1}/${teams.length}] ${team.name}`);

    // Save team
    await client.execute({
      sql: `INSERT OR REPLACE INTO soccer_teams (id, name, short_code, country_id, league_id, image_path, last_updated)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      args: [team.id, team.name, team.short_code, team.country_id, PREMIER_LEAGUE_ID, team.image_path],
    });

    // Get squad
    const squad = await fetchAPI<any[]>(`/squads/teams/${team.id}`, { include: 'player' });
    if (!squad) {
      console.log(`  ⚠️ No squad data`);
      continue;
    }

    console.log(`  👥 ${squad.length} players`);

    for (const entry of squad) {
      const playerId = entry.player_id || entry.id;
      const player = entry.player || entry;
      const playerName = player.display_name || player.common_name ||
        [player.firstname, player.lastname].filter(Boolean).join(' ') || 'Unknown';

      // Get player lineups (games)
      const playerData = await fetchAPI<any>(`/players/${playerId}`, {
        include: 'lineups.fixture.participants;lineups.details',
      });

      if (!playerData?.lineups?.length) continue;

      // Filter to current season
      const now = new Date();
      const seasonStart = new Date(now.getFullYear(), 7, 1); // Aug 1

      const games = playerData.lineups
        .filter((l: any) => {
          if (!l.fixture?.starting_at) return false;
          const date = new Date(l.fixture.starting_at);
          return date >= seasonStart && date < now;
        })
        .sort((a: any, b: any) =>
          new Date(b.fixture.starting_at).getTime() - new Date(a.fixture.starting_at).getTime()
        )
        .slice(0, 20);

      if (games.length === 0) continue;

      // Process each game
      const gameStats: any[] = [];

      for (const lineup of games) {
        const fixture = lineup.fixture;
        const stats = extractStats(lineup.details);

        // Find opponent
        let opponent = '';
        let opponentId = 0;
        let isHome = false;

        if (fixture.participants?.length >= 2) {
          const home = fixture.participants.find((p: any) => p.meta?.location === 'home');
          const away = fixture.participants.find((p: any) => p.meta?.location === 'away');

          if (lineup.team_id === home?.id) {
            isHome = true;
            opponent = away?.name || '';
            opponentId = away?.id || 0;
          } else {
            opponent = home?.name || '';
            opponentId = home?.id || 0;
          }
        }

        const gameData = {
          fixtureId: fixture.id,
          gameDate: fixture.starting_at?.split('T')[0] || '',
          opponent,
          opponentId,
          isHome,
          ...stats,
        };

        gameStats.push(gameData);

        // Insert game
        try {
          await client.execute({
            sql: `INSERT OR IGNORE INTO soccer_player_game_stats
                  (player_id, fixture_id, game_date, opponent, opponent_id, is_home, league_id,
                   minutes, shots, shots_on_target, goals, assists, passes, key_passes,
                   tackles, interceptions, clearances, blocks, saves, fouls, fouls_drawn,
                   dribbles, duels, duels_won, aerial_duels, aerial_duels_won, touches,
                   yellow_cards, red_cards, rating)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              playerId, gameData.fixtureId, gameData.gameDate, opponent, opponentId,
              isHome ? 1 : 0, PREMIER_LEAGUE_ID,
              stats.minutes || 0, stats.shots || 0, stats.shotsOnTarget || 0,
              stats.goals || 0, stats.assists || 0, stats.passes || 0, stats.keyPasses || 0,
              stats.tackles || 0, stats.interceptions || 0, stats.clearances || 0,
              stats.blocks || 0, stats.saves || 0, stats.fouls || 0, stats.foulsDrawn || 0,
              stats.dribbles || 0, stats.duels || 0, stats.duelsWon || 0,
              stats.aerialDuels || 0, stats.aerialDuelsWon || 0, stats.touches || 0,
              stats.yellowCards || 0, stats.redCards || 0, stats.rating || null,
            ],
          });
          totalGames++;
        } catch {}
      }

      if (gameStats.length === 0) continue;

      // Calculate averages
      const allGames = gameStats;
      const last5 = gameStats.slice(0, 5);
      const last10 = gameStats.slice(0, 10);
      const homeGames = gameStats.filter(g => g.isHome);
      const awayGames = gameStats.filter(g => !g.isHome);

      const position = entry.position_id === 24 ? 'GK' :
                       entry.position_id === 25 ? 'DEF' :
                       entry.position_id === 26 ? 'MID' : 'FWD';

      // Insert/update player
      await client.execute({
        sql: `INSERT OR REPLACE INTO soccer_players
              (id, name, display_name, common_name, first_name, last_name,
               team_id, team_name, league_id, league_name, position_id, position,
               image_path, date_of_birth,
               avg_shots, avg_shots_on_target, avg_goals, avg_assists, avg_passes,
               avg_key_passes, avg_tackles, avg_interceptions, avg_clearances, avg_blocks,
               avg_fouls, avg_fouls_drawn, avg_dribbles, avg_duels_won, avg_touches, avg_minutes,
               last5_shots, last5_shots_on_target, last5_goals, last5_assists, last5_passes, last5_tackles,
               last10_shots, last10_shots_on_target, last10_goals, last10_assists, last10_passes, last10_tackles,
               home_shots, home_shots_on_target, home_goals, home_assists,
               away_shots, away_shots_on_target, away_goals, away_assists,
               games_played, home_games, away_games, total_goals, total_assists,
               last_game_date, last_updated)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                      ?, ?, ?, ?, ?, ?, ?, ?,
                      ?, ?, ?, ?, ?, ?, datetime('now'))`,
        args: [
          playerId, playerName, player.display_name, player.common_name,
          player.firstname, player.lastname, team.id, team.name,
          PREMIER_LEAGUE_ID, 'Premier League', entry.position_id, position,
          player.image_path, player.date_of_birth,
          // Averages
          avg(allGames.map(g => g.shots || 0)),
          avg(allGames.map(g => g.shotsOnTarget || 0)),
          avg(allGames.map(g => g.goals || 0)),
          avg(allGames.map(g => g.assists || 0)),
          avg(allGames.map(g => g.passes || 0)),
          avg(allGames.map(g => g.keyPasses || 0)),
          avg(allGames.map(g => g.tackles || 0)),
          avg(allGames.map(g => g.interceptions || 0)),
          avg(allGames.map(g => g.clearances || 0)),
          avg(allGames.map(g => g.blocks || 0)),
          avg(allGames.map(g => g.fouls || 0)),
          avg(allGames.map(g => g.foulsDrawn || 0)),
          avg(allGames.map(g => g.dribbles || 0)),
          avg(allGames.map(g => g.duelsWon || 0)),
          avg(allGames.map(g => g.touches || 0)),
          avg(allGames.map(g => g.minutes || 0)),
          // Last 5
          avg(last5.map(g => g.shots || 0)),
          avg(last5.map(g => g.shotsOnTarget || 0)),
          avg(last5.map(g => g.goals || 0)),
          avg(last5.map(g => g.assists || 0)),
          avg(last5.map(g => g.passes || 0)),
          avg(last5.map(g => g.tackles || 0)),
          // Last 10
          avg(last10.map(g => g.shots || 0)),
          avg(last10.map(g => g.shotsOnTarget || 0)),
          avg(last10.map(g => g.goals || 0)),
          avg(last10.map(g => g.assists || 0)),
          avg(last10.map(g => g.passes || 0)),
          avg(last10.map(g => g.tackles || 0)),
          // Home/Away
          avg(homeGames.map(g => g.shots || 0)),
          avg(homeGames.map(g => g.shotsOnTarget || 0)),
          avg(homeGames.map(g => g.goals || 0)),
          avg(homeGames.map(g => g.assists || 0)),
          avg(awayGames.map(g => g.shots || 0)),
          avg(awayGames.map(g => g.shotsOnTarget || 0)),
          avg(awayGames.map(g => g.goals || 0)),
          avg(awayGames.map(g => g.assists || 0)),
          // Counts
          allGames.length, homeGames.length, awayGames.length,
          allGames.reduce((sum, g) => sum + (g.goals || 0), 0),
          allGames.reduce((sum, g) => sum + (g.assists || 0), 0),
          gameStats[0]?.gameDate || null,
        ],
      });

      totalPlayers++;
      process.stdout.write('.');
    }
    console.log(` ✅ ${totalPlayers} players cached`);
  }

  // Save league
  await client.execute({
    sql: `INSERT OR REPLACE INTO soccer_leagues (id, name, short_code, country_id, current_season_id, active, last_updated)
          VALUES (?, ?, ?, ?, ?, 1, datetime('now'))`,
    args: [PREMIER_LEAGUE_ID, 'Premier League', 'UK PL', 462, seasonId],
  });

  console.log('\n' + '='.repeat(50));
  console.log('✅ Premier League Cache Complete!');
  console.log(`   Teams: ${teams.length}`);
  console.log(`   Players: ${totalPlayers}`);
  console.log(`   Games: ${totalGames}`);
  console.log('='.repeat(50));

  client.close();
}

main().catch(console.error);
