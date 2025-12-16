import { z } from 'zod';
import { FAIR_ODDS_METHODS } from '../constants.js';
import { EVOpportunitySummarySchema, EVOpportunitySchema } from './opportunity.js';
import { SportsbookWithStatusSchema } from './sportsbook.js';
import { LeagueWithStatusSchema } from './fixture.js';

// Pagination
export const PaginationSchema = z.object({
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  totalPages: z.number(),
});

export type Pagination = z.infer<typeof PaginationSchema>;

// Health check response
export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  timestamp: z.string(),
  version: z.string(),
  scheduler: z.object({
    isRunning: z.boolean(),
    lastRun: z.string().optional(),
    nextRun: z.string().optional(),
  }),
  database: z.object({
    connected: z.boolean(),
    opportunityCount: z.number(),
    fixtureCount: z.number(),
  }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// Sportsbooks response
export const SportsbooksMetaResponseSchema = z.object({
  data: z.array(SportsbookWithStatusSchema),
  targetIds: z.array(z.string()),
  sharpBookId: z.string().optional(),
});

export type SportsbooksMetaResponse = z.infer<typeof SportsbooksMetaResponseSchema>;

// Set targets request
export const SetTargetsRequestSchema = z.object({
  targetIds: z.array(z.string()),
});

export type SetTargetsRequest = z.infer<typeof SetTargetsRequestSchema>;

// Leagues response
export const LeaguesMetaResponseSchema = z.object({
  data: z.array(LeagueWithStatusSchema),
  enabledIds: z.array(z.string()),
});

export type LeaguesMetaResponse = z.infer<typeof LeaguesMetaResponseSchema>;

// Set leagues request
export const SetLeaguesRequestSchema = z.object({
  enabledIds: z.array(z.string()),
});

export type SetLeaguesRequest = z.infer<typeof SetLeaguesRequestSchema>;

// Methods response
export const MethodsResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.enum(FAIR_ODDS_METHODS),
      name: z.string(),
      description: z.string(),
    })
  ),
  default: z.enum(FAIR_ODDS_METHODS),
});

export type MethodsResponse = z.infer<typeof MethodsResponseSchema>;

// Opportunities query params
export const OpportunitiesQuerySchema = z.object({
  method: z.enum(FAIR_ODDS_METHODS).optional(),
  sport: z.string().optional(),
  league: z.string().optional(),
  marketGroup: z.string().optional(),
  targetBook: z.string().optional(),
  minEV: z.number().optional(),
  q: z.string().optional(), // Search query
  page: z.number().optional().default(1),
  pageSize: z.number().optional().default(20),
  sortBy: z.enum(['evPercent', 'startsAt', 'market']).optional().default('evPercent'),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
});

export type OpportunitiesQuery = z.infer<typeof OpportunitiesQuerySchema>;

// Opportunities list response
export const OpportunitiesResponseSchema = z.object({
  data: z.array(EVOpportunitySummarySchema),
  pagination: PaginationSchema,
  filters: z.object({
    sports: z.array(z.string()),
    leagues: z.array(z.string()),
    marketGroups: z.array(z.string()),
    targetBooks: z.array(z.string()),
  }),
  stats: z.object({
    totalOpportunities: z.number(),
    avgEV: z.number(),
    maxEV: z.number(),
    lastUpdate: z.string(),
  }),
});

export type OpportunitiesResponse = z.infer<typeof OpportunitiesResponseSchema>;

// Single opportunity response
export const OpportunityDetailResponseSchema = z.object({
  data: EVOpportunitySchema,
  bookBreakdown: z.array(
    z.object({
      sportsbookId: z.string(),
      sportsbookName: z.string(),
      decimalOdds: z.number(),
      impliedProbability: z.number(),
      isTarget: z.boolean(),
      isSharp: z.boolean(),
      isOutlier: z.boolean(),
      deviationFromFair: z.number(),
    })
  ),
  explanation: z.array(z.string()), // Human-readable explanation bullets
});

export type OpportunityDetailResponse = z.infer<typeof OpportunityDetailResponseSchema>;

// Fixtures query params
export const FixturesQuerySchema = z.object({
  sport: z.string().optional(),
  league: z.string().optional(),
  start: z.string().optional(), // ISO datetime
  end: z.string().optional(),
  prematchOnly: z.boolean().optional().default(true),
});

export type FixturesQuery = z.infer<typeof FixturesQuerySchema>;

// Error response
export const ErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  statusCode: z.number(),
  timestamp: z.string(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
