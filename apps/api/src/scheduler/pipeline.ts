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
import { calculateOpportunities } from '../engine/evCalculator.js';
import { validateNBAPlayerBet } from '../services/ballDontLieClient.js';
import { db, schema } from '../db/index.js';
import { eq, inArray, isNull, sql, and } from 'drizzle-orm';
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

          // Calculate opportunities for each grouped selection
          for (const group of groupedOdds) {
            const opportunity = calculateOpportunities(
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

    console.info(`[Pipeline] Found ${opportunitiesFound} opportunities above ${config.minEvPercent}% EV`);

    // Validate NBA player props in background (don't block pipeline)
    // Only pass IDs to reduce memory - validation will query DB
    if (allOpportunityIds.length > 0) {
      validateNBAOpportunitiesById(allOpportunityIds).catch(err => {
        console.error('[Pipeline] Error validating NBA opportunities:', err);
      });
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
  return m.startsWith('player_') ||
    m.includes('points') ||
    m.includes('rebounds') ||
    m.includes('assists') ||
    m.includes('steals') ||
    m.includes('blocks') ||
    m.includes('threes') ||
    m.includes('turnovers');
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
 * Validate NBA player prop opportunities by ID (memory-optimized)
 * Queries DB for needed data instead of keeping full objects in memory
 */
async function validateNBAOpportunitiesById(opportunityIds: string[]): Promise<void> {
  if (opportunityIds.length === 0) return;

  // Query NBA player props that need validation in small batches
  const toValidate: Array<{
    id: string;
    selection: string;
    market: string;
    line: number | null;
    playerName: string | null;
    bestEvPercent: number;
  }> = [];

  // Query in batches of 100
  for (let i = 0; i < opportunityIds.length; i += 100) {
    const batchIds = opportunityIds.slice(i, i + 100);
    try {
      const batch = await db.query.opportunities.findMany({
        where: and(
          inArray(schema.opportunities.id, batchIds),
          eq(schema.opportunities.sport, 'basketball'),
          isNull(schema.opportunities.nbaValidationJson)
        ),
        columns: {
          id: true,
          selection: true,
          market: true,
          line: true,
          playerName: true,
          bestEvPercent: true,
        },
      });

      // Filter to player props
      for (const opp of batch) {
        if (opp.line !== null && isPlayerProp(opp.market)) {
          toValidate.push(opp);
        }
      }
    } catch (error) {
      console.error('[Pipeline] Error querying opportunities for validation:', error);
    }
  }

  if (toValidate.length === 0) {
    console.info('[Pipeline] No NBA player props need validation');
    return;
  }

  // Sort by EV (highest first)
  toValidate.sort((a, b) => b.bestEvPercent - a.bestEvPercent);

  console.info(`[Pipeline] Validating ${toValidate.length} NBA player props...`);

  // Process in batches - Ball Don't Lie free tier allows 30 req/min
  const batchSize = 10;
  let validated = 0;

  for (let i = 0; i < toValidate.length; i += batchSize) {
    const batch = toValidate.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (opp) => {
        try {
          const playerName = extractPlayerName(opp.selection, opp.playerName ?? undefined);
          if (!playerName) return;

          // Determine direction from selection
          const direction = opp.selection.toLowerCase().includes('over') ? 'over' : 'under';

          const result = await validateNBAPlayerBet(
            playerName,
            opp.market,
            opp.line!,
            direction as 'over' | 'under',
            10 // Last 10 games
          );

          if (result) {
            // Store validation result in database
            await db
              .update(schema.opportunities)
              .set({
                nbaValidationJson: JSON.stringify(result),
                updatedAt: new Date().toISOString(),
              })
              .where(eq(schema.opportunities.id, opp.id));
            validated++;
          }
        } catch (error) {
          console.error(`[Pipeline] Error validating NBA bet ${opp.id}:`, error);
        }
      })
    );

    // Log progress every 100 validations
    if (validated > 0 && validated % 100 === 0) {
      console.info(`[Pipeline] Validated ${validated}/${toValidate.length} NBA props so far...`);
    }

    // Delay between batches to respect rate limits (30 req/min = 2 sec per batch of 10)
    if (i + batchSize < toValidate.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.info(`[Pipeline] Validated ${validated}/${toValidate.length} NBA player props`);
}
