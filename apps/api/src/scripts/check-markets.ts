import { db, schema, initDatabase } from '../db/index.js';
import { sql } from 'drizzle-orm';

await initDatabase();

const result = await db.all(sql`SELECT DISTINCT market, sport, COUNT(*) as cnt FROM opportunities GROUP BY market, sport ORDER BY sport, cnt DESC`);
console.log('Market types in database:');

let currentSport = '';
for (const row of result as Array<{ sport: string; market: string; cnt: number }>) {
  if (row.sport !== currentSport) {
    currentSport = row.sport;
    console.log(`\n${currentSport.toUpperCase()}:`);
  }
  console.log(`  ${row.market} (${row.cnt})`);
}
