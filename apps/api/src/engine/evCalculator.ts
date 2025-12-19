import type {
  EVCalculation,
  EVOpportunity,
  GroupedOdds,
  FairOddsMethod,
  FairOddsResult,
  BookOdds,
} from '@ev-bets/shared';
import { FAIR_ODDS_METHODS } from '@ev-bets/shared';
import { calculateAllFairOdds } from './fairOdds.js';
import { impliedProbToDecimal } from './oddsNormalizer.js';
import { config } from '../config.js';
import { createHash } from 'crypto';

/**
 * Calculate EV percentage
 *
 * EV% = (fairProb * offeredDecimalOdds - 1) * 100
 *
 * Where:
 * - fairProb is our estimate of the true probability
 * - offeredDecimalOdds is what the sportsbook is offering
 *
 * A positive EV% means the bet has positive expected value
 */
export function calculateEV(fairProbability: number, offeredDecimalOdds: number): number {
  if (fairProbability <= 0 || fairProbability >= 1) {
    return 0;
  }
  return (fairProbability * offeredDecimalOdds - 1) * 100;
}

/**
 * Calculate EV for all target sportsbooks using a specific fair odds result
 */
export function calculateEVForTargets(
  groupedOdds: GroupedOdds,
  fairOddsResult: FairOddsResult,
  targetBookIds: string[]
): EVCalculation[] {
  if (fairOddsResult.fairProbability <= 0) {
    return [];
  }

  const calculations: EVCalculation[] = [];

  for (const odds of groupedOdds.odds) {
    if (!targetBookIds.includes(odds.sportsbookId)) {
      continue;
    }

    const evPercent = calculateEV(fairOddsResult.fairProbability, odds.decimalOdds);

    // Only include if EV is reasonable (not obviously wrong)
    if (evPercent > -50 && evPercent < 200) {
      calculations.push({
        targetBookId: odds.sportsbookId,
        targetBookName: odds.sportsbookName,
        offeredDecimalOdds: odds.decimalOdds,
        offeredImpliedProbability: odds.impliedProbability,
        fairProbability: fairOddsResult.fairProbability,
        fairDecimalOdds: fairOddsResult.fairDecimalOdds,
        evPercent,
        method: fairOddsResult.method,
      });
    }
  }

  return calculations;
}

/**
 * Generate a unique ID for an opportunity
 */
function generateOpportunityId(groupedOdds: GroupedOdds, targetBookId: string): string {
  const data = `${groupedOdds.selectionKey}||${targetBookId}`;
  return createHash('sha256').update(data).digest('hex').substring(0, 16);
}

/**
 * Calculate all EV opportunities for a grouped odds selection
 */
export function calculateOpportunities(
  groupedOdds: GroupedOdds,
  fixtureData: {
    sport: string;
    league: string;
    leagueName?: string;
    homeTeam?: string;
    awayTeam?: string;
    startsAt: string;
  },
  targetBookIds: string[]
): EVOpportunity | null {
  // Calculate fair odds using all methods
  const allFairOdds = calculateAllFairOdds(groupedOdds);

  // Check if we have any valid fair odds
  const hasValidFairOdds = Object.values(allFairOdds).some(
    result => result.fairProbability > 0 && !result.isFallback
  );

  if (!hasValidFairOdds) {
    return null;
  }

  // Calculate EV for each method/target combination
  const calculationsByMethod: Record<FairOddsMethod, EVCalculation[]> = {} as Record<
    FairOddsMethod,
    EVCalculation[]
  >;

  let bestEV: EVOpportunity['bestEV'] | null = null;

  for (const method of FAIR_ODDS_METHODS) {
    const fairOddsResult = allFairOdds[method];
    const calculations = calculateEVForTargets(groupedOdds, fairOddsResult, targetBookIds);
    calculationsByMethod[method] = calculations;

    // Find best EV
    for (const calc of calculations) {
      if (calc.evPercent >= config.minEvPercent) {
        if (!bestEV || calc.evPercent > bestEV.evPercent) {
          bestEV = {
            evPercent: calc.evPercent,
            targetBookId: calc.targetBookId,
            targetBookName: calc.targetBookName,
            method: calc.method,
            offeredOdds: calc.offeredDecimalOdds,
            fairOdds: calc.fairDecimalOdds,
          };
        }
      }
    }
  }

  // Only return opportunity if we found EV above threshold
  if (!bestEV) {
    return null;
  }

  const opportunityId = generateOpportunityId(groupedOdds, bestEV.targetBookId);

  // Extract book odds for inline display (sorted: target books first, then by odds desc)
  const bookOdds: BookOdds[] = groupedOdds.odds
    .map(o => ({
      sportsbookId: o.sportsbookId,
      sportsbookName: o.sportsbookName,
      decimalOdds: o.decimalOdds,
      impliedProbability: o.impliedProbability,
      isTarget: o.isTarget,
      isSharp: o.isSharp,
      isOutlier: o.isOutlier,
    }))
    .sort((a, b) => {
      // Target books first
      if (a.isTarget && !b.isTarget) return -1;
      if (!a.isTarget && b.isTarget) return 1;
      // Then by odds descending (higher odds = better for bettor)
      return b.decimalOdds - a.decimalOdds;
    });

  return {
    id: opportunityId,
    fixtureId: groupedOdds.fixtureId,
    sport: fixtureData.sport,
    league: fixtureData.league,
    leagueName: fixtureData.leagueName,
    homeTeam: fixtureData.homeTeam,
    awayTeam: fixtureData.awayTeam,
    startsAt: fixtureData.startsAt,
    market: groupedOdds.market,
    selection: groupedOdds.selection,
    selectionKey: groupedOdds.selectionKey,
    line: groupedOdds.line,
    playerId: groupedOdds.playerId,
    playerName: groupedOdds.playerName,
    bestEV,
    calculations: calculationsByMethod,
    fairOdds: allFairOdds,
    bookOdds,
    bookCount: groupedOdds.odds.length,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Calculate all bets for a grouped odds selection (regardless of EV)
 * This stores ALL bets so we can validate them with stats
 */
export function calculateAllBets(
  groupedOdds: GroupedOdds,
  fixtureData: {
    sport: string;
    league: string;
    leagueName?: string;
    homeTeam?: string;
    awayTeam?: string;
    startsAt: string;
  },
  targetBookIds: string[]
): EVOpportunity | null {
  // Calculate fair odds using all methods
  const allFairOdds = calculateAllFairOdds(groupedOdds);

  // Check if we have any valid fair odds
  const hasValidFairOdds = Object.values(allFairOdds).some(
    result => result.fairProbability > 0
  );

  if (!hasValidFairOdds) {
    return null;
  }

  // Calculate EV for each method/target combination
  const calculationsByMethod: Record<FairOddsMethod, EVCalculation[]> = {} as Record<
    FairOddsMethod,
    EVCalculation[]
  >;

  let bestEV: EVOpportunity['bestEV'] | null = null;

  for (const method of FAIR_ODDS_METHODS) {
    const fairOddsResult = allFairOdds[method];
    const calculations = calculateEVForTargets(groupedOdds, fairOddsResult, targetBookIds);
    calculationsByMethod[method] = calculations;

    // Find best EV (even if negative - we want the best one)
    for (const calc of calculations) {
      if (!bestEV || calc.evPercent > bestEV.evPercent) {
        bestEV = {
          evPercent: calc.evPercent,
          targetBookId: calc.targetBookId,
          targetBookName: calc.targetBookName,
          method: calc.method,
          offeredOdds: calc.offeredDecimalOdds,
          fairOdds: calc.fairDecimalOdds,
        };
      }
    }
  }

  // Return even if EV is negative - we want ALL bets
  if (!bestEV) {
    // Fallback: create a default bestEV from first target book
    const firstTargetOdds = groupedOdds.odds.find(o => targetBookIds.includes(o.sportsbookId));
    if (!firstTargetOdds) {
      return null;
    }
    const firstFairOdds = allFairOdds[FAIR_ODDS_METHODS[0]];
    bestEV = {
      evPercent: calculateEV(firstFairOdds.fairProbability, firstTargetOdds.decimalOdds),
      targetBookId: firstTargetOdds.sportsbookId,
      targetBookName: firstTargetOdds.sportsbookName,
      method: FAIR_ODDS_METHODS[0],
      offeredOdds: firstTargetOdds.decimalOdds,
      fairOdds: firstFairOdds.fairDecimalOdds,
    };
  }

  const opportunityId = generateOpportunityId(groupedOdds, bestEV.targetBookId);

  // Extract book odds for inline display (sorted: target books first, then by odds desc)
  const bookOdds: BookOdds[] = groupedOdds.odds
    .map(o => ({
      sportsbookId: o.sportsbookId,
      sportsbookName: o.sportsbookName,
      decimalOdds: o.decimalOdds,
      impliedProbability: o.impliedProbability,
      isTarget: o.isTarget,
      isSharp: o.isSharp,
      isOutlier: o.isOutlier,
    }))
    .sort((a, b) => {
      // Target books first
      if (a.isTarget && !b.isTarget) return -1;
      if (!a.isTarget && b.isTarget) return 1;
      // Then by odds descending (higher odds = better for bettor)
      return b.decimalOdds - a.decimalOdds;
    });

  return {
    id: opportunityId,
    fixtureId: groupedOdds.fixtureId,
    sport: fixtureData.sport,
    league: fixtureData.league,
    leagueName: fixtureData.leagueName,
    homeTeam: fixtureData.homeTeam,
    awayTeam: fixtureData.awayTeam,
    startsAt: fixtureData.startsAt,
    market: groupedOdds.market,
    selection: groupedOdds.selection,
    selectionKey: groupedOdds.selectionKey,
    line: groupedOdds.line,
    playerId: groupedOdds.playerId,
    playerName: groupedOdds.playerName,
    bestEV,
    calculations: calculationsByMethod,
    fairOdds: allFairOdds,
    bookOdds,
    bookCount: groupedOdds.odds.length,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Generate human-readable explanation bullets for an opportunity
 */
export function generateExplanation(opportunity: EVOpportunity): string[] {
  const { bestEV, bookCount, fairOdds } = opportunity;
  const fairResult = fairOdds[bestEV.method];

  const bullets: string[] = [];

  // Basic explanation
  bullets.push(
    `This bet has ${bestEV.evPercent.toFixed(1)}% expected value at ${bestEV.targetBookName}.`
  );

  // Fair odds explanation
  bullets.push(
    `Fair odds calculated using ${bestEV.method.replace(/_/g, ' ').toLowerCase()} method across ${bookCount} sportsbooks.`
  );

  // Odds comparison
  bullets.push(
    `${bestEV.targetBookName} offers ${bestEV.offeredOdds.toFixed(2)} decimal odds vs fair odds of ${bestEV.fairOdds.toFixed(2)}.`
  );

  // Probability comparison
  const offeredProb = (1 / bestEV.offeredOdds) * 100;
  const fairProb = (1 / bestEV.fairOdds) * 100;
  bullets.push(
    `The market implies ${offeredProb.toFixed(1)}% probability, but true probability is estimated at ${fairProb.toFixed(1)}%.`
  );

  // Outlier info
  if (fairResult && fairResult.booksExcluded > 0) {
    bullets.push(
      `${fairResult.booksExcluded} sportsbook${fairResult.booksExcluded > 1 ? 's were' : ' was'} excluded as outlier${fairResult.booksExcluded > 1 ? 's' : ''}.`
    );
  }

  // Fallback warning
  if (fairResult && fairResult.isFallback) {
    bullets.push(`Note: ${fairResult.fallbackReason}`);
  }

  return bullets;
}
