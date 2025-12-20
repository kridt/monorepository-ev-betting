/**
 * Ball Don't Lie API Client
 *
 * Fetches NBA player statistics from the Ball Don't Lie API.
 * API Docs: https://docs.balldontlie.io/
 *
 * Features:
 * - Player search and lookup
 * - Game-by-game stats (last 20 games)
 * - Season averages
 * - Rate limiting: 60 requests/minute (GOAT package)
 */

import { db, schema } from '../db/index.js';
import { eq, desc, and, sql, inArray } from 'drizzle-orm';
import { config } from '../config.js';

// ============================================================================
// Configuration
// ============================================================================

const API_BASE_URL = config.ballDontLieBaseUrl + '/v1';
const API_KEY = config.ballDontLieApiKey;
const GAMES_TO_CACHE = 20; // Last 20 games per player
const RATE_LIMIT_DELAY = 100; // 100ms between requests (safe for 60/min)

// ============================================================================
// Types
// ============================================================================

export interface BDLPlayer {
  id: number;
  first_name: string;
  last_name: string;
  position: string;
  height: string | null;
  weight: string | null;
  jersey_number: string | null;
  college: string | null;
  country: string | null;
  draft_year: number | null;
  draft_round: number | null;
  draft_number: number | null;
  team: BDLTeam | null;
}

export interface BDLTeam {
  id: number;
  conference: string;
  division: string;
  city: string;
  name: string;
  full_name: string;
  abbreviation: string;
}

export interface BDLGame {
  id: number;
  date: string;
  season: number;
  status: string;
  period: number;
  time: string;
  postseason: boolean;
  home_team_score: number;
  visitor_team_score: number;
  home_team: BDLTeam;
  visitor_team: BDLTeam;
}

export interface BDLPlayerStats {
  id: number;
  min: string; // "32:15" format
  fgm: number;
  fga: number;
  fg_pct: number;
  fg3m: number;
  fg3a: number;
  fg3_pct: number;
  ftm: number;
  fta: number;
  ft_pct: number;
  oreb: number;
  dreb: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  turnover: number;
  pf: number;
  pts: number;
  player: BDLPlayer;
  game: BDLGame;
  team: BDLTeam;
}

export interface BDLSeasonAverages {
  games_played: number;
  season: number;
  min: string;
  fgm: number;
  fga: number;
  fg_pct: number;
  fg3m: number;
  fg3a: number;
  fg3_pct: number;
  ftm: number;
  fta: number;
  ft_pct: number;
  oreb: number;
  dreb: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  turnover: number;
  pf: number;
  pts: number;
  player_id: number;
}

interface BDLResponse<T> {
  data: T[];
  meta?: {
    next_cursor?: number;
    per_page?: number;
  };
}

// ============================================================================
// API Client
// ============================================================================

async function fetchBDL<T>(endpoint: string, params: Record<string, string | number> = {}): Promise<BDLResponse<T>> {
  if (!API_KEY) {
    throw new Error('BALLDONTLIE_API_KEY environment variable not set');
  }

  const url = new URL(`${API_BASE_URL}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': API_KEY,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ball Don't Lie API error: ${response.status} - ${text}`);
  }

  return response.json() as Promise<BDLResponse<T>>;
}

// Rate limiting helper
let lastRequestTime = 0;
async function rateLimitedFetch<T>(endpoint: string, params: Record<string, string | number> = {}): Promise<BDLResponse<T>> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < RATE_LIMIT_DELAY) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY - timeSinceLastRequest));
  }

  lastRequestTime = Date.now();
  return fetchBDL<T>(endpoint, params);
}

// ============================================================================
// Player Search & Lookup
// ============================================================================

/**
 * Search for players by name
 */
export async function searchPlayers(query: string): Promise<BDLPlayer[]> {
  const response = await rateLimitedFetch<BDLPlayer>('/players', {
    search: query,
    per_page: 25,
  });
  return response.data;
}

/**
 * Get a specific player by ID
 */
export async function getPlayer(playerId: number): Promise<BDLPlayer | null> {
  try {
    const response = await rateLimitedFetch<BDLPlayer>(`/players/${playerId}`, {});
    // Single player endpoint returns data directly, not in array
    return (response as any).data || null;
  } catch (error) {
    console.error(`[BDL] Error fetching player ${playerId}:`, error);
    return null;
  }
}

/**
 * Get all active NBA players (paginated)
 */
export async function getAllActivePlayers(): Promise<BDLPlayer[]> {
  const allPlayers: BDLPlayer[] = [];
  let cursor: number | undefined = undefined;

  do {
    const params: Record<string, string | number> = { per_page: 100 };
    if (cursor) params.cursor = cursor;

    const response = await rateLimitedFetch<BDLPlayer>('/players/active', params);
    allPlayers.push(...response.data);
    cursor = response.meta?.next_cursor;

    console.log(`[BDL] Fetched ${allPlayers.length} active players...`);
  } while (cursor);

  return allPlayers;
}

// ============================================================================
// Player Stats
// ============================================================================

/**
 * Get player stats for recent games
 */
export async function getPlayerStats(
  playerId: number,
  options: {
    seasons?: number[];
    postseason?: boolean;
    startDate?: string;
    endDate?: string;
    perPage?: number;
  } = {}
): Promise<BDLPlayerStats[]> {
  const allStats: BDLPlayerStats[] = [];
  let cursor: number | undefined = undefined;
  const perPage = options.perPage || 100;

  do {
    const params: Record<string, string | number> = {
      'player_ids[]': playerId,
      per_page: perPage,
    };

    if (cursor) params.cursor = cursor;
    if (options.seasons && options.seasons.length > 0) {
      params['seasons[]'] = options.seasons[0]; // Can extend for multiple seasons
    }
    if (options.postseason !== undefined) {
      params.postseason = options.postseason ? 'true' : 'false';
    }
    if (options.startDate) params.start_date = options.startDate;
    if (options.endDate) params.end_date = options.endDate;

    const response = await rateLimitedFetch<BDLPlayerStats>('/stats', params);
    allStats.push(...response.data);
    cursor = response.meta?.next_cursor;

    // Stop if we have enough games
    if (allStats.length >= GAMES_TO_CACHE) break;

  } while (cursor);

  // Sort by game date descending (most recent first)
  allStats.sort((a, b) => new Date(b.game.date).getTime() - new Date(a.game.date).getTime());

  // Return only the last N games
  return allStats.slice(0, GAMES_TO_CACHE);
}

/**
 * Get season averages for a player
 */
export async function getSeasonAverages(
  playerId: number,
  season?: number
): Promise<BDLSeasonAverages | null> {
  const currentSeason = season || new Date().getFullYear();

  try {
    const response = await rateLimitedFetch<BDLSeasonAverages>('/season_averages', {
      season: currentSeason,
      'player_ids[]': playerId,
    });

    return response.data[0] || null;
  } catch (error) {
    console.error(`[BDL] Error fetching season averages for player ${playerId}:`, error);
    return null;
  }
}

// ============================================================================
// Cache Management
// ============================================================================

/**
 * Parse minutes string "32:15" to integer minutes
 */
function parseMinutes(minStr: string | null): number {
  if (!minStr) return 0;
  const parts = minStr.split(':');
  return parseInt(parts[0], 10) || 0;
}

/**
 * Update player cache with Ball Don't Lie data
 * @param playerId - Internal player ID (string, e.g., "bdl_123")
 * @param bdlPlayerId - Ball Don't Lie player ID (number)
 */
export async function updatePlayerCache(playerId: string, bdlPlayerId: number): Promise<boolean> {
  try {
    // Get player info
    const player = await getPlayer(bdlPlayerId);
    if (!player) {
      console.log(`[BDL Cache] Player ${bdlPlayerId} not found`);
      return false;
    }

    // Get recent stats (last 20 games)
    const stats = await getPlayerStats(bdlPlayerId, {
      seasons: [new Date().getFullYear(), new Date().getFullYear() - 1],
      postseason: false,
    });

    if (stats.length === 0) {
      console.log(`[BDL Cache] No stats found for ${player.first_name} ${player.last_name}`);
      return false;
    }

    console.log(`[BDL Cache] Found ${stats.length} games for ${player.first_name} ${player.last_name}`);

    // Calculate averages from game stats
    const avgStats = calculateAverages(stats);
    const last5Stats = calculateAverages(stats.slice(0, 5));
    const last10Stats = calculateAverages(stats.slice(0, 10));

    // Separate home/away games
    const homeGames = stats.filter(s => s.team.id === s.game.home_team.id);
    const awayGames = stats.filter(s => s.team.id === s.game.visitor_team.id);
    const homeStats = calculateAverages(homeGames);
    const awayStats = calculateAverages(awayGames);

    // Upsert player record
    await db.insert(schema.players).values({
      id: playerId, // Use our internal ID
      name: `${player.first_name} ${player.last_name}`,
      team: player.team?.full_name || null,
      teamId: player.team?.id?.toString() || null,
      position: player.position || null,
      jersey: player.jersey_number ? parseInt(player.jersey_number) : null,
      league: 'nba',

      // Averages (all games)
      avgPoints: avgStats.pts,
      avgRebounds: avgStats.reb,
      avgAssists: avgStats.ast,
      avgThrees: avgStats.fg3m,
      avgSteals: avgStats.stl,
      avgBlocks: avgStats.blk,
      avgTurnovers: avgStats.turnover,
      avgMinutes: avgStats.min,
      avgPRA: avgStats.pts + avgStats.reb + avgStats.ast,

      // Last 5 games
      last5Points: last5Stats.pts,
      last5Rebounds: last5Stats.reb,
      last5Assists: last5Stats.ast,
      last5Threes: last5Stats.fg3m,
      last5PRA: last5Stats.pts + last5Stats.reb + last5Stats.ast,

      // Last 10 games
      last10Points: last10Stats.pts,
      last10Rebounds: last10Stats.reb,
      last10Assists: last10Stats.ast,
      last10Threes: last10Stats.fg3m,
      last10PRA: last10Stats.pts + last10Stats.reb + last10Stats.ast,

      // Home/Away splits
      homePoints: homeStats.pts,
      homeRebounds: homeStats.reb,
      homeAssists: homeStats.ast,
      awayPoints: awayStats.pts,
      awayRebounds: awayStats.reb,
      awayAssists: awayStats.ast,

      // Games tracked
      gamesPlayed: stats.length,
      homeGames: homeGames.length,
      awayGames: awayGames.length,

      // Metadata
      lastGameDate: stats[0]?.game.date || null,
      lastUpdated: new Date().toISOString(),
    }).onConflictDoUpdate({
      target: schema.players.id,
      set: {
        name: `${player.first_name} ${player.last_name}`,
        team: player.team?.full_name || null,
        teamId: player.team?.id?.toString() || null,
        position: player.position || null,
        jersey: player.jersey_number ? parseInt(player.jersey_number) : null,
        avgPoints: avgStats.pts,
        avgRebounds: avgStats.reb,
        avgAssists: avgStats.ast,
        avgThrees: avgStats.fg3m,
        avgSteals: avgStats.stl,
        avgBlocks: avgStats.blk,
        avgTurnovers: avgStats.turnover,
        avgMinutes: avgStats.min,
        avgPRA: avgStats.pts + avgStats.reb + avgStats.ast,
        last5Points: last5Stats.pts,
        last5Rebounds: last5Stats.reb,
        last5Assists: last5Stats.ast,
        last5Threes: last5Stats.fg3m,
        last5PRA: last5Stats.pts + last5Stats.reb + last5Stats.ast,
        last10Points: last10Stats.pts,
        last10Rebounds: last10Stats.reb,
        last10Assists: last10Stats.ast,
        last10Threes: last10Stats.fg3m,
        last10PRA: last10Stats.pts + last10Stats.reb + last10Stats.ast,
        homePoints: homeStats.pts,
        homeRebounds: homeStats.reb,
        homeAssists: homeStats.ast,
        awayPoints: awayStats.pts,
        awayRebounds: awayStats.reb,
        awayAssists: awayStats.ast,
        gamesPlayed: stats.length,
        homeGames: homeGames.length,
        awayGames: awayGames.length,
        lastGameDate: stats[0]?.game.date || null,
        lastUpdated: new Date().toISOString(),
      },
    });

    // Delete old game stats for this player
    await db.delete(schema.playerGameStats)
      .where(eq(schema.playerGameStats.playerId, playerId));

    // Insert new game stats
    for (const stat of stats) {
      const isHome = stat.team.id === stat.game.home_team.id;
      const opponent = isHome ? stat.game.visitor_team : stat.game.home_team;

      await db.insert(schema.playerGameStats).values({
        playerId: playerId,
        fixtureId: stat.game.id.toString(),
        gameDate: stat.game.date,
        opponent: opponent.full_name,
        opponentId: opponent.id.toString(),
        isHome: isHome,
        minutes: parseMinutes(stat.min),
        points: stat.pts,
        rebounds: stat.reb,
        assists: stat.ast,
        threes: stat.fg3m,
        steals: stat.stl,
        blocks: stat.blk,
        turnovers: stat.turnover,
        fgMade: stat.fgm,
        fgAttempted: stat.fga,
        ftMade: stat.ftm,
        ftAttempted: stat.fta,
        pra: stat.pts + stat.reb + stat.ast,
        pr: stat.pts + stat.reb,
        pa: stat.pts + stat.ast,
        ra: stat.reb + stat.ast,
      });
    }

    console.log(`[BDL Cache] Updated ${player.first_name} ${player.last_name} with ${stats.length} games`);
    return true;

  } catch (error) {
    console.error(`[BDL Cache] Error updating player ${playerId}:`, error);
    return false;
  }
}

function calculateAverages(stats: BDLPlayerStats[]): {
  pts: number;
  reb: number;
  ast: number;
  fg3m: number;
  stl: number;
  blk: number;
  turnover: number;
  min: number;
} {
  if (stats.length === 0) {
    return { pts: 0, reb: 0, ast: 0, fg3m: 0, stl: 0, blk: 0, turnover: 0, min: 0 };
  }

  const sum = stats.reduce((acc, s) => ({
    pts: acc.pts + s.pts,
    reb: acc.reb + s.reb,
    ast: acc.ast + s.ast,
    fg3m: acc.fg3m + s.fg3m,
    stl: acc.stl + s.stl,
    blk: acc.blk + s.blk,
    turnover: acc.turnover + s.turnover,
    min: acc.min + parseMinutes(s.min),
  }), { pts: 0, reb: 0, ast: 0, fg3m: 0, stl: 0, blk: 0, turnover: 0, min: 0 });

  const count = stats.length;
  return {
    pts: Math.round((sum.pts / count) * 10) / 10,
    reb: Math.round((sum.reb / count) * 10) / 10,
    ast: Math.round((sum.ast / count) * 10) / 10,
    fg3m: Math.round((sum.fg3m / count) * 10) / 10,
    stl: Math.round((sum.stl / count) * 10) / 10,
    blk: Math.round((sum.blk / count) * 10) / 10,
    turnover: Math.round((sum.turnover / count) * 10) / 10,
    min: Math.round(sum.min / count),
  };
}

// ============================================================================
// Hit Rate Calculation
// ============================================================================

export type NBAStatKey = 'points' | 'rebounds' | 'assists' | 'threes' | 'steals' | 'blocks' | 'turnovers' | 'pra' | 'pr' | 'pa' | 'ra';

/**
 * Map market name to stat key
 */
export function mapMarketToStatKey(market: string): NBAStatKey | null {
  const m = market.toLowerCase();

  if (m.includes('point') && m.includes('rebound') && m.includes('assist')) return 'pra';
  if (m.includes('point') && m.includes('rebound')) return 'pr';
  if (m.includes('point') && m.includes('assist')) return 'pa';
  if (m.includes('rebound') && m.includes('assist')) return 'ra';
  if (m.includes('point')) return 'points';
  if (m.includes('rebound')) return 'rebounds';
  if (m.includes('assist')) return 'assists';
  if (m.includes('three') || m.includes('3pt') || m.includes('3-point')) return 'threes';
  if (m.includes('steal')) return 'steals';
  if (m.includes('block')) return 'blocks';
  if (m.includes('turnover')) return 'turnovers';

  return null;
}

/**
 * Get the stat value from a game record
 */
function getStatValue(game: typeof schema.playerGameStats.$inferSelect, statKey: NBAStatKey): number {
  switch (statKey) {
    case 'points': return game.points || 0;
    case 'rebounds': return game.rebounds || 0;
    case 'assists': return game.assists || 0;
    case 'threes': return game.threes || 0;
    case 'steals': return game.steals || 0;
    case 'blocks': return game.blocks || 0;
    case 'turnovers': return game.turnovers || 0;
    case 'pra': return game.pra || 0;
    case 'pr': return game.pr || 0;
    case 'pa': return game.pa || 0;
    case 'ra': return game.ra || 0;
    default: return 0;
  }
}

export interface HitRateResult {
  total: number;
  hits: number;
  hitRate: number;
  avgValue: number;
  recentGames: Array<{
    date: string;
    opponent: string;
    value: number;
    hit: boolean;
    isHome: boolean;
  }>;
}

/**
 * Calculate hit rate for a player's prop line from cached data
 */
export async function calculateHitRateFromCache(
  playerId: string,
  statKey: NBAStatKey,
  line: number,
  direction: 'over' | 'under',
  gameCount: number = 20
): Promise<HitRateResult | null> {
  // Get recent games from cache
  const games = await db.query.playerGameStats.findMany({
    where: eq(schema.playerGameStats.playerId, playerId),
    orderBy: [desc(schema.playerGameStats.gameDate)],
    limit: gameCount,
  });

  if (games.length === 0) {
    return null;
  }

  let hits = 0;
  let totalValue = 0;
  const recentGames: HitRateResult['recentGames'] = [];

  for (const game of games) {
    const value = getStatValue(game, statKey);
    totalValue += value;

    const hit = direction === 'over' ? value > line : value < line;
    if (hit) hits++;

    recentGames.push({
      date: game.gameDate,
      opponent: game.opponent || 'Unknown',
      value,
      hit,
      isHome: game.isHome || false,
    });
  }

  return {
    total: games.length,
    hits,
    hitRate: Math.round((hits / games.length) * 100),
    avgValue: Math.round((totalValue / games.length) * 10) / 10,
    recentGames,
  };
}

// ============================================================================
// Player Lookup
// ============================================================================

/**
 * Find or create a player in cache by name
 */
export async function findOrCreatePlayer(
  playerName: string,
  teamHint?: string
): Promise<{ id: string; bdlPlayerId: number; name: string } | null> {
  // First, check if player exists in our cache
  const existingPlayer = await db.query.players.findFirst({
    where: sql`lower(${schema.players.name}) = lower(${playerName})`,
  });

  if (existingPlayer && existingPlayer.gamesPlayed && existingPlayer.gamesPlayed > 0) {
    // Player exists and has game data
    // Check if we need to refresh (older than 24 hours)
    const lastUpdated = existingPlayer.lastUpdated ? new Date(existingPlayer.lastUpdated) : new Date(0);
    const hoursSinceUpdate = (Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60);

    if (hoursSinceUpdate < 24) {
      return {
        id: existingPlayer.id,
        bdlPlayerId: parseInt(existingPlayer.id.replace('bdl_', '')) || 0,
        name: existingPlayer.name,
      };
    }
  }

  // Search Ball Don't Lie for player
  console.log(`[BDL] Searching for player: ${playerName}`);
  const searchResults = await searchPlayers(playerName);

  if (searchResults.length === 0) {
    console.log(`[BDL] No results found for: ${playerName}`);
    return null;
  }

  // Find best match
  let bestMatch = searchResults[0];
  const normalizedSearch = playerName.toLowerCase().trim();

  for (const player of searchResults) {
    const fullName = `${player.first_name} ${player.last_name}`.toLowerCase();
    if (fullName === normalizedSearch) {
      bestMatch = player;
      break;
    }
    // Check team hint if provided
    if (teamHint && player.team) {
      const teamMatch = player.team.full_name.toLowerCase().includes(teamHint.toLowerCase()) ||
                       player.team.name.toLowerCase().includes(teamHint.toLowerCase());
      if (teamMatch) {
        bestMatch = player;
        break;
      }
    }
  }

  const internalId = `bdl_${bestMatch.id}`;
  console.log(`[BDL] Found player: ${bestMatch.first_name} ${bestMatch.last_name} (ID: ${bestMatch.id})`);

  // Update cache
  const success = await updatePlayerCache(internalId, bestMatch.id);

  if (success) {
    return {
      id: internalId,
      bdlPlayerId: bestMatch.id,
      name: `${bestMatch.first_name} ${bestMatch.last_name}`,
    };
  }

  return null;
}

/**
 * Get player from cache by internal ID
 */
export async function getPlayerFromCache(playerId: string): Promise<typeof schema.players.$inferSelect | null> {
  const player = await db.query.players.findFirst({
    where: eq(schema.players.id, playerId),
  });
  return player || null;
}

/**
 * Get player by name from cache (for validation lookup)
 */
export async function getPlayerByName(playerName: string): Promise<typeof schema.players.$inferSelect | null> {
  // Try exact match first
  let player = await db.query.players.findFirst({
    where: sql`lower(${schema.players.name}) = lower(${playerName})`,
  });

  if (player) return player;

  // Try partial match (first + last name separately)
  const parts = playerName.trim().split(/\s+/);
  if (parts.length >= 2) {
    player = await db.query.players.findFirst({
      where: sql`${schema.players.name} LIKE ${`%${parts[0]}%${parts[parts.length - 1]}%`}`,
    });
  }

  return player || null;
}

// ============================================================================
// Bulk Cache Population
// ============================================================================

export interface CachePopulationResult {
  playersProcessed: number;
  playersUpdated: number;
  playersFailed: number;
  errors: string[];
  duration: number;
}

/**
 * Populate cache for a list of player names (used during pipeline)
 */
export async function populateCacheForPlayers(playerNames: string[]): Promise<CachePopulationResult> {
  const startTime = Date.now();
  const result: CachePopulationResult = {
    playersProcessed: 0,
    playersUpdated: 0,
    playersFailed: 0,
    errors: [],
    duration: 0,
  };

  const uniqueNames = [...new Set(playerNames.map(n => n.toLowerCase().trim()))];
  console.log(`[BDL Cache] Populating cache for ${uniqueNames.length} unique players...`);

  for (const name of uniqueNames) {
    result.playersProcessed++;

    try {
      const player = await findOrCreatePlayer(name);
      if (player) {
        result.playersUpdated++;
      } else {
        result.playersFailed++;
        result.errors.push(`Player not found: ${name}`);
      }
    } catch (error) {
      result.playersFailed++;
      result.errors.push(`Error processing ${name}: ${error}`);
    }

    // Progress log
    if (result.playersProcessed % 10 === 0) {
      console.log(`[BDL Cache] Progress: ${result.playersProcessed}/${uniqueNames.length}`);
    }
  }

  result.duration = Date.now() - startTime;
  console.log(`[BDL Cache] Complete: ${result.playersUpdated} updated, ${result.playersFailed} failed in ${result.duration}ms`);

  return result;
}
