import { z } from 'zod';

// Team
export const TeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  logo: z.string().optional(),
});

export type Team = z.infer<typeof TeamSchema>;

// League
export const LeagueSchema = z.object({
  id: z.string(),
  name: z.string(),
  numerical_id: z.number().nullable().optional(),
  sport: z
    .object({
      id: z.string(),
      name: z.string(),
      numerical_id: z.number().nullable().optional(),
    })
    .optional(),
  region: z.string().nullable().optional(),
  region_code: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
});

export type League = z.infer<typeof LeagueSchema>;

// League with enabled status (our extension)
export const LeagueWithStatusSchema = LeagueSchema.extend({
  isEnabled: z.boolean(),
  sportId: z.string(),
});

export type LeagueWithStatus = z.infer<typeof LeagueWithStatusSchema>;

// Sport object from OpticOdds API
export const SportObjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  numerical_id: z.number().nullable().optional(),
});

// League object from OpticOdds API
export const LeagueObjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  numerical_id: z.number().nullable().optional(),
});

// Competitor from OpticOdds API
export const CompetitorSchema = z.object({
  id: z.string(),
  name: z.string(),
  numerical_id: z.number().nullable().optional(),
  base_id: z.number().nullable().optional(),
  abbreviation: z.string().nullable().optional(),
  logo: z.string().nullable().optional(),
});

// Fixture from OpticOdds API (actual API shape)
export const OpticOddsFixtureSchema = z.object({
  id: z.string(),
  sport: SportObjectSchema,
  league: LeagueObjectSchema,
  start_date: z.string(), // ISO datetime
  home_competitors: z.array(CompetitorSchema).optional(),
  away_competitors: z.array(CompetitorSchema).optional(),
  home_team_display: z.string().optional(),
  away_team_display: z.string().optional(),
  status: z.string().optional(),
  is_live: z.boolean().optional(),
  has_odds: z.boolean().optional(),
});

export type OpticOddsFixture = z.infer<typeof OpticOddsFixtureSchema>;

// Simplified fixture (our internal representation)
export const FixtureSchema = z.object({
  id: z.string(),
  sport: z.string(),
  league: z.string(),
  leagueName: z.string().optional(),
  start_date: z.string(), // ISO datetime
  home_team: z.string().optional(),
  away_team: z.string().optional(),
  home_team_id: z.string().optional(),
  away_team_id: z.string().optional(),
  status: z.string().optional(),
  is_live: z.boolean().optional(),
});

export type Fixture = z.infer<typeof FixtureSchema>;

// Fixture with computed properties
export const FixtureWithDetailsSchema = FixtureSchema.extend({
  leagueName: z.string().optional(),
  homeTeamName: z.string().optional(),
  awayTeamName: z.string().optional(),
  startsAt: z.date(),
  isPrematch: z.boolean(),
});

export type FixtureWithDetails = z.infer<typeof FixtureWithDetailsSchema>;

// OpticOdds fixtures response (raw API response)
export const OpticOddsFixturesResponseSchema = z.object({
  data: z.array(OpticOddsFixtureSchema),
});

export type OpticOddsFixturesResponse = z.infer<typeof OpticOddsFixturesResponseSchema>;

// Simplified fixtures response (our internal representation)
export const FixturesResponseSchema = z.object({
  data: z.array(FixtureSchema),
});

export type FixturesResponse = z.infer<typeof FixturesResponseSchema>;

// Leagues response
export const LeaguesResponseSchema = z.object({
  data: z.array(LeagueSchema),
});

export type LeaguesResponse = z.infer<typeof LeaguesResponseSchema>;
