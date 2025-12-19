import type { FastifyInstance } from 'fastify';
import {
  searchPlayer,
  searchTeam,
  validatePlayerProp,
  validateSpreadBet,
  validateMoneylineBet,
  validateBTTS,
  validateTotalGoals,
  validateOpportunitiesBatch,
  getTeamLastXResults,
  type ValidationResult,
} from '../services/opticOddsStatsClient.js';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /stats/fixture/:fixtureId
   * Returns bet-backing statistics for a fixture
   * Now uses OpticOdds data
   */
  app.get<{
    Params: { fixtureId: string };
  }>('/fixture/:fixtureId', async (request, reply) => {
    const { fixtureId } = request.params;

    try {
      // Get the fixture from our database
      const fixture = await db.query.fixtures.findFirst({
        where: eq(schema.fixtures.id, fixtureId),
      });

      if (!fixture) {
        return reply.status(404).send({
          error: 'Fixture not found',
          fixtureId,
        });
      }

      // Need team names to fetch stats
      if (!fixture.homeTeam || !fixture.awayTeam) {
        return reply.status(200).send({
          data: null,
          message: 'Team names not available for this fixture',
        });
      }

      // Determine sport type
      const sport = fixture.sport.toLowerCase().includes('basket') ? 'basketball' : 'soccer';

      // Search for teams to get their IDs
      const [homeTeam, awayTeam] = await Promise.all([
        searchTeam(fixture.homeTeam, sport, fixture.league),
        searchTeam(fixture.awayTeam, sport, fixture.league),
      ]);

      if (!homeTeam || !awayTeam) {
        return reply.status(200).send({
          data: null,
          message: 'Could not find team data for this fixture',
        });
      }

      // Get recent results for both teams
      const [homeResults, awayResults] = await Promise.all([
        getTeamLastXResults(homeTeam.id, 5),
        getTeamLastXResults(awayTeam.id, 5),
      ]);

      // Build stats response
      const stats = {
        fixtureId,
        homeTeam: {
          id: homeTeam.id,
          name: homeTeam.name,
          recentForm: homeResults.map(g => g.won ? 'W' : 'L').join(''),
          avgGoalsScored: homeResults.length > 0
            ? Math.round((homeResults.reduce((sum, g) => sum + g.teamScore, 0) / homeResults.length) * 10) / 10
            : 0,
          avgGoalsConceded: homeResults.length > 0
            ? Math.round((homeResults.reduce((sum, g) => sum + g.opponentScore, 0) / homeResults.length) * 10) / 10
            : 0,
          winRate: homeResults.length > 0
            ? Math.round((homeResults.filter(g => g.won).length / homeResults.length) * 100)
            : 0,
          recentMatches: homeResults.slice(0, 5).map(g => ({
            date: g.fixtureDate,
            opponent: g.opponent,
            result: g.won ? 'W' : 'L',
            score: `${g.teamScore}-${g.opponentScore}`,
            isHome: g.isHome,
          })),
        },
        awayTeam: {
          id: awayTeam.id,
          name: awayTeam.name,
          recentForm: awayResults.map(g => g.won ? 'W' : 'L').join(''),
          avgGoalsScored: awayResults.length > 0
            ? Math.round((awayResults.reduce((sum, g) => sum + g.teamScore, 0) / awayResults.length) * 10) / 10
            : 0,
          avgGoalsConceded: awayResults.length > 0
            ? Math.round((awayResults.reduce((sum, g) => sum + g.opponentScore, 0) / awayResults.length) * 10) / 10
            : 0,
          winRate: awayResults.length > 0
            ? Math.round((awayResults.filter(g => g.won).length / awayResults.length) * 100)
            : 0,
          recentMatches: awayResults.slice(0, 5).map(g => ({
            date: g.fixtureDate,
            opponent: g.opponent,
            result: g.won ? 'W' : 'L',
            score: `${g.teamScore}-${g.opponentScore}`,
            isHome: g.isHome,
          })),
        },
      };

      return {
        data: stats,
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

          if (!fixture || !fixture.homeTeam || !fixture.awayTeam) {
            results[fixtureId] = null;
            return;
          }

          const sport = fixture.sport.toLowerCase().includes('basket') ? 'basketball' : 'soccer';

          const [homeTeam, awayTeam] = await Promise.all([
            searchTeam(fixture.homeTeam, sport, fixture.league),
            searchTeam(fixture.awayTeam, sport, fixture.league),
          ]);

          if (!homeTeam || !awayTeam) {
            results[fixtureId] = null;
            return;
          }

          const [homeResults, awayResults] = await Promise.all([
            getTeamLastXResults(homeTeam.id, 5),
            getTeamLastXResults(awayTeam.id, 5),
          ]);

          results[fixtureId] = {
            fixtureId,
            homeTeam: {
              id: homeTeam.id,
              name: homeTeam.name,
              recentForm: homeResults.map(g => g.won ? 'W' : 'L').join(''),
              winRate: homeResults.length > 0
                ? Math.round((homeResults.filter(g => g.won).length / homeResults.length) * 100)
                : 0,
            },
            awayTeam: {
              id: awayTeam.id,
              name: awayTeam.name,
              recentForm: awayResults.map(g => g.won ? 'W' : 'L').join(''),
              winRate: awayResults.length > 0
                ? Math.round((awayResults.filter(g => g.won).length / awayResults.length) * 100)
                : 0,
            },
          };
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
   * Validate a player bet against historical data (works for both NBA and Soccer)
   * Returns hit rate for the last N matches
   */
  app.post<{
    Body: {
      playerName: string;
      market: string;
      line: number;
      selection: string; // "over" or "under"
      sport?: string; // "basketball" or "soccer" - defaults to soccer
      league?: string;
      matchCount?: number;
    };
  }>('/validate', async (request, reply) => {
    const { playerName, market, line, selection, sport = 'soccer', league, matchCount = 10 } = request.body;

    if (!playerName || !market || line === undefined || !selection) {
      return reply.status(400).send({
        error: 'Missing required fields: playerName, market, line, selection',
      });
    }

    // Determine direction from selection
    const direction = selection.toLowerCase().includes('over') ? 'over' : 'under';
    const sportType = sport.toLowerCase().includes('basket') ? 'basketball' : 'soccer';

    try {
      // First find the player
      const player = await searchPlayer(playerName, sportType, league);

      if (!player) {
        return reply.status(200).send({
          data: null,
          message: 'Could not find player in database',
        });
      }

      const result = await validatePlayerProp(
        player.id,
        player.name,
        market,
        line,
        direction as 'over' | 'under',
        sportType,
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
   * POST /stats/validate-batch
   * Batch validate multiple player bets (works for all sports)
   * Returns validation results keyed by opportunity ID
   */
  app.post<{
    Body: {
      bets: Array<{
        opportunityId: string;
        playerId?: string;
        playerName: string;
        teamId?: string;
        teamName?: string;
        market: string;
        line: number;
        selection: string;
        sport: string;
        league?: string;
      }>;
      matchCount?: number;
    };
  }>('/validate-batch', async (request, reply) => {
    const { bets, matchCount = 10 } = request.body;

    if (!bets || !Array.isArray(bets) || bets.length === 0) {
      return reply.status(400).send({
        error: 'Missing required field: bets (array)',
      });
    }

    // Limit batch size
    const limitedBets = bets.slice(0, 50);

    try {
      // Transform bets for the batch validator
      const transformedBets = limitedBets.map(bet => ({
        opportunityId: bet.opportunityId,
        playerId: bet.playerId,
        playerName: bet.playerName,
        teamId: bet.teamId,
        teamName: bet.teamName,
        market: bet.market,
        line: bet.line,
        selection: bet.selection,
        sport: bet.sport,
        league: bet.league || '',
      }));

      const results = await validateOpportunitiesBatch(transformedBets, matchCount);

      // Convert Map to object for JSON response
      const responseData: Record<string, ValidationResult | null> = {};
      for (const [id, result] of results) {
        responseData[id] = result;
      }

      return {
        data: responseData,
        processed: limitedBets.length,
        total: bets.length,
      };
    } catch (error) {
      console.error('[Stats] Error batch validating bets:', error);
      return reply.status(500).send({
        error: 'Failed to batch validate bets',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /stats/validate-team
   * Validate a team spread or moneyline bet
   */
  app.post<{
    Body: {
      teamName: string;
      market: string; // "spread" or "moneyline"
      line?: number;
      selection?: string;
      sport?: string;
      league?: string;
      matchCount?: number;
    };
  }>('/validate-team', async (request, reply) => {
    const { teamName, market, line = 0, selection, sport = 'basketball', league, matchCount = 10 } = request.body;

    if (!teamName || !market) {
      return reply.status(400).send({
        error: 'Missing required fields: teamName, market',
      });
    }

    const sportType = sport.toLowerCase().includes('basket') ? 'basketball' : 'soccer';

    try {
      // Find the team
      const team = await searchTeam(teamName, sportType, league);

      if (!team) {
        return reply.status(200).send({
          data: null,
          message: 'Could not find team in database',
        });
      }

      let result: ValidationResult | null = null;

      if (market.toLowerCase().includes('spread')) {
        const direction = selection?.toLowerCase().includes('over') ? 'over' : 'under';
        result = await validateSpreadBet(team.id, team.name, line, direction, matchCount);
      } else if (market.toLowerCase().includes('moneyline') || market.toLowerCase().includes('ml')) {
        result = await validateMoneylineBet(team.id, team.name, matchCount);
      }

      if (!result) {
        return reply.status(200).send({
          data: null,
          message: 'Could not find historical data for this team/market',
        });
      }

      return {
        data: result,
      };
    } catch (error) {
      console.error('[Stats] Error validating team bet:', error);
      return reply.status(500).send({
        error: 'Failed to validate team bet',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /stats/validate-btts
   * Validate Both Teams To Score market
   */
  app.post<{
    Body: {
      homeTeam: string;
      awayTeam: string;
      selection: string; // "yes" or "no"
      league?: string;
      matchCount?: number;
    };
  }>('/validate-btts', async (request, reply) => {
    const { homeTeam, awayTeam, selection, league, matchCount = 10 } = request.body;

    if (!homeTeam || !awayTeam || !selection) {
      return reply.status(400).send({
        error: 'Missing required fields: homeTeam, awayTeam, selection',
      });
    }

    const bttsSelection = selection.toLowerCase().includes('yes') ? 'yes' : 'no';

    try {
      // Find both teams
      const [home, away] = await Promise.all([
        searchTeam(homeTeam, 'soccer', league),
        searchTeam(awayTeam, 'soccer', league),
      ]);

      if (!home || !away) {
        return reply.status(200).send({
          data: null,
          message: 'Could not find one or both teams in database',
        });
      }

      const result = await validateBTTS(home.id, away.id, bttsSelection, matchCount);

      if (!result) {
        return reply.status(200).send({
          data: null,
          message: 'Could not find historical data for these teams',
        });
      }

      return {
        data: {
          homeTeam: {
            name: home.name,
            bttsRate: result.homeRate,
          },
          awayTeam: {
            name: away.name,
            bttsRate: result.awayRate,
          },
          combinedRate: result.combinedRate,
          selection: bttsSelection,
        },
      };
    } catch (error) {
      console.error('[Stats] Error validating BTTS:', error);
      return reply.status(500).send({
        error: 'Failed to validate BTTS',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /stats/validate-1x2
   * Validate Match Result (1X2) market
   */
  app.post<{
    Body: {
      homeTeam: string;
      awayTeam: string;
      selection: string; // "1", "X", or "2"
      league?: string;
      matchCount?: number;
    };
  }>('/validate-1x2', async (request, reply) => {
    const { homeTeam, awayTeam, selection, league, matchCount = 10 } = request.body;

    if (!homeTeam || !awayTeam || !selection) {
      return reply.status(400).send({
        error: 'Missing required fields: homeTeam, awayTeam, selection',
      });
    }

    // Normalize selection
    let normalizedSelection: '1' | 'X' | '2';
    const sel = selection.toLowerCase();
    if (sel === '1' || sel.includes('home')) {
      normalizedSelection = '1';
    } else if (sel === '2' || sel.includes('away')) {
      normalizedSelection = '2';
    } else {
      normalizedSelection = 'X';
    }

    try {
      // Find both teams
      const [home, away] = await Promise.all([
        searchTeam(homeTeam, 'soccer', league),
        searchTeam(awayTeam, 'soccer', league),
      ]);

      if (!home || !away) {
        return reply.status(200).send({
          data: null,
          message: 'Could not find one or both teams in database',
        });
      }

      // Get recent results for both teams
      const [homeResults, awayResults] = await Promise.all([
        getTeamLastXResults(home.id, matchCount),
        getTeamLastXResults(away.id, matchCount),
      ]);

      if (homeResults.length === 0 || awayResults.length === 0) {
        return reply.status(200).send({
          data: null,
          message: 'Could not find historical data for these teams',
        });
      }

      // Calculate win/draw/loss rates
      const homeWins = homeResults.filter(g => g.won).length;
      const homeDraws = homeResults.filter(g => g.margin === 0).length;
      const homeLosses = homeResults.length - homeWins - homeDraws;

      const awayWins = awayResults.filter(g => g.won).length;
      const awayDraws = awayResults.filter(g => g.margin === 0).length;
      const awayLosses = awayResults.length - awayWins - awayDraws;

      const homeWinRate = Math.round((homeWins / homeResults.length) * 100);
      const drawRate = Math.round(((homeDraws + awayDraws) / (homeResults.length + awayResults.length)) * 100);
      const awayWinRate = Math.round((awayWins / awayResults.length) * 100);

      return {
        data: {
          homeWinRate,
          drawRate,
          awayWinRate,
          homeForm: homeResults.slice(0, 5).map(g => g.won ? 'W' : g.margin === 0 ? 'D' : 'L').join(''),
          awayForm: awayResults.slice(0, 5).map(g => g.won ? 'W' : g.margin === 0 ? 'D' : 'L').join(''),
          homeRecentMatches: homeResults.slice(0, 5).map(g => ({
            date: g.fixtureDate,
            opponent: g.opponent,
            result: g.won ? 'W' : g.margin === 0 ? 'D' : 'L',
            score: `${g.teamScore}-${g.opponentScore}`,
          })),
          awayRecentMatches: awayResults.slice(0, 5).map(g => ({
            date: g.fixtureDate,
            opponent: g.opponent,
            result: g.won ? 'W' : g.margin === 0 ? 'D' : 'L',
            score: `${g.teamScore}-${g.opponentScore}`,
          })),
          selection: normalizedSelection,
        },
      };
    } catch (error) {
      console.error('[Stats] Error validating match result:', error);
      return reply.status(500).send({
        error: 'Failed to validate match result',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /stats/validate-nba
   * Validate an NBA player bet (kept for backwards compatibility)
   * Now uses OpticOdds instead of Ball Don't Lie
   */
  app.post<{
    Body: {
      playerName: string;
      market: string;
      line: number;
      selection: string;
      matchCount?: number;
    };
  }>('/validate-nba', async (request, reply) => {
    const { playerName, market, line, selection, matchCount = 10 } = request.body;

    if (!playerName || !market || line === undefined || !selection) {
      return reply.status(400).send({
        error: 'Missing required fields: playerName, market, line, selection',
      });
    }

    const direction = selection.toLowerCase().includes('over') ? 'over' : 'under';

    try {
      // Find the player
      const player = await searchPlayer(playerName, 'basketball');

      if (!player) {
        return reply.status(200).send({
          data: null,
          message: 'Could not find NBA player in database',
        });
      }

      const result = await validatePlayerProp(
        player.id,
        player.name,
        market,
        line,
        direction as 'over' | 'under',
        'basketball',
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
   * Batch validate multiple NBA player bets (kept for backwards compatibility)
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

    const limitedBets = bets.slice(0, 50);

    try {
      const results: Record<string, ValidationResult | null> = {};

      // Process bets - need to look up player IDs first
      for (const bet of limitedBets) {
        const player = await searchPlayer(bet.playerName, 'basketball');

        if (!player) {
          results[bet.opportunityId] = null;
          continue;
        }

        const direction = bet.selection.toLowerCase().includes('over') ? 'over' : 'under';
        const result = await validatePlayerProp(
          player.id,
          player.name,
          bet.market,
          bet.line,
          direction as 'over' | 'under',
          'basketball',
          matchCount
        );

        results[bet.opportunityId] = result;
      }

      return {
        data: results,
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

  /**
   * POST /stats/validate-soccer-batch
   * Batch validate multiple soccer player bets (kept for backwards compatibility)
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
  }>('/validate-soccer-batch', async (request, reply) => {
    const { bets, matchCount = 10 } = request.body;

    if (!bets || !Array.isArray(bets) || bets.length === 0) {
      return reply.status(400).send({
        error: 'Missing required field: bets (array)',
      });
    }

    const limitedBets = bets.slice(0, 50);

    try {
      const results: Record<string, ValidationResult | null> = {};

      for (const bet of limitedBets) {
        const player = await searchPlayer(bet.playerName, 'soccer');

        if (!player) {
          results[bet.opportunityId] = null;
          continue;
        }

        const direction = bet.selection.toLowerCase().includes('over') ? 'over' : 'under';
        const result = await validatePlayerProp(
          player.id,
          player.name,
          bet.market,
          bet.line,
          direction as 'over' | 'under',
          'soccer',
          matchCount
        );

        results[bet.opportunityId] = result;
      }

      return {
        data: results,
        processed: limitedBets.length,
        total: bets.length,
      };
    } catch (error) {
      console.error('[Stats] Error batch validating soccer bets:', error);
      return reply.status(500).send({
        error: 'Failed to batch validate soccer bets',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /stats/validate-total-goals
   * Validate Over/Under total goals market for soccer
   */
  app.post<{
    Body: {
      homeTeam: string;
      awayTeam: string;
      line: number;
      selection: string; // "over" or "under"
      league?: string;
      matchCount?: number;
    };
  }>('/validate-total-goals', async (request, reply) => {
    const { homeTeam, awayTeam, line, selection, league, matchCount = 10 } = request.body;

    if (!homeTeam || !awayTeam || line === undefined || !selection) {
      return reply.status(400).send({
        error: 'Missing required fields: homeTeam, awayTeam, line, selection',
      });
    }

    const direction = selection.toLowerCase().includes('over') ? 'over' : 'under';

    try {
      // Find both teams
      const [home, away] = await Promise.all([
        searchTeam(homeTeam, 'soccer', league),
        searchTeam(awayTeam, 'soccer', league),
      ]);

      if (!home || !away) {
        return reply.status(200).send({
          data: null,
          message: 'Could not find one or both teams in database',
        });
      }

      const result = await validateTotalGoals(home.id, away.id, line, direction, matchCount);

      if (!result) {
        return reply.status(200).send({
          data: null,
          message: 'Could not find historical data for these teams',
        });
      }

      return {
        data: {
          homeTeam: home.name,
          awayTeam: away.name,
          line,
          direction,
          hitRate: result.hitRate,
          avgTotalGoals: result.avgTotal,
        },
      };
    } catch (error) {
      console.error('[Stats] Error validating total goals:', error);
      return reply.status(500).send({
        error: 'Failed to validate total goals',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
