import { z } from 'zod';
import { FAIR_ODDS_METHODS } from '../constants.js';

// Fair odds calculation result
export const FairOddsResultSchema = z.object({
  method: z.enum(FAIR_ODDS_METHODS),
  fairProbability: z.number(),
  fairDecimalOdds: z.number(),
  booksUsed: z.number(),
  booksExcluded: z.number(),
  outlierBookIds: z.array(z.string()),
  isFallback: z.boolean(), // True if method fell back (e.g., no Pinnacle for SHARP_BOOK_REFERENCE)
  fallbackReason: z.string().optional(),
});

export type FairOddsResult = z.infer<typeof FairOddsResultSchema>;

// EV calculation for a specific target book
export const EVCalculationSchema = z.object({
  targetBookId: z.string(),
  targetBookName: z.string(),
  offeredDecimalOdds: z.number(),
  offeredImpliedProbability: z.number(),
  fairProbability: z.number(),
  fairDecimalOdds: z.number(),
  evPercent: z.number(),
  method: z.enum(FAIR_ODDS_METHODS),
});

export type EVCalculation = z.infer<typeof EVCalculationSchema>;

// Individual book odds for display
export const BookOddsSchema = z.object({
  sportsbookId: z.string(),
  sportsbookName: z.string(),
  decimalOdds: z.number(),
  impliedProbability: z.number(),
  isTarget: z.boolean(),
  isSharp: z.boolean(),
  isOutlier: z.boolean(),
});

export type BookOdds = z.infer<typeof BookOddsSchema>;

// Full EV opportunity
export const EVOpportunitySchema = z.object({
  id: z.string(),
  fixtureId: z.string(),
  sport: z.string(),
  league: z.string(),
  leagueName: z.string().optional(),
  homeTeam: z.string().optional(),
  awayTeam: z.string().optional(),
  startsAt: z.string(), // ISO datetime
  market: z.string(),
  marketName: z.string().optional(),
  selection: z.string(),
  selectionKey: z.string(),
  line: z.number().optional(),
  playerId: z.string().optional(),
  playerName: z.string().optional(),

  // Best EV across all methods/targets
  bestEV: z.object({
    evPercent: z.number(),
    targetBookId: z.string(),
    targetBookName: z.string(),
    method: z.enum(FAIR_ODDS_METHODS),
    offeredOdds: z.number(),
    fairOdds: z.number(),
  }),

  // All EV calculations by method
  calculations: z.record(z.enum(FAIR_ODDS_METHODS), z.array(EVCalculationSchema)),

  // Fair odds by method
  fairOdds: z.record(z.enum(FAIR_ODDS_METHODS), FairOddsResultSchema),

  // Individual book odds
  bookOdds: z.array(BookOddsSchema).optional(),

  // Market data
  bookCount: z.number(),
  timestamp: z.string(),
});

export type EVOpportunity = z.infer<typeof EVOpportunitySchema>;

// Summary for list view
export const EVOpportunitySummarySchema = z.object({
  id: z.string(),
  fixtureId: z.string(),
  sport: z.string(),
  league: z.string(),
  leagueName: z.string().optional(),
  homeTeam: z.string().optional(),
  awayTeam: z.string().optional(),
  startsAt: z.string(),
  market: z.string(),
  selection: z.string(),
  line: z.number().optional(),
  playerName: z.string().optional(),
  evPercent: z.number(),
  targetBook: z.string(),
  targetBookId: z.string().optional(),
  offeredOdds: z.number(),
  fairOdds: z.number(),
  method: z.enum(FAIR_ODDS_METHODS),
  bookCount: z.number(),
  // Individual book odds for inline display
  bookOdds: z.array(BookOddsSchema).optional(),
});

export type EVOpportunitySummary = z.infer<typeof EVOpportunitySummarySchema>;

// Book breakdown for detail view
export const BookBreakdownSchema = z.object({
  sportsbookId: z.string(),
  sportsbookName: z.string(),
  decimalOdds: z.number(),
  impliedProbability: z.number(),
  isTarget: z.boolean(),
  isSharp: z.boolean(),
  isOutlier: z.boolean(),
  deviationFromFair: z.number(), // How far from fair odds (percentage)
});

export type BookBreakdown = z.infer<typeof BookBreakdownSchema>;
