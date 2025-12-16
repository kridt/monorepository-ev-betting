import type { FairOddsResult, GroupedOdds, FairOddsMethod } from '@ev-bets/shared';
import { FAIR_ODDS_METHODS, DEFAULT_CONFIG } from '@ev-bets/shared';
import { median, mean, trimmedMean, detectOutliersMAD } from './outlierDetection.js';
import { impliedProbToDecimal } from './oddsNormalizer.js';
import { config } from '../config.js';

/**
 * Calculate fair odds using TRIMMED_MEAN_PROB method
 *
 * 1. Convert each sportsbook price to implied probability
 * 2. Remove outliers using MAD
 * 3. Compute mean of remaining probabilities
 */
function calcTrimmedMeanProb(groupedOdds: GroupedOdds): FairOddsResult {
  const impliedProbs = groupedOdds.odds.map(o => o.impliedProbability);
  const { indices, isOutlier } = detectOutliersMAD(impliedProbs, 3.5);

  // Mark outliers in the grouped odds
  for (let i = 0; i < groupedOdds.odds.length; i++) {
    groupedOdds.odds[i]!.isOutlier = isOutlier[i] ?? false;
  }

  const outlierBookIds = indices.map(i => groupedOdds.odds[i]!.sportsbookId);
  const validProbs = impliedProbs.filter((_, i) => !isOutlier[i]);

  if (validProbs.length === 0) {
    // All outliers, use median as fallback
    const fairProbability = median(impliedProbs);
    return {
      method: 'TRIMMED_MEAN_PROB',
      fairProbability,
      fairDecimalOdds: impliedProbToDecimal(fairProbability),
      booksUsed: impliedProbs.length,
      booksExcluded: 0,
      outlierBookIds: [],
      isFallback: true,
      fallbackReason: 'All books marked as outliers, using median',
    };
  }

  const fairProbability = mean(validProbs);

  return {
    method: 'TRIMMED_MEAN_PROB',
    fairProbability,
    fairDecimalOdds: impliedProbToDecimal(fairProbability),
    booksUsed: validProbs.length,
    booksExcluded: indices.length,
    outlierBookIds,
    isFallback: false,
  };
}

/**
 * Calculate fair odds using SHARP_BOOK_REFERENCE method
 *
 * Uses Pinnacle odds (de-vigged) when available.
 * Falls back to TRIMMED_MEAN_PROB if Pinnacle doesn't have the market.
 */
function calcSharpBookReference(groupedOdds: GroupedOdds): FairOddsResult {
  const sharpOdds = groupedOdds.odds.find(o => o.isSharp);

  if (!sharpOdds) {
    // Pinnacle doesn't have this market, fall back to trimmed mean
    const fallbackResult = calcTrimmedMeanProb(groupedOdds);
    return {
      ...fallbackResult,
      method: 'SHARP_BOOK_REFERENCE',
      isFallback: true,
      fallbackReason: 'Sharp book (Pinnacle) does not have this market',
    };
  }

  // For simplicity, use the sharp book's implied probability directly
  // In a more sophisticated system, we'd find the opposite side and de-vig
  const fairProbability = sharpOdds.impliedProbability;

  // Estimate vig and de-vig (assume ~2-3% vig on each side for Pinnacle)
  // De-vig by assuming overround of ~1.02-1.03
  const estimatedOverround = 1.025; // Conservative estimate for Pinnacle
  const deViggedProb = fairProbability / estimatedOverround;

  return {
    method: 'SHARP_BOOK_REFERENCE',
    fairProbability: deViggedProb,
    fairDecimalOdds: impliedProbToDecimal(deViggedProb),
    booksUsed: 1,
    booksExcluded: groupedOdds.odds.length - 1,
    outlierBookIds: [],
    isFallback: false,
  };
}

/**
 * Calculate fair odds using both methods
 */
export function calculateAllFairOdds(
  groupedOdds: GroupedOdds
): Record<FairOddsMethod, FairOddsResult> {
  // Need minimum books for reliable fair odds
  if (groupedOdds.odds.length < config.minBooksForFairOdds) {
    const insufficientResult: FairOddsResult = {
      method: 'TRIMMED_MEAN_PROB',
      fairProbability: 0,
      fairDecimalOdds: 0,
      booksUsed: groupedOdds.odds.length,
      booksExcluded: 0,
      outlierBookIds: [],
      isFallback: true,
      fallbackReason: `Insufficient books (${groupedOdds.odds.length} < ${config.minBooksForFairOdds})`,
    };

    return {
      TRIMMED_MEAN_PROB: { ...insufficientResult, method: 'TRIMMED_MEAN_PROB' },
      SHARP_BOOK_REFERENCE: { ...insufficientResult, method: 'SHARP_BOOK_REFERENCE' },
    };
  }

  return {
    TRIMMED_MEAN_PROB: calcTrimmedMeanProb(groupedOdds),
    SHARP_BOOK_REFERENCE: calcSharpBookReference(groupedOdds),
  };
}

/**
 * Calculate fair odds using a specific method
 */
export function calculateFairOdds(
  groupedOdds: GroupedOdds,
  method: FairOddsMethod
): FairOddsResult {
  if (groupedOdds.odds.length < config.minBooksForFairOdds) {
    return {
      method,
      fairProbability: 0,
      fairDecimalOdds: 0,
      booksUsed: groupedOdds.odds.length,
      booksExcluded: 0,
      outlierBookIds: [],
      isFallback: true,
      fallbackReason: `Insufficient books (${groupedOdds.odds.length} < ${config.minBooksForFairOdds})`,
    };
  }

  switch (method) {
    case 'TRIMMED_MEAN_PROB':
      return calcTrimmedMeanProb(groupedOdds);
    case 'SHARP_BOOK_REFERENCE':
      return calcSharpBookReference(groupedOdds);
    default:
      throw new Error(`Unknown fair odds method: ${method}`);
  }
}
