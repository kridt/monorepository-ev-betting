import { config } from '../config.js';

// API configuration
const API_BASE_URL = config.ballDontLieBaseUrl;
const API_KEY = config.ballDontLieApiKey;

// Simple in-memory cache
const cache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getCached<T>(key: string): T | null {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data as T;
  }
  cache.delete(key);
  return null;
}

function setCache(key: string, data: unknown): void {
  cache.set(key, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

// Safe logging
function safeLog(message: string, data?: Record<string, unknown>) {
  console.info(`[BallDontLie] ${message}`, data || '');
}

// Sleep utility
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Ball Don't Lie API types
interface BDLPlayer {
  id: number;
  first_name: string;
  last_name: string;
  position: string;
  height: string;
  weight: string;
  jersey_number: string;
  college: string;
  country: string;
  draft_year: number | null;
  draft_round: number | null;
  draft_number: number | null;
  team: {
    id: number;
    conference: string;
    division: string;
    city: string;
    name: string;
    full_name: string;
    abbreviation: string;
  };
}

interface BDLGameStats {
  id: number;
  min: string; // "32:15"
  fgm: number; // Field goals made
  fga: number; // Field goals attempted
  fg_pct: number;
  fg3m: number; // 3-point made
  fg3a: number; // 3-point attempted
  fg3_pct: number;
  ftm: number; // Free throws made
  fta: number; // Free throws attempted
  ft_pct: number;
  oreb: number; // Offensive rebounds
  dreb: number; // Defensive rebounds
  reb: number; // Total rebounds
  ast: number; // Assists
  stl: number; // Steals
  blk: number; // Blocks
  turnover: number; // Turnovers
  pf: number; // Personal fouls
  pts: number; // Points
  player: BDLPlayer;
  team: {
    id: number;
    conference: string;
    division: string;
    city: string;
    name: string;
    full_name: string;
    abbreviation: string;
  };
  game: {
    id: number;
    date: string;
    season: number;
    status: string;
    period: number;
    time: string;
    postseason: boolean;
    home_team_score: number;
    visitor_team_score: number;
    home_team_id: number;
    visitor_team_id: number;
  };
}

interface BDLSeasonAverages {
  season: number;
  games_played: number;
  player_id: number;
  pts: number;
  ast: number;
  reb: number;
  stl: number;
  blk: number;
  turnover: number;
  pf: number;
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
  min: string;
}

interface BDLResponse<T> {
  data: T;
  meta?: {
    next_cursor?: number;
    per_page?: number;
  };
}

// Fetch with retry and auth
async function fetchWithRetry<T>(
  endpoint: string,
  params: Record<string, string | string[]> = {},
  retries = 3
): Promise<T | null> {
  if (!API_KEY) {
    console.warn('[BallDontLie] API key not configured');
    return null;
  }

  const url = new URL(`${API_BASE_URL}${endpoint}`);

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      value.forEach(v => url.searchParams.append(`${key}[]`, v));
    } else if (value) {
      url.searchParams.set(key, value);
    }
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': API_KEY,
        },
      });

      if (response.status === 429) {
        // Rate limited - wait and retry
        const retryAfter = parseInt(response.headers.get('retry-after') || '10', 10);
        safeLog(`Rate limited, waiting ${retryAfter}s`);
        await sleep(retryAfter * 1000);
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json() as BDLResponse<T>;
      return data.data;
    } catch (error) {
      safeLog(`Attempt ${attempt}/${retries} failed`, {
        endpoint,
        error: error instanceof Error ? error.message : 'Unknown',
      });

      if (attempt < retries) {
        await sleep(1000 * attempt); // Exponential backoff
      }
    }
  }

  return null;
}

/**
 * Normalize a name for comparison
 * - Remove periods (P.J. → PJ)
 * - Lowercase
 * - Remove Jr./Sr./III/II suffixes for matching
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\./g, '')          // P.J. → PJ
    .replace(/'/g, '')           // De'Aaron → DeAaron
    .replace(/\s+(jr|sr|iii|ii|iv)\.?$/i, '')  // Remove suffixes
    .trim();
}

/**
 * Check if two names match (with normalization)
 */
function namesMatch(name1: string, name2: string): boolean {
  return normalizeName(name1) === normalizeName(name2);
}

/**
 * Search for NBA player by name
 * The Ball Don't Lie API searches by first OR last name separately,
 * so we search by first name and then match the full name.
 */
export async function searchPlayer(name: string): Promise<BDLPlayer | null> {
  const cacheKey = `bdl-player:${name.toLowerCase()}`;
  const cached = getCached<BDLPlayer>(cacheKey);
  if (cached) return cached;

  safeLog('Searching for player', { name });

  // Extract first name for search (API matches first OR last, not full name)
  const nameParts = name.trim().split(/\s+/);
  const firstName = nameParts[0];
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';

  // Search by first name first (try with and without periods for names like P.J.)
  let players = await fetchWithRetry<BDLPlayer[]>(
    '/v1/players',
    { search: firstName.replace(/\./g, ''), per_page: '50' }
  );

  // If no results with normalized name, try original
  if ((!players || players.length === 0) && firstName.includes('.')) {
    players = await fetchWithRetry<BDLPlayer[]>(
      '/v1/players',
      { search: firstName, per_page: '50' }
    );
  }

  // If no results, try last name
  if ((!players || players.length === 0) && lastName) {
    players = await fetchWithRetry<BDLPlayer[]>(
      '/v1/players',
      { search: lastName, per_page: '50' }
    );
  }

  // If we got results but need to also check last name search (for cases like PJ Washington where
  // "PJ" returns results but none match "Washington")
  let lastNameResults: BDLPlayer[] | null = null;
  if (players && players.length > 0 && lastName) {
    // Check if any result matches our criteria
    const hasMatch = players.some(p =>
      namesMatch(p.first_name, firstName) && namesMatch(p.last_name, lastName)
    );

    // If no match found in first name results, also search by last name
    if (!hasMatch) {
      lastNameResults = await fetchWithRetry<BDLPlayer[]>(
        '/v1/players',
        { search: lastName, per_page: '50' }
      );

      if (lastNameResults && lastNameResults.length > 0) {
        // Combine results, removing duplicates
        const existingIds = new Set(players.map(p => p.id));
        for (const p of lastNameResults) {
          if (!existingIds.has(p.id)) {
            players.push(p);
          }
        }
      }
    }
  }

  if (!players || players.length === 0) {
    safeLog('Player not found', { name });
    return null;
  }

  // Find best match using normalized comparison
  const normalizedFirstName = normalizeName(firstName);
  const normalizedLastName = normalizeName(lastName);

  // Try exact full name match first (normalized)
  let player = players.find(p =>
    namesMatch(`${p.first_name} ${p.last_name}`, name)
  );

  // Try matching first and last name separately (normalized)
  if (!player && lastName) {
    player = players.find(p =>
      namesMatch(p.first_name, firstName) &&
      namesMatch(p.last_name, lastName)
    );
  }

  // Try partial match on last name (first name normalized match, last name contains)
  if (!player && lastName) {
    player = players.find(p =>
      namesMatch(p.first_name, firstName) &&
      normalizeName(p.last_name).includes(normalizedLastName)
    );
  }

  // Try partial match where last name includes Jr/Sr suffix (e.g., "Washington Jr.")
  if (!player && lastName) {
    player = players.find(p =>
      namesMatch(p.first_name, firstName) &&
      normalizeName(p.last_name).startsWith(normalizedLastName)
    );
  }

  // Try last name match with first name contains (for partial first names)
  if (!player && lastName) {
    player = players.find(p =>
      namesMatch(p.last_name, lastName) &&
      normalizeName(p.first_name).includes(normalizedFirstName)
    );
  }

  // Try just last name match if first name looks like initials (e.g., "PJ" matches "P.J.")
  // Real initials: "PJ", "CJ", "DJ", "AJ", "TJ", "RJ", "P.J.", etc.
  // Pattern: exactly 2 uppercase consonants, optionally with periods, possibly starting with vowel
  // NOT regular short names like "Ace", "Cam", "Tim", "Joe", etc.
  const initialsPattern = /^[A-Z]\.?[A-Z]\.?$/i;  // "PJ", "P.J.", "PJ.", "P.J"
  const hasVowelInMiddle = /[aeiou]./i.test(firstName);  // "Ace" has 'e' before 'c'
  const looksLikeInitials = initialsPattern.test(firstName) && firstName.length <= 4 && !hasVowelInMiddle;

  if (!player && lastName && looksLikeInitials) {
    player = players.find(p =>
      namesMatch(p.last_name, lastName)
    );
  }

  // If still no match, don't return a random wrong player
  if (!player) {
    safeLog('No matching player found', {
      name,
      searchResults: players.slice(0, 3).map(p => `${p.first_name} ${p.last_name}`)
    });
    return null;
  }

  safeLog('Found player', {
    searchedName: name,
    foundName: `${player.first_name} ${player.last_name}`,
    id: player.id
  });
  setCache(cacheKey, player);
  return player;
}

/**
 * Get player's game stats for last N games
 */
export async function getPlayerGameStats(
  playerId: number,
  limit: number = 10
): Promise<BDLGameStats[]> {
  const cacheKey = `bdl-stats:${playerId}:${limit}`;
  const cached = getCached<BDLGameStats[]>(cacheKey);
  if (cached) return cached;

  safeLog('Fetching player stats', { playerId, limit });

  // Get current season
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  // NBA season spans Oct-June, so if before October, use previous year
  const season = currentMonth < 9 ? currentYear - 1 : currentYear;

  // Fetch stats with per_page set to limit
  const stats = await fetchWithRetry<BDLGameStats[]>(
    '/v1/stats',
    {
      player_ids: [String(playerId)],
      seasons: [String(season)],
      per_page: String(limit),
    }
  );

  if (!stats || !Array.isArray(stats)) {
    safeLog('No stats found', { playerId });
    return [];
  }

  // Filter out any invalid entries and sort by game date descending
  const validStats = stats.filter(s => s && s.game && s.game.date);

  if (validStats.length === 0) {
    safeLog('No valid stats found', { playerId });
    return [];
  }

  // Sort by game date descending and take last N games
  const sorted = validStats.sort((a, b) =>
    new Date(b.game.date).getTime() - new Date(a.game.date).getTime()
  ).slice(0, limit);

  setCache(cacheKey, sorted);
  return sorted;
}

/**
 * Get player's season averages
 */
export async function getSeasonAverages(
  playerId: number,
  season?: number
): Promise<BDLSeasonAverages | null> {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  const seasonYear = season || (currentMonth < 9 ? currentYear - 1 : currentYear);

  const cacheKey = `bdl-season-avg:${playerId}:${seasonYear}`;
  const cached = getCached<BDLSeasonAverages>(cacheKey);
  if (cached) return cached;

  safeLog('Fetching season averages', { playerId, season: seasonYear });

  const averages = await fetchWithRetry<BDLSeasonAverages[]>(
    '/v1/season_averages',
    {
      season: String(seasonYear),
      player_id: String(playerId),
    }
  );

  if (!averages || averages.length === 0) {
    safeLog('No season averages found', { playerId, season: seasonYear });
    return null;
  }

  const avg = averages[0];
  setCache(cacheKey, avg);
  return avg;
}

// NBA market types to stat mappings
const NBA_MARKET_TO_STAT: Record<string, keyof BDLGameStats> = {
  'player_points_over_under': 'pts',
  'player_assists_over_under': 'ast',
  'player_rebounds_over_under': 'reb',
  'player_steals_over_under': 'stl',
  'player_blocks_over_under': 'blk',
  'player_turnovers_over_under': 'turnover',
  'player_threes_over_under': 'fg3m',
  'player_3pm_over_under': 'fg3m',
  // Combined props
  'player_pts_reb_over_under': 'pts', // Will combine manually
  'player_pts_ast_over_under': 'pts',
  'player_pts_reb_ast_over_under': 'pts',
  'player_reb_ast_over_under': 'reb',
  'player_stl_blk_over_under': 'stl',
};

// Validation result for NBA
export interface NBAValidationResult {
  playerName: string;
  playerId: number;
  market: string;
  line: number;
  direction: 'over' | 'under';
  matchesChecked: number;
  hits: number;
  hitRate: number; // 0-100
  recentGames: {
    date: string;
    opponent: string;
    value: number;
    hit: boolean;
  }[];
  avgValue: number;
  seasonAvg?: number;
}

/**
 * Parse NBA market type to determine what stat to check
 */
function parseNBAMarket(market: string): { stats: (keyof BDLGameStats)[]; combined: boolean } {
  const m = market.toLowerCase();

  // Helper functions for checking stat types
  const hasPoints = () => m.includes('point') || m.includes('pts');
  const hasRebounds = () => m.includes('rebound') || m.includes('reb');
  const hasAssists = () => m.includes('assist') || m.includes('ast');
  const hasSteals = () => m.includes('steal') || m.includes('stl');
  const hasBlocks = () => m.includes('block') || m.includes('blk');

  // Combined props (PRA, PR, PA, RA, etc.)
  if (hasPoints() && hasRebounds() && hasAssists()) {
    return { stats: ['pts', 'reb', 'ast'], combined: true };
  }
  if (hasPoints() && hasRebounds()) {
    return { stats: ['pts', 'reb'], combined: true };
  }
  if (hasPoints() && hasAssists()) {
    return { stats: ['pts', 'ast'], combined: true };
  }
  if (hasRebounds() && hasAssists()) {
    return { stats: ['reb', 'ast'], combined: true };
  }
  if (hasSteals() && hasBlocks()) {
    return { stats: ['stl', 'blk'], combined: true };
  }

  // Single stat props
  if (hasPoints()) {
    return { stats: ['pts'], combined: false };
  }
  if (hasAssists()) {
    return { stats: ['ast'], combined: false };
  }
  if (hasRebounds()) {
    return { stats: ['reb'], combined: false };
  }
  if (hasSteals()) {
    return { stats: ['stl'], combined: false };
  }
  if (hasBlocks()) {
    return { stats: ['blk'], combined: false };
  }
  if (m.includes('turnover') || m.includes('to_')) {
    return { stats: ['turnover'], combined: false };
  }
  if (m.includes('three') || m.includes('3p') || m.includes('fg3')) {
    return { stats: ['fg3m'], combined: false };
  }

  return { stats: [], combined: false };
}

/**
 * Calculate combined stat value from game stats
 */
function calculateStatValue(game: BDLGameStats, stats: (keyof BDLGameStats)[]): number {
  return stats.reduce((sum, stat) => {
    const value = game[stat];
    return sum + (typeof value === 'number' ? value : 0);
  }, 0);
}

/**
 * Validate NBA player bet against historical data
 */
export async function validateNBAPlayerBet(
  playerName: string,
  market: string,
  line: number,
  direction: 'over' | 'under',
  matchCount: number = 10
): Promise<NBAValidationResult | null> {
  // Find the player
  const player = await searchPlayer(playerName);
  if (!player) {
    return null;
  }

  // Parse market to determine which stats to check
  const { stats, combined } = parseNBAMarket(market);
  if (stats.length === 0) {
    safeLog('Unknown NBA market type', { market });
    return null;
  }

  // Get game stats
  const gameStats = await getPlayerGameStats(player.id, matchCount);
  if (gameStats.length === 0) {
    return null;
  }

  // Get season averages
  const seasonAvg = await getSeasonAverages(player.id);

  // Calculate hit rate
  const recentGames: NBAValidationResult['recentGames'] = [];
  let hits = 0;
  let totalValue = 0;

  for (const game of gameStats) {
    try {
      const value = calculateStatValue(game, stats);
      totalValue += value;

      const hit = direction === 'over' ? value > line : value < line;
      if (hit) hits++;

      // Determine if home or away game (with fallback)
      const isHome = game.game?.home_team_id === game.team?.id;

      recentGames.push({
        date: game.game?.date || 'N/A',
        opponent: isHome ? 'HOME' : 'AWAY',
        value,
        hit,
      });
    } catch (err) {
      safeLog('Error processing game stats', { gameId: game?.id, error: err instanceof Error ? err.message : 'Unknown' });
    }
  }

  // Calculate season average for the stat(s)
  let seasonStatAvg: number | undefined;
  if (seasonAvg) {
    seasonStatAvg = stats.reduce((sum, stat) => {
      const value = (seasonAvg as unknown as Record<string, number>)[stat];
      return sum + (typeof value === 'number' ? value : 0);
    }, 0);
  }

  // Avoid division by zero
  const gamesChecked = recentGames.length;
  if (gamesChecked === 0) {
    safeLog('No valid games to calculate hit rate', { playerName });
    return null;
  }

  return {
    playerName: `${player.first_name} ${player.last_name}`,
    playerId: player.id,
    market,
    line,
    direction,
    matchesChecked: gamesChecked,
    hits,
    hitRate: Math.round((hits / gamesChecked) * 100),
    recentGames,
    avgValue: Math.round((totalValue / gamesChecked) * 100) / 100,
    seasonAvg: seasonStatAvg ? Math.round(seasonStatAvg * 100) / 100 : undefined,
  };
}

/**
 * Batch validate multiple NBA bets
 */
export async function batchValidateNBABets(
  bets: Array<{
    playerName: string;
    market: string;
    line: number;
    direction: 'over' | 'under';
    opportunityId: string;
  }>,
  matchCount: number = 10
): Promise<Map<string, NBAValidationResult | null>> {
  const results = new Map<string, NBAValidationResult | null>();

  // Process in batches to respect rate limits (600/min = 10/sec)
  const batchSize = 5;
  for (let i = 0; i < bets.length; i += batchSize) {
    const batch = bets.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(async bet => {
        const result = await validateNBAPlayerBet(
          bet.playerName,
          bet.market,
          bet.line,
          bet.direction,
          matchCount
        );
        return { id: bet.opportunityId, result };
      })
    );

    for (const { id, result } of batchResults) {
      results.set(id, result);
    }

    // Small delay between batches
    if (i + batchSize < bets.length) {
      await sleep(200);
    }
  }

  return results;
}

/**
 * Clear the cache
 */
export function clearCache(): void {
  cache.clear();
  safeLog('Cache cleared');
}
