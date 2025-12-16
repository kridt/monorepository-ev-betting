import pLimit from 'p-limit';
import {
  SportsbooksResponse,
  SportsbooksResponseSchema,
  LeaguesResponse,
  LeaguesResponseSchema,
  FixturesResponse,
  OpticOddsFixturesResponseSchema,
  OddsResponse,
  OddsResponseSchema,
  type Fixture,
  type OpticOddsFixture,
} from '@ev-bets/shared';
import { config } from '../config.js';

// Concurrency limiter
const limit = pLimit(config.maxConcurrentRequests);

// Retry configuration
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;

// API client configuration
const API_BASE_URL = config.opticOddsBaseUrl;
const API_KEY = config.opticOddsApiKey;

// Safe logging (never log API key)
function safeLog(message: string, data?: Record<string, unknown>) {
  const safeData = data ? { ...data } : {};
  delete safeData['apiKey'];
  console.info(`[OpticOdds] ${message}`, safeData);
}

// Sleep utility
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// In-memory cache for sportsbooks (they don't change frequently)
let sportsbooksCache: SportsbooksResponse | null = null;
let sportsbooksCacheTime = 0;
const SPORTSBOOKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Fetch with retry and exponential backoff
async function fetchWithRetry<T>(
  url: string,
  schema: { parse: (data: unknown) => T },
  attempt = 1
): Promise<T> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Api-Key': API_KEY,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return schema.parse(data);
  } catch (error) {
    if (attempt < RETRY_ATTEMPTS) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      safeLog(`Retry ${attempt}/${RETRY_ATTEMPTS} after ${delay}ms`, {
        url: url.replace(API_KEY, '[REDACTED]'),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await sleep(delay);
      return fetchWithRetry(url, schema, attempt + 1);
    }
    throw error;
  }
}

// Transform OpticOdds fixture to our internal format
function transformFixture(opticOddsFixture: OpticOddsFixture): Fixture {
  return {
    id: opticOddsFixture.id,
    sport: opticOddsFixture.sport.id,
    league: opticOddsFixture.league.id,
    leagueName: opticOddsFixture.league.name,
    start_date: opticOddsFixture.start_date,
    home_team: opticOddsFixture.home_team_display || opticOddsFixture.home_competitors?.[0]?.name,
    away_team: opticOddsFixture.away_team_display || opticOddsFixture.away_competitors?.[0]?.name,
    home_team_id: opticOddsFixture.home_competitors?.[0]?.id,
    away_team_id: opticOddsFixture.away_competitors?.[0]?.id,
    status: opticOddsFixture.status,
    is_live: opticOddsFixture.is_live,
  };
}

// Build URL with query params (handling repeated params correctly)
function buildUrl(endpoint: string, params: Record<string, string | string[] | undefined>): string {
  const url = new URL(`${API_BASE_URL}${endpoint}`);

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;

    if (Array.isArray(value)) {
      // Repeated params (e.g., sportsbook=a&sportsbook=b)
      for (const v of value) {
        url.searchParams.append(key, v);
      }
    } else {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

// Batch sportsbooks into groups of MAX_SPORTSBOOKS_PER_REQUEST
function batchSportsbooks(sportsbooks: string[]): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < sportsbooks.length; i += config.maxSportsbooksPerRequest) {
    batches.push(sportsbooks.slice(i, i + config.maxSportsbooksPerRequest));
  }
  return batches;
}

// ============================================================================
// API ENDPOINTS
// ============================================================================

/**
 * Fetch active sportsbooks for a sport
 */
export async function fetchSportsbooks(sport: string): Promise<SportsbooksResponse> {
  const url = buildUrl('/sportsbooks/active', { sport });
  safeLog('Fetching sportsbooks', { sport });
  return limit(() => fetchWithRetry(url, SportsbooksResponseSchema));
}

/**
 * Fetch ALL active sportsbooks by combining results from multiple sports
 * OpticOdds requires a sport parameter, so we fetch for each sport and merge
 * Results are cached for 1 hour to avoid slow API calls
 */
export async function fetchAllSportsbooks(): Promise<SportsbooksResponse> {
  // Check cache first
  const now = Date.now();
  if (sportsbooksCache && (now - sportsbooksCacheTime) < SPORTSBOOKS_CACHE_TTL_MS) {
    safeLog('Returning cached sportsbooks', { count: sportsbooksCache.data.length });
    return sportsbooksCache;
  }

  // Focus on main sports - soccer, basketball, esports (for GGBet)
  // Most books are available across sports, no need to fetch all 8
  const sports = ['soccer', 'basketball', 'esports'];

  safeLog('Fetching sportsbooks from sports (no cache)', { sports });

  // Fetch sportsbooks for each sport in parallel (without limit for speed)
  const results = await Promise.all(
    sports.map(async (sport) => {
      try {
        return await fetchSportsbooks(sport);
      } catch (error) {
        safeLog(`Failed to fetch sportsbooks for ${sport}`, { error: error instanceof Error ? error.message : 'Unknown' });
        return { data: [] };
      }
    })
  );

  // Merge and deduplicate by sportsbook id
  const seenIds = new Set<string>();
  const allSportsbooks: SportsbooksResponse['data'] = [];

  for (const result of results) {
    for (const book of result.data) {
      if (!seenIds.has(book.id)) {
        seenIds.add(book.id);
        allSportsbooks.push(book);
      }
    }
  }

  // Sort alphabetically by name
  allSportsbooks.sort((a, b) => a.name.localeCompare(b.name));

  safeLog('Fetched all sportsbooks', { total: allSportsbooks.length });

  // Cache the result
  sportsbooksCache = { data: allSportsbooks };
  sportsbooksCacheTime = now;

  return sportsbooksCache;
}

/**
 * Fetch leagues for a sport
 */
export async function fetchLeagues(sport: string): Promise<LeaguesResponse> {
  const url = buildUrl('/leagues', { sport });
  safeLog('Fetching leagues', { sport });
  return limit(() => fetchWithRetry(url, LeaguesResponseSchema));
}

/**
 * Fetch active fixtures for a sport/league
 */
export async function fetchFixtures(
  sport: string,
  league?: string
): Promise<FixturesResponse> {
  const url = buildUrl('/fixtures/active', {
    sport,
    league,
  });
  safeLog('Fetching fixtures', { sport, league });

  // Fetch raw OpticOdds response and transform to our internal format
  const rawResponse = await limit(() => fetchWithRetry(url, OpticOddsFixturesResponseSchema));

  return {
    data: rawResponse.data.map(transformFixture),
  };
}

/**
 * Fetch odds for a fixture with batched sportsbooks
 * OpticOdds allows max 5 sportsbooks per request
 */
export async function fetchOdds(
  fixtureId: string,
  sportsbooks: string[],
  markets?: string[]
): Promise<OddsResponse> {
  const batches = batchSportsbooks(sportsbooks);

  safeLog('Fetching odds with batching', {
    fixtureId,
    totalSportsbooks: sportsbooks.length,
    batches: batches.length,
  });

  // Fetch each batch concurrently (within our rate limit)
  const batchPromises = batches.map(batch => {
    const url = buildUrl('/fixtures/odds', {
      fixture_id: fixtureId,
      sportsbook: batch,
      market: markets,
    });
    return limit(() => fetchWithRetry(url, OddsResponseSchema));
  });

  const batchResults = await Promise.all(batchPromises);

  // Merge results - each batch returns the same fixture but with different sportsbook odds
  // We need to combine all odds into a single fixture response
  const allOdds: OddsResponse['data'][0]['odds'] = [];
  let baseFixture: OddsResponse['data'][0] | null = null;

  for (const result of batchResults) {
    // Each batch may return multiple fixtures (though typically just one)
    for (const fixtureWithOdds of result.data) {
      if (fixtureWithOdds.id === fixtureId) {
        if (!baseFixture) {
          baseFixture = { ...fixtureWithOdds, odds: [] };
        }
        allOdds.push(...fixtureWithOdds.odds);
      }
    }
  }

  if (baseFixture) {
    baseFixture.odds = allOdds;
    return { data: [baseFixture] };
  }

  return { data: [] };
}

/**
 * Fetch odds for multiple fixtures efficiently
 */
export async function fetchOddsForFixtures(
  fixtures: Fixture[],
  sportsbooks: string[],
  markets?: string[]
): Promise<Map<string, OddsResponse>> {
  const results = new Map<string, OddsResponse>();

  safeLog('Fetching odds for fixtures', {
    fixtureCount: fixtures.length,
    sportsbooks: sportsbooks.length,
    markets: markets?.length ?? 'all',
  });

  // Process fixtures with concurrency limit
  const promises = fixtures.map(fixture =>
    limit(async () => {
      try {
        const odds = await fetchOdds(fixture.id, sportsbooks, markets);
        results.set(fixture.id, odds);
      } catch (error) {
        console.error(`[OpticOdds] Failed to fetch odds for fixture ${fixture.id}:`, error);
        results.set(fixture.id, { data: [] });
      }
    })
  );

  await Promise.all(promises);
  return results;
}

/**
 * Get all sportsbooks we need for EV calculation
 * Returns target books + sharp book + additional books for fair odds
 */
export function getAllRequiredSportsbooks(): string[] {
  const allBooks = new Set<string>();

  // Add target books
  for (const book of config.targetSportsbooks) {
    allBooks.add(book);
  }

  // Add sharp book
  allBooks.add(config.sharpBook);

  // Add common books for fair odds calculation
  // We want 20-30 books for robust consensus
  const commonBooks = [
    'bet365', // Not available, but include in case
    'betano',
    'unibet',
    'betway',
    'pinnacle',
    'bet99',
    'betfair',
    'betmgm',
    'draftkings',
    'fanduel',
    'caesars',
    'bovada',
    'betonline',
    '888sport',
    'bwin',
    'william_hill',
    'ladbrokes',
    'betsson',
    'betcris',
    'betrivers',
    'circa_sports',
    'sbobet',
    'bookmaker',
  ];

  for (const book of commonBooks) {
    allBooks.add(book);
  }

  return Array.from(allBooks);
}

/**
 * Filter fixtures to only pre-match (not started yet)
 */
export function filterPrematchFixtures(fixtures: Fixture[]): Fixture[] {
  const now = new Date();
  return fixtures.filter(fixture => {
    const startDate = new Date(fixture.start_date);
    return startDate > now && fixture.is_live !== true;
  });
}
