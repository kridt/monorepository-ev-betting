import { config as dotenvConfig } from 'dotenv';
import { AppConfigSchema } from '@ev-bets/shared';

// Load .env file
dotenvConfig();

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a number`);
  }
  return parsed;
}

function getEnvArray(key: string, defaultValue: string[]): string[] {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  return value.split(',').map(s => s.trim());
}

// Build config from environment
const rawConfig = {
  opticOddsApiKey: getEnvVar('OPTICODDS_API_KEY'),
  opticOddsBaseUrl: getEnvVar('OPTICODDS_BASE_URL', 'https://api.opticodds.com/api/v3'),

  // SportMonks API (for football statistics)
  sportMonksApiKey: getEnvVar('SPORTMONKS_API_KEY', ''),
  sportMonksBaseUrl: getEnvVar('SPORTMONKS_BASE_URL', 'https://api.sportmonks.com/v3/football'),

  // Ball Don't Lie API (for NBA statistics)
  ballDontLieApiKey: getEnvVar('BALLDONTLIE_API_KEY', ''),
  ballDontLieBaseUrl: getEnvVar('BALLDONTLIE_BASE_URL', 'https://api.balldontlie.io'),

  port: getEnvNumber('PORT', 4000),
  host: getEnvVar('HOST', '0.0.0.0'),

  dbPath: getEnvVar('DB_PATH', './data/dev.db'),

  refreshIntervalMs: getEnvNumber('REFRESH_INTERVAL_MS', 120000),

  minEvPercent: getEnvNumber('MIN_EV_PERCENT', 5),
  defaultMethod: 'TRIMMED_MEAN_PROB' as const,

  targetSportsbooks: getEnvArray('TARGET_SPORTSBOOKS', ['betano', 'unibet', 'betway']),
  sharpBook: getEnvVar('SHARP_BOOK', 'pinnacle'),

  soccerLeagues: getEnvArray('SOCCER_LEAGUES', [
    'england_-_premier_league',
    'spain_-_la_liga',
    'italy_-_serie_a',
    'germany_-_bundesliga',
    'france_-_ligue_1',
  ]),
  basketballLeagues: getEnvArray('BASKETBALL_LEAGUES', ['nba']),

  maxConcurrentRequests: getEnvNumber('MAX_CONCURRENT_REQUESTS', 5),
  maxSportsbooksPerRequest: 5,
  minBooksForFairOdds: 3,
  oddsTtlMs: getEnvNumber('ODDS_TTL_MS', 300000),
};

// Validate with Zod
export const config = AppConfigSchema.parse(rawConfig);

// Export type-safe config
export type Config = typeof config;
