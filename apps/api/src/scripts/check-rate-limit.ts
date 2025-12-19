import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

const API_KEY = process.env.SPORTMONKS_API_KEY;

async function check() {
  const res = await fetch(`https://api.sportmonks.com/v3/football/leagues/8?api_token=${API_KEY}`);
  const data = await res.json();

  console.log('SportMonks API Rate Limit Status');
  console.log('═'.repeat(40));

  if (data.rate_limit) {
    const limit = 3000;
    const remaining = data.rate_limit.remaining;
    const used = limit - remaining;
    const resetMins = Math.round(data.rate_limit.resets_in_seconds / 60);

    console.log(`  Requests used:     ${used} / ${limit}`);
    console.log(`  Remaining:         ${remaining}`);
    console.log(`  Resets in:         ${resetMins} minutes`);
    console.log(`  Usage:             ${(used / limit * 100).toFixed(1)}%`);
    console.log('═'.repeat(40));
  }
}

check();
