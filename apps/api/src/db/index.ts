import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema.js';
import { config } from '../config.js';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// Determine if using Turso cloud or local SQLite
const useTurso = config.tursoDbUrl && config.tursoAuthToken;

if (!useTurso) {
  // Ensure data directory exists for local SQLite
  const dbDir = dirname(config.dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }
}

// Create libsql client (Turso cloud or local file)
const client = useTurso
  ? createClient({
      url: config.tursoDbUrl,
      authToken: config.tursoAuthToken,
    })
  : createClient({
      url: `file:${config.dbPath}`,
    });

console.info(`[DB] Using ${useTurso ? 'Turso cloud' : 'local SQLite'} database`);

// Create Drizzle instance
export const db = drizzle(client, { schema });

// Initialize database with tables
export async function initDatabase() {
  console.info('[DB] Initializing database...');

  // Enable foreign keys and WAL mode (only for local SQLite, not Turso cloud)
  if (!useTurso) {
    await client.execute('PRAGMA foreign_keys = ON');
    await client.execute('PRAGMA journal_mode = WAL');
  }

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

  // ============================================================================
  // Player Stats Cache Tables
  // ============================================================================

  await client.execute(`
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      team TEXT,
      team_id TEXT,
      position TEXT,
      jersey INTEGER,
      league TEXT DEFAULT 'nba',
      avg_points REAL,
      avg_rebounds REAL,
      avg_assists REAL,
      avg_threes REAL,
      avg_steals REAL,
      avg_blocks REAL,
      avg_turnovers REAL,
      avg_minutes REAL,
      avg_pra REAL,
      last5_points REAL,
      last5_rebounds REAL,
      last5_assists REAL,
      last5_threes REAL,
      last5_pra REAL,
      last10_points REAL,
      last10_rebounds REAL,
      last10_assists REAL,
      last10_threes REAL,
      last10_pra REAL,
      home_points REAL,
      home_rebounds REAL,
      home_assists REAL,
      away_points REAL,
      away_rebounds REAL,
      away_assists REAL,
      games_played INTEGER DEFAULT 0,
      home_games INTEGER DEFAULT 0,
      away_games INTEGER DEFAULT 0,
      last_game_date TEXT,
      last_updated TEXT DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS player_game_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id TEXT NOT NULL REFERENCES players(id),
      fixture_id TEXT,
      game_date TEXT NOT NULL,
      opponent TEXT,
      opponent_id TEXT,
      is_home INTEGER DEFAULT 0,
      minutes INTEGER DEFAULT 0,
      points INTEGER DEFAULT 0,
      rebounds INTEGER DEFAULT 0,
      assists INTEGER DEFAULT 0,
      threes INTEGER DEFAULT 0,
      steals INTEGER DEFAULT 0,
      blocks INTEGER DEFAULT 0,
      turnovers INTEGER DEFAULT 0,
      fg_made INTEGER DEFAULT 0,
      fg_attempted INTEGER DEFAULT 0,
      ft_made INTEGER DEFAULT 0,
      ft_attempted INTEGER DEFAULT 0,
      pra INTEGER DEFAULT 0,
      pr INTEGER DEFAULT 0,
      pa INTEGER DEFAULT 0,
      ra INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS player_cache_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_date TEXT NOT NULL,
      players_updated INTEGER DEFAULT 0,
      players_added INTEGER DEFAULT 0,
      games_added INTEGER DEFAULT 0,
      errors TEXT,
      duration INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Player cache indexes
  await client.execute('CREATE INDEX IF NOT EXISTS idx_players_name ON players(name)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_players_team ON players(team)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_player_game_stats_player ON player_game_stats(player_id)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_player_game_stats_date ON player_game_stats(game_date DESC)');
  await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_player_game_unique ON player_game_stats(player_id, game_date, fixture_id)');

  // ============================================================================
  // Soccer Player Stats Cache Tables (SportMonks)
  // ============================================================================

  await client.execute(`
    CREATE TABLE IF NOT EXISTS soccer_leagues (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      short_code TEXT,
      country_id INTEGER,
      country_name TEXT,
      type TEXT,
      active INTEGER DEFAULT 1,
      current_season_id INTEGER,
      image_path TEXT,
      last_updated TEXT DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS soccer_teams (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      short_code TEXT,
      country_id INTEGER,
      league_id INTEGER,
      venue_id INTEGER,
      image_path TEXT,
      founded INTEGER,
      last_updated TEXT DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS soccer_players (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      display_name TEXT,
      common_name TEXT,
      first_name TEXT,
      last_name TEXT,
      team_id INTEGER,
      team_name TEXT,
      league_id INTEGER,
      league_name TEXT,
      position_id INTEGER,
      position TEXT,
      nationality TEXT,
      image_path TEXT,
      date_of_birth TEXT,
      avg_shots REAL,
      avg_shots_on_target REAL,
      avg_goals REAL,
      avg_assists REAL,
      avg_passes REAL,
      avg_key_passes REAL,
      avg_tackles REAL,
      avg_interceptions REAL,
      avg_clearances REAL,
      avg_blocks REAL,
      avg_fouls REAL,
      avg_fouls_drawn REAL,
      avg_dribbles REAL,
      avg_duels_won REAL,
      avg_aerial_duels_won REAL,
      avg_crosses REAL,
      avg_touches REAL,
      avg_minutes REAL,
      avg_yellow_cards REAL,
      avg_red_cards REAL,
      last5_shots REAL,
      last5_shots_on_target REAL,
      last5_goals REAL,
      last5_assists REAL,
      last5_passes REAL,
      last5_tackles REAL,
      last10_shots REAL,
      last10_shots_on_target REAL,
      last10_goals REAL,
      last10_assists REAL,
      last10_passes REAL,
      last10_tackles REAL,
      home_shots REAL,
      home_shots_on_target REAL,
      home_goals REAL,
      home_assists REAL,
      away_shots REAL,
      away_shots_on_target REAL,
      away_goals REAL,
      away_assists REAL,
      games_played INTEGER DEFAULT 0,
      home_games INTEGER DEFAULT 0,
      away_games INTEGER DEFAULT 0,
      total_goals INTEGER DEFAULT 0,
      total_assists INTEGER DEFAULT 0,
      last_game_date TEXT,
      last_updated TEXT DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS soccer_player_game_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      fixture_id INTEGER NOT NULL,
      game_date TEXT NOT NULL,
      opponent TEXT,
      opponent_id INTEGER,
      is_home INTEGER DEFAULT 0,
      league_id INTEGER,
      minutes INTEGER DEFAULT 0,
      shots INTEGER DEFAULT 0,
      shots_on_target INTEGER DEFAULT 0,
      goals INTEGER DEFAULT 0,
      assists INTEGER DEFAULT 0,
      passes INTEGER DEFAULT 0,
      passes_accurate INTEGER DEFAULT 0,
      key_passes INTEGER DEFAULT 0,
      crosses INTEGER DEFAULT 0,
      crosses_accurate INTEGER DEFAULT 0,
      tackles INTEGER DEFAULT 0,
      interceptions INTEGER DEFAULT 0,
      clearances INTEGER DEFAULT 0,
      blocks INTEGER DEFAULT 0,
      saves INTEGER DEFAULT 0,
      fouls INTEGER DEFAULT 0,
      fouls_drawn INTEGER DEFAULT 0,
      dribbles INTEGER DEFAULT 0,
      dribbles_successful INTEGER DEFAULT 0,
      duels INTEGER DEFAULT 0,
      duels_won INTEGER DEFAULT 0,
      aerial_duels INTEGER DEFAULT 0,
      aerial_duels_won INTEGER DEFAULT 0,
      touches INTEGER DEFAULT 0,
      yellow_cards INTEGER DEFAULT 0,
      red_cards INTEGER DEFAULT 0,
      rating REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS player_id_mapping (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opticodds_player_id TEXT,
      opticodds_player_name TEXT,
      sportmonks_player_id INTEGER,
      sportmonks_player_name TEXT,
      balldontlie_player_id INTEGER,
      balldontlie_player_name TEXT,
      normalized_name TEXT,
      team_name TEXT,
      sport TEXT NOT NULL,
      confidence REAL DEFAULT 1.0,
      verified INTEGER DEFAULT 0,
      last_updated TEXT DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Add Ball Don't Lie columns if they don't exist (migration)
  try {
    await client.execute('ALTER TABLE player_id_mapping ADD COLUMN balldontlie_player_id INTEGER');
    await client.execute('ALTER TABLE player_id_mapping ADD COLUMN balldontlie_player_name TEXT');
    await client.execute('ALTER TABLE player_id_mapping ADD COLUMN normalized_name TEXT');
  } catch {
    // Columns already exist, ignore
  }

  await client.execute(`
    CREATE TABLE IF NOT EXISTS player_name_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      normalized_alias TEXT NOT NULL,
      source TEXT DEFAULT 'auto',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS soccer_cache_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_date TEXT NOT NULL,
      leagues_processed INTEGER DEFAULT 0,
      teams_processed INTEGER DEFAULT 0,
      players_updated INTEGER DEFAULT 0,
      players_added INTEGER DEFAULT 0,
      games_added INTEGER DEFAULT 0,
      mappings_created INTEGER DEFAULT 0,
      errors TEXT,
      duration INTEGER,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Soccer cache indexes
  await client.execute('CREATE INDEX IF NOT EXISTS idx_soccer_players_name ON soccer_players(name)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_soccer_players_team ON soccer_players(team_id)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_soccer_players_league ON soccer_players(league_id)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_soccer_game_stats_player ON soccer_player_game_stats(player_id)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_soccer_game_stats_date ON soccer_player_game_stats(game_date DESC)');
  await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_soccer_game_unique ON soccer_player_game_stats(player_id, fixture_id)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_player_mapping_opticodds ON player_id_mapping(opticodds_player_id)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_player_mapping_sportmonks ON player_id_mapping(sportmonks_player_id)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_player_mapping_name ON player_id_mapping(opticodds_player_name, team_name)');

  // Player name aliases indexes
  await client.execute('CREATE INDEX IF NOT EXISTS idx_player_aliases_player ON player_name_aliases(player_id)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_player_aliases_normalized ON player_name_aliases(normalized_alias)');

  console.info('[DB] Database initialized successfully');
}

// Close database connection
export function closeDatabase() {
  client.close();
}

export { schema };
