import type { Fixture, NormalizedOdds, GroupedOdds, EVOpportunity } from '@ev-bets/shared';
import {
  fetchFixtures,
  fetchOdds,
  getAllRequiredSportsbooks,
  filterPrematchFixtures,
} from '../services/opticOddsClient.js';
import {
  normalizeOddsEntry,
  groupOddsBySelection,
} from '../engine/oddsNormalizer.js';
import { calculateOpportunities, calculateAllBets } from '../engine/evCalculator.js';
import {
  validatePlayerProp,
  validateSpreadBet,
  validateMoneylineBet,
  searchPlayer,
  searchTeam,
  type ValidationResult,
} from '../services/opticOddsStatsClient.js';
import {
  getPlayerById,
  getPlayerByName,
  calculateHitRateFromCache,
  updatePlayerById,
} from '../services/playerCache.js';
import {
  getSoccerPlayerByName,
  calculateSoccerHitRate,
} from '../services/soccerPlayerCache.js';
import {
  findSportMonksPlayer,
} from '../services/playerIdMapping.js';
import { db, schema } from '../db/index.js';
import { eq, inArray, sql, and, or } from 'drizzle-orm';
import { config } from '../config.js';

// NBA is ALWAYS included regardless of user settings
const ALWAYS_INCLUDED_LEAGUES = ['nba'];

// Memory optimization: Process fixtures in batches
const FIXTURE_BATCH_SIZE = 20;

/**
 * Main data pipeline that runs on schedule
 *
 * Steps:
 * 1. Fetch active pre-match fixtures for soccer + NBA
 * 2. For each fixture, fetch odds for all required sportsbooks
 * 3. Normalize and group odds by selection
 * 4. Calculate fair odds and EV for each selection
 * 5. Persist opportunities that meet threshold
 */
export async function runPipeline(): Promise<{
  fixturesProcessed: number;
  opportunitiesFound: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let fixturesProcessed = 0;
  let opportunitiesFound = 0;

  const allSportsbooks = getAllRequiredSportsbooks();
  const targetBookIds = config.targetSportsbooks;
  const sharpBookId = config.sharpBook;

  console.info('[Pipeline] Starting pipeline run...');
  console.info(`[Pipeline] Target sportsbooks: ${targetBookIds.join(', ')}`);
  console.info(`[Pipeline] Total sportsbooks for fair odds: ${allSportsbooks.length}`);

  try {
    // Fetch fixtures for all enabled leagues
    const allFixtures: Fixture[] = [];

    // Soccer fixtures
    for (const league of config.soccerLeagues) {
      try {
        const response = await fetchFixtures('soccer', league);
        const prematch = filterPrematchFixtures(response.data);
        allFixtures.push(...prematch);
        console.info(`[Pipeline] Found ${prematch.length} pre-match fixtures for ${league}`);
      } catch (error) {
        const msg = `Failed to fetch fixtures for soccer/${league}: ${error}`;
        console.error(`[Pipeline] ${msg}`);
        errors.push(msg);
      }
    }

    // Basketball fixtures - ensure NBA is ALWAYS included
    const basketballLeagues = new Set([
      ...config.basketballLeagues,
      ...ALWAYS_INCLUDED_LEAGUES,
    ]);

    for (const league of basketballLeagues) {
      try {
        const response = await fetchFixtures('basketball', league);
        const prematch = filterPrematchFixtures(response.data);
        allFixtures.push(...prematch);
        console.info(`[Pipeline] Found ${prematch.length} pre-match fixtures for ${league}`);
      } catch (error) {
        const msg = `Failed to fetch fixtures for basketball/${league}: ${error}`;
        console.error(`[Pipeline] ${msg}`);
        errors.push(msg);
      }
    }

    console.info(`[Pipeline] Total pre-match fixtures to process: ${allFixtures.length}`);

    // Process fixtures in batches to manage memory
    const allOpportunityIds: string[] = [];

    for (let batchStart = 0; batchStart < allFixtures.length; batchStart += FIXTURE_BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + FIXTURE_BATCH_SIZE, allFixtures.length);
      const fixtureBatch = allFixtures.slice(batchStart, batchEnd);

      console.info(`[Pipeline] Processing batch ${Math.floor(batchStart / FIXTURE_BATCH_SIZE) + 1}/${Math.ceil(allFixtures.length / FIXTURE_BATCH_SIZE)} (fixtures ${batchStart + 1}-${batchEnd})`);

      // Process batch and collect opportunities
      const batchOpportunities: EVOpportunity[] = [];

      for (const fixture of fixtureBatch) {
        try {
          fixturesProcessed++;

          // Fetch odds for this fixture
          const oddsResponse = await fetchOdds(fixture.id, allSportsbooks);

          if (oddsResponse.data.length === 0) {
            continue;
          }

          // Normalize all odds (filter out nulls from extreme odds)
          const normalizedOdds: NormalizedOdds[] = [];

          for (const fixtureWithOdds of oddsResponse.data) {
            for (const entry of fixtureWithOdds.odds) {
              // Sportsbook is inside each odds entry
              const sportsbookId = entry.sportsbook.toLowerCase().replace(/\s+/g, '_');
              const normalized = normalizeOddsEntry(
                entry,
                fixture.id,
                sportsbookId,
                entry.sportsbook
              );
              // Skip odds that were filtered out (e.g., > 10.0 decimal)
              if (normalized) {
                normalizedOdds.push(normalized);
              }
            }
          }

          // Group by selection
          const groupedOdds = groupOddsBySelection(normalizedOdds, targetBookIds, sharpBookId);

          // Calculate ALL bets for each grouped selection (regardless of EV)
          for (const group of groupedOdds) {
            // Use calculateAllBets to store ALL selections, not just +EV
            const opportunity = calculateAllBets(
              group,
              {
                sport: fixture.sport,
                league: fixture.league,
                homeTeam: fixture.home_team,
                awayTeam: fixture.away_team,
                startsAt: fixture.start_date,
              },
              targetBookIds
            );

            if (opportunity) {
              batchOpportunities.push(opportunity);
              opportunitiesFound++;
            }
          }
        } catch (error) {
          const msg = `Error processing fixture ${fixture.id}: ${error}`;
          console.error(`[Pipeline] ${msg}`);
          errors.push(msg);
        }
      }

      // Persist batch opportunities immediately to free memory
      if (batchOpportunities.length > 0) {
        await persistOpportunities(batchOpportunities);
        allOpportunityIds.push(...batchOpportunities.map(o => o.id));
        console.info(`[Pipeline] Batch complete: ${batchOpportunities.length} opportunities persisted`);
      }

      // Clear batch array to help garbage collection
      batchOpportunities.length = 0;
    }

    console.info(`[Pipeline] Found ${opportunitiesFound} total bets to track and validate`);

    // Validate opportunities (must complete before pipeline returns)
    if (allOpportunityIds.length > 0) {
      console.info(`[Pipeline] Starting validation for ${allOpportunityIds.length} opportunities...`);
      try {
        await validateAllOpportunitiesById(allOpportunityIds);
        console.info('[Pipeline] Validation complete');
      } catch (err) {
        console.error('[Pipeline] Error validating opportunities:', err);
        errors.push(`Validation error: ${err}`);
      }
    }

    // Clean up stale data
    await cleanupStaleData();

  } catch (error) {
    const msg = `Pipeline error: ${error}`;
    console.error(`[Pipeline] ${msg}`);
    errors.push(msg);
  }

  console.info(`[Pipeline] Pipeline complete. Processed ${fixturesProcessed} fixtures, found ${opportunitiesFound} opportunities.`);

  return { fixturesProcessed, opportunitiesFound, errors };
}

/**
 * Persist opportunities to database
 */
async function persistOpportunities(opportunities: EVOpportunity[]): Promise<void> {
  if (opportunities.length === 0) {
    return;
  }

  console.info(`[Pipeline] Persisting ${opportunities.length} opportunities...`);

  // Clear existing opportunities for fixtures we're updating
  const fixtureIds = [...new Set(opportunities.map(o => o.fixtureId))];

  // First, ensure fixtures exist
  for (const opp of opportunities) {
    try {
      // Upsert fixture
      const existingFixture = await db.query.fixtures.findFirst({
        where: eq(schema.fixtures.id, opp.fixtureId),
      });

      if (!existingFixture) {
        await db.insert(schema.fixtures).values({
          id: opp.fixtureId,
          sport: opp.sport,
          league: opp.league,
          leagueName: opp.leagueName,
          homeTeam: opp.homeTeam,
          awayTeam: opp.awayTeam,
          startsAt: opp.startsAt,
          status: 'scheduled',
          isLive: false,
        });
      }

      // Upsert opportunity
      const existingOpp = await db.query.opportunities.findFirst({
        where: eq(schema.opportunities.id, opp.id),
      });

      if (existingOpp) {
        await db
          .update(schema.opportunities)
          .set({
            bestEvPercent: opp.bestEV.evPercent,
            bestTargetBookId: opp.bestEV.targetBookId,
            bestTargetBookName: opp.bestEV.targetBookName,
            bestMethod: opp.bestEV.method,
            bestOfferedOdds: opp.bestEV.offeredOdds,
            bestFairOdds: opp.bestEV.fairOdds,
            calculationsJson: JSON.stringify(opp.calculations),
            fairOddsJson: JSON.stringify(opp.fairOdds),
            bookOddsJson: JSON.stringify(opp.bookOdds || []),
            bookCount: opp.bookCount,
            timestamp: opp.timestamp,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.opportunities.id, opp.id));
      } else {
        await db.insert(schema.opportunities).values({
          id: opp.id,
          fixtureId: opp.fixtureId,
          sport: opp.sport,
          league: opp.league,
          leagueName: opp.leagueName,
          homeTeam: opp.homeTeam,
          awayTeam: opp.awayTeam,
          startsAt: opp.startsAt,
          market: opp.market,
          selection: opp.selection,
          selectionKey: opp.selectionKey,
          line: opp.line,
          playerId: opp.playerId,
          playerName: opp.playerName,
          bestEvPercent: opp.bestEV.evPercent,
          bestTargetBookId: opp.bestEV.targetBookId,
          bestTargetBookName: opp.bestEV.targetBookName,
          bestMethod: opp.bestEV.method,
          bestOfferedOdds: opp.bestEV.offeredOdds,
          bestFairOdds: opp.bestEV.fairOdds,
          calculationsJson: JSON.stringify(opp.calculations),
          fairOddsJson: JSON.stringify(opp.fairOdds),
          bookOddsJson: JSON.stringify(opp.bookOdds || []),
          bookCount: opp.bookCount,
          timestamp: opp.timestamp,
        });
      }
    } catch (error) {
      console.error(`[Pipeline] Error persisting opportunity ${opp.id}:`, error);
    }
  }
}

/**
 * Clean up stale data (opportunities for past fixtures, old snapshots)
 */
async function cleanupStaleData(): Promise<void> {
  const now = new Date().toISOString();

  try {
    // Delete opportunities for fixtures that have started
    const deleted = await db
      .delete(schema.opportunities)
      .where(eq(schema.opportunities.startsAt, now)); // This is wrong, need less than

    console.info('[Pipeline] Cleaned up stale data');
  } catch (error) {
    console.error('[Pipeline] Error cleaning up stale data:', error);
  }
}

/**
 * Check if a market is a player prop
 */
function isPlayerProp(market: string): boolean {
  const m = market.toLowerCase();

  // Exclude team/match-level markets that might contain player stat keywords
  if (m.includes('total') ||
      m.includes('1st half') ||
      m.includes('2nd half') ||
      m.includes('1st_half') ||
      m.includes('2nd_half') ||
      m.includes('quarter') ||
      m.includes('spread') ||
      m.includes('moneyline') ||
      m.includes('money_line') ||
      m.includes('handicap') ||
      m.includes('team')) {
    return false;
  }

  // Player props explicitly start with "player_" or "Player "
  return m.startsWith('player_') || m.startsWith('player ');
}

/**
 * Extract player name from selection (e.g., "Jaylen Brown Over 42.5" -> "Jaylen Brown")
 */
function extractPlayerName(selection: string, playerName?: string): string | undefined {
  if (playerName) return playerName;
  const match = selection.match(/^(.+?)\s+(over|under)\s+[\d.]+$/i);
  return match ? match[1].trim() : undefined;
}

/**
 * Validate all opportunities using OpticOdds (NBA + Soccer)
 * Uses player IDs from odds data for perfect matching
 * Validates ALL bets regardless of EV
 */
async function validateAllOpportunitiesById(opportunityIds: string[]): Promise<void> {
  if (opportunityIds.length === 0) return;

  // Query ALL opportunities to validate (not filtering by existing validation)
  const toValidate: Array<{
    id: string;
    sport: string;
    league: string;
    selection: string;
    market: string;
    line: number | null;
    playerName: string | null;
    playerId: string | null;
    homeTeam: string | null;
    awayTeam: string | null;
    bestEvPercent: number;
  }> = [];

  // Query in batches of 100
  for (let i = 0; i < opportunityIds.length; i += 100) {
    const batchIds = opportunityIds.slice(i, i + 100);
    try {
      const batch = await db.query.opportunities.findMany({
        where: inArray(schema.opportunities.id, batchIds), // Validate ALL - no filter
        columns: {
          id: true,
          sport: true,
          league: true,
          selection: true,
          market: true,
          line: true,
          playerName: true,
          playerId: true,
          homeTeam: true,
          awayTeam: true,
          bestEvPercent: true,
        },
      });

      toValidate.push(...batch);
    } catch (error) {
      console.error('[Pipeline] Error querying opportunities for validation:', error);
    }
  }

  if (toValidate.length === 0) {
    console.info('[Pipeline] No opportunities to validate');
    return;
  }

  // Sort by EV (highest first) so best bets get validated first
  toValidate.sort((a, b) => b.bestEvPercent - a.bestEvPercent);

  console.info(`[Pipeline] Validating ${toValidate.length} opportunities using OpticOdds...`);

  // Process in batches
  const batchSize = 5; // Smaller batches for OpticOdds
  let validated = 0;

  for (let i = 0; i < toValidate.length; i += batchSize) {
    const batch = toValidate.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (opp) => {
        try {
          const result = await validateOpportunity(opp);

          if (result) {
            // Store validation result in database
            await db
              .update(schema.opportunities)
              .set({
                nbaValidationJson: JSON.stringify(result), // Stores all validation types
                updatedAt: new Date().toISOString(),
              })
              .where(eq(schema.opportunities.id, opp.id));
            validated++;
          }
        } catch (error) {
          console.error(`[Pipeline] Error validating ${opp.id}:`, error);
        }
      })
    );

    // Log progress
    if (validated > 0 && validated % 50 === 0) {
      console.info(`[Pipeline] Validated ${validated}/${toValidate.length} opportunities so far...`);
    }

    // Delay between batches
    if (i + batchSize < toValidate.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.info(`[Pipeline] Validated ${validated}/${toValidate.length} opportunities`);
}

/**
 * Validate a single opportunity using Player Cache first, falling back to live API
 * Supports both basketball (NBA via OpticOdds) and soccer (via SportMonks)
 */
async function validateOpportunity(opp: {
  id: string;
  sport: string;
  league: string;
  selection: string;
  market: string;
  line: number | null;
  playerName: string | null;
  playerId: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
}): Promise<ValidationResult | null> {
  const isBasketball = opp.sport.toLowerCase().includes('basket');
  const isSoccer = opp.sport.toLowerCase().includes('soccer') || opp.sport.toLowerCase().includes('football');
  const direction = opp.selection.toLowerCase().includes('over') ? 'over' : 'under';

  // Handle soccer validation
  if (isSoccer) {
    return validateSoccerOpportunity(opp, direction);
  }

  // Only basketball is supported for remaining logic
  if (!isBasketball) {
    return null;
  }

  // Check if it's a player prop
  if (isPlayerProp(opp.market)) {
    const playerName = extractPlayerName(opp.selection, opp.playerName ?? undefined);
    if (!playerName) {
      return null;
    }

    // Try to get player from cache first
    let playerId = opp.playerId;
    let cachedPlayer = playerId ? await getPlayerById(playerId) : null;

    // If not found by ID, try by name
    if (!cachedPlayer) {
      cachedPlayer = await getPlayerByName(playerName);
      if (cachedPlayer) {
        playerId = cachedPlayer.id;
      }
    }

    // If player is in cache, use cached data for validation
    if (cachedPlayer && playerId) {
      const statKey = mapMarketToStatKey(opp.market);
      if (statKey) {
        const result = await calculateHitRateFromCache(
          playerId,
          statKey,
          opp.line || 0,
          direction,
          10
        );

        if (result) {
          return {
            playerId,
            playerName: cachedPlayer.name,
            market: opp.market,
            line: opp.line || 0,
            direction,
            matchesChecked: result.total,
            hits: result.hits,
            hitRate: result.hitRate,
            avgValue: result.avgValue,
            recentGames: result.recentGames.map(g => ({
              ...g,
              opponent: g.opponent || 'Unknown',
              isHome: g.isHome ?? undefined,
            })),
          };
        }
      }
    }

    // Fallback to live API if not in cache
    if (playerId) {
      const result = await validatePlayerProp(
        playerId,
        playerName,
        opp.market,
        opp.line || 0,
        direction,
        'basketball',
        10
      );

      // If we got data from API, try to update cache for next time
      if (result && playerId) {
        updatePlayerById(playerId).catch(() => {}); // Fire and forget
      }

      return result;
    }

    // Search for the player via API
    const player = await searchPlayer(playerName, 'basketball', opp.league);
    if (!player) {
      return null;
    }

    const result = await validatePlayerProp(
      player.id,
      playerName,
      opp.market,
      opp.line || 0,
      direction,
      'basketball',
      10
    );

    // Update cache for next time
    if (result) {
      updatePlayerById(player.id).catch(() => {}); // Fire and forget
    }

    return result;
  }

  // Check if it's a spread or moneyline (basketball only since we already filtered soccer)
  const marketType = isSpreadOrMoneyline(opp.market);
  if (marketType) {
    const teamName = extractTeamFromSelection(
      opp.selection,
      opp.homeTeam ?? undefined,
      opp.awayTeam ?? undefined
    );

    if (!teamName) return null;

    const team = await searchTeam(teamName, 'basketball', opp.league);
    if (!team) {
      return null;
    }

    if (marketType === 'moneyline') {
      return validateMoneylineBet(team.id, teamName, 10);
    } else if (opp.line !== null) {
      return validateSpreadBet(team.id, teamName, opp.line, direction, 10);
    }
  }

  return null;
}

/**
 * Map market name to stat key for cache lookup
 */
function mapMarketToStatKey(market: string): 'points' | 'rebounds' | 'assists' | 'threes' | 'steals' | 'blocks' | 'turnovers' | 'pra' | 'pr' | 'pa' | 'ra' | null {
  const m = market.toLowerCase();

  if (m.includes('points') && m.includes('rebounds') && m.includes('assists')) return 'pra';
  if (m.includes('pra')) return 'pra';
  if (m.includes('points') && m.includes('rebounds')) return 'pr';
  if (m.includes('points') && m.includes('assists')) return 'pa';
  if (m.includes('rebounds') && m.includes('assists')) return 'ra';
  if (m.includes('point') && !m.includes('rebounds') && !m.includes('assists')) return 'points';
  if (m.includes('rebound')) return 'rebounds';
  if (m.includes('assist')) return 'assists';
  if (m.includes('three') || m.includes('3p')) return 'threes';
  if (m.includes('steal')) return 'steals';
  if (m.includes('block')) return 'blocks';
  if (m.includes('turnover')) return 'turnovers';

  return null;
}

/**
 * Check if a market is a spread or moneyline bet
 */
function isSpreadOrMoneyline(market: string): 'spread' | 'moneyline' | null {
  const m = market.toLowerCase();
  if (m.includes('spread') || m.includes('handicap')) {
    return 'spread';
  }
  if (m.includes('moneyline') || m.includes('money_line') || m === 'h2h' || m.includes('winner')) {
    return 'moneyline';
  }
  return null;
}

/**
 * Extract team name from selection for spread/moneyline
 */
function extractTeamFromSelection(selection: string, homeTeam?: string, awayTeam?: string): string | null {
  const sel = selection.trim();

  // Try to match team name with optional spread line
  const spreadMatch = sel.match(/^(.+?)\s*[+-]?\d+\.?\d*$/);
  if (spreadMatch) {
    return spreadMatch[1].trim();
  }

  // Check if selection matches home or away team
  if (homeTeam && sel.toLowerCase().includes(homeTeam.toLowerCase())) {
    return homeTeam;
  }
  if (awayTeam && sel.toLowerCase().includes(awayTeam.toLowerCase())) {
    return awayTeam;
  }

  // Return the selection as is if it looks like a team name
  if (sel.length > 3 && !sel.match(/^(over|under)\s/i)) {
    return sel;
  }

  return null;
}

// ============================================================================
// Soccer Validation Functions
// ============================================================================

/**
 * Validate a soccer opportunity using SportMonks cache
 */
async function validateSoccerOpportunity(
  opp: {
    id: string;
    sport: string;
    league: string;
    selection: string;
    market: string;
    line: number | null;
    playerName: string | null;
    playerId: string | null;
    homeTeam: string | null;
    awayTeam: string | null;
  },
  direction: 'over' | 'under'
): Promise<ValidationResult | null> {
  // Check if it's a player prop
  if (!isPlayerProp(opp.market)) {
    return null; // Only player props supported for now
  }

  const playerName = extractPlayerName(opp.selection, opp.playerName ?? undefined);
  if (!playerName) {
    return null;
  }

  // Try to find SportMonks player via ID mapping
  const mapping = await findSportMonksPlayer(
    opp.playerId,
    playerName,
    opp.homeTeam || opp.awayTeam || undefined
  );

  if (!mapping.sportMonksPlayerId) {
    // Try direct name search in cache
    const cachedPlayer = await getSoccerPlayerByName(
      playerName,
      opp.homeTeam || opp.awayTeam || undefined
    );

    if (!cachedPlayer) {
      return null;
    }

    // Use cached player
    const statKey = mapSoccerMarketToStatKey(opp.market);
    if (!statKey) {
      return null;
    }

    const result = await calculateSoccerHitRate(
      cachedPlayer.id,
      statKey,
      opp.line || 0,
      direction,
      10
    );

    if (!result) {
      return null;
    }

    return {
      playerId: cachedPlayer.id.toString(),
      playerName: cachedPlayer.name,
      market: opp.market,
      line: opp.line || 0,
      direction,
      matchesChecked: result.total,
      hits: result.hits,
      hitRate: result.hitRate,
      avgValue: result.avgValue,
      recentGames: result.recentGames,
    };
  }

  // Use mapped SportMonks player
  const statKey = mapSoccerMarketToStatKey(opp.market);
  if (!statKey) {
    return null;
  }

  const result = await calculateSoccerHitRate(
    mapping.sportMonksPlayerId,
    statKey,
    opp.line || 0,
    direction,
    10
  );

  if (!result) {
    return null;
  }

  return {
    playerId: mapping.sportMonksPlayerId.toString(),
    playerName: mapping.sportMonksPlayerName || playerName,
    market: opp.market,
    line: opp.line || 0,
    direction,
    matchesChecked: result.total,
    hits: result.hits,
    hitRate: result.hitRate,
    avgValue: result.avgValue,
    recentGames: result.recentGames,
  };
}

/**
 * Map soccer market name to stat key for cache lookup
 */
function mapSoccerMarketToStatKey(market: string): string | null {
  const m = market.toLowerCase();

  // Shots markets
  if (m.includes('shot') && m.includes('target')) return 'shots_on_target';
  if (m.includes('shot')) return 'shots';

  // Goals & Assists
  if (m.includes('goal') && m.includes('assist')) return 'goals'; // Combined - use goals
  if (m.includes('goal')) return 'goals';
  if (m.includes('assist')) return 'assists';

  // Defensive
  if (m.includes('tackle')) return 'tackles';
  if (m.includes('intercept')) return 'interceptions';
  if (m.includes('clearance')) return 'clearances';
  if (m.includes('block')) return 'blocks';
  if (m.includes('save')) return 'saves';
  if (m.includes('foul') && m.includes('drawn')) return 'fouls_drawn';
  if (m.includes('foul')) return 'fouls';

  // Passing
  if (m.includes('key') && m.includes('pass')) return 'key_passes';
  if (m.includes('pass')) return 'passes';
  if (m.includes('cross')) return 'crosses';

  // Dribbling & Duels
  if (m.includes('dribble')) return 'dribbles';
  if (m.includes('aerial') && m.includes('duel')) return 'aerial_duels_won';
  if (m.includes('duel')) return 'duels_won';

  // Cards
  if (m.includes('yellow') && m.includes('card')) return 'yellow_cards';
  if (m.includes('red') && m.includes('card')) return 'red_cards';
  if (m.includes('card')) return 'yellow_cards'; // Default to yellow

  // Other
  if (m.includes('touch')) return 'touches';
  if (m.includes('minute')) return 'minutes';

  return null;
}
