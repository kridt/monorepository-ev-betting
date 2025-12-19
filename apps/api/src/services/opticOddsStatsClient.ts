/**
 * OpticOdds Stats Client
 * Handles all player and team statistics validation using OpticOdds API
 * Replaces both Ball Don't Lie (NBA) and SportMonks (Soccer) APIs
 */

import { config } from '../config.js';

const BASE_URL = 'https://api.opticodds.com/api/v3';

// ============================================================================
// Types
// ============================================================================

export interface PlayerSearchResult {
  id: string;
  name: string;
  position: string;
  number: number;
  team: {
    id: string;
    name: string;
  };
  sport: string;
  league: string;
}

export interface TeamSearchResult {
  id: string;
  name: string;
  abbreviation: string;
  sport: string;
  league: string;
}

export interface PlayerGameStats {
  fixtureId: string;
  fixtureDate: string;
  opponent: string;
  isHome: boolean;
  minutes: number;
  // NBA stats
  points?: number;
  rebounds?: number;
  assists?: number;
  threePointersMade?: number;
  steals?: number;
  blocks?: number;
  turnovers?: number;
  // Soccer stats
  goals?: number;
  soccerAssists?: number;
  shots?: number;
  shotsOnTarget?: number;
  tackles?: number;
  passes?: number;
  crosses?: number;
  cards?: number;
  fouls?: number;
  // Combined
  pra?: number; // Points + Rebounds + Assists
}

export interface TeamGameResult {
  fixtureId: string;
  fixtureDate: string;
  opponent: string;
  isHome: boolean;
  teamScore: number;
  opponentScore: number;
  margin: number;
  won: boolean;
}

export interface ValidationResult {
  playerId?: string;
  teamId?: string;
  playerName?: string;
  teamName?: string;
  market: string;
  line: number;
  direction: 'over' | 'under';
  matchesChecked: number;
  hits: number;
  hitRate: number;
  avgValue: number;
  recentGames: Array<{
    date: string;
    opponent: string;
    value: number;
    hit: boolean;
    isHome?: boolean;
  }>;
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
// Player Search
// ============================================================================

/**
 * Search for a player by name
 */
export async function searchPlayer(
  name: string,
  sport: 'basketball' | 'soccer',
  league?: string
): Promise<PlayerSearchResult | null> {
  try {
    // First try with name filter (if supported by API)
    const params: Record<string, string> = { sport, name };
    if (league) params.league = league;

    console.info(`[OpticOdds Stats] Searching for player: "${name}" sport=${sport} league=${league || 'any'}`);
    let response = await fetchFromOpticOdds<{ data: any[] }>('/players', params);
    console.info(`[OpticOdds Stats] Player search with name filter returned ${response.data?.length || 0} results`);

    // If no results with name filter, try without (fallback to listing all)
    if (!response.data || response.data.length === 0) {
      console.info(`[OpticOdds Stats] Retrying player search without name filter...`);
      const fallbackParams: Record<string, string> = { sport };
      if (league) fallbackParams.league = league;
      response = await fetchFromOpticOdds<{ data: any[] }>('/players', fallbackParams);
      console.info(`[OpticOdds Stats] Player search without name filter returned ${response.data?.length || 0} results`);
    }

    // Search through results for best match
    const searchLower = name.toLowerCase().trim();
    const searchParts = searchLower.split(' ');

    // Try exact match first
    let match = response.data?.find(p =>
      p.name?.toLowerCase() === searchLower
    );

    // Try contains match
    if (!match) {
      match = response.data?.find(p =>
        p.name?.toLowerCase().includes(searchLower) ||
        searchLower.includes(p.name?.toLowerCase())
      );
    }

    // Try partial match (first and last name)
    if (!match && searchParts.length >= 2) {
      match = response.data?.find(p => {
        const playerName = p.name?.toLowerCase() || '';
        return searchParts.every(part => playerName.includes(part));
      });
    }

    // Try last name only
    if (!match && searchParts.length >= 2) {
      const lastName = searchParts[searchParts.length - 1];
      match = response.data?.find(p =>
        p.name?.toLowerCase().includes(lastName)
      );
    }

    if (!match) {
      console.warn(`[OpticOdds Stats] No match found for "${name}" in ${response.data?.length || 0} players`);
      return null;
    }

    return {
      id: match.id,
      name: match.name,
      position: match.position,
      number: match.number,
      team: {
        id: match.team?.id,
        name: match.team?.name,
      },
      sport: match.sport?.id,
      league: match.league?.id,
    };
  } catch (error) {
    console.error('[OpticOdds Stats] Error searching player:', error);
    return null;
  }
}

/**
 * Search for a team by name
 */
export async function searchTeam(
  name: string,
  sport: 'basketball' | 'soccer',
  league?: string
): Promise<TeamSearchResult | null> {
  try {
    const params: Record<string, string> = { sport };
    if (league) params.league = league;

    const response = await fetchFromOpticOdds<{ data: any[] }>('/teams', params);

    const searchLower = name.toLowerCase().trim();

    // Try exact match first
    let match = response.data?.find(t =>
      t.name?.toLowerCase() === searchLower ||
      t.abbreviation?.toLowerCase() === searchLower
    );

    // Try contains match
    if (!match) {
      match = response.data?.find(t =>
        t.name?.toLowerCase().includes(searchLower) ||
        searchLower.includes(t.name?.toLowerCase())
      );
    }

    if (!match) return null;

    return {
      id: match.id,
      name: match.name,
      abbreviation: match.abbreviation,
      sport: match.sport?.id,
      league: match.league?.id,
    };
  } catch (error) {
    console.error('[OpticOdds Stats] Error searching team:', error);
    return null;
  }
}

// ============================================================================
// Player Stats Retrieval
// ============================================================================

/**
 * Get last X games stats for a player
 */
export async function getPlayerLastXStats(
  playerId: string,
  lastX: number = 10
): Promise<PlayerGameStats[]> {
  try {
    console.info(`[OpticOdds Stats] Fetching last ${lastX} stats for player ${playerId}`);
    const response = await fetchFromOpticOdds<{ data: any[] }>(
      '/fixtures/player-results/last-x',
      { player_id: playerId, last_x: lastX.toString() }
    );

    if (!response.data?.[0]?.stats) {
      console.warn(`[OpticOdds Stats] No stats data for player ${playerId}. Response:`, JSON.stringify(response.data?.[0] || 'empty').slice(0, 200));
      return [];
    }

    const playerData = response.data[0];
    const stats = playerData.stats;
    const sport = playerData.sport?.id;

    // Stats are returned as arrays where each index is a game
    const gameCount = stats.points?.length || stats.goals?.length || 0;
    const games: PlayerGameStats[] = [];

    for (let i = 0; i < gameCount; i++) {
      const game: PlayerGameStats = {
        fixtureId: '',
        fixtureDate: '',
        opponent: '',
        isHome: false,
        minutes: stats.minutes?.[i] || 0,
      };

      if (sport === 'basketball') {
        game.points = stats.points?.[i] || 0;
        game.rebounds = stats.total_rebounds?.[i] || 0;
        game.assists = stats.assists?.[i] || 0;
        game.threePointersMade = stats.three_point_field_goals_made?.[i] || 0;
        game.steals = stats.steals?.[i] || 0;
        game.blocks = stats.blocks?.[i] || 0;
        game.turnovers = stats.turnovers?.[i] || 0;
        game.pra = (game.points || 0) + (game.rebounds || 0) + (game.assists || 0);
      } else if (sport === 'soccer') {
        game.goals = stats.goals?.[i] || 0;
        game.soccerAssists = stats.goal_assist?.[i] || 0;
        game.shots = stats.total_scoring_att?.[i] || 0;
        game.shotsOnTarget = stats.ontarget_scoring_att?.[i] || 0;
        game.tackles = stats.won_tackle?.[i] || 0;
        game.passes = stats.total_pass?.[i] || 0;
        game.crosses = stats.total_cross?.[i] || 0;
        game.cards = (stats.yellow_card?.[i] || 0) + (stats.red_card?.[i] || 0);
        game.fouls = stats.fouls?.[i] || 0;
      }

      games.push(game);
    }

    return games;
  } catch (error) {
    console.error('[OpticOdds Stats] Error getting player stats:', error);
    return [];
  }
}

/**
 * Get player stats from a specific fixture (more detailed)
 */
export async function getPlayerFixtureStats(
  playerId: string,
  fixtureId: string
): Promise<PlayerGameStats | null> {
  try {
    const response = await fetchFromOpticOdds<{ data: any[] }>(
      '/fixtures/player-results',
      { fixture_id: fixtureId, player_id: playerId }
    );

    const playerResult = response.data?.find(r => r.player?.id === playerId);
    if (!playerResult) return null;

    const stats = playerResult.stats?.[0]?.stats || {};
    const marketStats = playerResult.market_stats || {};
    const fixture = playerResult.fixture;
    const sport = playerResult.sport?.id;

    const game: PlayerGameStats = {
      fixtureId: fixture?.id || fixtureId,
      fixtureDate: fixture?.start_date || '',
      opponent: '',
      isHome: false,
      minutes: stats.minutes || 0,
    };

    if (sport === 'basketball') {
      game.points = marketStats.player_points || stats.points || 0;
      game.rebounds = marketStats.player_rebounds || stats.total_rebounds || 0;
      game.assists = marketStats.player_assists || stats.assists || 0;
      game.threePointersMade = marketStats.player_threes || stats.three_point_field_goals_made || 0;
      game.steals = stats.steals || 0;
      game.blocks = stats.blocks || 0;
      game.turnovers = stats.turnovers || 0;
      game.pra = (game.points || 0) + (game.rebounds || 0) + (game.assists || 0);
    } else if (sport === 'soccer') {
      game.goals = marketStats.player_goals || stats.goals || 0;
      game.soccerAssists = marketStats.player_assists || stats.goal_assist || 0;
      game.shots = marketStats.player_shots || stats.total_scoring_att || 0;
      game.shotsOnTarget = marketStats.player_shots_on_target || stats.ontarget_scoring_att || 0;
      game.tackles = marketStats.player_tackles || stats.won_tackle || 0;
      game.passes = marketStats.player_passes || stats.total_pass || 0;
      game.crosses = marketStats.player_crosses || stats.total_cross || 0;
      game.cards = marketStats.player_cards || ((stats.yellow_card || 0) + (stats.red_card || 0));
      game.fouls = marketStats.player_fouls || stats.fouls || 0;
    }

    return game;
  } catch (error) {
    console.error('[OpticOdds Stats] Error getting fixture stats:', error);
    return null;
  }
}

// ============================================================================
// Team Stats Retrieval
// ============================================================================

/**
 * Get last X game results for a team
 */
export async function getTeamLastXResults(
  teamId: string,
  lastX: number = 10
): Promise<TeamGameResult[]> {
  try {
    const response = await fetchFromOpticOdds<{ data: any[] }>(
      '/fixtures/results',
      { team_id: teamId, status: 'Completed' }
    );

    const games: TeamGameResult[] = [];

    for (const result of response.data?.slice(0, lastX) || []) {
      const fixture = result.fixture;
      const scores = result.scores;

      const isHome = fixture.home_competitors?.[0]?.id === teamId;
      const teamScore = isHome ? scores.home?.total : scores.away?.total;
      const opponentScore = isHome ? scores.away?.total : scores.home?.total;
      const opponent = isHome
        ? fixture.away_competitors?.[0]?.name
        : fixture.home_competitors?.[0]?.name;

      games.push({
        fixtureId: fixture.id,
        fixtureDate: fixture.start_date,
        opponent: opponent || 'Unknown',
        isHome,
        teamScore: teamScore || 0,
        opponentScore: opponentScore || 0,
        margin: (teamScore || 0) - (opponentScore || 0),
        won: (teamScore || 0) > (opponentScore || 0),
      });
    }

    return games;
  } catch (error) {
    console.error('[OpticOdds Stats] Error getting team results:', error);
    return [];
  }
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Map common market names to stat keys
 */
function getStatKeyForMarket(market: string, sport: 'basketball' | 'soccer'): keyof PlayerGameStats | null {
  const marketLower = market.toLowerCase();

  if (sport === 'basketball') {
    if (marketLower.includes('point') && !marketLower.includes('three')) return 'points';
    if (marketLower.includes('rebound')) return 'rebounds';
    if (marketLower.includes('assist')) return 'assists';
    if (marketLower.includes('three') || marketLower.includes('3p') || marketLower.includes('3-p')) return 'threePointersMade';
    if (marketLower.includes('steal')) return 'steals';
    if (marketLower.includes('block')) return 'blocks';
    if (marketLower.includes('turnover')) return 'turnovers';
    if (marketLower.includes('pra') || marketLower.includes('pts+reb+ast')) return 'pra';
    if (marketLower.includes('pts+reb') || marketLower.includes('points+rebounds')) return null; // Handle separately
    if (marketLower.includes('pts+ast') || marketLower.includes('points+assists')) return null; // Handle separately
    if (marketLower.includes('reb+ast') || marketLower.includes('rebounds+assists')) return null; // Handle separately
  } else if (sport === 'soccer') {
    if (marketLower.includes('goal') && !marketLower.includes('assist')) return 'goals';
    if (marketLower.includes('assist')) return 'soccerAssists';
    if (marketLower.includes('shot on target') || marketLower.includes('sot')) return 'shotsOnTarget';
    if (marketLower.includes('shot')) return 'shots';
    if (marketLower.includes('tackle')) return 'tackles';
    if (marketLower.includes('pass')) return 'passes';
    if (marketLower.includes('cross')) return 'crosses';
    if (marketLower.includes('card') || marketLower.includes('booking')) return 'cards';
    if (marketLower.includes('foul')) return 'fouls';
  }

  return null;
}

/**
 * Get combined stat value for combo markets
 */
function getCombinedStatValue(game: PlayerGameStats, market: string): number | null {
  const marketLower = market.toLowerCase();

  if (marketLower.includes('pts+reb+ast') || marketLower.includes('pra')) {
    return (game.points || 0) + (game.rebounds || 0) + (game.assists || 0);
  }
  if (marketLower.includes('pts+reb') || marketLower.includes('points+rebounds')) {
    return (game.points || 0) + (game.rebounds || 0);
  }
  if (marketLower.includes('pts+ast') || marketLower.includes('points+assists')) {
    return (game.points || 0) + (game.assists || 0);
  }
  if (marketLower.includes('reb+ast') || marketLower.includes('rebounds+assists')) {
    return (game.rebounds || 0) + (game.assists || 0);
  }
  if (marketLower.includes('goals+assists') || marketLower.includes('g+a')) {
    return (game.goals || 0) + (game.soccerAssists || 0);
  }

  return null;
}

/**
 * Validate a player prop bet
 */
export async function validatePlayerProp(
  playerId: string,
  playerName: string,
  market: string,
  line: number,
  direction: 'over' | 'under',
  sport: 'basketball' | 'soccer',
  matchCount: number = 10
): Promise<ValidationResult | null> {
  try {
    const games = await getPlayerLastXStats(playerId, matchCount);

    if (games.length === 0) {
      console.warn(`[OpticOdds Stats] No games found for player ${playerId}`);
      return null;
    }

    const statKey = getStatKeyForMarket(market, sport);
    let hits = 0;
    let totalValue = 0;
    const recentGames: ValidationResult['recentGames'] = [];

    for (const game of games) {
      let value: number;

      // Handle combined stats
      const combinedValue = getCombinedStatValue(game, market);
      if (combinedValue !== null) {
        value = combinedValue;
      } else if (statKey && game[statKey] !== undefined) {
        value = game[statKey] as number;
      } else {
        continue;
      }

      const hit = direction === 'over' ? value > line : value < line;
      if (hit) hits++;
      totalValue += value;

      recentGames.push({
        date: game.fixtureDate || 'Unknown',
        opponent: game.opponent || 'Unknown',
        value,
        hit,
        isHome: game.isHome,
      });
    }

    const matchesChecked = recentGames.length;
    if (matchesChecked === 0) return null;

    return {
      playerId,
      playerName,
      market,
      line,
      direction,
      matchesChecked,
      hits,
      hitRate: Math.round((hits / matchesChecked) * 100),
      avgValue: Math.round((totalValue / matchesChecked) * 10) / 10,
      recentGames,
    };
  } catch (error) {
    console.error('[OpticOdds Stats] Error validating player prop:', error);
    return null;
  }
}

/**
 * Validate a spread bet
 */
export async function validateSpreadBet(
  teamId: string,
  teamName: string,
  line: number,
  direction: 'over' | 'under', // over = team covers (wins by more than spread)
  matchCount: number = 10
): Promise<ValidationResult | null> {
  try {
    const games = await getTeamLastXResults(teamId, matchCount);

    if (games.length === 0) {
      console.warn(`[OpticOdds Stats] No games found for team ${teamId}`);
      return null;
    }

    let hits = 0;
    let totalMargin = 0;
    const recentGames: ValidationResult['recentGames'] = [];

    for (const game of games) {
      // For spread: line is typically negative for favorites
      // "Team -5.5" means they need to win by more than 5.5
      // margin > |line| means they covered
      const covered = direction === 'over'
        ? game.margin > Math.abs(line)
        : game.margin < -Math.abs(line);

      if (covered) hits++;
      totalMargin += game.margin;

      recentGames.push({
        date: game.fixtureDate,
        opponent: game.opponent,
        value: game.margin,
        hit: covered,
        isHome: game.isHome,
      });
    }

    return {
      teamId,
      teamName,
      market: 'spread',
      line,
      direction,
      matchesChecked: games.length,
      hits,
      hitRate: Math.round((hits / games.length) * 100),
      avgValue: Math.round((totalMargin / games.length) * 10) / 10,
      recentGames,
    };
  } catch (error) {
    console.error('[OpticOdds Stats] Error validating spread:', error);
    return null;
  }
}

/**
 * Validate a moneyline bet
 */
export async function validateMoneylineBet(
  teamId: string,
  teamName: string,
  matchCount: number = 10
): Promise<ValidationResult | null> {
  try {
    const games = await getTeamLastXResults(teamId, matchCount);

    if (games.length === 0) {
      console.warn(`[OpticOdds Stats] No games found for team ${teamId}`);
      return null;
    }

    let wins = 0;
    const recentGames: ValidationResult['recentGames'] = [];

    for (const game of games) {
      if (game.won) wins++;

      recentGames.push({
        date: game.fixtureDate,
        opponent: game.opponent,
        value: game.won ? 1 : 0,
        hit: game.won,
        isHome: game.isHome,
      });
    }

    return {
      teamId,
      teamName,
      market: 'moneyline',
      line: 0,
      direction: 'over',
      matchesChecked: games.length,
      hits: wins,
      hitRate: Math.round((wins / games.length) * 100),
      avgValue: Math.round((wins / games.length) * 100),
      recentGames,
    };
  } catch (error) {
    console.error('[OpticOdds Stats] Error validating moneyline:', error);
    return null;
  }
}

/**
 * Validate BTTS (Both Teams To Score) for soccer
 */
export async function validateBTTS(
  homeTeamId: string,
  awayTeamId: string,
  selection: 'yes' | 'no',
  matchCount: number = 10
): Promise<{ homeRate: number; awayRate: number; combinedRate: number } | null> {
  try {
    const [homeGames, awayGames] = await Promise.all([
      getTeamLastXResults(homeTeamId, matchCount),
      getTeamLastXResults(awayTeamId, matchCount),
    ]);

    if (homeGames.length === 0 || awayGames.length === 0) {
      return null;
    }

    // Count games where both teams scored
    const homeBTTS = homeGames.filter(g => g.teamScore > 0 && g.opponentScore > 0).length;
    const awayBTTS = awayGames.filter(g => g.teamScore > 0 && g.opponentScore > 0).length;

    const homeRate = Math.round((homeBTTS / homeGames.length) * 100);
    const awayRate = Math.round((awayBTTS / awayGames.length) * 100);
    const combinedRate = Math.round((homeRate + awayRate) / 2);

    return { homeRate, awayRate, combinedRate };
  } catch (error) {
    console.error('[OpticOdds Stats] Error validating BTTS:', error);
    return null;
  }
}

/**
 * Validate Over/Under total goals for soccer
 */
export async function validateTotalGoals(
  homeTeamId: string,
  awayTeamId: string,
  line: number,
  direction: 'over' | 'under',
  matchCount: number = 10
): Promise<{ hitRate: number; avgTotal: number } | null> {
  try {
    const [homeGames, awayGames] = await Promise.all([
      getTeamLastXResults(homeTeamId, matchCount),
      getTeamLastXResults(awayTeamId, matchCount),
    ]);

    if (homeGames.length === 0 || awayGames.length === 0) {
      return null;
    }

    // Calculate average total goals for each team's games
    const homeTotals = homeGames.map(g => g.teamScore + g.opponentScore);
    const awayTotals = awayGames.map(g => g.teamScore + g.opponentScore);

    const homeAvg = homeTotals.reduce((a, b) => a + b, 0) / homeTotals.length;
    const awayAvg = awayTotals.reduce((a, b) => a + b, 0) / awayTotals.length;
    const avgTotal = (homeAvg + awayAvg) / 2;

    // Count hits
    const homeHits = homeTotals.filter(t => direction === 'over' ? t > line : t < line).length;
    const awayHits = awayTotals.filter(t => direction === 'over' ? t > line : t < line).length;
    const totalHits = homeHits + awayHits;
    const totalGames = homeTotals.length + awayTotals.length;

    return {
      hitRate: Math.round((totalHits / totalGames) * 100),
      avgTotal: Math.round(avgTotal * 10) / 10,
    };
  } catch (error) {
    console.error('[OpticOdds Stats] Error validating total goals:', error);
    return null;
  }
}

// ============================================================================
// Batch Validation for Pipeline
// ============================================================================

export interface OpportunityValidationRequest {
  opportunityId: string;
  playerId?: string;
  playerName?: string;
  teamId?: string;
  teamName?: string;
  market: string;
  line?: number;
  selection: string;
  sport: string;
  league: string;
}

/**
 * Validate multiple opportunities efficiently
 */
export async function validateOpportunitiesBatch(
  opportunities: OpportunityValidationRequest[],
  matchCount: number = 10
): Promise<Map<string, ValidationResult | null>> {
  const results = new Map<string, ValidationResult | null>();

  // Process in batches to avoid rate limits
  const batchSize = 5;
  for (let i = 0; i < opportunities.length; i += batchSize) {
    const batch = opportunities.slice(i, i + batchSize);

    const batchPromises = batch.map(async (opp) => {
      try {
        const sport = opp.sport.toLowerCase().includes('basket') ? 'basketball' : 'soccer';
        const direction = opp.selection.toLowerCase().includes('over') ? 'over' : 'under';
        const line = opp.line || 0;

        // Player prop validation
        if (opp.playerId && opp.playerName) {
          const result = await validatePlayerProp(
            opp.playerId,
            opp.playerName,
            opp.market,
            line,
            direction,
            sport,
            matchCount
          );
          return { id: opp.opportunityId, result };
        }

        // Team spread validation
        if (opp.teamId && opp.market.toLowerCase().includes('spread')) {
          const result = await validateSpreadBet(
            opp.teamId,
            opp.teamName || '',
            line,
            direction,
            matchCount
          );
          return { id: opp.opportunityId, result };
        }

        // Team moneyline validation
        if (opp.teamId && opp.market.toLowerCase().includes('moneyline')) {
          const result = await validateMoneylineBet(
            opp.teamId,
            opp.teamName || '',
            matchCount
          );
          return { id: opp.opportunityId, result };
        }

        return { id: opp.opportunityId, result: null };
      } catch (error) {
        console.error(`[OpticOdds Stats] Error validating ${opp.opportunityId}:`, error);
        return { id: opp.opportunityId, result: null };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    batchResults.forEach(({ id, result }) => {
      results.set(id, result);
    });

    // Small delay between batches
    if (i + batchSize < opportunities.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return results;
}
