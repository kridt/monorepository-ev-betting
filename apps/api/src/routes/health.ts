import type { FastifyInstance } from 'fastify';
import { getSchedulerStatus } from '../scheduler/index.js';
import { db, schema } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { fetchLeagues, fetchFixtures } from '../services/opticOddsClient.js';
import { config } from '../config.js';

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
}
