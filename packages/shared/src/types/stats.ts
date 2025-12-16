import { z } from 'zod';

/**
 * Team statistics for bet-backing display
 */
export const TeamStatsSchema = z.object({
  teamId: z.string(),
  name: z.string(),
  shortName: z.string().optional(),
  form: z.string().optional(), // "WWDLW" - last 5 matches
  position: z.number().optional(), // League position
  played: z.number().optional(),
  won: z.number().optional(),
  drawn: z.number().optional(),
  lost: z.number().optional(),
  goalsScored: z.number().optional(),
  goalsConceded: z.number().optional(),
  avgGoalsScored: z.number().optional(), // Goals per game
  avgGoalsConceded: z.number().optional(),
  cleanSheets: z.number().optional(),
  bttsPercentage: z.number().optional(), // Both teams to score %
});

export type TeamStats = z.infer<typeof TeamStatsSchema>;

/**
 * Player statistics for bet-backing display
 */
export const PlayerStatsSchema = z.object({
  playerId: z.string(),
  name: z.string(),
  teamId: z.string().optional(),
  position: z.string().optional(), // "Forward", "Midfielder", etc.
  appearances: z.number().optional(),
  minutesPlayed: z.number().optional(),

  // Goals & Assists
  goals: z.number().optional(),
  assists: z.number().optional(),
  avgGoals: z.number().optional(), // Per game
  avgAssists: z.number().optional(),

  // Shots
  shots: z.number().optional(),
  shotsOnTarget: z.number().optional(),
  avgShots: z.number().optional(), // Per game
  avgShotsOnTarget: z.number().optional(),

  // Defensive
  tackles: z.number().optional(),
  avgTackles: z.number().optional(),
  interceptions: z.number().optional(),
  avgInterceptions: z.number().optional(),
  clearances: z.number().optional(),
  avgClearances: z.number().optional(),
  blocks: z.number().optional(),
  avgBlocks: z.number().optional(),

  // Discipline
  fouls: z.number().optional(),
  avgFouls: z.number().optional(),
  yellowCards: z.number().optional(),
  redCards: z.number().optional(),

  // Passing
  passes: z.number().optional(),
  avgPasses: z.number().optional(),
  crosses: z.number().optional(),
  avgCrosses: z.number().optional(),

  // Goalkeeper specific
  saves: z.number().optional(),
  avgSaves: z.number().optional(),
});

export type PlayerStats = z.infer<typeof PlayerStatsSchema>;

/**
 * Fixture stats response - contains bet-backing statistics
 */
export const FixtureStatsSchema = z.object({
  fixtureId: z.string(),
  sportMonksFixtureId: z.number().optional(), // SportMonks internal ID
  homeTeam: TeamStatsSchema.optional(),
  awayTeam: TeamStatsSchema.optional(),
  // Map of player name (lowercase, normalized) to their stats
  playerStats: z.record(z.string(), PlayerStatsSchema).optional(),
  // Head to head
  h2h: z.object({
    homeWins: z.number(),
    awayWins: z.number(),
    draws: z.number(),
    totalGames: z.number(),
  }).optional(),
  // Cache info
  cachedAt: z.string().optional(),
});

export type FixtureStats = z.infer<typeof FixtureStatsSchema>;

/**
 * Stats response wrapper
 */
export const StatsResponseSchema = z.object({
  data: FixtureStatsSchema,
  error: z.string().optional(),
});

export type StatsResponse = z.infer<typeof StatsResponseSchema>;

/**
 * Bet-backing stat - what to show inline for a specific bet
 */
export const BetBackingStatSchema = z.object({
  label: z.string(), // "Avg: 3.2/game"
  value: z.number(), // 3.2
  supports: z.boolean(), // true if stat > line
  trend: z.enum(['up', 'down', 'stable']).optional(),
});

export type BetBackingStat = z.infer<typeof BetBackingStatSchema>;

/**
 * Validation result - historical hit rate for a bet
 */
export const ValidationResultSchema = z.object({
  playerName: z.string(),
  market: z.string(),
  line: z.number(),
  direction: z.enum(['over', 'under']),
  matchesChecked: z.number(),
  hits: z.number(),
  hitRate: z.number(), // 0-100
  recentMatches: z.array(z.object({
    date: z.string(),
    opponent: z.string(),
    value: z.number(),
    hit: z.boolean(),
  })),
  avgValue: z.number(),
});

export type ValidationResult = z.infer<typeof ValidationResultSchema>;

/**
 * Validation response wrapper
 */
export const ValidationResponseSchema = z.object({
  data: ValidationResultSchema.nullable(),
  message: z.string().optional(),
  error: z.string().optional(),
});

export type ValidationResponse = z.infer<typeof ValidationResponseSchema>;
