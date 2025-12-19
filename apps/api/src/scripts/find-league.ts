import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

const API_KEY = process.env.SPORTMONKS_API_KEY;

async function find() {
  const search = process.argv[2]?.toLowerCase() || '';

  const res = await fetch(`https://api.sportmonks.com/v3/football/leagues?api_token=${API_KEY}&per_page=150&include=country`);
  const data = await res.json();

  if (search) {
    console.log(`Searching for "${search}"...\n`);
    const matches = data.data?.filter((l: any) =>
      l.name.toLowerCase().includes(search) ||
      l.country?.name?.toLowerCase().includes(search)
    ) || [];

    matches.forEach((l: any) => {
      console.log(`  ID: ${l.id} - ${l.name} (${l.country?.name || '?'})`);
    });
  } else {
    console.log('Top leagues by category:\n');
    const sorted = data.data?.sort((a: any, b: any) => (a.category || 99) - (b.category || 99)) || [];
    sorted.slice(0, 20).forEach((l: any) => {
      console.log(`  ID: ${l.id} - ${l.name} (${l.country?.name || '?'})`);
    });
  }
}

find();
