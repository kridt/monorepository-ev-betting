/**
 * Player Stats Cache Service
 *
 * Manages a local cache of NBA player stats from OpticOdds.
 * - Fetches and stores last 20 games per player
 * - Calculates averages, trends, and home/away splits
 * - Uses same player IDs as OpticOdds for easy lookups
 */

import { db, schema } from '../db/index.js';
import { eq, desc, sql, inArray } from 'drizzle-orm';
import { config } from '../config.js';

const BASE_URL = 'https://api.opticodds.com/api/v3';

// ============================================================================
// Types
// ============================================================================

interface OpticOddsPlayer {
  id: string;
  name: string;
  position?: string;
  number?: number;
  team?: {
    id: string;
    name: string;
  };
}

interface GameStats {
  fixtureId: string;
  gameDate: string;
  opponent: string;
  opponentId?: string;
  isHome: boolean;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  threes: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fgMade: number;
  fgAttempted: number;
  ftMade: number;
  ftAttempted: number;
}

interface PlayerAverages {
  avgPoints: number;
  avgRebounds: number;
  avgAssists: number;
  avgThrees: number;
  avgSteals: number;
  avgBlocks: number;
  avgTurnovers: number;
  avgMinutes: number;
  avgPRA: number;
  last5Points: number;
  last5Rebounds: number;
  last5Assists: number;
  last5Threes: number;
  last5PRA: number;
  last10Points: number;
  last10Rebounds: number;
  last10Assists: number;
  last10Threes: number;
  last10PRA: number;
  homePoints: number;
  homeRebounds: number;
  homeAssists: number;
  awayPoints: number;
  awayRebounds: number;
  awayAssists: number;
  gamesPlayed: number;
  homeGames: number;
  awayGames: number;
}

export interface CachedPlayer {
  id: string;
  name: string;
  team: string | null;
  avgPoints: number | null;
  avgRebounds: number | null;
  avgAssists: number | null;
  avgThrees: number | null;
  avgPRA: number | null;
  last5Points: number | null;
  last10Points: number | null;
  homePoints: number | null;
  awayPoints: number | null;
  gamesPlayed: number | null;
  lastGameDate: string | null;
  lastUpdated: string | null;
}

export interface CachedGameStats {
  gameDate: string;
  opponent: string | null;
  isHome: boolean | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  threes: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  pra: number | null;
}

// ============================================================================
// API Helpers
// ============================================================================

async function fetchFromOpticOdds<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });

  const response = await fetch(url.toString(), {
    headers: {
      'X-Api-Key': config.opticOddsApiKey,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpticOdds API error: ${response.status} - ${error}`);
  }

  return response.json() as Promise<T>;
}

// ============================================================================
// Fetch Functions
// ============================================================================

/**
 * Fetch all NBA players from OpticOdds
 */
export async function fetchAllNBAPlayers(): Promise<OpticOddsPlayer[]> {
  console.info('[PlayerCache] Fetching all NBA players from OpticOdds...');

  const response = await fetchFromOpticOdds<{ data: any[] }>('/players', {
    sport: 'basketball',
    league: 'nba',
  });

  const players: OpticOddsPlayer[] = (response.data || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    position: p.position,
    number: p.number,
    team: p.team ? { id: p.team.id, name: p.team.name } : undefined,
  }));

  console.info(`[PlayerCache] Found ${players.length} NBA players`);
  return players;
}

/**
 * Fetch last X games stats for a player
 */
export async function fetchPlayerStats(playerId: string, lastX: number = 20): Promise<GameStats[]> {
  try {
    const response = await fetchFromOpticOdds<{ data: any[] }>(
      '/fixtures/player-results/last-x',
      { player_id: playerId, last_x: lastX.toString() }
    );

    if (!response.data?.[0]?.stats) {
      return [];
    }

    const playerData = response.data[0];
    const stats = playerData.stats;
    const fixtures = playerData.fixtures || [];

    // Stats are returned as arrays where each index is a game
    const gameCount = stats.points?.length || 0;
    const games: GameStats[] = [];

    for (let i = 0; i < gameCount; i++) {
      const fixture = fixtures[i] || {};

      games.push({
        fixtureId: fixture.id || '',
        gameDate: fixture.start_date || new Date().toISOString().split('T')[0],
        opponent: fixture.opponent?.name || 'Unknown',
        opponentId: fixture.opponent?.id,
        isHome: fixture.is_home ?? false,
        minutes: stats.minutes?.[i] || 0,
        points: stats.points?.[i] || 0,
        rebounds: stats.total_rebounds?.[i] || 0,
        assists: stats.assists?.[i] || 0,
        threes: stats.three_point_field_goals_made?.[i] || 0,
        steals: stats.steals?.[i] || 0,
        blocks: stats.blocks?.[i] || 0,
        turnovers: stats.turnovers?.[i] || 0,
        fgMade: stats.field_goals_made?.[i] || 0,
        fgAttempted: stats.field_goals_attempted?.[i] || 0,
        ftMade: stats.free_throws_made?.[i] || 0,
        ftAttempted: stats.free_throws_attempted?.[i] || 0,
      });
    }

    return games;
  } catch (error) {
    console.error(`[PlayerCache] Error fetching stats for player ${playerId}:`, error);
    return [];
  }
}

// ============================================================================
// Calculation Functions
// ============================================================================

/**
 * Calculate averages and trends from game stats
 */
function calculateAverages(games: GameStats[]): PlayerAverages {
  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const round = (n: number) => Math.round(n * 10) / 10;

  // All games (up to 20)
  const allGames = games.slice(0, 20);
  const last10 = games.slice(0, 10);
  const last5 = games.slice(0, 5);
  const homeGames = allGames.filter(g => g.isHome);
  const awayGames = allGames.filter(g => !g.isHome);

  const pra = (g: GameStats) => g.points + g.rebounds + g.assists;

  return {
    avgPoints: round(avg(allGames.map(g => g.points))),
    avgRebounds: round(avg(allGames.map(g => g.rebounds))),
    avgAssists: round(avg(allGames.map(g => g.assists))),
    avgThrees: round(avg(allGames.map(g => g.threes))),
    avgSteals: round(avg(allGames.map(g => g.steals))),
    avgBlocks: round(avg(allGames.map(g => g.blocks))),
    avgTurnovers: round(avg(allGames.map(g => g.turnovers))),
    avgMinutes: round(avg(allGames.map(g => g.minutes))),
    avgPRA: round(avg(allGames.map(pra))),

    last5Points: round(avg(last5.map(g => g.points))),
    last5Rebounds: round(avg(last5.map(g => g.rebounds))),
    last5Assists: round(avg(last5.map(g => g.assists))),
    last5Threes: round(avg(last5.map(g => g.threes))),
    last5PRA: round(avg(last5.map(pra))),

    last10Points: round(avg(last10.map(g => g.points))),
    last10Rebounds: round(avg(last10.map(g => g.rebounds))),
    last10Assists: round(avg(last10.map(g => g.assists))),
    last10Threes: round(avg(last10.map(g => g.threes))),
    last10PRA: round(avg(last10.map(pra))),

    homePoints: round(avg(homeGames.map(g => g.points))),
    homeRebounds: round(avg(homeGames.map(g => g.rebounds))),
    homeAssists: round(avg(homeGames.map(g => g.assists))),

    awayPoints: round(avg(awayGames.map(g => g.points))),
    awayRebounds: round(avg(awayGames.map(g => g.rebounds))),
    awayAssists: round(avg(awayGames.map(g => g.assists))),

    gamesPlayed: allGames.length,
    homeGames: homeGames.length,
    awayGames: awayGames.length,
  };
}

// ============================================================================
// Database Functions
// ============================================================================

/**
 * Save or update a player in the cache
 */
async function savePlayer(
  player: OpticOddsPlayer,
  games: GameStats[],
  averages: PlayerAverages
): Promise<void> {
  const now = new Date().toISOString();
  const lastGameDate = games.length > 0 ? games[0].gameDate : null;

  // Upsert player
  await db
    .insert(schema.players)
    .values({
      id: player.id,
      name: player.name,
      team: player.team?.name || null,
      teamId: player.team?.id || null,
      position: player.position || null,
      jersey: player.number || null,
      league: 'nba',
      avgPoints: averages.avgPoints,
      avgRebounds: averages.avgRebounds,
      avgAssists: averages.avgAssists,
      avgThrees: averages.avgThrees,
      avgSteals: averages.avgSteals,
      avgBlocks: averages.avgBlocks,
      avgTurnovers: averages.avgTurnovers,
      avgMinutes: averages.avgMinutes,
      avgPRA: averages.avgPRA,
      last5Points: averages.last5Points,
      last5Rebounds: averages.last5Rebounds,
      last5Assists: averages.last5Assists,
      last5Threes: averages.last5Threes,
      last5PRA: averages.last5PRA,
      last10Points: averages.last10Points,
      last10Rebounds: averages.last10Rebounds,
      last10Assists: averages.last10Assists,
      last10Threes: averages.last10Threes,
      last10PRA: averages.last10PRA,
      homePoints: averages.homePoints,
      homeRebounds: averages.homeRebounds,
      homeAssists: averages.homeAssists,
      awayPoints: averages.awayPoints,
      awayRebounds: averages.awayRebounds,
      awayAssists: averages.awayAssists,
      gamesPlayed: averages.gamesPlayed,
      homeGames: averages.homeGames,
      awayGames: averages.awayGames,
      lastGameDate,
      lastUpdated: now,
    })
    .onConflictDoUpdate({
      target: schema.players.id,
      set: {
        name: player.name,
        team: player.team?.name || null,
        teamId: player.team?.id || null,
        position: player.position || null,
        jersey: player.number || null,
        avgPoints: averages.avgPoints,
        avgRebounds: averages.avgRebounds,
        avgAssists: averages.avgAssists,
        avgThrees: averages.avgThrees,
        avgSteals: averages.avgSteals,
        avgBlocks: averages.avgBlocks,
        avgTurnovers: averages.avgTurnovers,
        avgMinutes: averages.avgMinutes,
        avgPRA: averages.avgPRA,
        last5Points: averages.last5Points,
        last5Rebounds: averages.last5Rebounds,
        last5Assists: averages.last5Assists,
        last5Threes: averages.last5Threes,
        last5PRA: averages.last5PRA,
        last10Points: averages.last10Points,
        last10Rebounds: averages.last10Rebounds,
        last10Assists: averages.last10Assists,
        last10Threes: averages.last10Threes,
        last10PRA: averages.last10PRA,
        homePoints: averages.homePoints,
        homeRebounds: averages.homeRebounds,
        homeAssists: averages.homeAssists,
        awayPoints: averages.awayPoints,
        awayRebounds: averages.awayRebounds,
        awayAssists: averages.awayAssists,
        gamesPlayed: averages.gamesPlayed,
        homeGames: averages.homeGames,
        awayGames: averages.awayGames,
        lastGameDate,
        lastUpdated: now,
      },
    });

  // Delete old game stats for this player
  await db
    .delete(schema.playerGameStats)
    .where(eq(schema.playerGameStats.playerId, player.id));

  // Insert new game stats
  if (games.length > 0) {
    const gameRecords = games.slice(0, 20).map((g) => ({
      playerId: player.id,
      fixtureId: g.fixtureId || null,
      gameDate: g.gameDate,
      opponent: g.opponent,
      opponentId: g.opponentId || null,
      isHome: g.isHome,
      minutes: g.minutes,
      points: g.points,
      rebounds: g.rebounds,
      assists: g.assists,
      threes: g.threes,
      steals: g.steals,
      blocks: g.blocks,
      turnovers: g.turnovers,
      fgMade: g.fgMade,
      fgAttempted: g.fgAttempted,
      ftMade: g.ftMade,
      ftAttempted: g.ftAttempted,
      pra: g.points + g.rebounds + g.assists,
      pr: g.points + g.rebounds,
      pa: g.points + g.assists,
      ra: g.rebounds + g.assists,
    }));

    await db.insert(schema.playerGameStats).values(gameRecords);
  }
}

// ============================================================================
// Main Update Functions
// ============================================================================

/**
 * Update all players in the cache (full refresh)
 */
export async function updateAllPlayers(): Promise<{
  playersUpdated: number;
  playersAdded: number;
  gamesAdded: number;
  errors: string[];
  duration: number;
}> {
  const startTime = Date.now();
  const errors: string[] = [];
  let playersUpdated = 0;
  let playersAdded = 0;
  let gamesAdded = 0;

  console.info('[PlayerCache] Starting full cache update...');

  try {
    // Get existing player IDs
    const existingPlayers = await db.query.players.findMany({
      columns: { id: true },
    });
    const existingIds = new Set(existingPlayers.map((p) => p.id));

    // Fetch all NBA players
    const players = await fetchAllNBAPlayers();

    // Process in batches
    const batchSize = 10;
    for (let i = 0; i < players.length; i += batchSize) {
      const batch = players.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (player) => {
          try {
            const games = await fetchPlayerStats(player.id, 20);

            if (games.length > 0) {
              const averages = calculateAverages(games);
              await savePlayer(player, games, averages);

              if (existingIds.has(player.id)) {
                playersUpdated++;
              } else {
                playersAdded++;
              }
              gamesAdded += games.length;
            }
          } catch (error) {
            const msg = `Error updating ${player.name}: ${error}`;
            console.error(`[PlayerCache] ${msg}`);
            errors.push(msg);
          }
        })
      );

      // Progress log
      if ((i + batchSize) % 50 === 0 || i + batchSize >= players.length) {
        console.info(
          `[PlayerCache] Progress: ${Math.min(i + batchSize, players.length)}/${players.length} players`
        );
      }

      // Rate limit delay
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const duration = Date.now() - startTime;

    // Log the update
    await db.insert(schema.playerCacheLog).values({
      runDate: new Date().toISOString().split('T')[0],
      playersUpdated,
      playersAdded,
      gamesAdded,
      errors: errors.length > 0 ? JSON.stringify(errors) : null,
      duration,
    });

    console.info(
      `[PlayerCache] Update complete: ${playersUpdated} updated, ${playersAdded} added, ${gamesAdded} games, ${duration}ms`
    );

    return { playersUpdated, playersAdded, gamesAdded, errors, duration };
  } catch (error) {
    const msg = `Fatal error in cache update: ${error}`;
    console.error(`[PlayerCache] ${msg}`);
    errors.push(msg);
    return { playersUpdated, playersAdded, gamesAdded, errors, duration: Date.now() - startTime };
  }
}

/**
 * Update only players who played on a specific date
 * (More efficient for daily updates)
 */
export async function updatePlayersFromDate(date: string): Promise<{
  playersUpdated: number;
  gamesAdded: number;
  errors: string[];
}> {
  console.info(`[PlayerCache] Updating players who played on ${date}...`);

  // This would require knowing which players played - for now, just do full update
  // In the future, could fetch fixtures from that date and get player IDs
  const result = await updateAllPlayers();
  return {
    playersUpdated: result.playersUpdated + result.playersAdded,
    gamesAdded: result.gamesAdded,
    errors: result.errors,
  };
}

/**
 * Update a single player by ID
 */
export async function updatePlayerById(playerId: string): Promise<boolean> {
  try {
    // Try to get player info from existing cache or fetch new
    const existing = await db.query.players.findFirst({
      where: eq(schema.players.id, playerId),
    });

    const games = await fetchPlayerStats(playerId, 20);
    if (games.length === 0) {
      return false;
    }

    const averages = calculateAverages(games);

    // If we don't have player info, try to fetch it
    let playerInfo: OpticOddsPlayer;
    if (existing) {
      playerInfo = {
        id: playerId,
        name: existing.name,
        position: existing.position || undefined,
        team: existing.team ? { id: existing.teamId || '', name: existing.team } : undefined,
      };
    } else {
      // Search for player info
      const response = await fetchFromOpticOdds<{ data: any[] }>('/players', {
        sport: 'basketball',
      });
      const found = response.data?.find((p: any) => p.id === playerId);
      if (!found) {
        return false;
      }
      playerInfo = {
        id: found.id,
        name: found.name,
        position: found.position,
        number: found.number,
        team: found.team ? { id: found.team.id, name: found.team.name } : undefined,
      };
    }

    await savePlayer(playerInfo, games, averages);
    return true;
  } catch (error) {
    console.error(`[PlayerCache] Error updating player ${playerId}:`, error);
    return false;
  }
}

// ============================================================================
// Query Functions (Used by validation)
// ============================================================================

/**
 * Get a player from cache by ID
 */
export async function getPlayerById(playerId: string): Promise<CachedPlayer | null> {
  const player = await db.query.players.findFirst({
    where: eq(schema.players.id, playerId),
  });

  return player || null;
}

/**
 * Get a player from cache by name (fuzzy match)
 */
export async function getPlayerByName(name: string): Promise<CachedPlayer | null> {
  const searchLower = name.toLowerCase().trim();

  // Try exact match first
  let player = await db.query.players.findFirst({
    where: sql`lower(${schema.players.name}) = ${searchLower}`,
  });

  // Try contains match
  if (!player) {
    player = await db.query.players.findFirst({
      where: sql`lower(${schema.players.name}) LIKE ${'%' + searchLower + '%'}`,
    });
  }

  return player || null;
}

/**
 * Get player's game history from cache
 */
export async function getPlayerGameHistory(
  playerId: string,
  limit: number = 20
): Promise<CachedGameStats[]> {
  const games = await db.query.playerGameStats.findMany({
    where: eq(schema.playerGameStats.playerId, playerId),
    orderBy: [desc(schema.playerGameStats.gameDate)],
    limit,
  });

  return games;
}

/**
 * Calculate hit rate for a player prop from cached data
 */
export async function calculateHitRateFromCache(
  playerId: string,
  stat: 'points' | 'rebounds' | 'assists' | 'threes' | 'steals' | 'blocks' | 'turnovers' | 'pra' | 'pr' | 'pa' | 'ra',
  line: number,
  direction: 'over' | 'under',
  lastX: number = 10
): Promise<{
  hits: number;
  total: number;
  hitRate: number;
  avgValue: number;
  recentGames: Array<{ date: string; opponent: string | null; value: number; hit: boolean; isHome: boolean | null }>;
} | null> {
  const games = await getPlayerGameHistory(playerId, lastX);

  if (games.length === 0) {
    return null;
  }

  const recentGames: Array<{ date: string; opponent: string | null; value: number; hit: boolean; isHome: boolean | null }> = [];
  let hits = 0;
  let totalValue = 0;

  for (const game of games) {
    const value = game[stat] || 0;
    const hit = direction === 'over' ? value > line : value < line;

    if (hit) hits++;
    totalValue += value;

    recentGames.push({
      date: game.gameDate,
      opponent: game.opponent,
      value,
      hit,
      isHome: game.isHome,
    });
  }

  return {
    hits,
    total: games.length,
    hitRate: Math.round((hits / games.length) * 100),
    avgValue: Math.round((totalValue / games.length) * 10) / 10,
    recentGames,
  };
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{
  totalPlayers: number;
  totalGames: number;
  lastUpdate: string | null;
  oldestPlayer: string | null;
}> {
  const playerCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.players);

  const gameCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.playerGameStats);

  const lastLog = await db.query.playerCacheLog.findFirst({
    orderBy: [desc(schema.playerCacheLog.createdAt)],
  });

  const oldestPlayer = await db.query.players.findFirst({
    orderBy: [schema.players.lastUpdated],
    columns: { lastUpdated: true },
  });

  return {
    totalPlayers: playerCount[0]?.count || 0,
    totalGames: gameCount[0]?.count || 0,
    lastUpdate: lastLog?.createdAt || null,
    oldestPlayer: oldestPlayer?.lastUpdated || null,
  };
}
