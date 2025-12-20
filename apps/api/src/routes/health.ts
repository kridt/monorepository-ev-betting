import type { FastifyInstance } from 'fastify';
import { getSchedulerStatus } from '../scheduler/index.js';
import { db, schema } from '../db/index.js';
import { sql, eq } from 'drizzle-orm';
import { fetchLeagues, fetchFixtures } from '../services/opticOddsClient.js';
import { config } from '../config.js';
import {
  prePopulateAllPlayers,
  getCacheStats,
  searchPlayers,
  findOrCreatePlayer,
  normalizeName,
  generateNameVariants,
} from '../services/ballDontLie.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, _reply) => {
    const schedulerStatus = await getSchedulerStatus();

    // Get counts from database
    let opportunityCount = 0;
    let fixtureCount = 0;

    try {
      const oppResult = await db.select({ count: sql<number>`count(*)` }).from(schema.opportunities);
      opportunityCount = oppResult[0]?.count ?? 0;

      const fixResult = await db.select({ count: sql<number>`count(*)` }).from(schema.fixtures);
      fixtureCount = fixResult[0]?.count ?? 0;
    } catch (error) {
      console.error('[Health] Error getting counts:', error);
    }

    // Determine overall status
    let status: 'ok' | 'degraded' | 'error' = 'ok';
    if (schedulerStatus.lastError) {
      status = 'degraded';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      scheduler: {
        isRunning: schedulerStatus.isRunning,
        lastRun: schedulerStatus.lastRun,
        nextRun: schedulerStatus.nextRun,
      },
      database: {
        connected: true,
        opportunityCount,
        fixtureCount,
      },
    };
  });

  /**
   * GET /health/debug
   * Debug endpoint to check OpticOdds API data
   */
  app.get('/health/debug', async (_request, _reply) => {
    const sports: Record<string, unknown> = {};

    const results: {
      timestamp: string;
      config: { soccerLeagues: string[]; basketballLeagues: string[] };
      sports: Record<string, unknown>;
      basketball_fixtures?: unknown;
      soccer_fixtures?: unknown;
    } = {
      timestamp: new Date().toISOString(),
      config: {
        soccerLeagues: config.soccerLeagues,
        basketballLeagues: config.basketballLeagues,
      },
      sports,
    };

    // Try to fetch basketball leagues
    try {
      const basketballLeagues = await fetchLeagues('basketball');
      sports['basketball'] = {
        leaguesFound: basketballLeagues.data.length,
        leagues: basketballLeagues.data.map(l => ({
          id: l.id,
          name: l.name,
        })),
      };
    } catch (error) {
      sports['basketball'] = {
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    // Try with 'nba' as sport
    try {
      const nbaLeagues = await fetchLeagues('nba');
      sports['nba'] = {
        leaguesFound: nbaLeagues.data.length,
        leagues: nbaLeagues.data.map(l => ({
          id: l.id,
          name: l.name,
        })),
      };
    } catch (error) {
      sports['nba'] = {
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    // Try to fetch fixtures for basketball/nba
    try {
      const fixtures = await fetchFixtures('basketball', 'nba');
      results['basketball_fixtures'] = {
        count: fixtures.data.length,
        fixtures: fixtures.data.slice(0, 5).map(f => ({
          id: f.id,
          sport: f.sport,
          league: f.league,
          home_team: f.home_team,
          away_team: f.away_team,
          start_date: f.start_date,
        })),
      };
    } catch (error) {
      results['basketball_fixtures'] = {
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    // Try soccer fixtures for comparison
    try {
      const fixtures = await fetchFixtures('soccer', 'england_-_premier_league');
      results['soccer_fixtures'] = {
        count: fixtures.data.length,
        fixtures: fixtures.data.slice(0, 3).map(f => ({
          id: f.id,
          sport: f.sport,
          league: f.league,
          home_team: f.home_team,
          away_team: f.away_team,
          start_date: f.start_date,
        })),
      };
    } catch (error) {
      results['soccer_fixtures'] = {
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    return results;
  });

  /**
   * GET /health/nba-cache
   * Get NBA player cache statistics
   */
  app.get('/health/nba-cache', async (_request, _reply) => {
    const stats = await getCacheStats();
    return {
      timestamp: new Date().toISOString(),
      cache: stats,
    };
  });

  /**
   * POST /health/prepopulate-nba
   * Trigger NBA player pre-population (admin endpoint)
   * This fetches ALL active NBA players from Ball Don't Lie
   */
  app.post('/health/prepopulate-nba', async (_request, _reply) => {
    const statsBefore = await getCacheStats();

    console.log('[Admin] Starting NBA player pre-population...');
    const result = await prePopulateAllPlayers();

    const statsAfter = await getCacheStats();

    return {
      timestamp: new Date().toISOString(),
      status: 'completed',
      result: {
        totalPlayersFound: result.totalPlayers,
        playersAdded: result.playersAdded,
        playersFailed: result.playersFailed,
        aliasesCreated: result.aliasesCreated,
        durationSeconds: Math.round(result.duration / 1000),
        errorCount: result.errors.length,
        errors: result.errors.slice(0, 10),
      },
      cacheBefore: statsBefore,
      cacheAfter: statsAfter,
    };
  });

  /**
   * GET /health/verify-nba-players
   * Verify all NBA player names from current opportunities can be found
   */
  app.get('/health/verify-nba-players', async (_request, _reply) => {
    // Get all unique NBA player names from opportunities
    const nbaOpportunities = await db.query.opportunities.findMany({
      where: eq(schema.opportunities.sport, 'basketball'),
    });

    // Extract unique player names
    const playerNames = new Set<string>();
    for (const opp of nbaOpportunities) {
      if (opp.playerName) {
        playerNames.add(opp.playerName);
      }
      // Also try to extract from selection
      const match = opp.selection.match(/^([A-Za-z\s\-'\.]+?)\s+(Over|Under)/i);
      if (match) {
        playerNames.add(match[1].trim());
      }
    }

    const results: {
      found: Array<{ name: string; bdlName: string; bdlId: number }>;
      notFound: Array<{ name: string; normalized: string; variants: string[]; searchResults: string[] }>;
    } = {
      found: [],
      notFound: [],
    };

    // Test each player name
    for (const name of playerNames) {
      try {
        // Check if already in cache
        const cached = await db.query.players.findFirst({
          where: sql`lower(${schema.players.name}) = lower(${name})`,
        });

        if (cached && cached.gamesPlayed && cached.gamesPlayed > 0) {
          results.found.push({
            name,
            bdlName: cached.name,
            bdlId: parseInt(cached.id.replace('bdl_', '')) || 0,
          });
          continue;
        }

        // Try to find in Ball Don't Lie
        const variants = generateNameVariants(name);
        let foundInBDL = false;
        const allSearchResults: string[] = [];

        for (const variant of variants) {
          const searchResults = await searchPlayers(variant);
          if (searchResults.length > 0) {
            allSearchResults.push(...searchResults.map(p => `${p.first_name} ${p.last_name} (${p.team?.abbreviation || 'N/A'})`));

            // Check for good match
            const normalized = normalizeName(name);
            for (const player of searchResults) {
              const bdlNormalized = normalizeName(`${player.first_name} ${player.last_name}`);
              if (bdlNormalized === normalized ||
                  bdlNormalized.includes(normalized.split(' ').pop() || '') ||
                  normalized.includes(bdlNormalized.split(' ').pop() || '')) {
                results.found.push({
                  name,
                  bdlName: `${player.first_name} ${player.last_name}`,
                  bdlId: player.id,
                });
                foundInBDL = true;
                break;
              }
            }
            if (foundInBDL) break;
          }
        }

        if (!foundInBDL) {
          results.notFound.push({
            name,
            normalized: normalizeName(name),
            variants,
            searchResults: [...new Set(allSearchResults)].slice(0, 10),
          });
        }
      } catch (error) {
        results.notFound.push({
          name,
          normalized: normalizeName(name),
          variants: generateNameVariants(name),
          searchResults: [`Error: ${error}`],
        });
      }
    }

    return {
      timestamp: new Date().toISOString(),
      totalPlayers: playerNames.size,
      found: results.found.length,
      notFound: results.notFound.length,
      successRate: `${Math.round((results.found.length / playerNames.size) * 100)}%`,
      foundPlayers: results.found,
      notFoundPlayers: results.notFound,
    };
  });

  /**
   * POST /health/fix-nba-players
   * Attempt to cache all NBA players from current opportunities
   */
  app.post('/health/fix-nba-players', async (_request, _reply) => {
    // Get all unique NBA player names from opportunities
    const nbaOpportunities = await db.query.opportunities.findMany({
      where: eq(schema.opportunities.sport, 'basketball'),
    });

    // Extract unique player names
    const playerNames = new Set<string>();
    for (const opp of nbaOpportunities) {
      if (opp.playerName) {
        playerNames.add(opp.playerName);
      }
      const match = opp.selection.match(/^([A-Za-z\s\-'\.]+?)\s+(Over|Under)/i);
      if (match) {
        playerNames.add(match[1].trim());
      }
    }

    const results = {
      total: playerNames.size,
      cached: 0,
      failed: 0,
      errors: [] as string[],
    };

    // Try to cache each player
    for (const name of playerNames) {
      try {
        const player = await findOrCreatePlayer(name);
        if (player) {
          results.cached++;
        } else {
          results.failed++;
          results.errors.push(`Not found: ${name}`);
        }
      } catch (error) {
        results.failed++;
        results.errors.push(`Error caching ${name}: ${error}`);
      }
    }

    return {
      timestamp: new Date().toISOString(),
      status: 'completed',
      results,
    };
  });

  /**
   * GET /health/search-player/:name
   * Debug endpoint to test player search
   */
  app.get('/health/search-player/:name', async (request, _reply) => {
    const { name } = request.params as { name: string };

    const normalized = normalizeName(name);
    const variants = generateNameVariants(name);

    // Search Ball Don't Lie with each variant
    const searchResults: Record<string, Array<{ name: string; team: string; id: number }>> = {};

    for (const variant of variants) {
      try {
        const results = await searchPlayers(variant);
        searchResults[variant] = results.map(p => ({
          name: `${p.first_name} ${p.last_name}`,
          team: p.team?.full_name || 'N/A',
          id: p.id,
        }));
      } catch (error) {
        searchResults[variant] = [{ name: `Error: ${error}`, team: '', id: 0 }];
      }
    }

    // Check cache
    const cached = await db.query.players.findFirst({
      where: sql`lower(${schema.players.name}) LIKE ${`%${normalized}%`}`,
    });

    // Check aliases
    const aliases = await db.query.playerNameAliases.findMany({
      where: sql`${schema.playerNameAliases.normalizedAlias} LIKE ${`%${normalized}%`}`,
    });

    return {
      input: name,
      normalized,
      variants,
      searchResults,
      cachedPlayer: cached ? { id: cached.id, name: cached.name, gamesPlayed: cached.gamesPlayed } : null,
      matchingAliases: aliases.map(a => ({ playerId: a.playerId, alias: a.alias })),
    };
  });

  /**
   * GET /health/test-bdl-api
   * Test the Ball Don't Lie API directly with raw response
   */
  app.get('/health/test-bdl-api', async (_request, _reply) => {
    const apiKey = config.ballDontLieApiKey;
    const baseUrl = config.ballDontLieBaseUrl;

    // Test with LeBron James
    const testUrl = `${baseUrl}/v1/players?search=LeBron&per_page=5`;

    try {
      const response = await fetch(testUrl, {
        headers: {
          'Authorization': apiKey,
        },
      });

      const status = response.status;
      const headers = Object.fromEntries(response.headers.entries());
      const body = await response.json();

      return {
        timestamp: new Date().toISOString(),
        config: {
          apiKeySet: !!apiKey,
          apiKeyLength: apiKey?.length || 0,
          apiKeyPreview: apiKey ? `${apiKey.substring(0, 8)}...` : 'NOT SET',
          baseUrl,
        },
        request: {
          url: testUrl,
        },
        response: {
          status,
          headers,
          body,
        },
      };
    } catch (error) {
      return {
        timestamp: new Date().toISOString(),
        config: {
          apiKeySet: !!apiKey,
          apiKeyLength: apiKey?.length || 0,
          apiKeyPreview: apiKey ? `${apiKey.substring(0, 8)}...` : 'NOT SET',
          baseUrl,
        },
        error: String(error),
      };
    }
  });
}
