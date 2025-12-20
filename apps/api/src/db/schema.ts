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

// ============================================================================
// Player Stats Cache (Basketball)
// ============================================================================

// Players table - stores player info and pre-calculated averages/trends
export const players = sqliteTable('players', {
  id: text('id').primaryKey(), // OpticOdds player ID
  name: text('name').notNull(),
  team: text('team'),
  teamId: text('team_id'),
  position: text('position'),
  jersey: integer('jersey'),
  league: text('league').default('nba'),

  // Pre-calculated averages (last 20 games)
  avgPoints: real('avg_points'),
  avgRebounds: real('avg_rebounds'),
  avgAssists: real('avg_assists'),
  avgThrees: real('avg_threes'),
  avgSteals: real('avg_steals'),
  avgBlocks: real('avg_blocks'),
  avgTurnovers: real('avg_turnovers'),
  avgMinutes: real('avg_minutes'),
  avgPRA: real('avg_pra'), // Points + Rebounds + Assists

  // Last 5 games averages (for trend comparison)
  last5Points: real('last5_points'),
  last5Rebounds: real('last5_rebounds'),
  last5Assists: real('last5_assists'),
  last5Threes: real('last5_threes'),
  last5PRA: real('last5_pra'),

  // Last 10 games averages
  last10Points: real('last10_points'),
  last10Rebounds: real('last10_rebounds'),
  last10Assists: real('last10_assists'),
  last10Threes: real('last10_threes'),
  last10PRA: real('last10_pra'),

  // Home/Away splits (averages)
  homePoints: real('home_points'),
  homeRebounds: real('home_rebounds'),
  homeAssists: real('home_assists'),
  awayPoints: real('away_points'),
  awayRebounds: real('away_rebounds'),
  awayAssists: real('away_assists'),

  // Games tracked
  gamesPlayed: integer('games_played').default(0),
  homeGames: integer('home_games').default(0),
  awayGames: integer('away_games').default(0),

  // Cache metadata
  lastGameDate: text('last_game_date'), // Date of most recent game in cache
  lastUpdated: text('last_updated').default(sql`CURRENT_TIMESTAMP`),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// Player game stats - individual game records (last 20 games per player)
export const playerGameStats = sqliteTable('player_game_stats', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  playerId: text('player_id').notNull().references(() => players.id),
  fixtureId: text('fixture_id'), // OpticOdds fixture ID
  gameDate: text('game_date').notNull(), // ISO date
  opponent: text('opponent'),
  opponentId: text('opponent_id'),
  isHome: integer('is_home', { mode: 'boolean' }).default(false),

  // Stats
  minutes: integer('minutes').default(0),
  points: integer('points').default(0),
  rebounds: integer('rebounds').default(0),
  assists: integer('assists').default(0),
  threes: integer('threes').default(0), // Three pointers made
  steals: integer('steals').default(0),
  blocks: integer('blocks').default(0),
  turnovers: integer('turnovers').default(0),
  fgMade: integer('fg_made').default(0),
  fgAttempted: integer('fg_attempted').default(0),
  ftMade: integer('ft_made').default(0),
  ftAttempted: integer('ft_attempted').default(0),

  // Combined stats (pre-calculated)
  pra: integer('pra').default(0), // Points + Rebounds + Assists
  pr: integer('pr').default(0),   // Points + Rebounds
  pa: integer('pa').default(0),   // Points + Assists
  ra: integer('ra').default(0),   // Rebounds + Assists

  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// Player cache update log - tracks when updates ran
export const playerCacheLog = sqliteTable('player_cache_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runDate: text('run_date').notNull(), // ISO date
  playersUpdated: integer('players_updated').default(0),
  playersAdded: integer('players_added').default(0),
  gamesAdded: integer('games_added').default(0),
  errors: text('errors'), // JSON array of error messages
  duration: integer('duration'), // milliseconds
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// ============================================================================
// Soccer Player Stats Cache (SportMonks)
// ============================================================================

// Soccer leagues from SportMonks
export const soccerLeagues = sqliteTable('soccer_leagues', {
  id: integer('id').primaryKey(), // SportMonks league ID
  name: text('name').notNull(),
  shortCode: text('short_code'),
  countryId: integer('country_id'),
  countryName: text('country_name'),
  type: text('type'), // league, cup, etc.
  active: integer('active', { mode: 'boolean' }).default(true),
  currentSeasonId: integer('current_season_id'),
  imagePath: text('image_path'),
  lastUpdated: text('last_updated').default(sql`CURRENT_TIMESTAMP`),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// Soccer teams from SportMonks
export const soccerTeams = sqliteTable('soccer_teams', {
  id: integer('id').primaryKey(), // SportMonks team ID
  name: text('name').notNull(),
  shortCode: text('short_code'),
  countryId: integer('country_id'),
  leagueId: integer('league_id'),
  venueId: integer('venue_id'),
  imagePath: text('image_path'),
  founded: integer('founded'),
  lastUpdated: text('last_updated').default(sql`CURRENT_TIMESTAMP`),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// Soccer players - stores player info and pre-calculated averages
export const soccerPlayers = sqliteTable('soccer_players', {
  id: integer('id').primaryKey(), // SportMonks player ID
  name: text('name').notNull(),
  displayName: text('display_name'),
  commonName: text('common_name'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  teamId: integer('team_id'),
  teamName: text('team_name'),
  leagueId: integer('league_id'),
  leagueName: text('league_name'),
  positionId: integer('position_id'),
  position: text('position'), // GK, DEF, MID, FWD
  nationality: text('nationality'),
  imagePath: text('image_path'),
  dateOfBirth: text('date_of_birth'),

  // Pre-calculated season averages
  avgShots: real('avg_shots'),
  avgShotsOnTarget: real('avg_shots_on_target'),
  avgGoals: real('avg_goals'),
  avgAssists: real('avg_assists'),
  avgPasses: real('avg_passes'),
  avgKeyPasses: real('avg_key_passes'),
  avgTackles: real('avg_tackles'),
  avgInterceptions: real('avg_interceptions'),
  avgClearances: real('avg_clearances'),
  avgBlocks: real('avg_blocks'),
  avgFouls: real('avg_fouls'),
  avgFoulsDrawn: real('avg_fouls_drawn'),
  avgDribbles: real('avg_dribbles'),
  avgDuelsWon: real('avg_duels_won'),
  avgAerialDuelsWon: real('avg_aerial_duels_won'),
  avgCrosses: real('avg_crosses'),
  avgTouches: real('avg_touches'),
  avgMinutes: real('avg_minutes'),
  avgYellowCards: real('avg_yellow_cards'),
  avgRedCards: real('avg_red_cards'),

  // Last 5 games averages (recent form)
  last5Shots: real('last5_shots'),
  last5ShotsOnTarget: real('last5_shots_on_target'),
  last5Goals: real('last5_goals'),
  last5Assists: real('last5_assists'),
  last5Passes: real('last5_passes'),
  last5Tackles: real('last5_tackles'),

  // Last 10 games averages
  last10Shots: real('last10_shots'),
  last10ShotsOnTarget: real('last10_shots_on_target'),
  last10Goals: real('last10_goals'),
  last10Assists: real('last10_assists'),
  last10Passes: real('last10_passes'),
  last10Tackles: real('last10_tackles'),

  // Home/Away splits
  homeShots: real('home_shots'),
  homeShotsOnTarget: real('home_shots_on_target'),
  homeGoals: real('home_goals'),
  homeAssists: real('home_assists'),
  awayShots: real('away_shots'),
  awayShotsOnTarget: real('away_shots_on_target'),
  awayGoals: real('away_goals'),
  awayAssists: real('away_assists'),

  // Games tracked
  gamesPlayed: integer('games_played').default(0),
  homeGames: integer('home_games').default(0),
  awayGames: integer('away_games').default(0),
  totalGoals: integer('total_goals').default(0),
  totalAssists: integer('total_assists').default(0),

  // Cache metadata
  lastGameDate: text('last_game_date'),
  lastUpdated: text('last_updated').default(sql`CURRENT_TIMESTAMP`),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// Soccer player game stats - individual game records
export const soccerPlayerGameStats = sqliteTable('soccer_player_game_stats', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  playerId: integer('player_id').notNull(),
  fixtureId: integer('fixture_id').notNull(), // SportMonks fixture ID
  gameDate: text('game_date').notNull(), // ISO date
  opponent: text('opponent'),
  opponentId: integer('opponent_id'),
  isHome: integer('is_home', { mode: 'boolean' }).default(false),
  leagueId: integer('league_id'),

  // Stats (from lineup details)
  minutes: integer('minutes').default(0),
  shots: integer('shots').default(0),
  shotsOnTarget: integer('shots_on_target').default(0),
  goals: integer('goals').default(0),
  assists: integer('assists').default(0),
  passes: integer('passes').default(0),
  passesAccurate: integer('passes_accurate').default(0),
  keyPasses: integer('key_passes').default(0),
  crosses: integer('crosses').default(0),
  crossesAccurate: integer('crosses_accurate').default(0),
  tackles: integer('tackles').default(0),
  interceptions: integer('interceptions').default(0),
  clearances: integer('clearances').default(0),
  blocks: integer('blocks').default(0),
  saves: integer('saves').default(0), // For goalkeepers
  fouls: integer('fouls').default(0),
  foulsDrawn: integer('fouls_drawn').default(0),
  dribbles: integer('dribbles').default(0),
  dribblesSuccessful: integer('dribbles_successful').default(0),
  duels: integer('duels').default(0),
  duelsWon: integer('duels_won').default(0),
  aerialDuels: integer('aerial_duels').default(0),
  aerialDuelsWon: integer('aerial_duels_won').default(0),
  touches: integer('touches').default(0),
  yellowCards: integer('yellow_cards').default(0),
  redCards: integer('red_cards').default(0),
  rating: real('rating'), // Match rating if available

  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// Player ID mapping - maps OpticOdds player IDs to SportMonks/BallDontLie IDs
export const playerIdMapping = sqliteTable('player_id_mapping', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  opticOddsPlayerId: text('opticodds_player_id'), // OpticOdds player ID
  opticOddsPlayerName: text('opticodds_player_name'),
  sportMonksPlayerId: integer('sportmonks_player_id'), // SportMonks player ID
  sportMonksPlayerName: text('sportmonks_player_name'),
  ballDontLiePlayerId: integer('balldontlie_player_id'), // Ball Don't Lie player ID
  ballDontLiePlayerName: text('balldontlie_player_name'),
  normalizedName: text('normalized_name'), // Lowercase, no special chars
  teamName: text('team_name'),
  sport: text('sport').notNull(), // 'soccer' or 'basketball'
  confidence: real('confidence').default(1.0), // Match confidence 0-1
  verified: integer('verified', { mode: 'boolean' }).default(false), // Manual verification
  lastUpdated: text('last_updated').default(sql`CURRENT_TIMESTAMP`),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// Player name aliases - common name variations
export const playerNameAliases = sqliteTable('player_name_aliases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  playerId: text('player_id').notNull(), // Internal player ID (bdl_xxx)
  alias: text('alias').notNull(), // The alias name
  normalizedAlias: text('normalized_alias').notNull(), // Lowercase, no special chars
  source: text('source').default('auto'), // 'auto', 'manual', 'odds_api'
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// Soccer cache update log
export const soccerCacheLog = sqliteTable('soccer_cache_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runDate: text('run_date').notNull(),
  leaguesProcessed: integer('leagues_processed').default(0),
  teamsProcessed: integer('teams_processed').default(0),
  playersUpdated: integer('players_updated').default(0),
  playersAdded: integer('players_added').default(0),
  gamesAdded: integer('games_added').default(0),
  mappingsCreated: integer('mappings_created').default(0),
  errors: text('errors'), // JSON array of error messages
  duration: integer('duration'), // milliseconds
  status: text('status').default('pending'), // pending, running, completed, failed
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});
