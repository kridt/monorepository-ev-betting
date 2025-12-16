/**
 * Build a player name → Ball Don't Lie ID mapping
 *
 * Run with: npx tsx scripts/build-player-mapping.ts
 *
 * This creates a JSON file that maps normalized player names to their BDL IDs,
 * eliminating the need for fuzzy search which can return wrong players.
 *
 * Only includes ACTIVE players (those with stats in current season).
 */

import { writeFileSync, existsSync, readFileSync } from 'fs';
import { config } from '../src/config.js';

const API_BASE_URL = config.ballDontLieBaseUrl;
const API_KEY = config.ballDontLieApiKey;

interface BDLPlayer {
  id: number;
  first_name: string;
  last_name: string;
  position: string;
  team: {
    id: number;
    full_name: string;
    abbreviation: string;
  };
}

interface BDLSeasonAverage {
  player_id: number;
  season: number;
  games_played: number;
  pts: number;
  reb: number;
  ast: number;
}

interface PlayerMapping {
  [normalizedName: string]: {
    id: number;
    fullName: string;
    team: string;
  };
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Get current NBA season (2024-25 season = 2024)
function getCurrentSeason(): number {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  // NBA season starts in October, so before October use previous year
  return month < 9 ? year - 1 : year;
}

interface BDLGameStats {
  player: {
    id: number;
    first_name: string;
    last_name: string;
  };
  team: {
    id: number;
    abbreviation: string;
  };
}

/**
 * Fetch active players by getting recent game stats
 * This returns players who have played in games this season
 */
async function fetchActivePlayers(): Promise<Map<number, { firstName: string; lastName: string; team: string }>> {
  const activePlayers = new Map<number, { firstName: string; lastName: string; team: string }>();
  const season = getCurrentSeason();
  let cursor: number | undefined = undefined;
  let page = 1;

  console.log(`Fetching game stats for ${season}-${season + 1} season to find active players...`);

  while (true) {
    const url = new URL(`${API_BASE_URL}/v1/stats`);
    url.searchParams.set('seasons[]', String(season));
    url.searchParams.set('per_page', '100');
    if (cursor) {
      url.searchParams.set('cursor', String(cursor));
    }

    try {
      const response = await fetch(url.toString(), {
        headers: { 'Authorization': API_KEY },
      });

      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '10', 10);
        console.log(`Rate limited, waiting ${retryAfter}s...`);
        await sleep(retryAfter * 1000);
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const data = await response.json();
      const stats = data.data as BDLGameStats[];

      if (!stats || stats.length === 0) {
        break;
      }

      for (const stat of stats) {
        if (stat.player?.id && !activePlayers.has(stat.player.id)) {
          activePlayers.set(stat.player.id, {
            firstName: stat.player.first_name,
            lastName: stat.player.last_name,
            team: stat.team?.abbreviation || '',
          });
        }
      }

      console.log(`Page ${page}: processed ${stats.length} game stats (unique active players: ${activePlayers.size})`);

      cursor = data.meta?.next_cursor;
      if (!cursor) {
        break;
      }

      // Stop after finding ~600 players (should cover all active players)
      if (activePlayers.size >= 600) {
        console.log('Found enough active players, stopping early');
        break;
      }

      page++;
      await sleep(100);
    } catch (error) {
      console.error('Error fetching game stats:', error);
      break;
    }
  }

  return activePlayers;
}

/**
 * Fetch player details by ID
 */
async function fetchPlayerById(playerId: number): Promise<BDLPlayer | null> {
  try {
    const url = new URL(`${API_BASE_URL}/v1/players/${playerId}`);
    const response = await fetch(url.toString(), {
      headers: { 'Authorization': API_KEY },
    });

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('retry-after') || '10', 10);
      await sleep(retryAfter * 1000);
      return fetchPlayerById(playerId); // Retry
    }

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.data as BDLPlayer;
  } catch {
    return null;
  }
}

/**
 * Fetch player details in batches
 */
async function fetchPlayerDetails(playerIds: number[]): Promise<BDLPlayer[]> {
  const players: BDLPlayer[] = [];
  const batchSize = 25;

  console.log(`\nFetching details for ${playerIds.length} active players...`);

  for (let i = 0; i < playerIds.length; i += batchSize) {
    const batch = playerIds.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(id => fetchPlayerById(id))
    );

    for (const player of batchResults) {
      if (player) {
        players.push(player);
      }
    }

    const progress = Math.min(i + batchSize, playerIds.length);
    console.log(`Progress: ${progress}/${playerIds.length} players fetched`);

    if (i + batchSize < playerIds.length) {
      await sleep(500); // Respect rate limits
    }
  }

  return players;
}

function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/['']/g, "'")  // Normalize apostrophes
    .replace(/\s+/g, ' ')   // Normalize spaces
    .replace(/\./g, '')     // Remove periods (J.R. -> JR)
    .replace(/jr$/i, 'jr')  // Normalize Jr
    .replace(/sr$/i, 'sr')  // Normalize Sr
    .replace(/iii$/i, 'iii') // Normalize III
    .replace(/ii$/i, 'ii'); // Normalize II
}

function buildMapping(players: BDLPlayer[]): PlayerMapping {
  const mapping: PlayerMapping = {};

  for (const player of players) {
    const fullName = `${player.first_name} ${player.last_name}`;
    const normalized = normalizePlayerName(fullName);

    // Skip if we already have this name (keep the first one, usually active player)
    if (mapping[normalized]) {
      // Prefer players with teams (active players)
      if (player.team && !mapping[normalized].team) {
        mapping[normalized] = {
          id: player.id,
          fullName,
          team: player.team?.abbreviation || '',
        };
      }
      continue;
    }

    mapping[normalized] = {
      id: player.id,
      fullName,
      team: player.team?.abbreviation || '',
    };

    // Also add common name variations
    const variations = generateNameVariations(player.first_name, player.last_name);
    for (const variation of variations) {
      const normalizedVar = normalizePlayerName(variation);
      if (!mapping[normalizedVar]) {
        mapping[normalizedVar] = {
          id: player.id,
          fullName,
          team: player.team?.abbreviation || '',
        };
      }
    }
  }

  return mapping;
}

function generateNameVariations(firstName: string, lastName: string): string[] {
  const variations: string[] = [];

  // Handle names with Jr., Sr., III, II
  if (lastName.includes(' Jr') || lastName.includes(' Sr') || lastName.includes(' III') || lastName.includes(' II')) {
    // Add version without suffix
    const baseLast = lastName.replace(/\s+(Jr|Sr|III|II)\.?$/i, '').trim();
    variations.push(`${firstName} ${baseLast}`);
  }

  // Handle hyphenated first names (e.g., "Karl-Anthony" -> "Karl Anthony")
  if (firstName.includes('-')) {
    variations.push(`${firstName.replace('-', ' ')} ${lastName}`);
    variations.push(`${firstName.replace('-', '')} ${lastName}`);
  }

  // Handle names with apostrophes (e.g., "De'Aaron" -> "DeAaron", "Dearon")
  if (firstName.includes("'")) {
    variations.push(`${firstName.replace("'", '')} ${lastName}`);
    variations.push(`${firstName.replace("'", '')} ${lastName}`.toLowerCase());
  }

  // Handle two-word last names (e.g., "Jackson Jr." -> match with just "Jackson")
  const lastParts = lastName.split(' ');
  if (lastParts.length > 1) {
    variations.push(`${firstName} ${lastParts[0]}`);
  }

  // Common nickname mappings
  const nicknameMap: Record<string, string[]> = {
    'William': ['Will', 'Bill', 'Billy'],
    'Robert': ['Rob', 'Bob', 'Bobby'],
    'James': ['Jim', 'Jimmy'],
    'Michael': ['Mike', 'Mikey'],
    'Christopher': ['Chris'],
    'Anthony': ['Tony'],
    'Nicholas': ['Nick', 'Nic'],
    'Alexander': ['Alex'],
    'Timothy': ['Tim', 'Timmy'],
    'Joshua': ['Josh'],
    'Matthew': ['Matt'],
    'Daniel': ['Dan', 'Danny'],
    'Patrick': ['Pat'],
    'Cameron': ['Cam'],
    'Benjamin': ['Ben'],
    'Jonathan': ['Jon'],
    'Kenneth': ['Ken', 'Kenny'],
    'Stephen': ['Steve', 'Steph'],
    'Steven': ['Steve', 'Steph'],
  };

  // Add nickname variations
  for (const [fullFirst, nicknames] of Object.entries(nicknameMap)) {
    if (firstName.toLowerCase() === fullFirst.toLowerCase()) {
      for (const nick of nicknames) {
        variations.push(`${nick} ${lastName}`);
      }
    }
    // Also reverse - if we have nickname, add full name
    for (const nick of nicknames) {
      if (firstName.toLowerCase() === nick.toLowerCase()) {
        variations.push(`${fullFirst} ${lastName}`);
      }
    }
  }

  return variations;
}

async function main() {
  if (!API_KEY) {
    console.error('ERROR: BALL_DONT_LIE_API_KEY not set in environment');
    process.exit(1);
  }

  const outputPath = new URL('../src/data/player-mapping.json', import.meta.url).pathname.slice(1); // Remove leading slash on Windows

  // Get active players from game stats (already contains name + team)
  const activePlayersMap = await fetchActivePlayers();
  console.log(`\nFound ${activePlayersMap.size} active players with stats this season`);

  // Convert to BDLPlayer format for buildMapping
  const players: BDLPlayer[] = [];
  for (const [id, data] of activePlayersMap) {
    players.push({
      id,
      first_name: data.firstName,
      last_name: data.lastName,
      position: '',
      team: {
        id: 0,
        full_name: data.team,
        abbreviation: data.team,
      },
    });
  }

  // Build mapping
  const mapping = buildMapping(players);
  const mappingCount = Object.keys(mapping).length;
  console.log(`\nBuilt mapping with ${mappingCount} name variations for ${players.length} active players`);

  // Create data directory if it doesn't exist
  const dataDir = outputPath.replace(/[/\\][^/\\]+$/, '');
  if (!existsSync(dataDir)) {
    const { mkdirSync } = await import('fs');
    mkdirSync(dataDir, { recursive: true });
  }

  // Write mapping to file
  writeFileSync(outputPath, JSON.stringify(mapping, null, 2));
  console.log(`\nSaved mapping to: ${outputPath}`);

  // Print some stats
  const teamCounts = new Map<string, number>();
  const uniquePlayerIds = new Set<number>();
  for (const entry of Object.values(mapping)) {
    uniquePlayerIds.add(entry.id);
    const team = entry.team || 'No Team';
    if (!teamCounts.has(team)) {
      teamCounts.set(team, 0);
    }
  }

  // Count unique players per team
  for (const player of players) {
    const team = player.team?.abbreviation || 'No Team';
    teamCounts.set(team, (teamCounts.get(team) || 0) + 1);
  }

  console.log(`\nUnique players: ${uniquePlayerIds.size}`);
  console.log('\nPlayers per team (active only):');
  const sortedTeams = [...teamCounts.entries()]
    .filter(([team]) => team && team !== 'No Team')
    .sort((a, b) => b[1] - a[1]);
  for (const [team, count] of sortedTeams) {
    console.log(`  ${team}: ${count}`);
  }
}

main().catch(console.error);
