import type { FastifyInstance } from 'fastify';
import { db, schema } from '../db/index.js';
import { eq, and, gte, lte } from 'drizzle-orm';

interface FixturesQuery {
  sport?: string;
  league?: string;
  start?: string;
  end?: string;
  prematchOnly?: string;
}

export async function fixturesRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /fixtures/active
   * List active fixtures with optional filtering
   */
  app.get<{
    Querystring: FixturesQuery;
  }>('/active', async (request, _reply) => {
    const { sport, league, start, end, prematchOnly = 'true' } = request.query;

    // Build where conditions
    const conditions = [];

    if (sport) {
      conditions.push(eq(schema.fixtures.sport, sport));
    }

    if (league) {
      conditions.push(eq(schema.fixtures.league, league));
    }

    if (start) {
      conditions.push(gte(schema.fixtures.startsAt, start));
    }

    if (end) {
      conditions.push(lte(schema.fixtures.startsAt, end));
    }

    if (prematchOnly === 'true') {
      // Only show future events
      conditions.push(gte(schema.fixtures.startsAt, new Date().toISOString()));
      conditions.push(eq(schema.fixtures.isLive, false));
    }

    // Build query
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const fixtures = await db
      .select()
      .from(schema.fixtures)
      .where(whereClause)
      .orderBy(schema.fixtures.startsAt)
      .limit(100);

    return {
      data: fixtures,
      count: fixtures.length,
    };
  });
}
