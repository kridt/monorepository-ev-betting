import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the config
vi.mock('../config.js', () => ({
  config: {
    minEvPercent: 2,
    targetSportsbooks: ['betano', 'unibet'],
    sharpBook: 'pinnacle',
  },
}));

// Mock the fair odds module
vi.mock('./fairOdds.js', () => ({
  calculateAllFairOdds: vi.fn(),
}));

import { calculateEV, calculateEVForTargets, calculateOpportunities, generateExplanation } from './evCalculator.js';
import { calculateAllFairOdds } from './fairOdds.js';
import type { GroupedOdds, FairOddsResult, EVOpportunity } from '@ev-bets/shared';

describe('evCalculator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateEV', () => {
    it('should calculate positive EV correctly', () => {
      // If fair probability is 50% (0.5) and offered odds are 2.2
      // EV = (0.5 * 2.2 - 1) * 100 = 10%
      const ev = calculateEV(0.5, 2.2);
      expect(ev).toBeCloseTo(10, 1);
    });

    it('should calculate negative EV correctly', () => {
      // If fair probability is 50% (0.5) and offered odds are 1.8
      // EV = (0.5 * 1.8 - 1) * 100 = -10%
      const ev = calculateEV(0.5, 1.8);
      expect(ev).toBeCloseTo(-10, 1);
    });

    it('should return 0 for break-even bets', () => {
      // If fair probability is 50% (0.5) and offered odds are 2.0
      // EV = (0.5 * 2.0 - 1) * 100 = 0%
      const ev = calculateEV(0.5, 2.0);
      expect(ev).toBeCloseTo(0, 1);
    });

    it('should return 0 for invalid probability <= 0', () => {
      expect(calculateEV(0, 2.0)).toBe(0);
      expect(calculateEV(-0.1, 2.0)).toBe(0);
    });

    it('should return 0 for invalid probability >= 1', () => {
      expect(calculateEV(1, 2.0)).toBe(0);
      expect(calculateEV(1.1, 2.0)).toBe(0);
    });

    it('should handle high EV scenarios', () => {
      // Fair prob 40%, offered odds 3.0
      // EV = (0.4 * 3.0 - 1) * 100 = 20%
      const ev = calculateEV(0.4, 3.0);
      expect(ev).toBeCloseTo(20, 1);
    });

    it('should handle very low probability bets', () => {
      // Fair prob 5%, offered odds 25.0
      // EV = (0.05 * 25.0 - 1) * 100 = 25%
      const ev = calculateEV(0.05, 25.0);
      expect(ev).toBeCloseTo(25, 1);
    });

    it('should handle very high probability bets', () => {
      // Fair prob 95%, offered odds 1.1
      // EV = (0.95 * 1.1 - 1) * 100 = 4.5%
      const ev = calculateEV(0.95, 1.1);
      expect(ev).toBeCloseTo(4.5, 1);
    });
  });

  describe('calculateEVForTargets', () => {
    it('should calculate EV only for target books', () => {
      const groupedOdds: GroupedOdds = {
        fixtureId: 'fixture-1',
        market: 'moneyline',
        selection: 'Home',
        selectionKey: 'fixture-1||moneyline||Home',
        odds: [
          { sportsbookId: 'betano', sportsbookName: 'Betano', decimalOdds: 2.2, impliedProbability: 0.4545 },
          { sportsbookId: 'pinnacle', sportsbookName: 'Pinnacle', decimalOdds: 2.0, impliedProbability: 0.5 },
          { sportsbookId: 'other', sportsbookName: 'Other Book', decimalOdds: 2.3, impliedProbability: 0.4348 },
        ],
      };

      const fairOddsResult: FairOddsResult = {
        method: 'TRIMMED_MEAN_PROB',
        fairProbability: 0.5,
        fairDecimalOdds: 2.0,
        booksUsed: 3,
        booksExcluded: 0,
        isFallback: false,
      };

      const calculations = calculateEVForTargets(groupedOdds, fairOddsResult, ['betano']);

      expect(calculations).toHaveLength(1);
      expect(calculations[0].targetBookId).toBe('betano');
      expect(calculations[0].evPercent).toBeCloseTo(10, 1);
    });

    it('should return empty array when fair probability is 0', () => {
      const groupedOdds: GroupedOdds = {
        fixtureId: 'fixture-1',
        market: 'moneyline',
        selection: 'Home',
        selectionKey: 'fixture-1||moneyline||Home',
        odds: [{ sportsbookId: 'betano', sportsbookName: 'Betano', decimalOdds: 2.2, impliedProbability: 0.4545 }],
      };

      const fairOddsResult: FairOddsResult = {
        method: 'TRIMMED_MEAN_PROB',
        fairProbability: 0,
        fairDecimalOdds: 0,
        booksUsed: 0,
        booksExcluded: 0,
        isFallback: true,
        fallbackReason: 'No valid odds',
      };

      const calculations = calculateEVForTargets(groupedOdds, fairOddsResult, ['betano']);

      expect(calculations).toHaveLength(0);
    });

    it('should filter out extreme EV values', () => {
      const groupedOdds: GroupedOdds = {
        fixtureId: 'fixture-1',
        market: 'moneyline',
        selection: 'Home',
        selectionKey: 'fixture-1||moneyline||Home',
        odds: [
          { sportsbookId: 'betano', sportsbookName: 'Betano', decimalOdds: 100, impliedProbability: 0.01 },
        ],
      };

      const fairOddsResult: FairOddsResult = {
        method: 'TRIMMED_MEAN_PROB',
        fairProbability: 0.5, // This would give absurd EV
        fairDecimalOdds: 2.0,
        booksUsed: 3,
        booksExcluded: 0,
        isFallback: false,
      };

      const calculations = calculateEVForTargets(groupedOdds, fairOddsResult, ['betano']);

      // EV would be 4900% which is > 200, so should be filtered out
      expect(calculations).toHaveLength(0);
    });

    it('should include multiple target books', () => {
      const groupedOdds: GroupedOdds = {
        fixtureId: 'fixture-1',
        market: 'moneyline',
        selection: 'Home',
        selectionKey: 'fixture-1||moneyline||Home',
        odds: [
          { sportsbookId: 'betano', sportsbookName: 'Betano', decimalOdds: 2.2, impliedProbability: 0.4545 },
          { sportsbookId: 'unibet', sportsbookName: 'Unibet', decimalOdds: 2.1, impliedProbability: 0.4762 },
        ],
      };

      const fairOddsResult: FairOddsResult = {
        method: 'TRIMMED_MEAN_PROB',
        fairProbability: 0.5,
        fairDecimalOdds: 2.0,
        booksUsed: 2,
        booksExcluded: 0,
        isFallback: false,
      };

      const calculations = calculateEVForTargets(groupedOdds, fairOddsResult, ['betano', 'unibet']);

      expect(calculations).toHaveLength(2);
      expect(calculations.map(c => c.targetBookId)).toContain('betano');
      expect(calculations.map(c => c.targetBookId)).toContain('unibet');
    });
  });

  describe('calculateOpportunities', () => {
    it('should return null when no valid fair odds', () => {
      const mockFairOdds = {
        TRIMMED_MEAN_PROB: { fairProbability: 0, fairDecimalOdds: 0, booksUsed: 0, booksExcluded: 0, isFallback: true, method: 'TRIMMED_MEAN_PROB' as const },
        SHARP_BOOK_REFERENCE: { fairProbability: 0, fairDecimalOdds: 0, booksUsed: 0, booksExcluded: 0, isFallback: true, method: 'SHARP_BOOK_REFERENCE' as const },
        WEIGHTED_AVERAGE: { fairProbability: 0, fairDecimalOdds: 0, booksUsed: 0, booksExcluded: 0, isFallback: true, method: 'WEIGHTED_AVERAGE' as const },
      };
      (calculateAllFairOdds as ReturnType<typeof vi.fn>).mockReturnValue(mockFairOdds);

      const groupedOdds: GroupedOdds = {
        fixtureId: 'fixture-1',
        market: 'moneyline',
        selection: 'Home',
        selectionKey: 'fixture-1||moneyline||Home',
        odds: [],
      };

      const result = calculateOpportunities(
        groupedOdds,
        { sport: 'soccer', league: 'epl', startsAt: '2024-01-01T15:00:00Z' },
        ['betano']
      );

      expect(result).toBeNull();
    });

    it('should return null when EV below threshold', () => {
      const mockFairOdds = {
        TRIMMED_MEAN_PROB: { fairProbability: 0.5, fairDecimalOdds: 2.0, booksUsed: 5, booksExcluded: 0, isFallback: false, method: 'TRIMMED_MEAN_PROB' as const },
        SHARP_BOOK_REFERENCE: { fairProbability: 0.5, fairDecimalOdds: 2.0, booksUsed: 1, booksExcluded: 0, isFallback: false, method: 'SHARP_BOOK_REFERENCE' as const },
        WEIGHTED_AVERAGE: { fairProbability: 0.5, fairDecimalOdds: 2.0, booksUsed: 5, booksExcluded: 0, isFallback: false, method: 'WEIGHTED_AVERAGE' as const },
      };
      (calculateAllFairOdds as ReturnType<typeof vi.fn>).mockReturnValue(mockFairOdds);

      const groupedOdds: GroupedOdds = {
        fixtureId: 'fixture-1',
        market: 'moneyline',
        selection: 'Home',
        selectionKey: 'fixture-1||moneyline||Home',
        odds: [
          { sportsbookId: 'betano', sportsbookName: 'Betano', decimalOdds: 1.99, impliedProbability: 0.5025 }, // Negative EV
        ],
      };

      const result = calculateOpportunities(
        groupedOdds,
        { sport: 'soccer', league: 'epl', startsAt: '2024-01-01T15:00:00Z' },
        ['betano']
      );

      expect(result).toBeNull();
    });

    it('should return opportunity with best EV', () => {
      const mockFairOdds = {
        TRIMMED_MEAN_PROB: { fairProbability: 0.5, fairDecimalOdds: 2.0, booksUsed: 5, booksExcluded: 0, isFallback: false, method: 'TRIMMED_MEAN_PROB' as const },
        SHARP_BOOK_REFERENCE: { fairProbability: 0.48, fairDecimalOdds: 2.08, booksUsed: 1, booksExcluded: 0, isFallback: false, method: 'SHARP_BOOK_REFERENCE' as const },
        WEIGHTED_AVERAGE: { fairProbability: 0.5, fairDecimalOdds: 2.0, booksUsed: 5, booksExcluded: 0, isFallback: false, method: 'WEIGHTED_AVERAGE' as const },
      };
      (calculateAllFairOdds as ReturnType<typeof vi.fn>).mockReturnValue(mockFairOdds);

      const groupedOdds: GroupedOdds = {
        fixtureId: 'fixture-1',
        market: 'moneyline',
        selection: 'Home',
        selectionKey: 'fixture-1||moneyline||Home',
        odds: [
          { sportsbookId: 'betano', sportsbookName: 'Betano', decimalOdds: 2.2, impliedProbability: 0.4545, isTarget: true },
          { sportsbookId: 'pinnacle', sportsbookName: 'Pinnacle', decimalOdds: 2.0, impliedProbability: 0.5, isSharp: true },
        ],
      };

      const result = calculateOpportunities(
        groupedOdds,
        { sport: 'soccer', league: 'epl', startsAt: '2024-01-01T15:00:00Z', homeTeam: 'Arsenal', awayTeam: 'Chelsea' },
        ['betano']
      );

      expect(result).not.toBeNull();
      expect(result!.bestEV.targetBookId).toBe('betano');
      expect(result!.bestEV.evPercent).toBeGreaterThan(2);
      expect(result!.homeTeam).toBe('Arsenal');
      expect(result!.awayTeam).toBe('Chelsea');
    });

    it('should include bookOdds sorted correctly', () => {
      const mockFairOdds = {
        TRIMMED_MEAN_PROB: { fairProbability: 0.5, fairDecimalOdds: 2.0, booksUsed: 3, booksExcluded: 0, isFallback: false, method: 'TRIMMED_MEAN_PROB' as const },
        SHARP_BOOK_REFERENCE: { fairProbability: 0.5, fairDecimalOdds: 2.0, booksUsed: 1, booksExcluded: 0, isFallback: false, method: 'SHARP_BOOK_REFERENCE' as const },
        WEIGHTED_AVERAGE: { fairProbability: 0.5, fairDecimalOdds: 2.0, booksUsed: 3, booksExcluded: 0, isFallback: false, method: 'WEIGHTED_AVERAGE' as const },
      };
      (calculateAllFairOdds as ReturnType<typeof vi.fn>).mockReturnValue(mockFairOdds);

      const groupedOdds: GroupedOdds = {
        fixtureId: 'fixture-1',
        market: 'moneyline',
        selection: 'Home',
        selectionKey: 'fixture-1||moneyline||Home',
        odds: [
          { sportsbookId: 'pinnacle', sportsbookName: 'Pinnacle', decimalOdds: 2.0, impliedProbability: 0.5, isSharp: true },
          { sportsbookId: 'betano', sportsbookName: 'Betano', decimalOdds: 2.2, impliedProbability: 0.4545, isTarget: true },
          { sportsbookId: 'other', sportsbookName: 'Other', decimalOdds: 2.3, impliedProbability: 0.4348 },
        ],
      };

      const result = calculateOpportunities(
        groupedOdds,
        { sport: 'soccer', league: 'epl', startsAt: '2024-01-01T15:00:00Z' },
        ['betano']
      );

      expect(result).not.toBeNull();
      expect(result!.bookOdds).toBeDefined();
      // Target book should be first
      expect(result!.bookOdds[0].isTarget).toBe(true);
    });
  });

  describe('generateExplanation', () => {
    it('should generate explanation bullets', () => {
      const opportunity: EVOpportunity = {
        id: 'opp-1',
        fixtureId: 'fixture-1',
        sport: 'soccer',
        league: 'epl',
        startsAt: '2024-01-01T15:00:00Z',
        market: 'moneyline',
        selection: 'Home',
        selectionKey: 'fixture-1||moneyline||Home',
        bestEV: {
          evPercent: 10.5,
          targetBookId: 'betano',
          targetBookName: 'Betano',
          method: 'TRIMMED_MEAN_PROB',
          offeredOdds: 2.2,
          fairOdds: 2.0,
        },
        calculations: {
          TRIMMED_MEAN_PROB: [],
          SHARP_BOOK_REFERENCE: [],
          WEIGHTED_AVERAGE: [],
        },
        fairOdds: {
          TRIMMED_MEAN_PROB: { method: 'TRIMMED_MEAN_PROB', fairProbability: 0.5, fairDecimalOdds: 2.0, booksUsed: 5, booksExcluded: 1, isFallback: false },
          SHARP_BOOK_REFERENCE: { method: 'SHARP_BOOK_REFERENCE', fairProbability: 0.5, fairDecimalOdds: 2.0, booksUsed: 1, booksExcluded: 0, isFallback: false },
          WEIGHTED_AVERAGE: { method: 'WEIGHTED_AVERAGE', fairProbability: 0.5, fairDecimalOdds: 2.0, booksUsed: 5, booksExcluded: 0, isFallback: false },
        },
        bookOdds: [],
        bookCount: 5,
        timestamp: '2024-01-01T12:00:00Z',
      };

      const bullets = generateExplanation(opportunity);

      expect(bullets.length).toBeGreaterThan(0);
      expect(bullets.some(b => b.includes('10.5%'))).toBe(true);
      expect(bullets.some(b => b.includes('Betano'))).toBe(true);
      expect(bullets.some(b => b.includes('trimmed mean prob'))).toBe(true);
    });

    it('should include outlier info when books excluded', () => {
      const opportunity: EVOpportunity = {
        id: 'opp-1',
        fixtureId: 'fixture-1',
        sport: 'soccer',
        league: 'epl',
        startsAt: '2024-01-01T15:00:00Z',
        market: 'moneyline',
        selection: 'Home',
        selectionKey: 'fixture-1||moneyline||Home',
        bestEV: {
          evPercent: 10.5,
          targetBookId: 'betano',
          targetBookName: 'Betano',
          method: 'TRIMMED_MEAN_PROB',
          offeredOdds: 2.2,
          fairOdds: 2.0,
        },
        calculations: {
          TRIMMED_MEAN_PROB: [],
          SHARP_BOOK_REFERENCE: [],
          WEIGHTED_AVERAGE: [],
        },
        fairOdds: {
          TRIMMED_MEAN_PROB: { method: 'TRIMMED_MEAN_PROB', fairProbability: 0.5, fairDecimalOdds: 2.0, booksUsed: 5, booksExcluded: 2, isFallback: false },
          SHARP_BOOK_REFERENCE: { method: 'SHARP_BOOK_REFERENCE', fairProbability: 0.5, fairDecimalOdds: 2.0, booksUsed: 1, booksExcluded: 0, isFallback: false },
          WEIGHTED_AVERAGE: { method: 'WEIGHTED_AVERAGE', fairProbability: 0.5, fairDecimalOdds: 2.0, booksUsed: 5, booksExcluded: 0, isFallback: false },
        },
        bookOdds: [],
        bookCount: 7,
        timestamp: '2024-01-01T12:00:00Z',
      };

      const bullets = generateExplanation(opportunity);

      expect(bullets.some(b => b.includes('2 sportsbooks were excluded'))).toBe(true);
    });
  });
});
