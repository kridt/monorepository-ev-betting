import { sqliteTable, text, integer, real, blob } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Fixtures table
export const fixtures = sqliteTable('fixtures', {
  id: text('id').primaryKey(),
  sport: text('sport').notNull(),
  league: text('league').notNull(),
  leagueName: text('league_name'),
  homeTeam: text('home_team'),
  awayTeam: text('away_team'),
  homeTeamId: text('home_team_id'),
  awayTeamId: text('away_team_id'),
  startsAt: text('starts_at').notNull(), // ISO datetime
  status: text('status'),
  isLive: integer('is_live', { mode: 'boolean' }).default(false),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

// Odds snapshots table
export const oddsSnapshots = sqliteTable('odds_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fixtureId: text('fixture_id').notNull().references(() => fixtures.id),
  sportsbookId: text('sportsbook_id').notNull(),
  sportsbookName: text('sportsbook_name').notNull(),
  market: text('market').notNull(),
  selection: text('selection').notNull(),
  selectionKey: text('selection_key').notNull(),
  line: real('line'),
  playerId: text('player_id'),
  playerName: text('player_name'),
  decimalOdds: real('decimal_odds').notNull(),
  impliedProbability: real('implied_probability').notNull(),
  timestamp: text('timestamp').notNull(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// EV opportunities table
export const opportunities = sqliteTable('opportunities', {
  id: text('id').primaryKey(),
  fixtureId: text('fixture_id').notNull().references(() => fixtures.id),
  sport: text('sport').notNull(),
  league: text('league').notNull(),
  leagueName: text('league_name'),
  homeTeam: text('home_team'),
  awayTeam: text('away_team'),
  startsAt: text('starts_at').notNull(),
  market: text('market').notNull(),
  marketName: text('market_name'),
  selection: text('selection').notNull(),
  selectionKey: text('selection_key').notNull(),
  line: real('line'),
  playerId: text('player_id'),
  playerName: text('player_name'),
  // Best EV across methods/targets
  bestEvPercent: real('best_ev_percent').notNull(),
  bestTargetBookId: text('best_target_book_id').notNull(),
  bestTargetBookName: text('best_target_book_name').notNull(),
  bestMethod: text('best_method').notNull(),
  bestOfferedOdds: real('best_offered_odds').notNull(),
  bestFairOdds: real('best_fair_odds').notNull(),
  // Calculations JSON (all methods/targets)
  calculationsJson: text('calculations_json').notNull(), // JSON string
  fairOddsJson: text('fair_odds_json').notNull(), // JSON string
  bookOddsJson: text('book_odds_json').default('[]'), // JSON string - individual book odds
  nbaValidationJson: text('nba_validation_json'), // JSON string - pre-computed NBA validation
  bookCount: integer('book_count').notNull(),
  timestamp: text('timestamp').notNull(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

// Sportsbooks table (cached from API)
export const sportsbooks = sqliteTable('sportsbooks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  logo: text('logo'),
  isOnshore: integer('is_onshore', { mode: 'boolean' }).default(false),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  isTarget: integer('is_target', { mode: 'boolean' }).default(false),
  isSharp: integer('is_sharp', { mode: 'boolean' }).default(false),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

// Leagues table
export const leagues = sqliteTable('leagues', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sport: text('sport').notNull(),
  region: text('region'),
  regionCode: text('region_code'),
  gender: text('gender'),
  isEnabled: integer('is_enabled', { mode: 'boolean' }).default(false),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

// Config table (key-value store)
export const configTable = sqliteTable('config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

// Scheduler status table
export const schedulerStatus = sqliteTable('scheduler_status', {
  id: integer('id').primaryKey().default(1),
  isRunning: integer('is_running', { mode: 'boolean' }).default(false),
  lastRunStart: text('last_run_start'),
  lastRunEnd: text('last_run_end'),
  lastRunError: text('last_run_error'),
  nextRun: text('next_run'),
  fixturesProcessed: integer('fixtures_processed').default(0),
  opportunitiesFound: integer('opportunities_found').default(0),
});
