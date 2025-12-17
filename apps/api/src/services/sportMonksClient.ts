import { config } from '../config.js';
import type { TeamStats, PlayerStats, FixtureStats } from '@ev-bets/shared';

// API configuration
const API_BASE_URL = config.sportMonksBaseUrl;
const API_KEY = config.sportMonksApiKey;

// Simple in-memory cache
const cache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const SHORT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes for validation data

function getCached<T>(key: string): T | null {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data as T;
  }
  cache.delete(key);
  return null;
}

function setCache(key: string, data: unknown, ttl: number = CACHE_TTL_MS): void {
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttl,
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
  meta?: {
    location?: 'home' | 'away';
    winner?: boolean;
    position?: number | null;
  };
}

// Player team entry from teams include
interface PlayerTeamEntry {
  id: number;
  transfer_id?: number | null;
  player_id: number;
  team_id: number;
  position_id?: number;
  detailed_position_id?: number;
  start?: string | null;
  end?: string | null;
  captain?: boolean;
  jersey_number?: number;
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
  teams?: PlayerTeamEntry[];
}

// SportMonks season statistic type
interface SportMonksStatistic {
  id: number;
  model_id: number;
  type_id: number;
  relation_id: number;
  participant_id?: number; // For fixture statistics
  value: {
    total?: number;
    home?: number;
    away?: number;
    average?: number;
    goals?: number;
    assists?: number;
  };
  data?: {
    value?: number;
  };
  details?: {
    type_id: number;
    type_name: string;
    value: number | { count?: number; percentage?: number };
  }[];
}

// SportMonks lineup entry type
interface SportMonksLineupEntry {
  id?: number;
  player_id: number;
  team_id?: number;
  fixture_id?: number;
  type_id?: number;
  position_id?: number;
  player_name?: string;
  jersey_number?: number;
  details?: Array<{
    type_id: number;
    data?: { value?: number };
  }>;
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
  scores?: Array<{
    id: number;
    fixture_id: number;
    type_id: number;
    participant_id: number;
    score: { goals: number; participant: string };
    description: string;
  }>;
  lineups?: SportMonksLineupEntry[];
  events?: Array<{
    id: number;
    type_id: number;
    fixture_id: number;
    participant_id: number;
    player_id?: number;
    related_player_id?: number;
    minute?: number;
  }>;
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

// ============================================================================
// STAT TYPE ID MAPPINGS - Verified from SportMonks API Documentation
// ============================================================================

/**
 * SportMonks Stat Type IDs
 * These IDs are used to identify specific statistics in the API responses.
 * Sourced from SportMonks documentation and API exploration.
 */
export const STAT_TYPE_IDS = {
  // Team/Match Statistics
  corners: 34,
  attacks: 43,
  dangerousAttacks: 44,
  ballPossession: 45,
  penalties: 47,
  offsides: 51,

  // Shots Statistics
  shotsTotal: 42,
  shotsOnTarget: 86,
  shotsOffTarget: 41,
  shotsInsideBox: 49,
  shotsOutsideBox: 50,
  shotsBlocked: 58,
  hitWoodwork: 64,

  // Goals & Scoring
  goals: 52,
  goalsConceded: 88,
  bigChancesCreated: 580,
  bigChancesMissed: 581,

  // Defensive Statistics
  tackles: 78,
  fouls: 56,
  foulsDrawn: 96,
  saves: 57,
  clearances: 101,
  blockedShots: 97,
  interceptions: 102, // Per-match interceptions
  interceptionsTotal: 27252, // Season total

  // Passing Statistics
  passes: 80,
  accuratePasses: 116,
  keyPasses: 117,
  longBalls: 122,
  longBallsWon: 123,
  crosses: 99,
  accurateCrosses: 100,

  // Dribbling & Duels
  dribbleAttempts: 108,
  successfulDribbles: 109,
  dribbledPast: 110,
  totalDuels: 105,
  duelsWon: 106,
  aerialDuels: 107,
  aerialDuelsWon: 115,

  // Cards
  yellowCards: 84,
  redCards: 83,
  yellowRedCards: 85,

  // Other
  assists: 79,
  minutesPlayed: 119,
  touches: 120,
  rating: 118,
  substitutions: 59,

  // Standing Details
  standingPlayed: 129,
  standingWon: 130,
  standingDrawn: 131,
  standingLost: 132,
  standingGoalsFor: 133,
  standingGoalsAgainst: 134,
} as const;

/**
 * Map market types to stat type IDs
 * Used to look up which stat to check for a given market
 */
export const MARKET_TO_STAT_TYPE: Record<string, number | number[]> = {
  // Player Props - Shots
  'player_shots_over_under': STAT_TYPE_IDS.shotsTotal,
  'player_shots_on_target_over_under': STAT_TYPE_IDS.shotsOnTarget,
  'player_shots_off_target_over_under': STAT_TYPE_IDS.shotsOffTarget,

  // Player Props - Goals/Assists
  'player_goals_over_under': STAT_TYPE_IDS.goals,
  'player_assists_over_under': STAT_TYPE_IDS.assists,
  'player_goal_assists_over_under': [STAT_TYPE_IDS.goals, STAT_TYPE_IDS.assists], // Combined

  // Player Props - Defensive
  'player_tackles_over_under': STAT_TYPE_IDS.tackles,
  'player_fouls_over_under': STAT_TYPE_IDS.fouls,
  'player_clearances_over_under': STAT_TYPE_IDS.clearances,
  'player_interceptions_over_under': STAT_TYPE_IDS.interceptions,
  'player_blocks_over_under': STAT_TYPE_IDS.blockedShots,
  'player_saves_over_under': STAT_TYPE_IDS.saves,

  // Player Props - Passing
  'player_passes_over_under': STAT_TYPE_IDS.passes,
  'player_key_passes_over_under': STAT_TYPE_IDS.keyPasses,
  'player_crosses_over_under': STAT_TYPE_IDS.crosses,
  'player_accurate_passes_over_under': STAT_TYPE_IDS.accuratePasses,

  // Player Props - Dribbling
  'player_dribbles_over_under': STAT_TYPE_IDS.successfulDribbles,
  'player_dribble_attempts_over_under': STAT_TYPE_IDS.dribbleAttempts,

  // Player Props - Duels
  'player_duels_over_under': STAT_TYPE_IDS.totalDuels,
  'player_duels_won_over_under': STAT_TYPE_IDS.duelsWon,
  'player_aerial_duels_over_under': STAT_TYPE_IDS.aerialDuels,

  // Player Props - Cards
  'player_yellow_cards_over_under': STAT_TYPE_IDS.yellowCards,
  'player_red_cards_over_under': STAT_TYPE_IDS.redCards,
  'player_cards_over_under': [STAT_TYPE_IDS.yellowCards, STAT_TYPE_IDS.redCards],

  // Player Props - Other
  'player_touches_over_under': STAT_TYPE_IDS.touches,
  'player_offsides_over_under': STAT_TYPE_IDS.offsides,

  // Team Props
  'team_corners_over_under': STAT_TYPE_IDS.corners,
  'team_shots_over_under': STAT_TYPE_IDS.shotsTotal,
  'team_shots_on_target_over_under': STAT_TYPE_IDS.shotsOnTarget,
  'team_fouls_over_under': STAT_TYPE_IDS.fouls,
  'team_offsides_over_under': STAT_TYPE_IDS.offsides,
};

/**
 * Human-readable stat names for display
 */
export const STAT_TYPE_NAMES: Record<number, string> = {
  [STAT_TYPE_IDS.shotsTotal]: 'Shots',
  [STAT_TYPE_IDS.shotsOnTarget]: 'Shots on Target',
  [STAT_TYPE_IDS.shotsOffTarget]: 'Shots off Target',
  [STAT_TYPE_IDS.goals]: 'Goals',
  [STAT_TYPE_IDS.assists]: 'Assists',
  [STAT_TYPE_IDS.tackles]: 'Tackles',
  [STAT_TYPE_IDS.fouls]: 'Fouls',
  [STAT_TYPE_IDS.clearances]: 'Clearances',
  [STAT_TYPE_IDS.interceptions]: 'Interceptions',
  [STAT_TYPE_IDS.blockedShots]: 'Blocked Shots',
  [STAT_TYPE_IDS.saves]: 'Saves',
  [STAT_TYPE_IDS.passes]: 'Passes',
  [STAT_TYPE_IDS.keyPasses]: 'Key Passes',
  [STAT_TYPE_IDS.crosses]: 'Crosses',
  [STAT_TYPE_IDS.accuratePasses]: 'Accurate Passes',
  [STAT_TYPE_IDS.successfulDribbles]: 'Successful Dribbles',
  [STAT_TYPE_IDS.dribbleAttempts]: 'Dribble Attempts',
  [STAT_TYPE_IDS.totalDuels]: 'Duels',
  [STAT_TYPE_IDS.duelsWon]: 'Duels Won',
  [STAT_TYPE_IDS.aerialDuels]: 'Aerial Duels',
  [STAT_TYPE_IDS.yellowCards]: 'Yellow Cards',
  [STAT_TYPE_IDS.redCards]: 'Red Cards',
  [STAT_TYPE_IDS.touches]: 'Touches',
  [STAT_TYPE_IDS.corners]: 'Corners',
  [STAT_TYPE_IDS.offsides]: 'Offsides',
};

// ============================================================================
// NAME NORMALIZATION - Match player/team names across different sources
// ============================================================================

/**
 * Common name variations and aliases for players
 */
const PLAYER_NAME_ALIASES: Record<string, string[]> = {
  // Example: Mohamed Salah might appear as Mo Salah, M. Salah, etc.
  'mohamed salah': ['mo salah', 'm salah', 'salah m'],
  'cristiano ronaldo': ['c ronaldo', 'ronaldo c', 'cr7'],
  'lionel messi': ['leo messi', 'l messi', 'messi l'],
  'kevin de bruyne': ['k de bruyne', 'de bruyne k', 'kdb'],
  'robert lewandowski': ['r lewandowski', 'lewandowski r', 'lewy'],
  'erling haaland': ['e haaland', 'haaland e'],
  'kylian mbappe': ['k mbappe', 'mbappe k'],
  'neymar jr': ['neymar', 'neymar junior'],
  'raphinha': ['raphael dias belloli'],
  'rodrygo': ['rodrygo goes'],
  'vinicius jr': ['vinicius junior', 'vini jr', 'vinicius'],
};

/**
 * Common team name variations and aliases
 */
const TEAM_NAME_ALIASES: Record<string, string[]> = {
  'manchester united': ['man united', 'man utd', 'mufc'],
  'manchester city': ['man city', 'mcfc'],
  'tottenham hotspur': ['tottenham', 'spurs', 'thfc'],
  'wolverhampton wanderers': ['wolves', 'wolverhampton'],
  'west ham united': ['west ham', 'whu', 'hammers'],
  'newcastle united': ['newcastle', 'nufc'],
  'nottingham forest': ['nott forest', 'nottm forest', 'forest'],
  'brighton & hove albion': ['brighton', 'brighton hove'],
  'crystal palace': ['palace', 'cpfc'],
  'aston villa': ['villa', 'avfc'],
  'leicester city': ['leicester', 'lcfc'],
  'real madrid': ['r madrid', 'madrid'],
  'atletico madrid': ['atletico', 'atl madrid'],
  'barcelona': ['barca', 'fc barcelona'],
  'bayern munich': ['bayern', 'fc bayern'],
  'borussia dortmund': ['dortmund', 'bvb'],
  'paris saint-germain': ['psg', 'paris sg'],
  'inter milan': ['inter', 'internazionale'],
  'ac milan': ['milan'],
  'juventus': ['juve'],
};

/**
 * Normalize a player name for matching
 * - Remove accents and diacritics
 * - Lowercase
 * - Remove common suffixes (Jr., II, III)
 * - Handle initials
 */
export function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[''`]/g, '') // Remove apostrophes
    .replace(/\s+(jr|sr|iii|ii|iv)\.?$/i, '') // Remove suffixes
    .replace(/\./g, '') // Remove periods (J.J. -> JJ)
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * Normalize a team name for matching
 */
export function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/fc|afc|sc|cf|ac|ssc/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Simplify a team name for better SportMonks search
 * Handles complex names like "BV Borussia 09 Dortmund" -> "Borussia Dortmund"
 */
function simplifyTeamName(name: string): string {
  return name
    // Remove German/European club prefixes
    .replace(/^(BV|VfL|VfB|SV|TSV|FSV|SpVgg|RB|1\.\s*FC|FC|SC|Borussia VfL|SSC|AS|AC|US|SS|AJ|OGC|RC|Stade|Olympique|Real|Atlético|Deportivo|CD|UD|Villarreal CF|Valencia CF)\s+/gi, '')
    // Remove numbers (like 09, 1860, etc.)
    .replace(/\s+\d{2,4}\s+/g, ' ')
    .replace(/\s+\d{2,4}$/g, '')
    // Remove common suffixes
    .replace(/\s+(FC|SC|CF|AC)$/gi, '')
    // Normalize spaces
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generate search variants for a team name
 */
function generateTeamSearchVariants(name: string): string[] {
  const variants = [name];

  // Add simplified version
  const simplified = simplifyTeamName(name);
  if (simplified !== name && simplified.length > 2) {
    variants.push(simplified);
  }

  // Handle specific patterns
  // "Borussia VfL Mönchengladbach" -> "Mönchengladbach", "Gladbach"
  if (name.toLowerCase().includes('gladbach') || name.toLowerCase().includes('mönchengladbach')) {
    variants.push('Borussia Mönchengladbach');
    variants.push('Gladbach');
  }

  // "BV Borussia 09 Dortmund" -> "Borussia Dortmund", "Dortmund"
  if (name.toLowerCase().includes('dortmund')) {
    variants.push('Borussia Dortmund');
    variants.push('Dortmund');
  }

  // Remove "Borussia" prefix if present for the main city name
  if (name.toLowerCase().includes('borussia')) {
    const withoutBorussia = name.replace(/borussia\s*/gi, '').trim();
    const simplifiedWithoutBorussia = simplifyTeamName(withoutBorussia);
    if (simplifiedWithoutBorussia.length > 2) {
      variants.push(simplifiedWithoutBorussia);
    }
  }

  // Try just the last word (often the city name)
  const words = simplified.split(' ');
  if (words.length > 1) {
    const lastWord = words[words.length - 1];
    if (lastWord.length > 3) {
      variants.push(lastWord);
    }
  }

  return [...new Set(variants)]; // Remove duplicates
}

/**
 * Check if two player names match (with fuzzy matching)
 */
export function playerNamesMatch(name1: string, name2: string): boolean {
  const n1 = normalizePlayerName(name1);
  const n2 = normalizePlayerName(name2);

  // Exact match
  if (n1 === n2) return true;

  // Check aliases
  for (const [canonical, aliases] of Object.entries(PLAYER_NAME_ALIASES)) {
    const allVariants = [canonical, ...aliases];
    if (allVariants.includes(n1) && allVariants.includes(n2)) {
      return true;
    }
  }

  // Check if one name contains the other (for partial matches like "Salah" matching "Mohamed Salah")
  if (n1.includes(n2) || n2.includes(n1)) return true;

  // Check last name match (most reliable for soccer players)
  const parts1 = n1.split(' ');
  const parts2 = n2.split(' ');
  const lastName1 = parts1[parts1.length - 1];
  const lastName2 = parts2[parts2.length - 1];

  if (lastName1 === lastName2 && lastName1.length > 2) {
    // If last names match and first initials match, it's likely the same person
    if (parts1[0]?.[0] === parts2[0]?.[0]) return true;
  }

  return false;
}

/**
 * Check if two team names match (with fuzzy matching)
 */
export function teamNamesMatch(name1: string, name2: string): boolean {
  const n1 = normalizeTeamName(name1);
  const n2 = normalizeTeamName(name2);

  if (n1 === n2) return true;

  // Check aliases
  for (const [canonical, aliases] of Object.entries(TEAM_NAME_ALIASES)) {
    const allVariants = [normalizeTeamName(canonical), ...aliases.map(normalizeTeamName)];
    if (allVariants.includes(n1) && allVariants.includes(n2)) {
      return true;
    }
  }

  // Check if one contains the other
  if (n1.includes(n2) || n2.includes(n1)) return true;

  return false;
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Search for a fixture by team names and date
 */
export async function searchFixture(
  homeTeam: string,
  awayTeam: string,
  date: string
): Promise<SportMonksFixture | null> {
  const cacheKey = `fixture:${normalizeTeamName(homeTeam)}:${normalizeTeamName(awayTeam)}:${date}`;
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
  const match = fixtures.find(f => {
    if (!f.participants || f.participants.length < 2) return false;

    const teams = f.participants.map(p => p.name);

    return (
      (teamNamesMatch(teams[0], homeTeam) && teamNamesMatch(teams[1], awayTeam)) ||
      (teamNamesMatch(teams[1], homeTeam) && teamNamesMatch(teams[0], awayTeam))
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
      include: 'participants;statistics;scores;events;lineups',
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
      include: 'participant;form;details',
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
 * Score how well a player matches the search name (higher = better)
 * Returns 0 if no match, 1-100 based on match quality
 */
function scorePlayerMatch(searchName: string, player: SportMonksPlayer): number {
  const searchNorm = normalizePlayerName(searchName);
  const searchParts = searchNorm.split(' ').filter(p => p.length > 1);

  // Get all possible names for the player
  const playerFullName = [player.firstname, player.lastname].filter(Boolean).join(' ');
  const displayName = player.display_name || player.common_name || player.name || playerFullName;

  const playerNames = [
    normalizePlayerName(displayName),
    normalizePlayerName(playerFullName),
    player.common_name ? normalizePlayerName(player.common_name) : '',
  ].filter(Boolean);

  let bestScore = 0;

  for (const playerName of playerNames) {
    // Exact match
    if (searchNorm === playerName) {
      return 100;
    }

    const playerParts = playerName.split(' ').filter(p => p.length > 1);

    // For multi-word searches, check how many parts match
    if (searchParts.length >= 2) {
      const searchLast = searchParts[searchParts.length - 1];
      const searchFirst = searchParts[0];

      // Check if last name matches exactly
      const lastMatches = playerParts.some(p => p === searchLast);
      // Check if first name/initial matches
      const firstMatches = playerParts.some(p =>
        p === searchFirst || p.startsWith(searchFirst) || searchFirst.startsWith(p)
      );

      if (lastMatches && firstMatches) {
        bestScore = Math.max(bestScore, 90); // Both first and last match
      } else if (lastMatches) {
        bestScore = Math.max(bestScore, 50); // Only last name matches
      }
    } else {
      // Single-word search - check if it matches any part
      const singleMatch = playerParts.some(p =>
        p === searchNorm || p.includes(searchNorm) || searchNorm.includes(p)
      );
      if (singleMatch) {
        bestScore = Math.max(bestScore, 70);
      }
    }

    // Check via aliases
    if (playerNamesMatch(searchName, playerName)) {
      bestScore = Math.max(bestScore, 80);
    }
  }

  return bestScore;
}

/**
 * Search for a player by name
 */
export async function searchPlayer(
  name: string
): Promise<SportMonksPlayer | null> {
  const normalizedName = normalizePlayerName(name);
  const cacheKey = `player-search:${normalizedName}`;
  const cached = getCached<SportMonksPlayer>(cacheKey);
  if (cached) return cached;

  safeLog('Searching for player', { name, normalized: normalizedName });

  // Try searching by the full name first
  let players = await fetchWithRetry<SportMonksPlayer[]>(
    '/players/search/' + encodeURIComponent(name)
  );

  // If no results, try with the last name only
  if ((!players || players.length === 0) && name.includes(' ')) {
    const lastName = name.split(' ').pop() || '';
    if (lastName.length > 2) {
      players = await fetchWithRetry<SportMonksPlayer[]>(
        '/players/search/' + encodeURIComponent(lastName)
      );
    }
  }

  if (!players || players.length === 0) {
    safeLog('Player not found', { name });
    return null;
  }

  // Score all players and find best match
  const scoredPlayers = players.map(p => ({
    player: p,
    score: scorePlayerMatch(name, p),
  }));

  // Sort by score descending
  scoredPlayers.sort((a, b) => b.score - a.score);

  const bestMatch = scoredPlayers[0];

  // For multi-word names, require at least a 50 score (last name match)
  const isMultiWord = name.includes(' ');
  const minScore = isMultiWord ? 50 : 30;

  if (bestMatch.score < minScore) {
    safeLog('No good match found', {
      name,
      bestScore: bestMatch.score,
      bestCandidate: bestMatch.player.display_name || bestMatch.player.common_name,
      minRequired: minScore,
    });
    return null;
  }

  const player = bestMatch.player;
  safeLog('Found player', {
    searchedName: name,
    foundName: player.display_name || player.common_name || `${player.firstname} ${player.lastname}`,
    id: player.id,
    matchScore: bestMatch.score,
  });

  setCache(cacheKey, player);
  return player;
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
      const value = typeof detail.value === 'number' ? detail.value : 0;
      switch (detail.type_id) {
        case STAT_TYPE_IDS.standingPlayed:
          played = value;
          break;
        case STAT_TYPE_IDS.standingWon:
          won = value;
          break;
        case STAT_TYPE_IDS.standingDrawn:
          drawn = value;
          break;
        case STAT_TYPE_IDS.standingLost:
          lost = value;
          break;
        case STAT_TYPE_IDS.standingGoalsFor:
          goalsScored = value;
          break;
        case STAT_TYPE_IDS.standingGoalsAgainst:
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
 * Clear the cache (useful for testing or manual refresh)
 */
export function clearCache(): void {
  cache.clear();
  safeLog('Cache cleared');
}

// ============================================================================
// PLAYER VALIDATION - Check historical hit rates for player props
// ============================================================================

// Player fixture with stats
interface PlayerFixtureStats {
  fixtureId: number;
  date: string;
  opponent: string;
  homeAway: 'home' | 'away';
  stats: Record<number, number>; // type_id -> value
}

// Validation result
export interface SoccerValidationResult {
  playerName: string;
  playerId: number;
  market: string;
  marketName: string;
  line: number;
  direction: 'over' | 'under';
  matchesChecked: number;
  hits: number;
  hitRate: number; // 0-100
  recentMatches: {
    date: string;
    opponent: string;
    homeAway: 'home' | 'away';
    value: number;
    hit: boolean;
  }[];
  avgValue: number;
  seasonAvg?: number;
}

// Lineup detail from SportMonks
interface LineupDetail {
  id: number;
  fixture_id: number;
  player_id: number;
  team_id: number;
  lineup_id: number;
  type_id: number;
  data: {
    value: number;
  };
}

// Lineup entry from SportMonks
interface LineupEntry {
  id: number;
  sport_id: number;
  fixture_id: number;
  player_id: number;
  team_id: number;
  position_id?: number;
  formation_field?: string;
  type_id: number;
  formation_position?: number;
  player_name?: string;
  jersey_number?: number;
  details?: LineupDetail[];
  fixture?: SportMonksFixture | null; // Included via lineups.fixture
}

// Event from SportMonks
interface SportMonksEvent {
  id: number;
  fixture_id: number;
  period_id?: number;
  participant_id: number;
  type_id: number;
  section: string;
  player_id?: number;
  related_player_id?: number;
  player_name?: string;
  related_player_name?: string;
  result?: string;
  info?: string;
  addition?: string;
  minute?: number;
  extra_minute?: number;
  sub_type_id?: number;
}

// Event type IDs
const EVENT_TYPES = {
  goal: 14,
  ownGoal: 16,
  substitution: 18,
  assist: 19,
  yellowCard: 84,
  redCard: 83,
  yellowRedCard: 85,
  penaltyScored: 14, // with sub_type_id check
  penaltyMissed: 17,
};

/**
 * Get player's recent fixtures with statistics using the correct SportMonks API approach:
 * 1. Get player with lineups include to find fixture IDs
 * 2. Fetch each fixture with lineups.details and events includes
 * 3. Extract stats from lineup.details and goals/assists from events
 */
export async function getPlayerRecentFixtures(
  playerId: number,
  limit: number = 10
): Promise<PlayerFixtureStats[]> {
  const cacheKey = `player-fixtures:${playerId}:${limit}`;
  const cached = getCached<PlayerFixtureStats[]>(cacheKey);
  if (cached) return cached;

  safeLog('Fetching player fixtures', { playerId, limit });

  // Step 1: Get player with lineups AND fixture data included
  // This allows us to filter to accessible fixtures only
  const playerData = await fetchWithRetry<SportMonksPlayer & { lineups?: LineupEntry[] }>(
    `/players/${playerId}`,
    {
      include: 'lineups.fixture;teams',
    }
  );

  if (!playerData || !playerData.lineups || playerData.lineups.length === 0) {
    safeLog('No lineups found for player', { playerId });
    return [];
  }

  // Get the player's current team ID
  let playerTeamId: number | null = null;
  if (playerData.teams && playerData.teams.length > 0) {
    // Find current team (no end date or end date in future)
    const currentTeam = playerData.teams.find(t =>
      !t.end || new Date(t.end) > new Date()
    );
    playerTeamId = currentTeam?.team_id || playerData.teams[0]?.team_id || null;
  }

  const now = new Date();

  // Filter to accessible PAST fixtures only
  const accessibleLineups = playerData.lineups.filter(l => {
    // Must have fixture data (accessible)
    if (!l.fixture) return false;

    // Must be a past fixture
    const fixtureDate = new Date(l.fixture.starting_at || '');
    if (fixtureDate >= now) return false;

    // Must be starting lineup (type 11) or substitute (type 12)
    if (l.type_id !== 11 && l.type_id !== 12) return false;

    return true;
  });

  // Prefer current team fixtures if available
  const currentTeamLineups = accessibleLineups.filter(l => l.team_id === playerTeamId);
  const lineupsToUse = currentTeamLineups.length >= 5 ? currentTeamLineups : accessibleLineups;

  // Sort by fixture date (most recent first)
  const recentLineups = lineupsToUse
    .sort((a, b) => {
      const dateA = new Date(a.fixture!.starting_at || '').getTime();
      const dateB = new Date(b.fixture!.starting_at || '').getTime();
      return dateB - dateA;
    })
    .slice(0, limit + 5); // Fetch extra in case some fail

  safeLog('Found player lineups', {
    playerId,
    totalLineups: playerData.lineups.length,
    accessibleLineups: accessibleLineups.length,
    currentTeamLineups: currentTeamLineups.length,
    recentLineups: recentLineups.length,
    teamId: playerTeamId,
    sampleFixtures: recentLineups.slice(0, 3).map(l => ({
      fixture_id: l.fixture_id,
      team_id: l.team_id,
      date: l.fixture?.starting_at,
      name: l.fixture?.name,
    })),
  });

  if (recentLineups.length === 0) {
    safeLog('No accessible past fixtures found', { playerId });
    return [];
  }

  const fixtureIds = [...new Set(recentLineups.map(l => l.fixture_id))].slice(0, limit);

  safeLog('Fixture IDs to fetch', {
    playerId,
    count: fixtureIds.length,
    ids: fixtureIds.slice(0, 5),
  });

  // Step 2: Fetch fixtures with full details (lineups.details and events)
  const result: PlayerFixtureStats[] = [];

  for (const fixtureId of fixtureIds) {
    try {
      safeLog('Fetching fixture details', { fixtureId });

      const fixtureData = await fetchWithRetry<SportMonksFixture & {
        lineups?: LineupEntry[];
        events?: SportMonksEvent[];
      }>(
        `/fixtures/${fixtureId}`,
        {
          include: 'participants;lineups.details;events',
        }
      );

      if (!fixtureData) {
        safeLog('Fixture fetch returned null', { fixtureId });
        continue;
      }

      const stats: Record<number, number> = {};

      // Extract player's lineup entry with details
      const playerLineup = fixtureData.lineups?.find(l => l.player_id === playerId);

      if (playerLineup?.details) {
        for (const detail of playerLineup.details) {
          const value = detail.data?.value;
          if (typeof value === 'number' && value > 0) {
            stats[detail.type_id] = value;
          }
        }
      }

      // Extract goals and assists from events
      const playerEvents = fixtureData.events?.filter(e => e.player_id === playerId) || [];
      const goals = playerEvents.filter(e => e.type_id === EVENT_TYPES.goal).length;
      const assists = playerEvents.filter(e => e.type_id === EVENT_TYPES.assist).length;
      const yellowCards = playerEvents.filter(e => e.type_id === EVENT_TYPES.yellowCard).length;
      const redCards = playerEvents.filter(e =>
        e.type_id === EVENT_TYPES.redCard || e.type_id === EVENT_TYPES.yellowRedCard
      ).length;

      // Also count assists given to this player (they assisted the goal scorer)
      const assistsReceived = fixtureData.events?.filter(e =>
        e.type_id === EVENT_TYPES.goal && e.related_player_id === playerId
      ).length || 0;

      // Add goals to stats (type_id 52 = goals)
      if (goals > 0) stats[STAT_TYPE_IDS.goals] = goals;
      if (assists > 0 || assistsReceived > 0) {
        stats[STAT_TYPE_IDS.assists] = (assists || 0) + (assistsReceived || 0);
      }
      if (yellowCards > 0) stats[STAT_TYPE_IDS.yellowCards] = yellowCards;
      if (redCards > 0) stats[STAT_TYPE_IDS.redCards] = redCards;

      // Determine opponent and home/away
      let opponent = 'Unknown';
      let homeAway: 'home' | 'away' = 'home';

      if (fixtureData.participants && fixtureData.participants.length >= 2) {
        const homeTeam = fixtureData.participants.find(
          p => p.meta?.location === 'home'
        ) || fixtureData.participants[0];
        const awayTeam = fixtureData.participants.find(
          p => p.meta?.location === 'away'
        ) || fixtureData.participants[1];

        // Determine which team the player is on
        const playerTeam = playerLineup?.team_id || playerTeamId;
        if (playerTeam === homeTeam?.id) {
          homeAway = 'home';
          opponent = awayTeam?.name || 'Unknown';
        } else if (playerTeam === awayTeam?.id) {
          homeAway = 'away';
          opponent = homeTeam?.name || 'Unknown';
        } else {
          opponent = `${homeTeam?.name} vs ${awayTeam?.name}`;
        }
      }

      result.push({
        fixtureId: fixtureData.id,
        date: fixtureData.starting_at || '',
        opponent,
        homeAway,
        stats,
      });

      safeLog('Got fixture stats', {
        fixtureId,
        statCount: Object.keys(stats).length,
        goals,
        assists: assists + assistsReceived,
      });
    } catch (err) {
      safeLog('Failed to fetch fixture', { fixtureId, error: (err as Error).message });
    }
  }

  // Sort by date (most recent first)
  result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  setCache(cacheKey, result, SHORT_CACHE_TTL_MS);
  safeLog('Returning player fixtures', { playerId, count: result.length });
  return result;
}

/**
 * Parse market type to determine which stat type ID(s) to check
 */
function parseSoccerMarket(market: string): { typeIds: number[]; combined: boolean; name: string } {
  const m = market.toLowerCase();

  // Direct mapping lookup first
  const directMapping = MARKET_TO_STAT_TYPE[market] || MARKET_TO_STAT_TYPE[m];
  if (directMapping) {
    const typeIds = Array.isArray(directMapping) ? directMapping : [directMapping];
    const name = STAT_TYPE_NAMES[typeIds[0]] || market;
    return { typeIds, combined: Array.isArray(directMapping), name };
  }

  // Fuzzy matching for market types
  // Shots
  if (m.includes('shot') && m.includes('target')) {
    return { typeIds: [STAT_TYPE_IDS.shotsOnTarget], combined: false, name: 'Shots on Target' };
  }
  if (m.includes('shot')) {
    return { typeIds: [STAT_TYPE_IDS.shotsTotal], combined: false, name: 'Shots' };
  }

  // Goals & Assists
  if (m.includes('goal') && m.includes('assist')) {
    return {
      typeIds: [STAT_TYPE_IDS.goals, STAT_TYPE_IDS.assists],
      combined: true,
      name: 'Goals + Assists',
    };
  }
  if (m.includes('goal')) {
    return { typeIds: [STAT_TYPE_IDS.goals], combined: false, name: 'Goals' };
  }
  if (m.includes('assist')) {
    return { typeIds: [STAT_TYPE_IDS.assists], combined: false, name: 'Assists' };
  }

  // Defensive
  if (m.includes('tackle')) {
    return { typeIds: [STAT_TYPE_IDS.tackles], combined: false, name: 'Tackles' };
  }
  if (m.includes('foul')) {
    return { typeIds: [STAT_TYPE_IDS.fouls], combined: false, name: 'Fouls' };
  }
  if (m.includes('clearance')) {
    return { typeIds: [STAT_TYPE_IDS.clearances], combined: false, name: 'Clearances' };
  }
  if (m.includes('intercept')) {
    return { typeIds: [STAT_TYPE_IDS.interceptions], combined: false, name: 'Interceptions' };
  }
  if (m.includes('block')) {
    return { typeIds: [STAT_TYPE_IDS.blockedShots], combined: false, name: 'Blocked Shots' };
  }
  if (m.includes('save')) {
    return { typeIds: [STAT_TYPE_IDS.saves], combined: false, name: 'Saves' };
  }

  // Passing
  if (m.includes('key') && m.includes('pass')) {
    return { typeIds: [STAT_TYPE_IDS.keyPasses], combined: false, name: 'Key Passes' };
  }
  if (m.includes('pass')) {
    return { typeIds: [STAT_TYPE_IDS.passes], combined: false, name: 'Passes' };
  }
  if (m.includes('cross')) {
    return { typeIds: [STAT_TYPE_IDS.crosses], combined: false, name: 'Crosses' };
  }

  // Dribbling & Duels
  if (m.includes('dribble')) {
    return { typeIds: [STAT_TYPE_IDS.successfulDribbles], combined: false, name: 'Dribbles' };
  }
  if (m.includes('duel')) {
    return { typeIds: [STAT_TYPE_IDS.duelsWon], combined: false, name: 'Duels Won' };
  }
  if (m.includes('aerial')) {
    return { typeIds: [STAT_TYPE_IDS.aerialDuelsWon], combined: false, name: 'Aerial Duels Won' };
  }

  // Cards
  if (m.includes('yellow') && m.includes('card')) {
    return { typeIds: [STAT_TYPE_IDS.yellowCards], combined: false, name: 'Yellow Cards' };
  }
  if (m.includes('red') && m.includes('card')) {
    return { typeIds: [STAT_TYPE_IDS.redCards], combined: false, name: 'Red Cards' };
  }
  if (m.includes('card')) {
    return {
      typeIds: [STAT_TYPE_IDS.yellowCards, STAT_TYPE_IDS.redCards],
      combined: true,
      name: 'Cards',
    };
  }

  // Other
  if (m.includes('touch')) {
    return { typeIds: [STAT_TYPE_IDS.touches], combined: false, name: 'Touches' };
  }
  if (m.includes('corner')) {
    return { typeIds: [STAT_TYPE_IDS.corners], combined: false, name: 'Corners' };
  }
  if (m.includes('offside')) {
    return { typeIds: [STAT_TYPE_IDS.offsides], combined: false, name: 'Offsides' };
  }

  safeLog('Unknown market type', { market });
  return { typeIds: [], combined: false, name: market };
}

/**
 * Calculate stat value from fixture stats
 */
function calculateStatValue(fixtureStats: Record<number, number>, typeIds: number[]): number {
  return typeIds.reduce((sum, typeId) => sum + (fixtureStats[typeId] || 0), 0);
}

/**
 * Validate a soccer player bet against historical data
 */
export async function validatePlayerBet(
  playerName: string,
  market: string,
  line: number,
  direction: 'over' | 'under',
  matchCount: number = 10
): Promise<SoccerValidationResult | null> {
  // Find the player
  const player = await searchPlayer(playerName);
  if (!player) {
    safeLog('Player not found for validation', { playerName });
    return null;
  }

  // Parse market to determine which stats to check
  const { typeIds, combined, name: marketName } = parseSoccerMarket(market);
  if (typeIds.length === 0) {
    safeLog('Unknown soccer market type', { market });
    return null;
  }

  // Get recent fixtures
  const fixtures = await getPlayerRecentFixtures(player.id, matchCount);
  if (fixtures.length === 0) {
    safeLog('No fixtures found for validation', { playerName, playerId: player.id });
    return null;
  }

  // Calculate hit rate
  const recentMatches: SoccerValidationResult['recentMatches'] = [];
  let hits = 0;
  let totalValue = 0;
  let matchesWithData = 0;

  for (const fixture of fixtures) {
    const value = calculateStatValue(fixture.stats, typeIds);

    // Skip matches with no data for this stat
    if (Object.keys(fixture.stats).length === 0) continue;

    matchesWithData++;
    totalValue += value;

    const hit = direction === 'over' ? value > line : value < line;
    if (hit) hits++;

    recentMatches.push({
      date: fixture.date,
      opponent: fixture.opponent,
      homeAway: fixture.homeAway,
      value,
      hit,
    });
  }

  if (matchesWithData === 0) {
    safeLog('No stat data found for player', { playerName, typeIds });
    return null;
  }

  const displayName = player.display_name || player.common_name ||
    [player.firstname, player.lastname].filter(Boolean).join(' ');

  return {
    playerName: displayName,
    playerId: player.id,
    market,
    marketName,
    line,
    direction,
    matchesChecked: matchesWithData,
    hits,
    hitRate: Math.round((hits / matchesWithData) * 100),
    recentMatches,
    avgValue: Math.round((totalValue / matchesWithData) * 100) / 100,
  };
}

/**
 * Batch validate multiple soccer bets
 */
export async function batchValidateSoccerBets(
  bets: Array<{
    playerName: string;
    market: string;
    line: number;
    direction: 'over' | 'under';
    opportunityId: string;
  }>,
  matchCount: number = 10
): Promise<Map<string, SoccerValidationResult | null>> {
  const results = new Map<string, SoccerValidationResult | null>();

  // Process in batches to respect rate limits
  const batchSize = 5;
  for (let i = 0; i < bets.length; i += batchSize) {
    const batch = bets.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(async bet => {
        const result = await validatePlayerBet(
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

// ============================================================================
// TEAM MARKET VALIDATION - Check historical hit rates for team props
// ============================================================================

// Team validation result
export interface TeamValidationResult {
  teamName: string;
  teamId: number;
  market: string;
  marketName: string;
  line: number;
  direction: 'over' | 'under';
  matchesChecked: number;
  hits: number;
  hitRate: number;
  recentMatches: {
    date: string;
    opponent: string;
    homeAway: 'home' | 'away';
    value: number;
    hit: boolean;
    result?: string; // "W 2-1", "L 0-3", "D 1-1"
  }[];
  avgValue: number;
  homeAvg?: number;
  awayAvg?: number;
}

// Match result for team validation
interface TeamMatchResult {
  fixtureId: number;
  date: string;
  opponent: string;
  homeAway: 'home' | 'away';
  goalsScored: number;
  goalsConceded: number;
  totalGoals: number;
  corners: number;
  totalCorners: number; // Both teams combined
  shots: number;
  shotsOnTarget: number;
  btts: boolean; // Both Teams To Score
  result: 'W' | 'D' | 'L';
}

// Major league IDs for fixture fetching
const MAJOR_LEAGUE_IDS = [
  8,    // Premier League (England)
  564,  // La Liga (Spain)
  384,  // Serie A (Italy)
  82,   // Bundesliga (Germany)
  301,  // Ligue 1 (France)
  271,  // Eredivisie (Netherlands)
  462,  // Primeira Liga (Portugal)
  501,  // Scottish Premiership
];

/**
 * Get team's recent match results
 */
export async function getTeamRecentMatches(
  teamId: number,
  limit: number = 10
): Promise<TeamMatchResult[]> {
  const cacheKey = `team-matches:${teamId}:${limit}`;
  const cached = getCached<TeamMatchResult[]>(cacheKey);
  if (cached) return cached;

  safeLog('Fetching team matches', { teamId, limit });

  // Use fixtures/between with date range and major league filter
  // API limits to 100 days range
  const endDate = new Date();
  const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const endStr = endDate.toISOString().split('T')[0];
  const startStr = startDate.toISOString().split('T')[0];

  // Fetch fixtures from major leagues
  // We query multiple leagues in sequence to support teams from different leagues
  const allFixtures: SportMonksFixture[] = [];

  // Priority order: English, Spanish, Italian, German, French
  const priorityLeagues = [8, 564, 384, 82, 301]; // PL, La Liga, Serie A, Bundesliga, Ligue 1

  for (const leagueId of priorityLeagues) {
    const leagueFixtures = await fetchWithRetry<SportMonksFixture[]>(
      `/fixtures/between/${startStr}/${endStr}`,
      {
        include: 'participants;scores;statistics',
        filters: `fixtureLeagues:${leagueId}`,
        per_page: '100',
      }
    );

    if (leagueFixtures) {
      // Check if this league has the team's fixtures
      const teamLeagueFixtures = leagueFixtures.filter(f =>
        f.participants?.some(p => p.id === teamId)
      );

      if (teamLeagueFixtures.length > 0) {
        // Found team's league - use all fixtures from this league
        allFixtures.push(...leagueFixtures);
        break; // Stop searching other leagues
      }
    }
  }

  if (!allFixtures || allFixtures.length === 0) {
    safeLog('No fixtures found in date range for major leagues', { teamId });
    return [];
  }

  // Filter for team's fixtures
  const teamFixtures = allFixtures.filter(f => {
    if (!f.participants) return false;
    return f.participants.some(p => p.id === teamId);
  });

  // Filter for completed fixtures only and sort by date (most recent first)
  const completedFixtures = teamFixtures
    .filter(f => f.state_id === 5) // 5 = finished
    .sort((a, b) => new Date(b.starting_at || 0).getTime() - new Date(a.starting_at || 0).getTime());

  if (completedFixtures.length === 0) {
    safeLog('No completed fixtures found for team in major leagues', { teamId });
    return [];
  }

  const detailedFixtures = completedFixtures.slice(0, limit);

  safeLog('Found team fixtures with details', { teamId, total: detailedFixtures.length });

  const results: TeamMatchResult[] = [];

  for (const fixture of detailedFixtures) {
    if (!fixture.participants || fixture.participants.length < 2) continue;

    // Determine home/away based on location meta or array order
    const homeTeam = fixture.participants.find(p => p.meta?.location === 'home') || fixture.participants[0];
    const awayTeam = fixture.participants.find(p => p.meta?.location === 'away') || fixture.participants[1];
    const isHome = homeTeam.id === teamId;
    const opponent = isHome ? awayTeam.name : homeTeam.name;
    const homeAway: 'home' | 'away' = isHome ? 'home' : 'away';

    // Get CURRENT scores only (not half-time scores)
    let goalsScored = 0;
    let goalsConceded = 0;

    if (fixture.scores) {
      for (const score of fixture.scores) {
        // Only look at CURRENT/FULLTIME scores (description includes 'CURRENT')
        if (score.description === 'CURRENT' || score.description === 'FULLTIME') {
          if (score.participant_id === teamId) {
            goalsScored = score.score?.goals || 0;
          } else {
            goalsConceded = score.score?.goals || 0;
          }
        }
      }
    }

    // Get statistics - use participant_id and data.value
    let corners = 0;
    let shots = 0;
    let shotsOnTarget = 0;
    let totalCorners = 0;

    if (fixture.statistics) {
      for (const stat of fixture.statistics) {
        // Extract value from data.value structure
        const value = stat.data?.value ??
                     (typeof stat.value === 'object' ? stat.value?.total : stat.value) ??
                     0;

        // Track this team's stats
        if (stat.participant_id === teamId) {
          switch (stat.type_id) {
            case STAT_TYPE_IDS.corners:
              corners = value;
              break;
            case STAT_TYPE_IDS.shotsTotal:
              shots = value;
              break;
            case STAT_TYPE_IDS.shotsOnTarget:
              shotsOnTarget = value;
              break;
          }
        }

        // Track total corners for both teams
        if (stat.type_id === STAT_TYPE_IDS.corners) {
          totalCorners += value;
        }
      }
    }

    const totalGoals = goalsScored + goalsConceded;
    const btts = goalsScored > 0 && goalsConceded > 0;
    const result: 'W' | 'D' | 'L' =
      goalsScored > goalsConceded ? 'W' :
      goalsScored < goalsConceded ? 'L' : 'D';

    results.push({
      fixtureId: fixture.id,
      date: fixture.starting_at || '',
      opponent,
      homeAway,
      goalsScored,
      goalsConceded,
      totalGoals,
      corners,
      totalCorners,
      shots,
      shotsOnTarget,
      btts,
      result,
    });
  }

  setCache(cacheKey, results, SHORT_CACHE_TTL_MS);
  return results;
}

/**
 * Search for a team by name
 */
export async function searchTeam(name: string): Promise<SportMonksTeam | null> {
  const normalizedName = normalizeTeamName(name);
  const cacheKey = `team-search:${normalizedName}`;
  const cached = getCached<SportMonksTeam>(cacheKey);
  if (cached) return cached;

  // Generate search variants
  const variants = generateTeamSearchVariants(name);
  safeLog('Searching for team', { name, variants });

  for (const variant of variants) {
    const teams = await fetchWithRetry<SportMonksTeam[]>(
      '/teams/search/' + encodeURIComponent(variant)
    );

    if (teams && teams.length > 0) {
      // Find best match
      const bestMatch = teams.find(t => teamNamesMatch(name, t.name) || teamNamesMatch(variant, t.name));
      const team = bestMatch || teams[0];

      safeLog('Found team', { searchedName: name, variant, foundName: team.name, id: team.id });
      setCache(cacheKey, team);
      return team;
    }
  }

  safeLog('Team not found after trying all variants', { name, variants });
  return null;
}

/**
 * Validate a team market bet (goals over/under, corners, etc.)
 */
export async function validateTeamBet(
  teamName: string,
  market: string,
  line: number,
  direction: 'over' | 'under',
  matchCount: number = 10
): Promise<TeamValidationResult | null> {
  // Find the team
  const team = await searchTeam(teamName);
  if (!team) {
    safeLog('Team not found for validation', { teamName });
    return null;
  }

  // Get recent matches
  const matches = await getTeamRecentMatches(team.id, matchCount);
  if (matches.length === 0) {
    safeLog('No matches found for team validation', { teamName, teamId: team.id });
    return null;
  }

  // Parse market to determine what to check
  const m = market.toLowerCase();
  let getValue: (match: TeamMatchResult) => number;
  let marketName: string;

  // Goals markets
  if (m.includes('total') && m.includes('goal')) {
    getValue = (match) => match.totalGoals;
    marketName = 'Total Goals';
  } else if (m.includes('team') && m.includes('goal')) {
    getValue = (match) => match.goalsScored;
    marketName = 'Team Goals';
  }
  // Corner markets - differentiate total vs team corners
  else if (m.includes('total') && m.includes('corner')) {
    // Total corners = both teams combined
    getValue = (match) => match.totalCorners;
    marketName = 'Total Corners';
  } else if (m.includes('team') && m.includes('corner')) {
    // Team corners = just this team's corners
    getValue = (match) => match.corners;
    marketName = 'Team Corners';
  } else if (m.includes('corner')) {
    // Default corners - assume team corners
    getValue = (match) => match.corners;
    marketName = 'Corners';
  }
  // Shot markets
  else if (m.includes('shot') && m.includes('target')) {
    getValue = (match) => match.shotsOnTarget;
    marketName = 'Shots on Target';
  } else if (m.includes('shot')) {
    getValue = (match) => match.shots;
    marketName = 'Shots';
  } else {
    safeLog('Unknown team market type', { market });
    return null;
  }

  // Calculate hit rate
  const recentMatches: TeamValidationResult['recentMatches'] = [];
  let hits = 0;
  let totalValue = 0;
  let homeTotal = 0;
  let homeCount = 0;
  let awayTotal = 0;
  let awayCount = 0;

  for (const match of matches) {
    const value = getValue(match);
    totalValue += value;

    if (match.homeAway === 'home') {
      homeTotal += value;
      homeCount++;
    } else {
      awayTotal += value;
      awayCount++;
    }

    const hit = direction === 'over' ? value > line : value < line;
    if (hit) hits++;

    recentMatches.push({
      date: match.date,
      opponent: match.opponent,
      homeAway: match.homeAway,
      value,
      hit,
      result: `${match.result} ${match.goalsScored}-${match.goalsConceded}`,
    });
  }

  return {
    teamName: team.name,
    teamId: team.id,
    market,
    marketName,
    line,
    direction,
    matchesChecked: matches.length,
    hits,
    hitRate: Math.round((hits / matches.length) * 100),
    recentMatches,
    avgValue: Math.round((totalValue / matches.length) * 100) / 100,
    homeAvg: homeCount > 0 ? Math.round((homeTotal / homeCount) * 100) / 100 : undefined,
    awayAvg: awayCount > 0 ? Math.round((awayTotal / awayCount) * 100) / 100 : undefined,
  };
}

/**
 * Validate Both Teams To Score (BTTS) market
 */
export async function validateBTTS(
  homeTeam: string,
  awayTeam: string,
  selection: 'yes' | 'no',
  matchCount: number = 10
): Promise<{
  homeTeamBTTSRate: number;
  awayTeamBTTSRate: number;
  combinedRate: number;
  homeRecentMatches: { date: string; opponent: string; btts: boolean }[];
  awayRecentMatches: { date: string; opponent: string; btts: boolean }[];
} | null> {
  // Get both teams
  const [homeTeamData, awayTeamData] = await Promise.all([
    searchTeam(homeTeam),
    searchTeam(awayTeam),
  ]);

  if (!homeTeamData || !awayTeamData) {
    safeLog('Teams not found for BTTS validation', { homeTeam, awayTeam });
    return null;
  }

  // Get recent matches for both teams
  const [homeMatches, awayMatches] = await Promise.all([
    getTeamRecentMatches(homeTeamData.id, matchCount),
    getTeamRecentMatches(awayTeamData.id, matchCount),
  ]);

  if (homeMatches.length === 0 || awayMatches.length === 0) {
    return null;
  }

  // Calculate BTTS rates
  const homeBTTSCount = homeMatches.filter(m => m.btts).length;
  const awayBTTSCount = awayMatches.filter(m => m.btts).length;

  const homeTeamBTTSRate = Math.round((homeBTTSCount / homeMatches.length) * 100);
  const awayTeamBTTSRate = Math.round((awayBTTSCount / awayMatches.length) * 100);

  // Combined probability (simplified)
  const combinedRate = Math.round((homeTeamBTTSRate + awayTeamBTTSRate) / 2);

  return {
    homeTeamBTTSRate,
    awayTeamBTTSRate,
    combinedRate,
    homeRecentMatches: homeMatches.map(m => ({
      date: m.date,
      opponent: m.opponent,
      btts: m.btts,
    })),
    awayRecentMatches: awayMatches.map(m => ({
      date: m.date,
      opponent: m.opponent,
      btts: m.btts,
    })),
  };
}

/**
 * Validate 1X2 (Match Result) market
 */
export async function validateMatchResult(
  homeTeam: string,
  awayTeam: string,
  selection: '1' | 'X' | '2', // 1=Home, X=Draw, 2=Away
  matchCount: number = 10
): Promise<{
  homeWinRate: number;
  drawRate: number;
  awayWinRate: number;
  homeForm: string;
  awayForm: string;
  homeRecentMatches: { date: string; opponent: string; result: 'W' | 'D' | 'L'; score: string }[];
  awayRecentMatches: { date: string; opponent: string; result: 'W' | 'D' | 'L'; score: string }[];
} | null> {
  // Get both teams
  const [homeTeamData, awayTeamData] = await Promise.all([
    searchTeam(homeTeam),
    searchTeam(awayTeam),
  ]);

  if (!homeTeamData || !awayTeamData) {
    safeLog('Teams not found for match result validation', { homeTeam, awayTeam });
    return null;
  }

  // Get recent matches for both teams
  const [homeMatches, awayMatches] = await Promise.all([
    getTeamRecentMatches(homeTeamData.id, matchCount),
    getTeamRecentMatches(awayTeamData.id, matchCount),
  ]);

  if (homeMatches.length === 0 || awayMatches.length === 0) {
    return null;
  }

  // Calculate win rates
  const homeWins = homeMatches.filter(m => m.result === 'W').length;
  const homeDraws = homeMatches.filter(m => m.result === 'D').length;
  const awayWins = awayMatches.filter(m => m.result === 'W').length;
  const awayDraws = awayMatches.filter(m => m.result === 'D').length;

  // Calculate home win rate (when playing at home specifically)
  const homeHomeMatches = homeMatches.filter(m => m.homeAway === 'home');
  const homeHomeWins = homeHomeMatches.filter(m => m.result === 'W').length;

  // Calculate away win rate (when playing away specifically)
  const awayAwayMatches = awayMatches.filter(m => m.homeAway === 'away');
  const awayAwayWins = awayAwayMatches.filter(m => m.result === 'W').length;

  return {
    homeWinRate: homeHomeMatches.length > 0
      ? Math.round((homeHomeWins / homeHomeMatches.length) * 100)
      : Math.round((homeWins / homeMatches.length) * 100),
    drawRate: Math.round(((homeDraws + awayDraws) / (homeMatches.length + awayMatches.length)) * 100),
    awayWinRate: awayAwayMatches.length > 0
      ? Math.round((awayAwayWins / awayAwayMatches.length) * 100)
      : Math.round((awayWins / awayMatches.length) * 100),
    homeForm: homeMatches.slice(0, 5).map(m => m.result).join(''),
    awayForm: awayMatches.slice(0, 5).map(m => m.result).join(''),
    homeRecentMatches: homeMatches.map(m => ({
      date: m.date,
      opponent: m.opponent,
      result: m.result,
      score: `${m.goalsScored}-${m.goalsConceded}`,
    })),
    awayRecentMatches: awayMatches.map(m => ({
      date: m.date,
      opponent: m.opponent,
      result: m.result,
      score: `${m.goalsScored}-${m.goalsConceded}`,
    })),
  };
}
