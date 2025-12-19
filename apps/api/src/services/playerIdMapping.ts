/**
 * Player ID Mapping Service
 *
 * Maps player IDs between OpticOdds and SportMonks.
 * Uses name + team matching with confidence scoring.
 */

import { db, schema } from '../db/index.js';
import { eq, and, or, like, sql } from 'drizzle-orm';
import {
  normalizePlayerName,
  normalizeTeamName,
  playerNamesMatch,
  teamNamesMatch,
} from './sportMonksClient.js';

// ============================================================================
// Types
// ============================================================================

interface MappingResult {
  sportMonksPlayerId: number | null;
  sportMonksPlayerName: string | null;
  confidence: number;
  source: 'cache' | 'search' | 'none';
}

interface CreateMappingParams {
  opticOddsPlayerId: string;
  opticOddsPlayerName: string;
  sportMonksPlayerId: number;
  sportMonksPlayerName: string;
  teamName?: string;
  sport: 'soccer' | 'basketball';
  confidence?: number;
}

// ============================================================================
// Utility Functions
// ============================================================================

function log(message: string, data?: Record<string, unknown>) {
  console.info(`[PlayerMapping] ${message}`, data ? JSON.stringify(data) : '');
}

/**
 * Calculate match confidence between two names
 * Returns 0-1 score
 */
function calculateNameConfidence(name1: string, name2: string): number {
  const n1 = normalizePlayerName(name1);
  const n2 = normalizePlayerName(name2);

  // Exact match
  if (n1 === n2) return 1.0;

  // Check via alias matching
  if (playerNamesMatch(name1, name2)) return 0.9;

  // Partial match - last name
  const parts1 = n1.split(' ');
  const parts2 = n2.split(' ');
  const lastName1 = parts1[parts1.length - 1];
  const lastName2 = parts2[parts2.length - 1];

  if (lastName1 === lastName2 && lastName1.length > 2) {
    // First initial match
    if (parts1[0]?.[0] === parts2[0]?.[0]) return 0.8;
    return 0.6;
  }

  // Contains match
  if (n1.includes(n2) || n2.includes(n1)) return 0.5;

  return 0;
}

// ============================================================================
// Mapping Functions
// ============================================================================

/**
 * Get existing mapping from cache
 */
export async function getExistingMapping(
  opticOddsPlayerId: string
): Promise<typeof schema.playerIdMapping.$inferSelect | null> {
  const mapping = await db.query.playerIdMapping.findFirst({
    where: eq(schema.playerIdMapping.opticOddsPlayerId, opticOddsPlayerId),
  });

  return mapping || null;
}

/**
 * Get mapping by name and team
 */
export async function getMappingByName(
  playerName: string,
  teamName?: string
): Promise<typeof schema.playerIdMapping.$inferSelect | null> {
  // First try with team name
  if (teamName) {
    const normalizedTeam = normalizeTeamName(teamName);

    // Search with team
    const mappings = await db.query.playerIdMapping.findMany({
      where: and(
        eq(schema.playerIdMapping.sport, 'soccer'),
        sql`lower(${schema.playerIdMapping.teamName}) LIKE ${`%${normalizedTeam.split(' ')[0]}%`}`
      ),
    });

    for (const mapping of mappings) {
      if (
        mapping.opticOddsPlayerName &&
        playerNamesMatch(playerName, mapping.opticOddsPlayerName)
      ) {
        return mapping;
      }
      if (
        mapping.sportMonksPlayerName &&
        playerNamesMatch(playerName, mapping.sportMonksPlayerName)
      ) {
        return mapping;
      }
    }
  }

  // Try without team
  const allMappings = await db.query.playerIdMapping.findMany({
    where: eq(schema.playerIdMapping.sport, 'soccer'),
  });

  for (const mapping of allMappings) {
    if (
      mapping.opticOddsPlayerName &&
      playerNamesMatch(playerName, mapping.opticOddsPlayerName)
    ) {
      return mapping;
    }
  }

  return null;
}

/**
 * Find SportMonks player ID for an OpticOdds player
 * Searches the soccer player cache by name/team
 */
export async function findSportMonksPlayer(
  opticOddsPlayerId: string | null,
  playerName: string,
  teamName?: string
): Promise<MappingResult> {
  // Check existing mapping first
  if (opticOddsPlayerId) {
    const existing = await getExistingMapping(opticOddsPlayerId);
    if (existing && existing.sportMonksPlayerId) {
      return {
        sportMonksPlayerId: existing.sportMonksPlayerId,
        sportMonksPlayerName: existing.sportMonksPlayerName,
        confidence: existing.confidence || 1.0,
        source: 'cache',
      };
    }
  }

  // Check mapping by name
  const nameMapping = await getMappingByName(playerName, teamName);
  if (nameMapping && nameMapping.sportMonksPlayerId) {
    return {
      sportMonksPlayerId: nameMapping.sportMonksPlayerId,
      sportMonksPlayerName: nameMapping.sportMonksPlayerName,
      confidence: nameMapping.confidence || 0.8,
      source: 'cache',
    };
  }

  // Search in soccer player cache
  const normalizedName = normalizePlayerName(playerName);

  // Build search query
  let query = db.query.soccerPlayers.findMany({
    where: teamName
      ? sql`lower(${schema.soccerPlayers.teamName}) LIKE ${`%${normalizeTeamName(teamName).split(' ')[0]}%`}`
      : undefined,
  });

  const players = await query;

  // Score each player
  let bestMatch: { player: typeof players[0]; confidence: number } | null = null;

  for (const player of players) {
    let confidence = 0;

    // Name matching
    const nameScore = Math.max(
      calculateNameConfidence(playerName, player.name),
      player.displayName ? calculateNameConfidence(playerName, player.displayName) : 0,
      player.commonName ? calculateNameConfidence(playerName, player.commonName) : 0
    );

    if (nameScore === 0) continue;

    confidence = nameScore;

    // Team matching bonus
    if (teamName && player.teamName) {
      if (teamNamesMatch(teamName, player.teamName)) {
        confidence = Math.min(1.0, confidence + 0.1);
      }
    }

    if (!bestMatch || confidence > bestMatch.confidence) {
      bestMatch = { player, confidence };
    }
  }

  if (bestMatch && bestMatch.confidence >= 0.5) {
    // Create mapping for future use
    if (opticOddsPlayerId) {
      await createMapping({
        opticOddsPlayerId,
        opticOddsPlayerName: playerName,
        sportMonksPlayerId: bestMatch.player.id,
        sportMonksPlayerName: bestMatch.player.name,
        teamName: teamName || bestMatch.player.teamName || undefined,
        sport: 'soccer',
        confidence: bestMatch.confidence,
      });
    }

    return {
      sportMonksPlayerId: bestMatch.player.id,
      sportMonksPlayerName: bestMatch.player.name,
      confidence: bestMatch.confidence,
      source: 'search',
    };
  }

  return {
    sportMonksPlayerId: null,
    sportMonksPlayerName: null,
    confidence: 0,
    source: 'none',
  };
}

/**
 * Create or update a player ID mapping
 */
export async function createMapping(params: CreateMappingParams): Promise<void> {
  const {
    opticOddsPlayerId,
    opticOddsPlayerName,
    sportMonksPlayerId,
    sportMonksPlayerName,
    teamName,
    sport,
    confidence = 1.0,
  } = params;

  // Check if mapping exists
  const existing = await db.query.playerIdMapping.findFirst({
    where: and(
      eq(schema.playerIdMapping.opticOddsPlayerId, opticOddsPlayerId),
      eq(schema.playerIdMapping.sportMonksPlayerId, sportMonksPlayerId)
    ),
  });

  if (existing) {
    // Update existing
    await db.update(schema.playerIdMapping)
      .set({
        opticOddsPlayerName,
        sportMonksPlayerName,
        teamName,
        confidence,
        lastUpdated: new Date().toISOString(),
      })
      .where(eq(schema.playerIdMapping.id, existing.id));
  } else {
    // Create new
    await db.insert(schema.playerIdMapping).values({
      opticOddsPlayerId,
      opticOddsPlayerName,
      sportMonksPlayerId,
      sportMonksPlayerName,
      teamName,
      sport,
      confidence,
      lastUpdated: new Date().toISOString(),
    });

    log('Created new mapping', {
      opticOddsPlayerId,
      sportMonksPlayerId,
      playerName: opticOddsPlayerName,
      confidence,
    });
  }
}

/**
 * Batch create mappings from OpticOdds fixtures
 * This can be called when processing soccer fixtures to pre-populate mappings
 */
export async function batchCreateMappings(
  players: Array<{
    opticOddsPlayerId: string;
    playerName: string;
    teamName?: string;
  }>
): Promise<{ created: number; skipped: number; failed: number }> {
  const result = { created: 0, skipped: 0, failed: 0 };

  for (const player of players) {
    try {
      // Check if mapping exists
      if (player.opticOddsPlayerId) {
        const existing = await getExistingMapping(player.opticOddsPlayerId);
        if (existing) {
          result.skipped++;
          continue;
        }
      }

      // Try to find SportMonks player
      const mapping = await findSportMonksPlayer(
        player.opticOddsPlayerId,
        player.playerName,
        player.teamName
      );

      if (mapping.sportMonksPlayerId) {
        result.created++;
      } else {
        result.failed++;
      }
    } catch (error) {
      log('Error creating mapping', { player, error: (error as Error).message });
      result.failed++;
    }
  }

  log('Batch mapping complete', result);
  return result;
}

/**
 * Get mapping statistics
 */
export async function getMappingStats() {
  const total = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.playerIdMapping)
    .where(eq(schema.playerIdMapping.sport, 'soccer'));

  const highConfidence = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.playerIdMapping)
    .where(and(
      eq(schema.playerIdMapping.sport, 'soccer'),
      sql`${schema.playerIdMapping.confidence} >= 0.8`
    ));

  const verified = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.playerIdMapping)
    .where(and(
      eq(schema.playerIdMapping.sport, 'soccer'),
      eq(schema.playerIdMapping.verified, true)
    ));

  return {
    totalMappings: total[0]?.count ?? 0,
    highConfidenceMappings: highConfidence[0]?.count ?? 0,
    verifiedMappings: verified[0]?.count ?? 0,
  };
}

/**
 * Delete all mappings (for testing/reset)
 */
export async function clearMappings(sport?: 'soccer' | 'basketball'): Promise<number> {
  const result = await db.delete(schema.playerIdMapping)
    .where(sport ? eq(schema.playerIdMapping.sport, sport) : undefined);

  return result.rowsAffected || 0;
}
