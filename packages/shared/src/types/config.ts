import { z } from 'zod';
import { FAIR_ODDS_METHODS, DEFAULT_TARGET_SPORTSBOOKS } from '../constants.js';

// Application configuration
export const AppConfigSchema = z.object({
  // API settings - OpticOdds
  opticOddsApiKey: z.string(),
  opticOddsBaseUrl: z.string().default('https://api.opticodds.com/api/v3'),

  // API settings - SportMonks (for football statistics)
  sportMonksApiKey: z.string().default(''),
  sportMonksBaseUrl: z.string().default('https://api.sportmonks.com/v3/football'),

  // API settings - Ball Don't Lie (for NBA statistics)
  ballDontLieApiKey: z.string().default(''),
  ballDontLieBaseUrl: z.string().default('https://api.balldontlie.io'),

  // Server settings
  port: z.number().default(4000),
  host: z.string().default('0.0.0.0'),

  // Database - Turso cloud or local SQLite
  tursoDbUrl: z.string().default(''),
  tursoAuthToken: z.string().default(''),
  dbPath: z.string().default('./data/dev.db'), // Fallback for local dev

  // Scheduler
  refreshIntervalMs: z.number().default(120000),

  // EV calculation
  minEvPercent: z.number().default(5),
  defaultMethod: z.enum(FAIR_ODDS_METHODS).default('TRIMMED_MEAN_PROB'),

  // Sportsbooks
  targetSportsbooks: z.array(z.string()).default([...DEFAULT_TARGET_SPORTSBOOKS]),
  sharpBook: z.string().default('pinnacle'),

  // Leagues
  soccerLeagues: z.array(z.string()),
  basketballLeagues: z.array(z.string()),

  // Rate limiting
  maxConcurrentRequests: z.number().default(5),
  maxSportsbooksPerRequest: z.number().default(5),
  minBooksForFairOdds: z.number().default(3),

  // TTL
  oddsTtlMs: z.number().default(300000),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

// User preferences (stored in DB)
export const UserPreferencesSchema = z.object({
  selectedMethod: z.enum(FAIR_ODDS_METHODS).default('TRIMMED_MEAN_PROB'),
  targetSportsbooks: z.array(z.string()),
  enabledLeagues: z.array(z.string()),
  minEvPercent: z.number().default(5),
  showNotifications: z.boolean().default(true),
});

export type UserPreferences = z.infer<typeof UserPreferencesSchema>;
