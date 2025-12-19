import type { FastifyInstance } from 'fastify';
import { db, schema } from '../db/index.js';
import { eq, desc, asc, sql, and, gte, lte, like, or } from 'drizzle-orm';
import type { FairOddsMethod, EVOpportunitySummary, NormalizedOdds } from '@ev-bets/shared';
import { FAIR_ODDS_METHODS } from '@ev-bets/shared';
import { generateExplanation, calculateOpportunities } from '../engine/evCalculator.js';
import { fetchOdds, getAllRequiredSportsbooks } from '../services/opticOddsClient.js';
import { normalizeOddsEntry, groupOddsBySelection } from '../engine/oddsNormalizer.js';
import { config } from '../config.js';

interface OpportunitiesQuery {
  method?: string;
  sport?: string;
  league?: string;
  marketGroup?: string;
  targetBook?: string;
  minEV?: string;
  maxEV?: string;
  minBooks?: string;
  maxOdds?: string;
  timeWindow?: string; // '1h', '3h', '6h', '12h', '24h', '48h'
  q?: string;
  page?: string;
  pageSize?: string;
  sortBy?: string;
  sortDir?: string;
}

export async function opportunitiesRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /ev/opportunities
   * List opportunities with filtering and pagination
   */
  app.get<{
    Querystring: OpportunitiesQuery;
  }>('/opportunities', async (request, _reply) => {
    const {
      method,
      sport,
      league,
      targetBook,
      minEV,
      maxEV,
      minBooks,
      maxOdds,
      timeWindow,
      q,
      page = '1',
      pageSize = '20',
      sortBy = 'bestEvPercent',
      sortDir = 'desc',
    } = request.query;

    const pageNum = parseInt(page, 10);
    const pageSizeNum = Math.min(parseInt(pageSize, 10), 100); // Max 100
    const offset = (pageNum - 1) * pageSizeNum;

    // Build where conditions
    const conditions = [];

    // Only show future events
    conditions.push(gte(schema.opportunities.startsAt, new Date().toISOString()));

    // Only show events within the next 72 hours
    const maxDate = new Date();
    maxDate.setHours(maxDate.getHours() + 72);
    conditions.push(lte(schema.opportunities.startsAt, maxDate.toISOString()));

    // Filter out extreme odds (max 10.0 decimal odds)
    conditions.push(lte(schema.opportunities.bestOfferedOdds, 10));

    if (sport) {
      conditions.push(eq(schema.opportunities.sport, sport));
    }

    if (league) {
      conditions.push(eq(schema.opportunities.league, league));
    }

    if (targetBook) {
      conditions.push(eq(schema.opportunities.bestTargetBookId, targetBook));
    }

    if (minEV) {
      const minEVNum = parseFloat(minEV);
      if (!isNaN(minEVNum)) {
        conditions.push(gte(schema.opportunities.bestEvPercent, minEVNum));
      }
    }

    if (maxEV) {
      const maxEVNum = parseFloat(maxEV);
      if (!isNaN(maxEVNum)) {
        conditions.push(lte(schema.opportunities.bestEvPercent, maxEVNum));
      }
    }

    if (minBooks) {
      const minBooksNum = parseInt(minBooks, 10);
      if (!isNaN(minBooksNum)) {
        conditions.push(gte(schema.opportunities.bookCount, minBooksNum));
      }
    }

    if (maxOdds) {
      const maxOddsNum = parseFloat(maxOdds);
      if (!isNaN(maxOddsNum)) {
        conditions.push(lte(schema.opportunities.bestOfferedOdds, maxOddsNum));
      }
    }

    if (timeWindow) {
      const now = new Date();
      let futureDate = new Date(now);

      switch (timeWindow) {
        case '1h':
          futureDate.setHours(now.getHours() + 1);
          break;
        case '3h':
          futureDate.setHours(now.getHours() + 3);
          break;
        case '6h':
          futureDate.setHours(now.getHours() + 6);
          break;
        case '12h':
          futureDate.setHours(now.getHours() + 12);
          break;
        case '24h':
          futureDate.setDate(now.getDate() + 1);
          break;
        case '48h':
          futureDate.setDate(now.getDate() + 2);
          break;
      }

      conditions.push(lte(schema.opportunities.startsAt, futureDate.toISOString()));
    }

    if (method && FAIR_ODDS_METHODS.includes(method as FairOddsMethod)) {
      conditions.push(eq(schema.opportunities.bestMethod, method));
    }

    if (q) {
      conditions.push(
        or(
          like(schema.opportunities.selection, `%${q}%`),
          like(schema.opportunities.playerName, `%${q}%`),
          like(schema.opportunities.homeTeam, `%${q}%`),
          like(schema.opportunities.awayTeam, `%${q}%`)
        )
      );
    }

    // Build query
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.opportunities)
      .where(whereClause);

    const total = countResult[0]?.count ?? 0;

    // Build order by
    let orderByColumn;
    switch (sortBy) {
      case 'startsAt':
        orderByColumn = schema.opportunities.startsAt;
        break;
      case 'market':
        orderByColumn = schema.opportunities.market;
        break;
      default:
        orderByColumn = schema.opportunities.bestEvPercent;
    }

    const orderBy = sortDir === 'asc' ? asc(orderByColumn) : desc(orderByColumn);

    // Get opportunities
    const opportunities = await db
      .select()
      .from(schema.opportunities)
      .where(whereClause)
      .orderBy(orderBy)
      .limit(pageSizeNum)
      .offset(offset);

    // Transform to summary format
    const data: EVOpportunitySummary[] = opportunities.map(opp => {
      // Parse book odds JSON - always return an array (never undefined)
      let bookOdds: Array<{
        sportsbookId: string;
        sportsbookName: string;
        decimalOdds: number;
        impliedProbability: number;
        isTarget: boolean;
        isSharp: boolean;
        isOutlier: boolean;
      }> = [];

      if (opp.bookOddsJson) {
        try {
          const parsed = JSON.parse(opp.bookOddsJson);
          if (Array.isArray(parsed)) {
            bookOdds = parsed;
          }
        } catch {
          // On parse error, keep empty array
        }
      }

      // Parse NBA validation JSON if present
      let nbaValidation = undefined;
      if (opp.nbaValidationJson) {
        try {
          nbaValidation = JSON.parse(opp.nbaValidationJson);
        } catch {
          // On parse error, keep undefined
        }
      }

      return {
        id: opp.id,
        fixtureId: opp.fixtureId,
        sport: opp.sport,
        league: opp.league,
        leagueName: opp.leagueName ?? undefined,
        homeTeam: opp.homeTeam ?? undefined,
        awayTeam: opp.awayTeam ?? undefined,
        startsAt: opp.startsAt,
        market: opp.market,
        selection: opp.selection,
        line: opp.line ?? undefined,
        playerName: opp.playerName ?? undefined,
        evPercent: opp.bestEvPercent,
        targetBook: opp.bestTargetBookName,
        targetBookId: opp.bestTargetBookId,
        offeredOdds: opp.bestOfferedOdds,
        fairOdds: opp.bestFairOdds,
        method: opp.bestMethod as FairOddsMethod,
        bookCount: opp.bookCount,
        bookOdds,
        nbaValidation,
      };
    });

    // Get filter options
    const sports = await db
      .selectDistinct({ sport: schema.opportunities.sport })
      .from(schema.opportunities);

    const leagues = await db
      .selectDistinct({ league: schema.opportunities.league })
      .from(schema.opportunities);

    const targetBooks = await db
      .selectDistinct({ book: schema.opportunities.bestTargetBookId })
      .from(schema.opportunities);

    // Get stats
    const statsResult = await db
      .select({
        avgEV: sql<number>`avg(best_ev_percent)`,
        maxEV: sql<number>`max(best_ev_percent)`,
      })
      .from(schema.opportunities)
      .where(whereClause);

    return {
      data,
      pagination: {
        page: pageNum,
        pageSize: pageSizeNum,
        total,
        totalPages: Math.ceil(total / pageSizeNum),
      },
      filters: {
        sports: sports.map(s => s.sport),
        leagues: leagues.map(l => l.league),
        marketGroups: [], // TODO: Implement market groups
        targetBooks: targetBooks.map(t => t.book),
      },
      stats: {
        totalOpportunities: total,
        avgEV: statsResult[0]?.avgEV ?? 0,
        maxEV: statsResult[0]?.maxEV ?? 0,
        lastUpdate: new Date().toISOString(),
      },
    };
  });

  /**
   * GET /ev/opportunities/:id
   * Get detailed opportunity with full breakdown
   */
  app.get<{
    Params: { id: string };
  }>('/opportunities/:id', async (request, reply) => {
    const { id } = request.params;

    const opportunity = await db.query.opportunities.findFirst({
      where: eq(schema.opportunities.id, id),
    });

    if (!opportunity) {
      reply.status(404);
      return {
        error: 'Not found',
        message: `Opportunity with id ${id} not found`,
        statusCode: 404,
        timestamp: new Date().toISOString(),
      };
    }

    // Parse JSON fields
    const calculations = JSON.parse(opportunity.calculationsJson);
    const fairOdds = JSON.parse(opportunity.fairOddsJson);

    // Parse validation JSON if present
    let validation = undefined;
    if (opportunity.nbaValidationJson) {
      try {
        validation = JSON.parse(opportunity.nbaValidationJson);
      } catch {
        // On parse error, keep undefined
      }
    }

    // Build full opportunity object
    const fullOpportunity = {
      id: opportunity.id,
      fixtureId: opportunity.fixtureId,
      sport: opportunity.sport,
      league: opportunity.league,
      leagueName: opportunity.leagueName,
      homeTeam: opportunity.homeTeam,
      awayTeam: opportunity.awayTeam,
      startsAt: opportunity.startsAt,
      market: opportunity.market,
      marketName: opportunity.marketName,
      selection: opportunity.selection,
      selectionKey: opportunity.selectionKey,
      line: opportunity.line,
      playerId: opportunity.playerId,
      playerName: opportunity.playerName,
      bestEV: {
        evPercent: opportunity.bestEvPercent,
        targetBookId: opportunity.bestTargetBookId,
        targetBookName: opportunity.bestTargetBookName,
        method: opportunity.bestMethod as FairOddsMethod,
        offeredOdds: opportunity.bestOfferedOdds,
        fairOdds: opportunity.bestFairOdds,
      },
      calculations,
      fairOdds,
      bookCount: opportunity.bookCount,
      timestamp: opportunity.timestamp,
      validation, // Include pre-computed validation data
    };

    // Generate explanation
    const explanation = generateExplanation(fullOpportunity as any);

    // Book breakdown would require re-fetching odds data
    // For now, return empty array - could be enhanced later
    const bookBreakdown: Array<{
      sportsbookId: string;
      sportsbookName: string;
      decimalOdds: number;
      impliedProbability: number;
      isTarget: boolean;
      isSharp: boolean;
      isOutlier: boolean;
      deviationFromFair: number;
    }> = [];

    return {
      data: fullOpportunity,
      bookBreakdown,
      explanation,
    };
  });

  /**
   * POST /ev/opportunities/:id/refresh
   * Fetch fresh odds from OpticOdds and recalculate EV in real-time
   */
  app.post<{
    Params: { id: string };
  }>('/opportunities/:id/refresh', async (request, reply) => {
    const { id } = request.params;

    // Get existing opportunity
    const opportunity = await db.query.opportunities.findFirst({
      where: eq(schema.opportunities.id, id),
    });

    if (!opportunity) {
      reply.status(404);
      return {
        error: 'Not found',
        message: `Opportunity with id ${id} not found`,
        statusCode: 404,
      };
    }

    try {
      // Fetch fresh odds from OpticOdds
      const allSportsbooks = getAllRequiredSportsbooks();
      const targetBookIds = config.targetSportsbooks;
      const sharpBookId = config.sharpBook;

      console.info(`[Refresh] Fetching fresh odds for fixture ${opportunity.fixtureId}`);

      const oddsResponse = await fetchOdds(opportunity.fixtureId, allSportsbooks);

      if (oddsResponse.data.length === 0) {
        return {
          success: false,
          message: 'No odds available for this fixture',
          data: null,
        };
      }

      // Normalize all odds
      const normalizedOdds: NormalizedOdds[] = [];

      for (const fixtureWithOdds of oddsResponse.data) {
        for (const entry of fixtureWithOdds.odds) {
          const sportsbookId = entry.sportsbook.toLowerCase().replace(/\s+/g, '_');
          const normalized = normalizeOddsEntry(
            entry,
            opportunity.fixtureId,
            sportsbookId,
            entry.sportsbook
          );
          if (normalized) {
            normalizedOdds.push(normalized);
          }
        }
      }

      // Group by selection and find the matching selection
      const groupedOdds = groupOddsBySelection(normalizedOdds, targetBookIds, sharpBookId);

      // Find the group that matches this opportunity's selection
      const matchingGroup = groupedOdds.find(
        g => g.selectionKey === opportunity.selectionKey
      );

      if (!matchingGroup) {
        return {
          success: false,
          message: 'Selection no longer available in current odds',
          data: null,
        };
      }

      // Recalculate EV
      const newOpportunity = calculateOpportunities(
        matchingGroup,
        {
          sport: opportunity.sport,
          league: opportunity.league,
          homeTeam: opportunity.homeTeam ?? undefined,
          awayTeam: opportunity.awayTeam ?? undefined,
          startsAt: opportunity.startsAt,
        },
        targetBookIds
      );

      if (!newOpportunity) {
        return {
          success: false,
          message: 'EV no longer meets threshold',
          data: null,
        };
      }

      // Update database with fresh data
      await db
        .update(schema.opportunities)
        .set({
          bestEvPercent: newOpportunity.bestEV.evPercent,
          bestTargetBookId: newOpportunity.bestEV.targetBookId,
          bestTargetBookName: newOpportunity.bestEV.targetBookName,
          bestMethod: newOpportunity.bestEV.method,
          bestOfferedOdds: newOpportunity.bestEV.offeredOdds,
          bestFairOdds: newOpportunity.bestEV.fairOdds,
          calculationsJson: JSON.stringify(newOpportunity.calculations),
          fairOddsJson: JSON.stringify(newOpportunity.fairOdds),
          bookOddsJson: JSON.stringify(newOpportunity.bookOdds || []),
          bookCount: newOpportunity.bookCount,
          timestamp: newOpportunity.timestamp,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.opportunities.id, id));

      console.info(`[Refresh] Updated opportunity ${id}: EV ${newOpportunity.bestEV.evPercent.toFixed(2)}%`);

      // Return updated data
      return {
        success: true,
        message: 'Odds refreshed successfully',
        data: {
          id: opportunity.id,
          fixtureId: opportunity.fixtureId,
          sport: opportunity.sport,
          league: opportunity.league,
          homeTeam: opportunity.homeTeam,
          awayTeam: opportunity.awayTeam,
          startsAt: opportunity.startsAt,
          market: opportunity.market,
          selection: opportunity.selection,
          line: opportunity.line,
          playerName: opportunity.playerName,
          evPercent: newOpportunity.bestEV.evPercent,
          targetBook: newOpportunity.bestEV.targetBookName,
          targetBookId: newOpportunity.bestEV.targetBookId,
          offeredOdds: newOpportunity.bestEV.offeredOdds,
          fairOdds: newOpportunity.bestEV.fairOdds,
          method: newOpportunity.bestEV.method,
          bookCount: newOpportunity.bookCount,
          bookOdds: newOpportunity.bookOdds,
          refreshedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      console.error(`[Refresh] Error refreshing opportunity ${id}:`, error);
      reply.status(500);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to refresh odds',
        data: null,
      };
    }
  });
}
