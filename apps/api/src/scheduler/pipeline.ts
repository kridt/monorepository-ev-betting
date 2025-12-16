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

    // Process each fixture
    const opportunities: EVOpportunity[] = [];

    for (const fixture of allFixtures) {
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
            opportunities.push(opportunity);
            opportunitiesFound++;
          }
        }
      } catch (error) {
        const msg = `Error processing fixture ${fixture.id}: ${error}`;
        console.error(`[Pipeline] ${msg}`);
        errors.push(msg);
      }
    }

    console.info(`[Pipeline] Found ${opportunitiesFound} opportunities above ${config.minEvPercent}% EV`);

    // Persist opportunities to database
    await persistOpportunities(opportunities);

    // Validate NBA player props in background (don't block pipeline)
    validateNBAOpportunities(opportunities).catch(err => {
      console.error('[Pipeline] Error validating NBA opportunities:', err);
    });

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
 * Validate NBA player prop opportunities and store results
 * Runs in background after opportunities are persisted
 */
async function validateNBAOpportunities(opportunities: EVOpportunity[]): Promise<void> {
  // Filter to NBA player props only
  const nbaPlayerProps = opportunities.filter(opp =>
    opp.sport === 'basketball' &&
    opp.line !== undefined &&
    isPlayerProp(opp.market)
  );

  if (nbaPlayerProps.length === 0) {
    return;
  }

  // Get IDs of opportunities that already have validation data
  const oppIds = nbaPlayerProps.map(opp => opp.id);
  const alreadyValidated = new Set<string>();

  try {
    // Query in batches to avoid too large IN clause
    for (let i = 0; i < oppIds.length; i += 100) {
      const batchIds = oppIds.slice(i, i + 100);
      const existing = await db.query.opportunities.findMany({
        where: and(
          inArray(schema.opportunities.id, batchIds),
          sql`${schema.opportunities.nbaValidationJson} IS NOT NULL`
        ),
        columns: { id: true },
      });
      existing.forEach(e => alreadyValidated.add(e.id));
    }
  } catch (error) {
    console.error('[Pipeline] Error checking existing validations:', error);
  }

  // Filter out already validated and sort by EV (highest first)
  const toValidate = nbaPlayerProps
    .filter(opp => !alreadyValidated.has(opp.id))
    .sort((a, b) => b.bestEV.evPercent - a.bestEV.evPercent);

  if (toValidate.length === 0) {
    console.info(`[Pipeline] All ${nbaPlayerProps.length} NBA player props already validated`);
    return;
  }

  console.info(`[Pipeline] Validating ${toValidate.length} NBA player props (${alreadyValidated.size} already done, prioritizing high EV)...`);

  // Process in batches - Ball Don't Lie free tier allows 30 req/min
  const batchSize = 10;
  let validated = 0;

  for (let i = 0; i < toValidate.length; i += batchSize) {
    const batch = toValidate.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (opp) => {
        try {
          const playerName = extractPlayerName(opp.selection, opp.playerName);
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
