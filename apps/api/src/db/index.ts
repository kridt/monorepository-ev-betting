import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema.js';
import { config } from '../config.js';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// Ensure data directory exists
const dbDir = dirname(config.dbPath);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

// Create libsql client (local file mode)
const client = createClient({
  url: `file:${config.dbPath}`,
});

// Create Drizzle instance
export const db = drizzle(client, { schema });

// Initialize database with tables
export async function initDatabase() {
  console.info('[DB] Initializing database...');

  // Enable foreign keys and WAL mode
  await client.execute('PRAGMA foreign_keys = ON');
  await client.execute('PRAGMA journal_mode = WAL');

  // Create tables directly (simple approach for SQLite)
  await client.execute(`
    CREATE TABLE IF NOT EXISTS fixtures (
      id TEXT PRIMARY KEY,
      sport TEXT NOT NULL,
      league TEXT NOT NULL,
      league_name TEXT,
      home_team TEXT,
      away_team TEXT,
      home_team_id TEXT,
      away_team_id TEXT,
      starts_at TEXT NOT NULL,
      status TEXT,
      is_live INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS odds_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_id TEXT NOT NULL REFERENCES fixtures(id),
      sportsbook_id TEXT NOT NULL,
      sportsbook_name TEXT NOT NULL,
      market TEXT NOT NULL,
      selection TEXT NOT NULL,
      selection_key TEXT NOT NULL,
      line REAL,
      player_id TEXT,
      player_name TEXT,
      decimal_odds REAL NOT NULL,
      implied_probability REAL NOT NULL,
      timestamp TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS opportunities (
      id TEXT PRIMARY KEY,
      fixture_id TEXT NOT NULL REFERENCES fixtures(id),
      sport TEXT NOT NULL,
      league TEXT NOT NULL,
      league_name TEXT,
      home_team TEXT,
      away_team TEXT,
      starts_at TEXT NOT NULL,
      market TEXT NOT NULL,
      market_name TEXT,
      selection TEXT NOT NULL,
      selection_key TEXT NOT NULL,
      line REAL,
      player_id TEXT,
      player_name TEXT,
      best_ev_percent REAL NOT NULL,
      best_target_book_id TEXT NOT NULL,
      best_target_book_name TEXT NOT NULL,
      best_method TEXT NOT NULL,
      best_offered_odds REAL NOT NULL,
      best_fair_odds REAL NOT NULL,
      calculations_json TEXT NOT NULL,
      fair_odds_json TEXT NOT NULL,
      book_odds_json TEXT,
      book_count INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Add book_odds_json column if it doesn't exist (migration for existing DBs)
  try {
    await client.execute('ALTER TABLE opportunities ADD COLUMN book_odds_json TEXT');
    console.info('[DB] Added book_odds_json column to opportunities table');
  } catch {
    // Column already exists, ignore
  }

  // Add nba_validation_json column if it doesn't exist (migration for pre-computed NBA validation)
  try {
    await client.execute('ALTER TABLE opportunities ADD COLUMN nba_validation_json TEXT');
    console.info('[DB] Added nba_validation_json column to opportunities table');
  } catch {
    // Column already exists, ignore
  }

  await client.execute(`
    CREATE TABLE IF NOT EXISTS sportsbooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      logo TEXT,
      is_onshore INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      is_target INTEGER DEFAULT 0,
      is_sharp INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS leagues (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sport TEXT NOT NULL,
      region TEXT,
      region_code TEXT,
      gender TEXT,
      is_enabled INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS scheduler_status (
      id INTEGER PRIMARY KEY DEFAULT 1,
      is_running INTEGER DEFAULT 0,
      last_run_start TEXT,
      last_run_end TEXT,
      last_run_error TEXT,
      next_run TEXT,
      fixtures_processed INTEGER DEFAULT 0,
      opportunities_found INTEGER DEFAULT 0
    )
  `);

  // Create indexes for common queries
  await client.execute('CREATE INDEX IF NOT EXISTS idx_opportunities_sport ON opportunities(sport)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_opportunities_league ON opportunities(league)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_opportunities_ev ON opportunities(best_ev_percent DESC)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_opportunities_starts_at ON opportunities(starts_at)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_fixtures_sport_league ON fixtures(sport, league)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_odds_fixture_selection ON odds_snapshots(fixture_id, selection_key)');

  // Insert default scheduler status if not exists
  await client.execute('INSERT OR IGNORE INTO scheduler_status (id) VALUES (1)');

  console.info('[DB] Database initialized successfully');
}

// Close database connection
export function closeDatabase() {
  client.close();
}

export { schema };
