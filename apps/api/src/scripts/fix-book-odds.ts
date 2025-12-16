/**
 * Migration script to fix NULL/empty bookOddsJson values in the database
 * and clean up stale opportunities
 *
 * Run with: npx tsx src/scripts/fix-book-odds.ts
 */

import { db, schema } from '../db/index.js';
import { isNull, sql, eq, lt, or } from 'drizzle-orm';
import { runPipeline } from '../scheduler/pipeline.js';

async function fixBookOdds() {
  console.log('🔧 Cleaning up and fixing bookOddsJson...\n');

  try {
    // Step 1: Delete opportunities with empty bookOddsJson (can't be displayed properly)
    const emptyCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.opportunities)
      .where(or(
        isNull(schema.opportunities.bookOddsJson),
        eq(schema.opportunities.bookOddsJson, '[]')
      ));

    console.log(`Found ${emptyCount[0]?.count ?? 0} opportunities with NULL/empty bookOddsJson`);

    // Step 2: Delete opportunities for past fixtures
    const now = new Date().toISOString();
    const pastCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.opportunities)
      .where(lt(schema.opportunities.startsAt, now));

    console.log(`Found ${pastCount[0]?.count ?? 0} opportunities for past fixtures`);

    // Delete past fixtures
    if (pastCount[0]?.count && pastCount[0].count > 0) {
      await db
        .delete(schema.opportunities)
        .where(lt(schema.opportunities.startsAt, now));
      console.log(`✅ Deleted ${pastCount[0].count} opportunities for past fixtures`);
    }

    // Delete opportunities with empty bookOddsJson
    if (emptyCount[0]?.count && emptyCount[0].count > 0) {
      const deleteResult = await db
        .delete(schema.opportunities)
        .where(or(
          isNull(schema.opportunities.bookOddsJson),
          eq(schema.opportunities.bookOddsJson, '[]')
        ));
      console.log(`✅ Deleted opportunities with empty bookOddsJson`);
    }

    // Step 3: Run pipeline to recreate all opportunities with proper bookOdds
    console.log('\n🔄 Running pipeline to refresh all opportunities with bookOdds data...\n');

    const result = await runPipeline();

    console.log('\n✅ Pipeline complete!');
    console.log(`   Fixtures processed: ${result.fixturesProcessed}`);
    console.log(`   Opportunities found: ${result.opportunitiesFound}`);
    if (result.errors.length > 0) {
      console.log(`   Errors: ${result.errors.length}`);
      result.errors.forEach(e => console.log(`     - ${e}`));
    }

    // Step 4: Final check
    const finalEmpty = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.opportunities)
      .where(or(
        isNull(schema.opportunities.bookOddsJson),
        eq(schema.opportunities.bookOddsJson, '[]')
      ));

    const finalTotal = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.opportunities);

    console.log('\n📊 Final status:');
    console.log(`   Total opportunities: ${finalTotal[0]?.count ?? 0}`);
    console.log(`   Without bookOdds: ${finalEmpty[0]?.count ?? 0}`);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }

  process.exit(0);
}

fixBookOdds();
