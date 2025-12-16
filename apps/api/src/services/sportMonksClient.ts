import { config } from '../config.js';
import type { TeamStats, PlayerStats, FixtureStats } from '@ev-bets/shared';

// API configuration
const API_BASE_URL = config.sportMonksBaseUrl;
const API_KEY = config.sportMonksApiKey;

// Simple in-memory cache
const cache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

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

// Generic API response type
interface SportMonksResponse<T> {
  data: T;
  subscription?: unknown[];
  rate_limit?: {
    resets_in_seconds: number;
    remaining: number;
    requested_entity: string;
  };
  pagination?: {
    count: number;
    per_page: number;
    current_page: number;
    next_page: string | null;
    has_more: boolean;
  };
}

// SportMonks team type
interface SportMonksTeam {
  id: number;
  name: string;
  short_code?: string;
  country_id?: number;
}

// SportMonks player type
interface SportMonksPlayer {
  id: number;
  sport_id?: number;
  country_id?: number;
  nationality_id?: number;
  city_id?: number;
  position_id?: number;
  detailed_position_id?: number;
  common_name?: string;
  firstname?: string;
  lastname?: string;
  name?: string;
  display_name?: string;
  image_path?: string;
  height?: number;
  weight?: number;
  date_of_birth?: string;
}

// SportMonks season statistic type
interface SportMonksStatistic {
  id: number;
  model_id: number;
  type_id: number;
  relation_id: number;
  value: {
    total?: number;
    home?: number;
    away?: number;
    average?: number;
    goals?: number;
    assists?: number;
    // Add more as needed
  };
  details?: {
    type_id: number;
    type_name: string;
    value: number | { count?: number; percentage?: number };
  }[];
}

// SportMonks fixture type
interface SportMonksFixture {
  id: number;
  sport_id?: number;
  league_id?: number;
  season_id?: number;
  stage_id?: number;
  group_id?: number;
  aggregate_id?: number;
  round_id?: number;
  state_id?: number;
  venue_id?: number;
  name?: string;
  starting_at?: string;
  result_info?: string;
  leg?: string;
  details?: string;
  length?: number;
  placeholder?: boolean;
  has_odds?: boolean;
  starting_at_timestamp?: number;
  // Related data via includes
  participants?: SportMonksTeam[];
  statistics?: SportMonksStatistic[];
  lineups?: unknown[];
  events?: unknown[];
}

// Standing entry type
interface SportMonksStanding {
  id: number;
  participant_id: number;
  sport_id?: number;
  league_id?: number;
  season_id?: number;
  stage_id?: number;
  group_id?: number;
  round_id?: number;
  position: number;
  points?: number;
  details?: {
    type_id: number;
    value: number | string;
    standing_type?: string;
  }[];
  form?: {
    fixture_id: number;
    form: string; // "W", "D", "L"
  }[];
  participant?: SportMonksTeam;
}

// Safe logging
function safeLog(message: string, data?: Record<string, unknown>) {
  console.info(`[SportMonks] ${message}`, data || '');
}

// Sleep utility
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Fetch with retry
async function fetchWithRetry<T>(
  endpoint: string,
  params: Record<string, string | string[]> = {},
  retries = 3
): Promise<T | null> {
  if (!API_KEY) {
    console.warn('[SportMonks] API key not configured');
    return null;
  }

  const url = new URL(`${API_BASE_URL}${endpoint}`);
  url.searchParams.set('api_token', API_KEY);

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      url.searchParams.set(key, value.join(','));
    } else if (value) {
      url.searchParams.set(key, value);
    }
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url.toString());

      if (response.status === 429) {
        // Rate limited - wait and retry
        const retryAfter = parseInt(response.headers.get('retry-after') || '60', 10);
        safeLog(`Rate limited, waiting ${retryAfter}s`);
        await sleep(retryAfter * 1000);
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json() as SportMonksResponse<T>;
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
 * Search for a fixture by team names and date
 */
export async function searchFixture(
  homeTeam: string,
  awayTeam: string,
  date: string
): Promise<SportMonksFixture | null> {
  const cacheKey = `fixture:${homeTeam}:${awayTeam}:${date}`;
  const cached = getCached<SportMonksFixture>(cacheKey);
  if (cached) return cached;

  // Get date range (same day)
  const startDate = new Date(date);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(date);
  endDate.setHours(23, 59, 59, 999);

  const startStr = startDate.toISOString().split('T')[0];
  const endStr = endDate.toISOString().split('T')[0];

  safeLog('Searching for fixture', { homeTeam, awayTeam, date: startStr });

  // Fetch fixtures for the date range
  const fixtures = await fetchWithRetry<SportMonksFixture[]>(
    `/fixtures/between/${startStr}/${endStr}`,
    {
      include: 'participants',
    }
  );

  if (!fixtures || fixtures.length === 0) {
    return null;
  }

  // Find matching fixture by team names
  const normalizedHome = normalizeTeamName(homeTeam);
  const normalizedAway = normalizeTeamName(awayTeam);

  const match = fixtures.find(f => {
    if (!f.participants || f.participants.length < 2) return false;

    const teams = f.participants.map(p => normalizeTeamName(p.name));

    return (
      (teams[0].includes(normalizedHome) || normalizedHome.includes(teams[0])) &&
      (teams[1].includes(normalizedAway) || normalizedAway.includes(teams[1]))
    ) || (
      (teams[1].includes(normalizedHome) || normalizedHome.includes(teams[1])) &&
      (teams[0].includes(normalizedAway) || normalizedAway.includes(teams[0]))
    );
  });

  if (match) {
    setCache(cacheKey, match);
  }

  return match || null;
}

/**
 * Get fixture with full statistics
 */
export async function getFixtureWithStats(
  fixtureId: number
): Promise<SportMonksFixture | null> {
  const cacheKey = `fixture-stats:${fixtureId}`;
  const cached = getCached<SportMonksFixture>(cacheKey);
  if (cached) return cached;

  const fixture = await fetchWithRetry<SportMonksFixture>(
    `/fixtures/${fixtureId}`,
    {
      include: 'participants,statistics,lineups.player',
    }
  );

  if (fixture) {
    setCache(cacheKey, fixture);
  }

  return fixture;
}

/**
 * Get standings for a season (includes team form)
 */
export async function getSeasonStandings(
  seasonId: number
): Promise<SportMonksStanding[] | null> {
  const cacheKey = `standings:${seasonId}`;
  const cached = getCached<SportMonksStanding[]>(cacheKey);
  if (cached) return cached;

  const standings = await fetchWithRetry<SportMonksStanding[]>(
    `/standings/seasons/${seasonId}`,
    {
      include: 'participant,form,details',
    }
  );

  if (standings) {
    setCache(cacheKey, standings);
  }

  return standings;
}

/**
 * Get team statistics for a season
 */
export async function getTeamSeasonStats(
  teamId: number,
  seasonId: number
): Promise<SportMonksStatistic[] | null> {
  const cacheKey = `team-stats:${teamId}:${seasonId}`;
  const cached = getCached<SportMonksStatistic[]>(cacheKey);
  if (cached) return cached;

  const stats = await fetchWithRetry<SportMonksStatistic[]>(
    `/statistics/seasons/teams/${seasonId}`,
    {
      filters: `teamStatisticTeamId:${teamId}`,
    }
  );

  if (stats) {
    setCache(cacheKey, stats);
  }

  return stats;
}

/**
 * Get player statistics for a season
 */
export async function getPlayerSeasonStats(
  playerId: number,
  seasonId: number
): Promise<SportMonksStatistic[] | null> {
  const cacheKey = `player-stats:${playerId}:${seasonId}`;
  const cached = getCached<SportMonksStatistic[]>(cacheKey);
  if (cached) return cached;

  const stats = await fetchWithRetry<SportMonksStatistic[]>(
    `/statistics/seasons/players/${seasonId}`,
    {
      filters: `playerStatisticPlayerId:${playerId}`,
    }
  );

  if (stats) {
    setCache(cacheKey, stats);
  }

  return stats;
}

/**
 * Search for a player by name
 */
export async function searchPlayer(
  name: string
): Promise<SportMonksPlayer | null> {
  const cacheKey = `player-search:${name.toLowerCase()}`;
  const cached = getCached<SportMonksPlayer>(cacheKey);
  if (cached) return cached;

  const players = await fetchWithRetry<SportMonksPlayer[]>(
    '/players/search/' + encodeURIComponent(name)
  );

  if (players && players.length > 0) {
    const player = players[0];
    setCache(cacheKey, player);
    return player;
  }

  return null;
}

/**
 * Get comprehensive fixture stats for bet-backing display
 */
export async function getFixtureStats(
  homeTeam: string,
  awayTeam: string,
  startsAt: string
): Promise<FixtureStats | null> {
  try {
    // First, find the fixture in SportMonks
    const fixture = await searchFixture(homeTeam, awayTeam, startsAt);

    if (!fixture || !fixture.id) {
      safeLog('Fixture not found', { homeTeam, awayTeam, startsAt });
      return null;
    }

    // Get fixture with full stats
    const fixtureWithStats = await getFixtureWithStats(fixture.id);

    if (!fixtureWithStats || !fixtureWithStats.participants) {
      return null;
    }

    // Get season standings for form and position
    const seasonId = fixtureWithStats.season_id;
    let standings: SportMonksStanding[] | null = null;

    if (seasonId) {
      standings = await getSeasonStandings(seasonId);
    }

    // Build team stats
    const [homeParticipant, awayParticipant] = fixtureWithStats.participants;

    const homeStats = buildTeamStats(homeParticipant, standings);
    const awayStats = buildTeamStats(awayParticipant, standings);

    // Build player stats from lineups
    const playerStats: Record<string, PlayerStats> = {};

    // TODO: Extract player stats from lineups and match statistics
    // This requires additional API calls per player, which could be expensive
    // For now, we'll populate with team-level stats

    return {
      fixtureId: fixture.id.toString(),
      sportMonksFixtureId: fixture.id,
      homeTeam: homeStats,
      awayTeam: awayStats,
      playerStats,
      cachedAt: new Date().toISOString(),
    };
  } catch (error) {
    safeLog('Error getting fixture stats', {
      error: error instanceof Error ? error.message : 'Unknown',
      homeTeam,
      awayTeam,
    });
    return null;
  }
}

/**
 * Build team stats from participant and standings
 */
function buildTeamStats(
  team: SportMonksTeam,
  standings: SportMonksStanding[] | null
): TeamStats {
  const standing = standings?.find(s => s.participant_id === team.id);

  // Extract form from standings
  let form = '';
  if (standing?.form) {
    form = standing.form
      .slice(0, 5)
      .map(f => f.form)
      .join('');
  }

  // Extract details
  let played = 0;
  let won = 0;
  let drawn = 0;
  let lost = 0;
  let goalsScored = 0;
  let goalsConceded = 0;

  if (standing?.details) {
    for (const detail of standing.details) {
      // Type IDs vary, but common ones:
      // 129 = Matches Played, 130 = Won, 131 = Draw, 132 = Lost
      // 133 = Goals For, 134 = Goals Against
      const value = typeof detail.value === 'number' ? detail.value : 0;
      switch (detail.type_id) {
        case 129:
          played = value;
          break;
        case 130:
          won = value;
          break;
        case 131:
          drawn = value;
          break;
        case 132:
          lost = value;
          break;
        case 133:
          goalsScored = value;
          break;
        case 134:
          goalsConceded = value;
          break;
      }
    }
  }

  const avgGoalsScored = played > 0 ? goalsScored / played : 0;
  const avgGoalsConceded = played > 0 ? goalsConceded / played : 0;

  return {
    teamId: team.id.toString(),
    name: team.name,
    shortName: team.short_code,
    form,
    position: standing?.position,
    played,
    won,
    drawn,
    lost,
    goalsScored,
    goalsConceded,
    avgGoalsScored: Math.round(avgGoalsScored * 100) / 100,
    avgGoalsConceded: Math.round(avgGoalsConceded * 100) / 100,
  };
}

/**
 * Normalize team name for matching
 */
function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/fc|afc|sc|cf|ac/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Clear the cache (useful for testing or manual refresh)
 */
export function clearCache(): void {
  cache.clear();
  safeLog('Cache cleared');
}

// ============================================================================
// VALIDATION FUNCTIONS - Check historical hit rates
// ============================================================================

// Player fixture with stats
interface PlayerFixtureStats {
  fixtureId: number;
  date: string;
  opponent: string;
  stats: {
    shots?: number;
    shotsOnTarget?: number;
    goals?: number;
    assists?: number;
    tackles?: number;
    fouls?: number;
    passes?: number;
    crosses?: number;
    clearances?: number;
    interceptions?: number;
    blocks?: number;
    saves?: number;
    yellowCards?: number;
    redCards?: number;
  };
}

// Validation result
export interface ValidationResult {
  playerName: string;
  market: string;
  line: number;
  direction: 'over' | 'under';
  matchesChecked: number;
  hits: number;
  hitRate: number; // 0-100
  recentMatches: {
    date: string;
    opponent: string;
    value: number;
    hit: boolean;
  }[];
  avgValue: number;
}

// Map market types to stat keys
const MARKET_TO_STAT: Record<string, keyof PlayerFixtureStats['stats']> = {
  'player_shots_over_under': 'shots',
  'player_shots_on_target_over_under': 'shotsOnTarget',
  'player_goals_over_under': 'goals',
  'player_assists_over_under': 'assists',
  'player_tackles_over_under': 'tackles',
  'player_fouls_over_under': 'fouls',
  'player_passes_over_under': 'passes',
  'player_crosses_over_under': 'crosses',
  'player_clearances_over_under': 'clearances',
  'player_interceptions_over_under': 'interceptions',
  'player_blocks_over_under': 'blocks',
  'player_saves_over_under': 'saves',
  'player_yellow_cards_over_under': 'yellowCards',
  'player_red_cards_over_under': 'redCards',
};

// SportMonks stat type IDs (approximate - may vary)
const STAT_TYPE_IDS: Record<string, number[]> = {
  shots: [42, 86], // Total shots
  shotsOnTarget: [43, 87], // Shots on target
  goals: [52, 79], // Goals
  assists: [79, 80], // Assists
  tackles: [78, 84], // Tackles
  fouls: [56, 75], // Fouls committed
  passes: [80, 116], // Total passes
  crosses: [99, 117], // Crosses
  clearances: [93, 100], // Clearances
  interceptions: [101, 104], // Interceptions
  blocks: [97, 98], // Blocks
  saves: [57, 58], // Saves
  yellowCards: [84, 85], // Yellow cards
  redCards: [83, 84], // Red cards
};

/**
 * Get player's recent fixtures with statistics
 */
export async function getPlayerRecentFixtures(
  playerName: string,
  limit: number = 10
): Promise<PlayerFixtureStats[]> {
  const cacheKey = `player-fixtures:${playerName.toLowerCase()}:${limit}`;
  const cached = getCached<PlayerFixtureStats[]>(cacheKey);
  if (cached) return cached;

  // First search for the player
  const player = await searchPlayer(playerName);
  if (!player) {
    safeLog('Player not found', { playerName });
    return [];
  }

  safeLog('Found player', { playerName, playerId: player.id });

  // Get player's fixtures with statistics
  // Using the player's fixtures endpoint with statistics include
  const fixtures = await fetchWithRetry<SportMonksFixture[]>(
    `/players/${player.id}/fixtures`,
    {
      include: 'participants,statistics.type',
      per_page: String(limit),
      order: 'starting_at',
      direction: 'desc',
    }
  );

  if (!fixtures || fixtures.length === 0) {
    safeLog('No fixtures found for player', { playerName, playerId: player.id });
    return [];
  }

  // Transform fixtures to our format
  const result: PlayerFixtureStats[] = [];

  for (const fixture of fixtures) {
    const stats: PlayerFixtureStats['stats'] = {};

    // Extract player statistics from fixture
    if (fixture.statistics) {
      for (const stat of fixture.statistics) {
        // Match player ID and extract stat value
        if (stat.model_id === player.id || stat.relation_id === player.id) {
          const value = typeof stat.value === 'object' ? stat.value.total : stat.value;
          if (typeof value === 'number') {
            // Map stat type ID to our stat keys
            for (const [key, typeIds] of Object.entries(STAT_TYPE_IDS)) {
              if (typeIds.includes(stat.type_id)) {
                stats[key as keyof PlayerFixtureStats['stats']] = value;
              }
            }
          }
        }
      }
    }

    // Get opponent name
    let opponent = 'Unknown';
    if (fixture.participants && fixture.participants.length >= 2) {
      opponent = fixture.participants
        .map(p => p.name)
        .filter(n => !n.toLowerCase().includes(playerName.toLowerCase().split(' ')[0]))
        .join(' vs ');
    }

    result.push({
      fixtureId: fixture.id,
      date: fixture.starting_at || '',
      opponent,
      stats,
    });
  }

  setCache(cacheKey, result);
  return result;
}

/**
 * Validate a player bet against historical data
 */
export async function validatePlayerBet(
  playerName: string,
  market: string,
  line: number,
  direction: 'over' | 'under',
  matchCount: number = 10
): Promise<ValidationResult | null> {
  const statKey = MARKET_TO_STAT[market];
  if (!statKey) {
    safeLog('Unknown market type', { market });
    return null;
  }

  const fixtures = await getPlayerRecentFixtures(playerName, matchCount);
  if (fixtures.length === 0) {
    return null;
  }

  const recentMatches: ValidationResult['recentMatches'] = [];
  let hits = 0;
  let totalValue = 0;
  let matchesWithStat = 0;

  for (const fixture of fixtures) {
    const value = fixture.stats[statKey];
    if (value !== undefined) {
      matchesWithStat++;
      totalValue += value;

      const hit = direction === 'over' ? value > line : value < line;
      if (hit) hits++;

      recentMatches.push({
        date: fixture.date,
        opponent: fixture.opponent,
        value,
        hit,
      });
    }
  }

  if (matchesWithStat === 0) {
    safeLog('No stat data found for player', { playerName, statKey });
    return null;
  }

  return {
    playerName,
    market,
    line,
    direction,
    matchesChecked: matchesWithStat,
    hits,
    hitRate: Math.round((hits / matchesWithStat) * 100),
    recentMatches,
    avgValue: Math.round((totalValue / matchesWithStat) * 100) / 100,
  };
}
