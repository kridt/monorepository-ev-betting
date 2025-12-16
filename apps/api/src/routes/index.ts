import type { FastifyInstance } from 'fastify';
import { healthRoutes } from './health.js';
import { metaRoutes } from './meta.js';
import { opportunitiesRoutes } from './opportunities.js';
import { fixturesRoutes } from './fixtures.js';
import { statsRoutes } from './stats.js';

export function registerRoutes(app: FastifyInstance): void {
  // Health check
  app.register(healthRoutes, { prefix: '/' });

  // Meta endpoints (sportsbooks, leagues, methods)
  app.register(metaRoutes, { prefix: '/meta' });

  // EV opportunities
  app.register(opportunitiesRoutes, { prefix: '/ev' });

  // Fixtures
  app.register(fixturesRoutes, { prefix: '/fixtures' });

  // Statistics (SportMonks)
  app.register(statsRoutes, { prefix: '/stats' });
}
