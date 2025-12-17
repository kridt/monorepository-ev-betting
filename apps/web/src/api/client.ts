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
