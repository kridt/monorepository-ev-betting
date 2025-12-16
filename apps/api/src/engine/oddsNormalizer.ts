import type { NormalizedOdds, OddsEntry, GroupedOdds } from '@ev-bets/shared';
import { config } from '../config.js';

/**
 * Convert American odds to decimal odds
 */
export function americanToDecimal(american: number): number {
  if (american > 0) {
    return american / 100 + 1;
  } else {
    return 100 / Math.abs(american) + 1;
  }
}

/**
 * Convert decimal odds to implied probability
 */
export function decimalToImpliedProb(decimal: number): number {
  return 1 / decimal;
}

/**
 * Convert implied probability to decimal odds
 */
export function impliedProbToDecimal(prob: number): number {
  return 1 / prob;
}

/**
 * Convert probability to logit space
 * logit(p) = ln(p / (1-p))
 */
export function probToLogit(prob: number): number {
  // Clamp to avoid log(0) or log(infinity)
  const clampedProb = Math.max(0.001, Math.min(0.999, prob));
  return Math.log(clampedProb / (1 - clampedProb));
}

/**
 * Convert logit back to probability
 * p = 1 / (1 + e^(-logit))
 */
export function logitToProb(logit: number): number {
  return 1 / (1 + Math.exp(-logit));
}

/**
 * Generate a unique selection key for grouping odds
 */
export function generateSelectionKey(
  fixtureId: string,
  market: string,
  selection: string,
  line?: number,
  playerId?: string
): string {
  const parts = [fixtureId, market, selection];
  if (line !== undefined) {
    parts.push(line.toString());
  }
  if (playerId) {
    parts.push(playerId);
  }
  return parts.join('||');
}

// Maximum decimal odds to consider (filter out extreme longshots)
const MAX_DECIMAL_ODDS = 10;

/**
 * Normalize a single odds entry
 * Returns null if odds should be filtered out
 */
export function normalizeOddsEntry(
  entry: OddsEntry,
  fixtureId: string,
  sportsbookId: string,
  sportsbookName: string
): NormalizedOdds | null {
  // Price is American odds, convert to decimal
  let decimalOdds = americanToDecimal(entry.price);

  // Ensure decimal odds are reasonable
  if (decimalOdds < 1.01) {
    decimalOdds = 1.01;
  }

  // Filter out extreme odds (over 10.0 decimal / +900 American)
  if (decimalOdds > MAX_DECIMAL_ODDS) {
    return null;
  }

  const impliedProbability = decimalToImpliedProb(decimalOdds);

  // Handle null values from API
  const line = entry.points ?? undefined;
  const playerId = entry.player_id ?? undefined;
  const playerName = entry.player_name ?? undefined;

  const selectionKey = generateSelectionKey(
    fixtureId,
    entry.market,
    entry.name,
    line,
    playerId
  );

  // Handle timestamp - can be number (unix) or string (ISO)
  let timestamp: Date;
  if (typeof entry.timestamp === 'number') {
    // Unix timestamp (seconds since epoch)
    timestamp = new Date(entry.timestamp * 1000);
  } else if (entry.timestamp) {
    timestamp = new Date(entry.timestamp);
  } else {
    timestamp = new Date();
  }

  return {
    fixtureId,
    market: entry.market,
    selection: entry.name,
    selectionKey,
    line,
    playerId,
    playerName,
    decimalOdds,
    impliedProbability,
    sportsbookId,
    sportsbookName,
    timestamp,
  };
}

/**
 * Group normalized odds by selection key
 */
export function groupOddsBySelection(
  allOdds: NormalizedOdds[],
  targetBookIds: string[],
  sharpBookId: string
): GroupedOdds[] {
  const groups = new Map<string, GroupedOdds>();

  for (const odds of allOdds) {
    let group = groups.get(odds.selectionKey);

    if (!group) {
      group = {
        fixtureId: odds.fixtureId,
        market: odds.market,
        selection: odds.selection,
        selectionKey: odds.selectionKey,
        line: odds.line,
        playerId: odds.playerId,
        playerName: odds.playerName,
        odds: [],
      };
      groups.set(odds.selectionKey, group);
    }

    group.odds.push({
      sportsbookId: odds.sportsbookId,
      sportsbookName: odds.sportsbookName,
      decimalOdds: odds.decimalOdds,
      impliedProbability: odds.impliedProbability,
      isTarget: targetBookIds.includes(odds.sportsbookId),
      isSharp: odds.sportsbookId === sharpBookId,
      isOutlier: false, // Will be set during fair odds calculation
      timestamp: odds.timestamp,
    });
  }

  return Array.from(groups.values());
}

/**
 * De-vig two-sided market (Over/Under or Yes/No)
 * Returns the fair probability for the first selection
 */
export function devigTwoSided(prob1: number, prob2: number): { fairProb1: number; fairProb2: number } {
  const totalImplied = prob1 + prob2;

  if (totalImplied <= 1) {
    // No vig or underround - shouldn't happen but handle it
    return { fairProb1: prob1, fairProb2: prob2 };
  }

  // Remove vig proportionally
  const fairProb1 = prob1 / totalImplied;
  const fairProb2 = prob2 / totalImplied;

  return { fairProb1, fairProb2 };
}

/**
 * Calculate the overround (total implied probability) for a set of odds
 */
export function calculateOverround(impliedProbs: number[]): number {
  return impliedProbs.reduce((sum, prob) => sum + prob, 0);
}

/**
 * Normalize multi-way market by dividing each implied prob by the overround
 */
export function normalizeMultiWay(impliedProbs: number[]): number[] {
  const overround = calculateOverround(impliedProbs);
  if (overround <= 1) {
    return impliedProbs;
  }
  return impliedProbs.map(prob => prob / overround);
}
