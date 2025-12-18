import type {
  HealthResponse,
  OpportunitiesResponse,
  OpportunityDetailResponse,
  SportsbooksMetaResponse,
  LeaguesMetaResponse,
  MethodsResponse,
  FixtureStats,
  ValidationResult,
  EVOpportunitySummary,
} from '@ev-bets/shared';

// Re-export the opportunity type for use in other parts of the app
export type OpportunityResponse = EVOpportunitySummary & {
  // Extended with bestEV for tracking service compatibility
  bestEV: {
    targetBookId: string;
    targetBookName: string;
    offeredOdds: number;
    fairOdds: number;
    evPercent: number;
    method: string;
  };
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

async function fetchJSON<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

// Health
export async function fetchHealth(): Promise<HealthResponse> {
  return fetchJSON('/health');
}

// Opportunities
export interface OpportunitiesParams {
  method?: string;
  sport?: string;
  league?: string;
  marketGroup?: string;
  targetBook?: string;
  minEV?: number;
  maxEV?: number;
  minBooks?: number;
  maxOdds?: number;
  timeWindow?: string; // '1h', '3h', '6h', '12h', '24h', '48h'
  q?: string;
  page?: number;
  pageSize?: number;
  sortBy?: 'evPercent' | 'startsAt' | 'market';
  sortDir?: 'asc' | 'desc';
}

export async function fetchOpportunities(
  params: OpportunitiesParams = {}
): Promise<OpportunitiesResponse> {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.set(key, String(value));
    }
  });

  const queryString = searchParams.toString();
  const endpoint = `/ev/opportunities${queryString ? `?${queryString}` : ''}`;

  return fetchJSON(endpoint);
}

export async function fetchOpportunityDetail(id: string): Promise<OpportunityDetailResponse> {
  return fetchJSON(`/ev/opportunities/${id}`);
}

// Refresh opportunity with live odds
export interface RefreshResponse {
  success: boolean;
  message: string;
  data: {
    id: string;
    fixtureId: string;
    sport: string;
    league: string;
    homeTeam: string | null;
    awayTeam: string | null;
    startsAt: string;
    market: string;
    selection: string;
    line: number | null;
    playerName: string | null;
    evPercent: number;
    targetBook: string;
    targetBookId: string;
    offeredOdds: number;
    fairOdds: number;
    method: string;
    bookCount: number;
    bookOdds: Array<{
      sportsbookId: string;
      sportsbookName: string;
      decimalOdds: number;
      impliedProbability: number;
      isTarget: boolean;
      isSharp: boolean;
      isOutlier: boolean;
    }>;
    refreshedAt: string;
  } | null;
}

export async function refreshOpportunity(id: string): Promise<RefreshResponse> {
  return fetchJSON(`/ev/opportunities/${id}/refresh`, {
    method: 'POST',
  });
}

// Meta
export async function fetchSportsbooks(): Promise<SportsbooksMetaResponse> {
  return fetchJSON('/meta/sportsbooks');
}

export async function fetchLeagues(): Promise<LeaguesMetaResponse> {
  return fetchJSON('/meta/leagues');
}

export async function fetchMethods(): Promise<MethodsResponse> {
  return fetchJSON('/meta/methods');
}

export async function setTargets(targetIds: string[]): Promise<{ success: boolean }> {
  return fetchJSON('/meta/targets', {
    method: 'POST',
    body: JSON.stringify({ targetIds }),
  });
}

export async function setLeagues(enabledIds: string[]): Promise<{ success: boolean }> {
  return fetchJSON('/meta/leagues', {
    method: 'POST',
    body: JSON.stringify({ enabledIds }),
  });
}

// Statistics (SportMonks)
export interface FixtureStatsResponse {
  data: FixtureStats | null;
  message?: string;
  error?: string;
}

export interface BatchFixtureStatsResponse {
  data: Record<string, FixtureStats | null>;
}

export async function fetchFixtureStats(fixtureId: string): Promise<FixtureStatsResponse> {
  return fetchJSON(`/stats/fixture/${fixtureId}`);
}

export async function fetchBatchFixtureStats(
  fixtureIds: string[]
): Promise<BatchFixtureStatsResponse> {
  const ids = fixtureIds.slice(0, 10).join(','); // Limit to 10
  return fetchJSON(`/stats/fixtures?ids=${ids}`);
}

// Validation
export interface ValidateBetParams {
  playerName: string;
  market: string;
  line: number;
  selection: string;
  matchCount?: number;
}

export interface ValidationResponse {
  data: ValidationResult | null;
  message?: string;
  error?: string;
}

export async function validateBet(params: ValidateBetParams): Promise<ValidationResponse> {
  return fetchJSON('/stats/validate', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// NBA Validation (Ball Don't Lie API)
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

export interface NBAValidationResponse {
  data: NBAValidationResult | null;
  message?: string;
  error?: string;
}

export interface NBABatchValidationResponse {
  data: Record<string, NBAValidationResult | null>;
  processed: number;
  total: number;
}

export async function validateNBABet(params: ValidateBetParams): Promise<NBAValidationResponse> {
  return fetchJSON('/stats/validate-nba', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function validateNBABetsBatch(
  bets: Array<{
    opportunityId: string;
    playerName: string;
    market: string;
    line: number;
    selection: string;
  }>,
  matchCount: number = 10
): Promise<NBABatchValidationResponse> {
  return fetchJSON('/stats/validate-nba-batch', {
    method: 'POST',
    body: JSON.stringify({ bets, matchCount }),
  });
}

// Team Validation (Soccer team markets - corners, goals, shots)
export interface TeamValidationResult {
  teamName: string;
  teamId: number;
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
    result: string;
  }[];
  avgValue: number;
  homeAvg?: number;
  awayAvg?: number;
}

export interface TeamValidationResponse {
  data: TeamValidationResult | null;
  message?: string;
  error?: string;
}

export interface ValidateTeamBetParams {
  teamName: string;
  market: string;
  line: number;
  selection: string;
  matchCount?: number;
}

export async function validateTeamBet(params: ValidateTeamBetParams): Promise<TeamValidationResponse> {
  return fetchJSON('/stats/validate-team', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// BTTS Validation
export interface BTTSValidationResult {
  homeTeamBTTSRate: number;
  awayTeamBTTSRate: number;
  combinedRate: number;
  homeRecentMatches: { date: string; opponent: string; btts: boolean }[];
  awayRecentMatches: { date: string; opponent: string; btts: boolean }[];
}

export interface BTTSValidationResponse {
  data: BTTSValidationResult | null;
  message?: string;
  error?: string;
}

export async function validateBTTS(
  homeTeam: string,
  awayTeam: string,
  selection: string,
  matchCount: number = 10
): Promise<BTTSValidationResponse> {
  return fetchJSON('/stats/validate-btts', {
    method: 'POST',
    body: JSON.stringify({ homeTeam, awayTeam, selection, matchCount }),
  });
}

// 1X2 (Match Result) Validation
export interface MatchResultValidationResult {
  homeWinRate: number;
  drawRate: number;
  awayWinRate: number;
  homeForm: string;
  awayForm: string;
  homeRecentMatches: { date: string; opponent: string; result: 'W' | 'D' | 'L'; score: string }[];
  awayRecentMatches: { date: string; opponent: string; result: 'W' | 'D' | 'L'; score: string }[];
}

export interface MatchResultValidationResponse {
  data: MatchResultValidationResult | null;
  message?: string;
  error?: string;
}

export async function validateMatchResult(
  homeTeam: string,
  awayTeam: string,
  selection: string,
  matchCount: number = 10
): Promise<MatchResultValidationResponse> {
  return fetchJSON('/stats/validate-1x2', {
    method: 'POST',
    body: JSON.stringify({ homeTeam, awayTeam, selection, matchCount }),
  });
}
