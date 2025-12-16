import type { FastifyInstance } from 'fastify';
import { getFixtureStats, validatePlayerBet } from '../services/sportMonksClient.js';
import { validateNBAPlayerBet, batchValidateNBABets } from '../services/ballDontLieClient.js';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /stats/fixture/:fixtureId
   * Returns bet-backing statistics for a fixture
   *
   * The fixtureId is the OpticOdds fixture ID. We'll look up the
   * fixture details and then fetch stats from SportMonks.
   */
  app.get<{
    Params: { fixtureId: string };
  }>('/fixture/:fixtureId', async (request, reply) => {
    const { fixtureId } = request.params;

    try {
      // First, get the fixture from our database to get team names and date
      const fixture = await db.query.fixtures.findFirst({
        where: eq(schema.fixtures.id, fixtureId),
      });

      if (!fixture) {
        return reply.status(404).send({
          error: 'Fixture not found',
          fixtureId,
        });
      }

      // Only fetch stats for soccer fixtures
      if (fixture.sport !== 'soccer') {
        return reply.status(200).send({
          data: null,
          message: 'Stats only available for soccer fixtures',
        });
      }

      // Need team names to fetch stats
      if (!fixture.homeTeam || !fixture.awayTeam) {
        return reply.status(200).send({
          data: null,
          message: 'Team names not available for this fixture',
        });
      }

      // Get stats from SportMonks
      const stats = await getFixtureStats(
        fixture.homeTeam,
        fixture.awayTeam,
        fixture.startsAt
      );

      if (!stats) {
        return reply.status(200).send({
          data: null,
          message: 'Stats not available for this fixture',
        });
      }

      return {
        data: {
          ...stats,
          fixtureId, // Use our fixture ID, not SportMonks
        },
      };
    } catch (error) {
      console.error('[Stats] Error fetching stats:', error);
      return reply.status(500).send({
        error: 'Failed to fetch statistics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /stats/fixtures
   * Batch fetch stats for multiple fixtures
   * Query param: ids=id1,id2,id3 (comma-separated fixture IDs)
   */
  app.get<{
    Querystring: { ids: string };
  }>('/fixtures', async (request, reply) => {
    const { ids } = request.query;

    if (!ids) {
      return reply.status(400).send({
        error: 'Missing required query parameter: ids',
      });
    }

    const fixtureIds = ids.split(',').slice(0, 10); // Limit to 10 at a time

    try {
      const results: Record<string, unknown> = {};

      // Fetch stats for each fixture in parallel
      await Promise.all(
        fixtureIds.map(async (fixtureId) => {
          const fixture = await db.query.fixtures.findFirst({
            where: eq(schema.fixtures.id, fixtureId),
          });

          if (!fixture || fixture.sport !== 'soccer' || !fixture.homeTeam || !fixture.awayTeam) {
            results[fixtureId] = null;
            return;
          }

          const stats = await getFixtureStats(
            fixture.homeTeam,
            fixture.awayTeam,
            fixture.startsAt
          );

          results[fixtureId] = stats
            ? { ...stats, fixtureId }
            : null;
        })
      );

      return {
        data: results,
      };
    } catch (error) {
      console.error('[Stats] Error batch fetching stats:', error);
      return reply.status(500).send({
        error: 'Failed to fetch statistics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /stats/validate
   * Validate a bet against historical player/team data
   * Returns hit rate for the last N matches
   */
  app.post<{
    Body: {
      playerName: string;
      market: string;
      line: number;
      selection: string; // "over" or "under"
      matchCount?: number;
    };
  }>('/validate', async (request, reply) => {
    const { playerName, market, line, selection, matchCount = 10 } = request.body;

    if (!playerName || !market || line === undefined || !selection) {
      return reply.status(400).send({
        error: 'Missing required fields: playerName, market, line, selection',
      });
    }

    // Determine direction from selection
    const direction = selection.toLowerCase().includes('over') ? 'over' : 'under';

    try {
      const result = await validatePlayerBet(
        playerName,
        market,
        line,
        direction as 'over' | 'under',
        matchCount
      );

      if (!result) {
        return reply.status(200).send({
          data: null,
          message: 'Could not find historical data for this player/market',
        });
      }

      return {
        data: result,
      };
    } catch (error) {
      console.error('[Stats] Error validating bet:', error);
      return reply.status(500).send({
        error: 'Failed to validate bet',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /stats/validate-nba
   * Validate an NBA player bet against historical data from Ball Don't Lie API
   * Returns hit rate for the last N games
   */
  app.post<{
    Body: {
      playerName: string;
      market: string;
      line: number;
      selection: string; // "over" or "under"
      matchCount?: number;
    };
  }>('/validate-nba', async (request, reply) => {
    const { playerName, market, line, selection, matchCount = 10 } = request.body;

    if (!playerName || !market || line === undefined || !selection) {
      return reply.status(400).send({
        error: 'Missing required fields: playerName, market, line, selection',
      });
    }

    // Determine direction from selection
    const direction = selection.toLowerCase().includes('over') ? 'over' : 'under';

    try {
      const result = await validateNBAPlayerBet(
        playerName,
        market,
        line,
        direction as 'over' | 'under',
        matchCount
      );

      if (!result) {
        return reply.status(200).send({
          data: null,
          message: 'Could not find historical data for this NBA player/market',
        });
      }

      return {
        data: result,
      };
    } catch (error) {
      console.error('[Stats] Error validating NBA bet:', error);
      return reply.status(500).send({
        error: 'Failed to validate NBA bet',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /stats/validate-nba-batch
   * Batch validate multiple NBA player bets
   * Returns validation results keyed by opportunity ID
   */
  app.post<{
    Body: {
      bets: Array<{
        opportunityId: string;
        playerName: string;
        market: string;
        line: number;
        selection: string;
      }>;
      matchCount?: number;
    };
  }>('/validate-nba-batch', async (request, reply) => {
    const { bets, matchCount = 10 } = request.body;

    if (!bets || !Array.isArray(bets) || bets.length === 0) {
      return reply.status(400).send({
        error: 'Missing required field: bets (array)',
      });
    }

    // Limit batch size
    const limitedBets = bets.slice(0, 50);

    try {
      // Transform bets to include direction
      const transformedBets = limitedBets.map(bet => ({
        opportunityId: bet.opportunityId,
        playerName: bet.playerName,
        market: bet.market,
        line: bet.line,
        direction: (bet.selection.toLowerCase().includes('over') ? 'over' : 'under') as 'over' | 'under',
      }));

      const results = await batchValidateNBABets(transformedBets, matchCount);

      // Convert Map to object for JSON response
      const responseData: Record<string, unknown> = {};
      for (const [id, result] of results) {
        responseData[id] = result;
      }

      return {
        data: responseData,
        processed: limitedBets.length,
        total: bets.length,
      };
    } catch (error) {
      console.error('[Stats] Error batch validating NBA bets:', error);
      return reply.status(500).send({
        error: 'Failed to batch validate NBA bets',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
