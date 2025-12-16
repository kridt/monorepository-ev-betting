import type { FastifyInstance } from 'fastify';
import {
  FAIR_ODDS_METHODS,
  FAIR_ODDS_METHOD_SIMPLE,
  FAIR_ODDS_METHOD_DESCRIPTIONS,
  FAIR_ODDS_METHOD_DETAILED
} from '@ev-bets/shared';
import { fetchAllSportsbooks, fetchLeagues } from '../services/opticOddsClient.js';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';

export async function metaRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /meta/sportsbooks
   * Returns list of ALL sportsbooks with target status
   */
  app.get('/sportsbooks', async (_request, _reply) => {
    // Fetch ALL sportsbooks from OpticOdds (no sport filter)
    const response = await fetchAllSportsbooks();

    const data = response.data.map(book => ({
      ...book,
      isTarget: config.targetSportsbooks.includes(book.id),
      isSharp: book.id === config.sharpBook,
    }));

    return {
      data,
      targetIds: config.targetSportsbooks,
      sharpBookId: config.sharpBook,
    };
  });

  /**
   * POST /meta/targets
   * Set target sportsbooks
   */
  app.post<{
    Body: { targetIds: string[] };
  }>('/targets', async (request, _reply) => {
    const { targetIds } = request.body;

    // Validate that at least one target is provided
    if (!targetIds || targetIds.length === 0) {
      return {
        error: 'At least one target sportsbook must be specified',
        statusCode: 400,
      };
    }

    // Store in config table
    await db
      .insert(schema.configTable)
      .values({
        key: 'TARGET_SPORTSBOOKS',
        value: targetIds.join(','),
      })
      .onConflictDoUpdate({
        target: schema.configTable.key,
        set: {
          value: targetIds.join(','),
          updatedAt: new Date().toISOString(),
        },
      });

    return {
      success: true,
      targetIds,
    };
  });

  /**
   * GET /meta/leagues
   * Returns list of leagues with enabled status
   * Note: NBA is always enabled and cannot be disabled
   */
  app.get('/leagues', async (_request, _reply) => {
    // Leagues that are always enabled (cannot be disabled)
    const ALWAYS_ENABLED = ['nba'];

    // Fetch leagues for both sports
    const [soccerLeagues, basketballLeagues] = await Promise.all([
      fetchLeagues('soccer'),
      fetchLeagues('basketball'),
    ]);

    const enabledSoccer = new Set(config.soccerLeagues);
    const enabledBasketball = new Set([...config.basketballLeagues, ...ALWAYS_ENABLED]);

    const allLeagues = [
      ...soccerLeagues.data.map(league => ({
        ...league,
        sportId: 'soccer',
        isEnabled: enabledSoccer.has(league.id),
        isAlwaysEnabled: false,
      })),
      ...basketballLeagues.data.map(league => ({
        ...league,
        sportId: 'basketball',
        isEnabled: enabledBasketball.has(league.id),
        isAlwaysEnabled: ALWAYS_ENABLED.includes(league.id),
      })),
    ];

    const enabledIds = [
      ...config.soccerLeagues,
      ...config.basketballLeagues,
      ...ALWAYS_ENABLED,
    ];

    return {
      data: allLeagues,
      enabledIds: [...new Set(enabledIds)],
      alwaysEnabled: ALWAYS_ENABLED,
    };
  });

  /**
   * POST /meta/leagues
   * Enable/disable leagues
   * Note: NBA is always included regardless of user selection
   */
  app.post<{
    Body: { enabledIds: string[] };
  }>('/leagues', async (request, _reply) => {
    const { enabledIds } = request.body;

    // Always include NBA - it cannot be disabled
    const ALWAYS_INCLUDED = ['nba'];
    const finalEnabledIds = [...new Set([...enabledIds, ...ALWAYS_INCLUDED])];

    // Store in config table
    await db
      .insert(schema.configTable)
      .values({
        key: 'ENABLED_LEAGUES',
        value: finalEnabledIds.join(','),
      })
      .onConflictDoUpdate({
        target: schema.configTable.key,
        set: {
          value: finalEnabledIds.join(','),
          updatedAt: new Date().toISOString(),
        },
      });

    return {
      success: true,
      enabledIds: finalEnabledIds,
      alwaysIncluded: ALWAYS_INCLUDED,
    };
  });

  /**
   * GET /meta/methods
   * Returns list of fair odds calculation methods with full explanations
   */
  app.get('/methods', async (_request, _reply) => {
    const data = FAIR_ODDS_METHODS.map(method => {
      const detailed = FAIR_ODDS_METHOD_DETAILED[method];
      return {
        id: method,
        name: method.replace(/_/g, ' '),
        simple: FAIR_ODDS_METHOD_SIMPLE[method],
        description: FAIR_ODDS_METHOD_DESCRIPTIONS[method],
        howItWorks: detailed.howItWorks,
        bestFor: detailed.bestFor,
        pros: detailed.pros,
        cons: detailed.cons,
        example: detailed.example,
      };
    });

    return {
      data,
      default: 'TRIMMED_MEAN_PROB',
    };
  });
}
