/**
 * Soccer Player Cache Service
 *
 * Fetches and caches player statistics from SportMonks API.
 * Handles rate limiting (3000 calls/hour per entity) with automatic pacing.
 * Creates mappings between OpticOdds player IDs and SportMonks player IDs.
 */

import { db, schema } from '../db/index.js';
import { eq, desc, and, sql } from 'drizzle-orm';
import { config } from '../config.js';
import {
  normalizePlayerName,
  normalizeTeamName,
  playerNamesMatch,
  teamNamesMatch,
  STAT_TYPE_IDS,
} from './sportMonksClient.js';

// ============================================================================
// Types
// ============================================================================

interface SportMonksLeague {
  id: number;
  sport_id: number;
  country_id: number;
  name: string;
  active: boolean;
  short_code?: string;
  image_path?: string;
  type?: string;
  sub_type?: string;
  last_played_at?: string;
  category?: number;
  current_season_id?: number;
  country?: {
    id: number;
    name: string;
  };
  // Note: API returns 'currentseason' (lowercase) when included
  currentseason?: {
    id: number;
    sport_id: number;
    league_id: number;
    name: string;
    finished: boolean;
  };
}

interface SportMonksTeam {
  id: number;
  sport_id?: number;
  country_id?: number;
  venue_id?: number;
  name: string;
  short_code?: string;
  image_path?: string;
  founded?: number;
  type?: string;
}

interface SportMonksPlayer {
  id: number;
  sport_id?: number;
  country_id?: number;
  nationality_id?: number;
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

interface SportMonksSquadPlayer extends SportMonksPlayer {
  transfer_id?: number;
  player_id: number;
  team_id: number;
  position_id?: number;
  jersey_number?: number;
  start?: string;
  end?: string | null;
}

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

interface LineupEntry {
  id: number;
  sport_id: number;
  fixture_id: number;
  player_id: number;
  team_id: number;
  position_id?: number;
  type_id: number;
  player_name?: string;
  jersey_number?: number;
  details?: LineupDetail[];
  fixture?: {
    id: number;
    starting_at?: string;
    name?: string;
    participants?: Array<{
      id: number;
      name: string;
      meta?: { location?: string };
    }>;
  };
}

interface SportMonksEvent {
  id: number;
  fixture_id: number;
  participant_id: number;
  type_id: number;
  player_id?: number;
  related_player_id?: number;
  minute?: number;
}

interface SportMonksFixture {
  id: number;
  sport_id?: number;
  league_id?: number;
  season_id?: number;
  starting_at?: string;
  state_id?: number;
  participants?: Array<{
    id: number;
    name: string;
    meta?: { location?: string };
  }>;
  lineups?: LineupEntry[];
  events?: SportMonksEvent[];
}

interface SportMonksResponse<T> {
  data: T;
  pagination?: {
    count: number;
    per_page: number;
    current_page: number;
    next_page: string | null;
    has_more: boolean;
  };
  rate_limit?: {
    resets_in_seconds: number;
    remaining: number;
    requested_entity: string;
  };
}

interface PlayerGameStats {
  fixtureId: number;
  gameDate: string;
  opponent: string;
  opponentId: number;
  isHome: boolean;
  leagueId: number;
  minutes: number;
  shots: number;
  shotsOnTarget: number;
  goals: number;
  assists: number;
  passes: number;
  passesAccurate: number;
  keyPasses: number;
  crosses: number;
  crossesAccurate: number;
  tackles: number;
  interceptions: number;
  clearances: number;
  blocks: number;
  saves: number;
  fouls: number;
  foulsDrawn: number;
  dribbles: number;
  dribblesSuccessful: number;
  duels: number;
  duelsWon: number;
  aerialDuels: number;
  aerialDuelsWon: number;
  touches: number;
  yellowCards: number;
  redCards: number;
  rating: number | null;
}

interface CacheUpdateResult {
  leaguesProcessed: number;
  teamsProcessed: number;
  playersUpdated: number;
  playersAdded: number;
  gamesAdded: number;
  mappingsCreated: number;
  errors: string[];
  duration: number;
}

// ============================================================================
// API Configuration & Rate Limiting
// ============================================================================

const API_BASE_URL = config.sportMonksBaseUrl;
const API_KEY = config.sportMonksApiKey;

// Rate limiting - 3000 calls/hour = 50 calls/minute = 1 call/1.2s
// Be conservative: 1 call per 1.5 seconds
const MIN_REQUEST_INTERVAL_MS = 1500;
let lastRequestTime = 0;
let requestCount = 0;

// Position ID to name mapping
const POSITION_MAP: Record<number, string> = {
  24: 'GK',
  25: 'DEF',
  26: 'MID',
  27: 'FWD',
  148: 'DEF', // Left Back
  149: 'DEF', // Right Back
  150: 'DEF', // Center Back
  151: 'MID', // Defensive Mid
  152: 'MID', // Central Mid
  153: 'MID', // Attacking Mid
  154: 'MID', // Left Wing
  155: 'MID', // Right Wing
  156: 'FWD', // Striker
};

// Event type IDs
const EVENT_TYPES = {
  goal: 14,
  assist: 19,
  yellowCard: 84,
  redCard: 83,
  yellowRedCard: 85,
};

// ============================================================================
// Utility Functions
// ============================================================================

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function log(message: string, data?: Record<string, unknown>) {
  console.info(`[SoccerCache] ${message}`, data ? JSON.stringify(data) : '');
}

async function rateLimitedFetch<T>(
  endpoint: string,
  params: Record<string, string> = {}
): Promise<T | null> {
  if (!API_KEY) {
    log('SportMonks API key not configured');
    return null;
  }

  // Enforce rate limiting
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL_MS) {
    await sleep(MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest);
  }

  const url = new URL(`${API_BASE_URL}${endpoint}`);
  url.searchParams.set('api_token', API_KEY);

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  try {
    lastRequestTime = Date.now();
    requestCount++;

    const response = await fetch(url.toString());

    if (response.status === 429) {
      // Rate limited - wait and retry
      const retryAfter = parseInt(response.headers.get('retry-after') || '60', 10);
      log(`Rate limited, waiting ${retryAfter}s before retry`);
      await sleep(retryAfter * 1000);
      return rateLimitedFetch(endpoint, params);
    }

    if (!response.ok) {
      const errorText = await response.text();
      log('API error', { status: response.status, error: errorText.substring(0, 200) });
      return null;
    }

    const data = (await response.json()) as SportMonksResponse<T>;

    // Log rate limit info periodically
    if (requestCount % 50 === 0 && data.rate_limit) {
      log('Rate limit status', {
        remaining: data.rate_limit.remaining,
        resetsIn: data.rate_limit.resets_in_seconds,
        totalRequests: requestCount,
      });
    }

    return data.data;
  } catch (error) {
    log('Fetch error', { endpoint, error: (error as Error).message });
    return null;
  }
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Fetch all available leagues
 */
export async function fetchAllLeagues(): Promise<SportMonksLeague[]> {
  log('Fetching all leagues...');

  const leagues = await rateLimitedFetch<SportMonksLeague[]>('/leagues', {
    include: 'country;currentSeason',
    per_page: '150',
  });

  if (!leagues) {
    log('No leagues returned from API');
    return [];
  }

  log(`API returned ${leagues.length} total leagues`);

  // Process leagues and extract current_season_id from nested currentseason
  const processedLeagues = leagues.map(l => ({
    ...l,
    // Extract current_season_id from nested currentseason object
    current_season_id: l.current_season_id || l.currentseason?.id,
  }));

  // Filter to active leagues
  const activeLeagues = processedLeagues.filter(l => l.active);

  // Sort by category (priority) - lower is better (top leagues)
  activeLeagues.sort((a, b) => (a.category || 999) - (b.category || 999));

  // Limit to top leagues to avoid hitting rate limits too hard
  const topLeagues = activeLeagues.slice(0, 50);

  log(`Found ${activeLeagues.length} active leagues, processing top ${topLeagues.length}`);

  // Log first few leagues
  topLeagues.slice(0, 5).forEach(l => {
    log(`  - ${l.name} (ID: ${l.id}, Season: ${l.current_season_id || 'N/A'})`);
  });

  return topLeagues;
}

/**
 * Fetch current season for a league
 */
export async function fetchLeagueCurrentSeason(leagueId: number): Promise<number | null> {
  const league = await rateLimitedFetch<SportMonksLeague>(
    `/leagues/${leagueId}`,
    { include: 'currentSeason' }
  );

  return league?.current_season_id || null;
}

/**
 * Fetch teams for a specific league/season
 */
export async function fetchLeagueTeams(
  seasonId: number
): Promise<SportMonksTeam[]> {
  const teams = await rateLimitedFetch<SportMonksTeam[]>(
    `/teams/seasons/${seasonId}`,
    { per_page: '100' }
  );

  return teams || [];
}

/**
 * Fetch teams directly for a league (alternative if season not available)
 */
export async function fetchLeagueTeamsDirect(
  leagueId: number
): Promise<SportMonksTeam[]> {
  const teams = await rateLimitedFetch<SportMonksTeam[]>(
    `/teams/countries/${leagueId}`, // Try by country
    { per_page: '100' }
  );

  return teams || [];
}

/**
 * Fetch squad (players) for a team
 */
export async function fetchTeamSquad(
  teamId: number
): Promise<SportMonksSquadPlayer[]> {
  const squad = await rateLimitedFetch<SportMonksSquadPlayer[]>(
    `/squads/teams/${teamId}`,
    { include: 'player' }
  );

  return squad || [];
}

/**
 * Fetch player with lineups for game history
 */
export async function fetchPlayerWithLineups(
  playerId: number
): Promise<(SportMonksPlayer & { lineups?: LineupEntry[] }) | null> {
  const player = await rateLimitedFetch<SportMonksPlayer & { lineups?: LineupEntry[] }>(
    `/players/${playerId}`,
    { include: 'lineups.fixture.participants;lineups.details' }
  );

  return player;
}

/**
 * Fetch fixture with full details
 */
export async function fetchFixtureDetails(
  fixtureId: number
): Promise<SportMonksFixture | null> {
  const fixture = await rateLimitedFetch<SportMonksFixture>(
    `/fixtures/${fixtureId}`,
    { include: 'participants;lineups.details;events' }
  );

  return fixture;
}

// ============================================================================
// Data Processing
// ============================================================================

/**
 * Extract stats from lineup details
 */
function extractStatsFromDetails(details: LineupDetail[] | undefined): Partial<PlayerGameStats> {
  const stats: Partial<PlayerGameStats> = {
    shots: 0,
    shotsOnTarget: 0,
    goals: 0,
    assists: 0,
    passes: 0,
    passesAccurate: 0,
    keyPasses: 0,
    crosses: 0,
    crossesAccurate: 0,
    tackles: 0,
    interceptions: 0,
    clearances: 0,
    blocks: 0,
    saves: 0,
    fouls: 0,
    foulsDrawn: 0,
    dribbles: 0,
    dribblesSuccessful: 0,
    duels: 0,
    duelsWon: 0,
    aerialDuels: 0,
    aerialDuelsWon: 0,
    touches: 0,
    yellowCards: 0,
    redCards: 0,
    minutes: 0,
    rating: null,
  };

  if (!details) return stats;

  for (const detail of details) {
    const value = detail.data?.value ?? 0;

    switch (detail.type_id) {
      case STAT_TYPE_IDS.shotsTotal:
        stats.shots = value;
        break;
      case STAT_TYPE_IDS.shotsOnTarget:
        stats.shotsOnTarget = value;
        break;
      case STAT_TYPE_IDS.goals:
        stats.goals = value;
        break;
      case STAT_TYPE_IDS.assists:
        stats.assists = value;
        break;
      case STAT_TYPE_IDS.passes:
        stats.passes = value;
        break;
      case STAT_TYPE_IDS.accuratePasses:
        stats.passesAccurate = value;
        break;
      case STAT_TYPE_IDS.keyPasses:
        stats.keyPasses = value;
        break;
      case STAT_TYPE_IDS.crosses:
        stats.crosses = value;
        break;
      case STAT_TYPE_IDS.accurateCrosses:
        stats.crossesAccurate = value;
        break;
      case STAT_TYPE_IDS.tackles:
        stats.tackles = value;
        break;
      case STAT_TYPE_IDS.interceptions:
        stats.interceptions = value;
        break;
      case STAT_TYPE_IDS.clearances:
        stats.clearances = value;
        break;
      case STAT_TYPE_IDS.blockedShots:
        stats.blocks = value;
        break;
      case STAT_TYPE_IDS.saves:
        stats.saves = value;
        break;
      case STAT_TYPE_IDS.fouls:
        stats.fouls = value;
        break;
      case STAT_TYPE_IDS.foulsDrawn:
        stats.foulsDrawn = value;
        break;
      case STAT_TYPE_IDS.dribbleAttempts:
        stats.dribbles = value;
        break;
      case STAT_TYPE_IDS.successfulDribbles:
        stats.dribblesSuccessful = value;
        break;
      case STAT_TYPE_IDS.totalDuels:
        stats.duels = value;
        break;
      case STAT_TYPE_IDS.duelsWon:
        stats.duelsWon = value;
        break;
      case STAT_TYPE_IDS.aerialDuels:
        stats.aerialDuels = value;
        break;
      case STAT_TYPE_IDS.aerialDuelsWon:
        stats.aerialDuelsWon = value;
        break;
      case STAT_TYPE_IDS.touches:
        stats.touches = value;
        break;
      case STAT_TYPE_IDS.yellowCards:
        stats.yellowCards = value;
        break;
      case STAT_TYPE_IDS.redCards:
        stats.redCards = value;
        break;
      case STAT_TYPE_IDS.minutesPlayed:
        stats.minutes = value;
        break;
      case STAT_TYPE_IDS.rating:
        stats.rating = value;
        break;
    }
  }

  return stats;
}

/**
 * Calculate averages from game stats
 */
function calculateAverages(games: PlayerGameStats[]): Record<string, number | null> {
  if (games.length === 0) {
    return {};
  }

  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const avg = (arr: number[]) => arr.length > 0 ? sum(arr) / arr.length : null;

  const allGames = games;
  const last5 = games.slice(0, 5);
  const last10 = games.slice(0, 10);
  const homeGames = games.filter(g => g.isHome);
  const awayGames = games.filter(g => !g.isHome);

  return {
    // Season averages
    avgShots: avg(allGames.map(g => g.shots)),
    avgShotsOnTarget: avg(allGames.map(g => g.shotsOnTarget)),
    avgGoals: avg(allGames.map(g => g.goals)),
    avgAssists: avg(allGames.map(g => g.assists)),
    avgPasses: avg(allGames.map(g => g.passes)),
    avgKeyPasses: avg(allGames.map(g => g.keyPasses)),
    avgTackles: avg(allGames.map(g => g.tackles)),
    avgInterceptions: avg(allGames.map(g => g.interceptions)),
    avgClearances: avg(allGames.map(g => g.clearances)),
    avgBlocks: avg(allGames.map(g => g.blocks)),
    avgFouls: avg(allGames.map(g => g.fouls)),
    avgFoulsDrawn: avg(allGames.map(g => g.foulsDrawn)),
    avgDribbles: avg(allGames.map(g => g.dribblesSuccessful)),
    avgDuelsWon: avg(allGames.map(g => g.duelsWon)),
    avgAerialDuelsWon: avg(allGames.map(g => g.aerialDuelsWon)),
    avgCrosses: avg(allGames.map(g => g.crosses)),
    avgTouches: avg(allGames.map(g => g.touches)),
    avgMinutes: avg(allGames.map(g => g.minutes)),
    avgYellowCards: avg(allGames.map(g => g.yellowCards)),
    avgRedCards: avg(allGames.map(g => g.redCards)),

    // Last 5 averages
    last5Shots: avg(last5.map(g => g.shots)),
    last5ShotsOnTarget: avg(last5.map(g => g.shotsOnTarget)),
    last5Goals: avg(last5.map(g => g.goals)),
    last5Assists: avg(last5.map(g => g.assists)),
    last5Passes: avg(last5.map(g => g.passes)),
    last5Tackles: avg(last5.map(g => g.tackles)),

    // Last 10 averages
    last10Shots: avg(last10.map(g => g.shots)),
    last10ShotsOnTarget: avg(last10.map(g => g.shotsOnTarget)),
    last10Goals: avg(last10.map(g => g.goals)),
    last10Assists: avg(last10.map(g => g.assists)),
    last10Passes: avg(last10.map(g => g.passes)),
    last10Tackles: avg(last10.map(g => g.tackles)),

    // Home/Away splits
    homeShots: avg(homeGames.map(g => g.shots)),
    homeShotsOnTarget: avg(homeGames.map(g => g.shotsOnTarget)),
    homeGoals: avg(homeGames.map(g => g.goals)),
    homeAssists: avg(homeGames.map(g => g.assists)),
    awayShots: avg(awayGames.map(g => g.shots)),
    awayShotsOnTarget: avg(awayGames.map(g => g.shotsOnTarget)),
    awayGoals: avg(awayGames.map(g => g.goals)),
    awayAssists: avg(awayGames.map(g => g.assists)),

    // Counts
    gamesPlayed: allGames.length,
    homeGames: homeGames.length,
    awayGames: awayGames.length,
    totalGoals: sum(allGames.map(g => g.goals)),
    totalAssists: sum(allGames.map(g => g.assists)),
  };
}

// ============================================================================
// Cache Update Functions
// ============================================================================

/**
 * Process a single player - fetch their game stats and update cache
 */
async function processPlayer(
  player: SportMonksSquadPlayer,
  teamName: string,
  leagueId: number,
  leagueName: string
): Promise<{ gamesAdded: number; updated: boolean; added: boolean }> {
  const playerId = player.player_id || player.id;
  const result = { gamesAdded: 0, updated: false, added: false };

  try {
    // Fetch player with lineups
    const playerData = await fetchPlayerWithLineups(playerId);
    if (!playerData || !playerData.lineups || playerData.lineups.length === 0) {
      return result;
    }

    const now = new Date();
    const currentSeasonStart = new Date(now.getFullYear(), 7, 1); // August 1st

    // Filter to current season fixtures only
    const accessibleLineups = playerData.lineups.filter(l => {
      if (!l.fixture || !l.fixture.starting_at) return false;
      const fixtureDate = new Date(l.fixture.starting_at);
      return fixtureDate >= currentSeasonStart && fixtureDate < now;
    });

    if (accessibleLineups.length === 0) {
      return result;
    }

    // Sort by date (most recent first)
    const sortedLineups = accessibleLineups.sort((a, b) => {
      const dateA = new Date(a.fixture!.starting_at!).getTime();
      const dateB = new Date(b.fixture!.starting_at!).getTime();
      return dateB - dateA;
    });

    // Get last 20 games max
    const recentLineups = sortedLineups.slice(0, 20);

    // Process each game
    const gameStats: PlayerGameStats[] = [];

    for (const lineup of recentLineups) {
      if (!lineup.fixture) continue;

      // Check if we already have this game
      const existing = await db.query.soccerPlayerGameStats.findFirst({
        where: and(
          eq(schema.soccerPlayerGameStats.playerId, playerId),
          eq(schema.soccerPlayerGameStats.fixtureId, lineup.fixture_id)
        ),
      });

      if (existing) {
        // Already have this game, skip fetching
        gameStats.push({
          fixtureId: existing.fixtureId,
          gameDate: existing.gameDate,
          opponent: existing.opponent || '',
          opponentId: existing.opponentId || 0,
          isHome: existing.isHome || false,
          leagueId: existing.leagueId || leagueId,
          minutes: existing.minutes || 0,
          shots: existing.shots || 0,
          shotsOnTarget: existing.shotsOnTarget || 0,
          goals: existing.goals || 0,
          assists: existing.assists || 0,
          passes: existing.passes || 0,
          passesAccurate: existing.passesAccurate || 0,
          keyPasses: existing.keyPasses || 0,
          crosses: existing.crosses || 0,
          crossesAccurate: existing.crossesAccurate || 0,
          tackles: existing.tackles || 0,
          interceptions: existing.interceptions || 0,
          clearances: existing.clearances || 0,
          blocks: existing.blocks || 0,
          saves: existing.saves || 0,
          fouls: existing.fouls || 0,
          foulsDrawn: existing.foulsDrawn || 0,
          dribbles: existing.dribbles || 0,
          dribblesSuccessful: existing.dribblesSuccessful || 0,
          duels: existing.duels || 0,
          duelsWon: existing.duelsWon || 0,
          aerialDuels: existing.aerialDuels || 0,
          aerialDuelsWon: existing.aerialDuelsWon || 0,
          touches: existing.touches || 0,
          yellowCards: existing.yellowCards || 0,
          redCards: existing.redCards || 0,
          rating: existing.rating,
        });
        continue;
      }

      // Need to fetch fixture details
      const fixtureDetails = await fetchFixtureDetails(lineup.fixture_id);
      if (!fixtureDetails) continue;

      // Find player's lineup entry with stats
      const playerLineup = fixtureDetails.lineups?.find(l => l.player_id === playerId);
      const stats = extractStatsFromDetails(playerLineup?.details);

      // Extract goals/assists from events
      const playerEvents = fixtureDetails.events?.filter(e => e.player_id === playerId) || [];
      const goals = playerEvents.filter(e => e.type_id === EVENT_TYPES.goal).length;
      const assists = playerEvents.filter(e => e.type_id === EVENT_TYPES.assist).length;
      const yellowCards = playerEvents.filter(e => e.type_id === EVENT_TYPES.yellowCard).length;
      const redCards = playerEvents.filter(e =>
        e.type_id === EVENT_TYPES.redCard || e.type_id === EVENT_TYPES.yellowRedCard
      ).length;

      // Override with event-based counts if higher
      if (goals > (stats.goals || 0)) stats.goals = goals;
      if (assists > (stats.assists || 0)) stats.assists = assists;
      if (yellowCards > (stats.yellowCards || 0)) stats.yellowCards = yellowCards;
      if (redCards > (stats.redCards || 0)) stats.redCards = redCards;

      // Determine opponent and home/away
      let opponent = '';
      let opponentId = 0;
      let isHome = false;

      if (fixtureDetails.participants && fixtureDetails.participants.length >= 2) {
        const homeTeam = fixtureDetails.participants.find(p => p.meta?.location === 'home');
        const awayTeam = fixtureDetails.participants.find(p => p.meta?.location === 'away');

        if (playerLineup?.team_id === homeTeam?.id) {
          isHome = true;
          opponent = awayTeam?.name || '';
          opponentId = awayTeam?.id || 0;
        } else {
          isHome = false;
          opponent = homeTeam?.name || '';
          opponentId = homeTeam?.id || 0;
        }
      }

      const gameData: PlayerGameStats = {
        fixtureId: lineup.fixture_id,
        gameDate: lineup.fixture.starting_at || '',
        opponent,
        opponentId,
        isHome,
        leagueId,
        minutes: stats.minutes || 0,
        shots: stats.shots || 0,
        shotsOnTarget: stats.shotsOnTarget || 0,
        goals: stats.goals || 0,
        assists: stats.assists || 0,
        passes: stats.passes || 0,
        passesAccurate: stats.passesAccurate || 0,
        keyPasses: stats.keyPasses || 0,
        crosses: stats.crosses || 0,
        crossesAccurate: stats.crossesAccurate || 0,
        tackles: stats.tackles || 0,
        interceptions: stats.interceptions || 0,
        clearances: stats.clearances || 0,
        blocks: stats.blocks || 0,
        saves: stats.saves || 0,
        fouls: stats.fouls || 0,
        foulsDrawn: stats.foulsDrawn || 0,
        dribbles: stats.dribbles || 0,
        dribblesSuccessful: stats.dribblesSuccessful || 0,
        duels: stats.duels || 0,
        duelsWon: stats.duelsWon || 0,
        aerialDuels: stats.aerialDuels || 0,
        aerialDuelsWon: stats.aerialDuelsWon || 0,
        touches: stats.touches || 0,
        yellowCards: stats.yellowCards || 0,
        redCards: stats.redCards || 0,
        rating: stats.rating || null,
      };

      gameStats.push(gameData);

      // Insert game stats
      await db.insert(schema.soccerPlayerGameStats).values({
        playerId,
        fixtureId: gameData.fixtureId,
        gameDate: gameData.gameDate.split('T')[0],
        opponent: gameData.opponent,
        opponentId: gameData.opponentId,
        isHome: gameData.isHome,
        leagueId: gameData.leagueId,
        minutes: gameData.minutes,
        shots: gameData.shots,
        shotsOnTarget: gameData.shotsOnTarget,
        goals: gameData.goals,
        assists: gameData.assists,
        passes: gameData.passes,
        passesAccurate: gameData.passesAccurate,
        keyPasses: gameData.keyPasses,
        crosses: gameData.crosses,
        crossesAccurate: gameData.crossesAccurate,
        tackles: gameData.tackles,
        interceptions: gameData.interceptions,
        clearances: gameData.clearances,
        blocks: gameData.blocks,
        saves: gameData.saves,
        fouls: gameData.fouls,
        foulsDrawn: gameData.foulsDrawn,
        dribbles: gameData.dribbles,
        dribblesSuccessful: gameData.dribblesSuccessful,
        duels: gameData.duels,
        duelsWon: gameData.duelsWon,
        aerialDuels: gameData.aerialDuels,
        aerialDuelsWon: gameData.aerialDuelsWon,
        touches: gameData.touches,
        yellowCards: gameData.yellowCards,
        redCards: gameData.redCards,
        rating: gameData.rating,
      }).onConflictDoNothing();

      result.gamesAdded++;
    }

    if (gameStats.length === 0) {
      return result;
    }

    // Calculate averages
    const averages = calculateAverages(gameStats);

    // Check if player exists
    const existingPlayer = await db.query.soccerPlayers.findFirst({
      where: eq(schema.soccerPlayers.id, playerId),
    });

    const displayName = playerData.display_name || playerData.common_name ||
      [playerData.firstname, playerData.lastname].filter(Boolean).join(' ');

    const playerRecord = {
      id: playerId,
      name: displayName,
      displayName: playerData.display_name,
      commonName: playerData.common_name,
      firstName: playerData.firstname,
      lastName: playerData.lastname,
      teamId: player.team_id,
      teamName,
      leagueId,
      leagueName,
      positionId: player.position_id,
      position: POSITION_MAP[player.position_id || 0] || 'Unknown',
      imagePath: playerData.image_path,
      dateOfBirth: playerData.date_of_birth,
      avgShots: averages.avgShots,
      avgShotsOnTarget: averages.avgShotsOnTarget,
      avgGoals: averages.avgGoals,
      avgAssists: averages.avgAssists,
      avgPasses: averages.avgPasses,
      avgKeyPasses: averages.avgKeyPasses,
      avgTackles: averages.avgTackles,
      avgInterceptions: averages.avgInterceptions,
      avgClearances: averages.avgClearances,
      avgBlocks: averages.avgBlocks,
      avgFouls: averages.avgFouls,
      avgFoulsDrawn: averages.avgFoulsDrawn,
      avgDribbles: averages.avgDribbles,
      avgDuelsWon: averages.avgDuelsWon,
      avgAerialDuelsWon: averages.avgAerialDuelsWon,
      avgCrosses: averages.avgCrosses,
      avgTouches: averages.avgTouches,
      avgMinutes: averages.avgMinutes,
      avgYellowCards: averages.avgYellowCards,
      avgRedCards: averages.avgRedCards,
      last5Shots: averages.last5Shots,
      last5ShotsOnTarget: averages.last5ShotsOnTarget,
      last5Goals: averages.last5Goals,
      last5Assists: averages.last5Assists,
      last5Passes: averages.last5Passes,
      last5Tackles: averages.last5Tackles,
      last10Shots: averages.last10Shots,
      last10ShotsOnTarget: averages.last10ShotsOnTarget,
      last10Goals: averages.last10Goals,
      last10Assists: averages.last10Assists,
      last10Passes: averages.last10Passes,
      last10Tackles: averages.last10Tackles,
      homeShots: averages.homeShots,
      homeShotsOnTarget: averages.homeShotsOnTarget,
      homeGoals: averages.homeGoals,
      homeAssists: averages.homeAssists,
      awayShots: averages.awayShots,
      awayShotsOnTarget: averages.awayShotsOnTarget,
      awayGoals: averages.awayGoals,
      awayAssists: averages.awayAssists,
      gamesPlayed: averages.gamesPlayed as number,
      homeGames: averages.homeGames as number,
      awayGames: averages.awayGames as number,
      totalGoals: averages.totalGoals as number,
      totalAssists: averages.totalAssists as number,
      lastGameDate: gameStats[0]?.gameDate.split('T')[0],
      lastUpdated: new Date().toISOString(),
    };

    if (existingPlayer) {
      await db.update(schema.soccerPlayers)
        .set(playerRecord)
        .where(eq(schema.soccerPlayers.id, playerId));
      result.updated = true;
    } else {
      await db.insert(schema.soccerPlayers).values(playerRecord);
      result.added = true;
    }

    return result;
  } catch (error) {
    log('Error processing player', { playerId, error: (error as Error).message });
    return result;
  }
}

/**
 * Full cache update - fetches all leagues, teams, and players
 */
export async function updateSoccerCache(): Promise<CacheUpdateResult> {
  const startTime = Date.now();
  const result: CacheUpdateResult = {
    leaguesProcessed: 0,
    teamsProcessed: 0,
    playersUpdated: 0,
    playersAdded: 0,
    gamesAdded: 0,
    mappingsCreated: 0,
    errors: [],
  };

  log('Starting full soccer cache update...');
  requestCount = 0;

  try {
    // Fetch all leagues
    const leagues = await fetchAllLeagues();
    log(`Processing ${leagues.length} leagues`);

    for (const league of leagues) {
      if (!league.current_season_id) continue;

      try {
        log(`Processing league: ${league.name}`, { leagueId: league.id, seasonId: league.current_season_id });

        // Save league to database
        await db.insert(schema.soccerLeagues).values({
          id: league.id,
          name: league.name,
          shortCode: league.short_code,
          countryId: league.country_id,
          countryName: league.country?.name,
          type: league.type,
          active: league.active,
          currentSeasonId: league.current_season_id,
          imagePath: league.image_path,
          lastUpdated: new Date().toISOString(),
        }).onConflictDoUpdate({
          target: schema.soccerLeagues.id,
          set: {
            name: league.name,
            currentSeasonId: league.current_season_id,
            lastUpdated: new Date().toISOString(),
          },
        });

        // Fetch teams for this season
        const teams = await fetchLeagueTeams(league.current_season_id);
        log(`Found ${teams.length} teams in ${league.name}`);

        for (const team of teams) {
          try {
            // Save team to database
            await db.insert(schema.soccerTeams).values({
              id: team.id,
              name: team.name,
              shortCode: team.short_code,
              countryId: team.country_id,
              leagueId: league.id,
              venueId: team.venue_id,
              imagePath: team.image_path,
              founded: team.founded,
              lastUpdated: new Date().toISOString(),
            }).onConflictDoUpdate({
              target: schema.soccerTeams.id,
              set: {
                name: team.name,
                leagueId: league.id,
                lastUpdated: new Date().toISOString(),
              },
            });

            // Fetch squad
            const squad = await fetchTeamSquad(team.id);
            log(`Processing ${squad.length} players from ${team.name}`);

            for (const player of squad) {
              const playerResult = await processPlayer(player, team.name, league.id, league.name);
              result.gamesAdded += playerResult.gamesAdded;
              if (playerResult.updated) result.playersUpdated++;
              if (playerResult.added) result.playersAdded++;
            }

            result.teamsProcessed++;
          } catch (teamError) {
            const msg = `Error processing team ${team.name}: ${(teamError as Error).message}`;
            log(msg);
            result.errors.push(msg);
          }
        }

        result.leaguesProcessed++;
      } catch (leagueError) {
        const msg = `Error processing league ${league.name}: ${(leagueError as Error).message}`;
        log(msg);
        result.errors.push(msg);
      }
    }

    result.duration = Date.now() - startTime;

    // Log cache update
    await db.insert(schema.soccerCacheLog).values({
      runDate: new Date().toISOString().split('T')[0],
      leaguesProcessed: result.leaguesProcessed,
      teamsProcessed: result.teamsProcessed,
      playersUpdated: result.playersUpdated,
      playersAdded: result.playersAdded,
      gamesAdded: result.gamesAdded,
      mappingsCreated: result.mappingsCreated,
      errors: result.errors.length > 0 ? JSON.stringify(result.errors) : null,
      duration: result.duration,
      status: 'completed',
    });

    log('Soccer cache update complete', {
      leagues: result.leaguesProcessed,
      teams: result.teamsProcessed,
      playersAdded: result.playersAdded,
      playersUpdated: result.playersUpdated,
      gamesAdded: result.gamesAdded,
      duration: `${Math.round(result.duration / 1000)}s`,
      totalRequests: requestCount,
    });

    return result;
  } catch (error) {
    const errorMsg = (error as Error).message;
    result.errors.push(`Fatal error: ${errorMsg}`);
    result.duration = Date.now() - startTime;

    // Log failed update
    await db.insert(schema.soccerCacheLog).values({
      runDate: new Date().toISOString().split('T')[0],
      leaguesProcessed: result.leaguesProcessed,
      teamsProcessed: result.teamsProcessed,
      playersUpdated: result.playersUpdated,
      playersAdded: result.playersAdded,
      gamesAdded: result.gamesAdded,
      errors: JSON.stringify(result.errors),
      duration: result.duration,
      status: 'failed',
    });

    throw error;
  }
}

// ============================================================================
// Query Functions (for validation)
// ============================================================================

/**
 * Get soccer player by SportMonks ID
 */
export async function getSoccerPlayerById(playerId: number) {
  return db.query.soccerPlayers.findFirst({
    where: eq(schema.soccerPlayers.id, playerId),
  });
}

/**
 * Get soccer player by name (fuzzy match)
 */
export async function getSoccerPlayerByName(name: string, teamName?: string) {
  const normalizedName = normalizePlayerName(name);

  // Get all players (or filter by team if provided)
  // We do fuzzy team matching so can't use exact DB filter
  const players = await db.query.soccerPlayers.findMany({});

  // Find best match with team consideration
  for (const player of players) {
    // Check if team matches (if provided)
    if (teamName && player.teamName && !teamNamesMatch(teamName, player.teamName)) {
      continue;
    }

    // Check name match
    if (playerNamesMatch(name, player.name)) {
      return player;
    }
    if (player.displayName && playerNamesMatch(name, player.displayName)) {
      return player;
    }
    if (player.commonName && playerNamesMatch(name, player.commonName)) {
      return player;
    }
  }

  // If no match found with team filter, try without team (broader search)
  if (teamName) {
    for (const player of players) {
      if (playerNamesMatch(name, player.name)) {
        return player;
      }
      if (player.displayName && playerNamesMatch(name, player.displayName)) {
        return player;
      }
      if (player.commonName && playerNamesMatch(name, player.commonName)) {
        return player;
      }
    }
  }

  return null;
}

/**
 * Get player game stats from cache
 */
export async function getSoccerPlayerGameStats(
  playerId: number,
  limit: number = 20
) {
  return db.query.soccerPlayerGameStats.findMany({
    where: eq(schema.soccerPlayerGameStats.playerId, playerId),
    orderBy: [desc(schema.soccerPlayerGameStats.gameDate)],
    limit,
  });
}

/**
 * Calculate hit rate from cached data for soccer bets
 */
export async function calculateSoccerHitRate(
  playerId: number,
  statKey: string,
  line: number,
  direction: 'over' | 'under',
  gameCount: number = 10
): Promise<{
  hits: number;
  total: number;
  hitRate: number;
  avgValue: number;
  recentGames: Array<{ date: string; opponent: string; value: number; hit: boolean }>;
} | null> {
  const games = await getSoccerPlayerGameStats(playerId, gameCount);

  if (games.length === 0) return null;

  // Map stat key to column
  const statMap: Record<string, keyof typeof games[0]> = {
    shots: 'shots',
    shots_on_target: 'shotsOnTarget',
    goals: 'goals',
    assists: 'assists',
    passes: 'passes',
    key_passes: 'keyPasses',
    tackles: 'tackles',
    interceptions: 'interceptions',
    clearances: 'clearances',
    blocks: 'blocks',
    saves: 'saves',
    fouls: 'fouls',
    fouls_drawn: 'foulsDrawn',
    dribbles: 'dribblesSuccessful',
    duels_won: 'duelsWon',
    aerial_duels_won: 'aerialDuelsWon',
    crosses: 'crosses',
    touches: 'touches',
    yellow_cards: 'yellowCards',
    red_cards: 'redCards',
    minutes: 'minutes',
  };

  const column = statMap[statKey];
  if (!column) return null;

  let hits = 0;
  let totalValue = 0;
  const recentGames: Array<{ date: string; opponent: string; value: number; hit: boolean }> = [];

  for (const game of games) {
    let value: number;

    // Special case: "shots" should be TOTAL shots (shots + shots_on_target)
    // SportMonks stat ID 41 is shots off target, so we need to add shots on target
    if (statKey === 'shots') {
      const shotsOffTarget = (game.shots as number) || 0;
      const shotsOnTarget = (game.shotsOnTarget as number) || 0;
      value = shotsOffTarget + shotsOnTarget;
    } else {
      value = (game[column] as number) || 0;
    }

    totalValue += value;

    const hit = direction === 'over' ? value > line : value < line;
    if (hit) hits++;

    recentGames.push({
      date: game.gameDate,
      opponent: game.opponent || 'Unknown',
      value,
      hit,
    });
  }

  return {
    hits,
    total: games.length,
    hitRate: Math.round((hits / games.length) * 100),
    avgValue: Math.round((totalValue / games.length) * 100) / 100,
    recentGames,
  };
}

/**
 * Get cache statistics
 */
export async function getSoccerCacheStats() {
  const playerCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.soccerPlayers);

  const gameCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.soccerPlayerGameStats);

  const leagueCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.soccerLeagues);

  const teamCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.soccerTeams);

  const lastLog = await db.query.soccerCacheLog.findFirst({
    orderBy: [desc(schema.soccerCacheLog.id)],
  });

  return {
    totalPlayers: playerCount[0]?.count ?? 0,
    totalGames: gameCount[0]?.count ?? 0,
    totalLeagues: leagueCount[0]?.count ?? 0,
    totalTeams: teamCount[0]?.count ?? 0,
    lastUpdate: lastLog?.runDate,
    lastStatus: lastLog?.status,
    lastDuration: lastLog?.duration,
  };
}
