import { z } from 'zod';

// Individual odds entry from OpticOdds (inside fixture response)
export const OddsEntrySchema = z.object({
  id: z.string().optional(),
  sportsbook: z.string(),
  market: z.string(),
  market_id: z.string().optional(),
  name: z.string(), // e.g., "Over 2.5", "Player X Goals Over 0.5"
  selection: z.string().optional(),
  normalized_selection: z.string().optional(),
  selection_line: z.string().nullable().optional(),
  price: z.number(), // American odds
  american_price: z.number().optional(),
  points: z.number().nullable().optional(), // For spread/total lines
  player_id: z.string().nullable().optional(),
  player_name: z.string().nullable().optional(),
  team_id: z.string().nullable().optional(),
  team_name: z.string().nullable().optional(),
  timestamp: z.union([z.string(), z.number()]).optional(), // Can be string or unix timestamp number
  is_main: z.boolean().optional(),
  grouping_key: z.string().nullable().optional(),
  deep_link: z.unknown().nullable().optional(), // Can be string, object, or null
  limits: z.unknown().nullable().optional(), // Can be object or null
  order_book: z.unknown().nullable().optional(),
  source_ids: z.unknown().nullable().optional(),
});

export type OddsEntry = z.infer<typeof OddsEntrySchema>;

// Sport object in odds response
const SportObjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  numerical_id: z.number().optional(),
});

// League object in odds response
const LeagueObjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  numerical_id: z.number().optional(),
});

// Competitor in odds response
const CompetitorSchema = z.object({
  id: z.string(),
  name: z.string(),
  numerical_id: z.number().optional(),
  base_id: z.number().optional(),
  abbreviation: z.string().optional(),
  logo: z.string().optional(),
});

// Fixture with odds from OpticOdds odds endpoint
export const FixtureWithOddsSchema = z.object({
  id: z.string(),
  numerical_id: z.number().optional(),
  game_id: z.string().optional(),
  start_date: z.string(),
  home_competitors: z.array(CompetitorSchema).optional(),
  away_competitors: z.array(CompetitorSchema).optional(),
  home_team_display: z.string().optional(),
  away_team_display: z.string().optional(),
  status: z.string().optional(),
  is_live: z.boolean().optional(),
  sport: SportObjectSchema,
  league: LeagueObjectSchema,
  tournament: z.string().nullable().optional(),
  odds: z.array(OddsEntrySchema.passthrough()),
}).passthrough();

export type FixtureWithOdds = z.infer<typeof FixtureWithOddsSchema>;

// OpticOdds odds response
export const OddsResponseSchema = z.object({
  data: z.array(FixtureWithOddsSchema),
});

export type OddsResponse = z.infer<typeof OddsResponseSchema>;

// Legacy fixture odds schema (for internal use if needed)
export const FixtureOddsSchema = z.object({
  fixture_id: z.string(),
  sportsbook: z.string(),
  odds: z.array(OddsEntrySchema),
});

export type FixtureOdds = z.infer<typeof FixtureOddsSchema>;

// Normalized odds for EV calculation
export const NormalizedOddsSchema = z.object({
  fixtureId: z.string(),
  market: z.string(),
  selection: z.string(),
  selectionKey: z.string(), // Unique identifier for this bet
  line: z.number().optional(),
  playerId: z.string().optional(),
  playerName: z.string().optional(),
  decimalOdds: z.number(),
  impliedProbability: z.number(),
  sportsbookId: z.string(),
  sportsbookName: z.string(),
  timestamp: z.date(),
});

export type NormalizedOdds = z.infer<typeof NormalizedOddsSchema>;

// Grouped odds for a single selection across books
export const GroupedOddsSchema = z.object({
  fixtureId: z.string(),
  market: z.string(),
  selection: z.string(),
  selectionKey: z.string(),
  line: z.number().optional(),
  playerId: z.string().optional(),
  playerName: z.string().optional(),
  odds: z.array(
    z.object({
      sportsbookId: z.string(),
      sportsbookName: z.string(),
      decimalOdds: z.number(),
      impliedProbability: z.number(),
      isTarget: z.boolean(),
      isSharp: z.boolean(),
      isOutlier: z.boolean(),
      timestamp: z.date(),
    })
  ),
});

export type GroupedOdds = z.infer<typeof GroupedOddsSchema>;
