/**
 * Bet Quality Grading System
 *
 * Calculates a grade (A/B/C/D/F) based on:
 * - EV% (expected value)
 * - Historical edge (hit rate relative to odds-implied probability)
 * - Confidence (sample size and book count)
 */

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface GradeResult {
  grade: Grade;
  score: number;
  breakdown: {
    evScore: number;
    historyScore: number;
    confidenceScore: number;
  };
  details: {
    evPercent: number;
    impliedProb: number;
    hitRate: number | null;
    edge: number | null;
    sampleSize: number | null;
    bookCount: number;
  };
  hasValidation: boolean;
}

export interface GradeInput {
  evPercent: number;
  odds: number;
  hitRate?: number | null;      // 0-100 percentage, null if no validation
  sampleSize?: number | null;   // Number of games checked
  bookCount: number;
}

/**
 * Calculate the bet quality grade
 *
 * Scoring breakdown (0-100 total):
 * - EV Score (max 45 points): min(45, EV% * 3)
 * - History Score (max 45 points): 22.5 + (edge * 150) where edge = hitRate - impliedProb
 * - Confidence Score (max 10 points): (sample/20) * (books/5) * 10
 */
export function calculateGrade(input: GradeInput): GradeResult {
  const { evPercent, odds, hitRate, sampleSize, bookCount } = input;

  // Calculate implied probability from odds
  const impliedProbability = 1 / odds;

  // EV Score: Higher EV = more points (max 45)
  // 15% EV = 45 points (max)
  const evScore = Math.min(45, Math.max(0, evPercent * 3));

  // History Score: Based on edge over expected (max 45)
  // Edge = actual hit rate - implied probability
  let historyScore = 22.5; // Neutral default for no validation
  let edge: number | null = null;
  const hasValidation = hitRate !== null && hitRate !== undefined &&
                        sampleSize !== null && sampleSize !== undefined &&
                        sampleSize >= 5;

  if (hasValidation) {
    const actualHitRate = hitRate / 100; // Convert from percentage
    edge = actualHitRate - impliedProbability;
    // +15% edge = 45 points, -15% edge = 0 points
    historyScore = Math.max(0, Math.min(45, 22.5 + (edge * 150)));
  }

  // Confidence Score: Based on sample size and book count (max 10)
  const sampleFactor = hasValidation ? Math.min(1, (sampleSize ?? 0) / 20) : 0;
  const bookFactor = Math.min(1, bookCount / 5);
  const confidenceScore = hasValidation
    ? sampleFactor * bookFactor * 10
    : bookFactor * 5; // Half points if no validation

  // Total score
  let totalScore = evScore + historyScore + confidenceScore;

  // Penalty adjustments
  if (!hasValidation) {
    // Cap at 70 (B grade) if no validation data
    totalScore = Math.min(70, totalScore);
  } else if (hitRate !== null && hitRate !== undefined) {
    const actualHitRate = hitRate / 100;
    // If historical hit rate is below implied probability, cap grade
    if (actualHitRate < impliedProbability) {
      // Negative edge - cap at 60 (C+ territory)
      totalScore = Math.min(60, totalScore);
    }
  }

  // Determine grade from score
  const grade = scoreToGrade(totalScore);

  return {
    grade,
    score: Math.round(totalScore),
    breakdown: {
      evScore: Math.round(evScore * 10) / 10,
      historyScore: Math.round(historyScore * 10) / 10,
      confidenceScore: Math.round(confidenceScore * 10) / 10,
    },
    details: {
      evPercent,
      impliedProb: Math.round(impliedProbability * 1000) / 10, // as percentage
      hitRate: hitRate ?? null,
      edge: edge !== null ? Math.round(edge * 1000) / 10 : null, // as percentage
      sampleSize: sampleSize ?? null,
      bookCount,
    },
    hasValidation,
  };
}

/**
 * Convert numeric score to letter grade (A is best)
 */
function scoreToGrade(score: number): Grade {
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

/**
 * Get display color for grade
 */
export function getGradeColor(grade: Grade): string {
  switch (grade) {
    case 'A': return '#22C55E'; // Green
    case 'B': return '#3B82F6'; // Blue
    case 'C': return '#F59E0B'; // Amber
    case 'D': return '#EF4444'; // Red
    case 'F': return '#6B7280'; // Gray
  }
}

/**
 * Get grade badge background style
 */
export function getGradeBgColor(grade: Grade): string {
  switch (grade) {
    case 'A': return 'bg-gradient-to-r from-emerald-500 to-green-500 text-white shadow-lg shadow-emerald-500/30';
    case 'B': return 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-md shadow-blue-500/20';
    case 'C': return 'bg-gradient-to-r from-amber-500 to-yellow-500 text-black';
    case 'D': return 'bg-gradient-to-r from-red-500 to-orange-500 text-white';
    case 'F': return 'bg-gray-600 text-white';
  }
}

/**
 * Get grade description
 */
export function getGradeDescription(grade: Grade): string {
  switch (grade) {
    case 'A': return 'Excellent - Strong value with positive history';
    case 'B': return 'Good - Solid opportunity';
    case 'C': return 'Average - Proceed with caution';
    case 'D': return 'Weak - Consider skipping';
    case 'F': return 'Avoid - Poor value or contradicting signals';
  }
}

/**
 * Generate human-readable reasons for the grade
 */
export function getGradeReasons(result: GradeResult): string[] {
  const reasons: string[] = [];
  const { breakdown, details, hasValidation, grade } = result;

  // EV assessment
  if (details.evPercent >= 15) {
    reasons.push(`Strong EV: +${details.evPercent.toFixed(1)}% expected value`);
  } else if (details.evPercent >= 10) {
    reasons.push(`Good EV: +${details.evPercent.toFixed(1)}% expected value`);
  } else if (details.evPercent >= 5) {
    reasons.push(`Moderate EV: +${details.evPercent.toFixed(1)}% expected value`);
  } else {
    reasons.push(`Low EV: +${details.evPercent.toFixed(1)}% expected value`);
  }

  // Historical edge assessment
  if (hasValidation && details.edge !== null && details.hitRate !== null) {
    const edgeSign = details.edge >= 0 ? '+' : '';
    if (details.edge >= 10) {
      reasons.push(`Strong history: ${details.hitRate.toFixed(0)}% hit rate (${edgeSign}${details.edge.toFixed(0)}% vs ${details.impliedProb.toFixed(0)}% expected)`);
    } else if (details.edge >= 0) {
      reasons.push(`Positive history: ${details.hitRate.toFixed(0)}% hit rate (${edgeSign}${details.edge.toFixed(0)}% vs ${details.impliedProb.toFixed(0)}% expected)`);
    } else {
      reasons.push(`Negative history: ${details.hitRate.toFixed(0)}% hit rate (${details.edge.toFixed(0)}% vs ${details.impliedProb.toFixed(0)}% expected)`);
    }
  } else {
    reasons.push('No historical data - grade capped at B');
  }

  // Confidence assessment
  if (details.bookCount >= 5) {
    reasons.push(`Good consensus: ${details.bookCount} books pricing this market`);
  } else if (details.bookCount >= 3) {
    reasons.push(`Fair consensus: ${details.bookCount} books pricing this market`);
  } else {
    reasons.push(`Limited data: only ${details.bookCount} books pricing this market`);
  }

  // Sample size
  if (hasValidation && details.sampleSize !== null) {
    if (details.sampleSize >= 15) {
      reasons.push(`Strong sample: ${details.sampleSize} games analyzed`);
    } else if (details.sampleSize >= 10) {
      reasons.push(`Good sample: ${details.sampleSize} games analyzed`);
    } else {
      reasons.push(`Small sample: ${details.sampleSize} games analyzed`);
    }
  }

  return reasons;
}

/**
 * All available grades for filtering
 */
export const ALL_GRADES: Grade[] = ['A', 'B', 'C', 'D', 'F'];
