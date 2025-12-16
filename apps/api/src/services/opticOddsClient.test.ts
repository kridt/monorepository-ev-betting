import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Fixture } from '@ev-bets/shared';

// Only test pure functions that don't depend on network/p-limit
describe('opticOddsClient utilities', () => {
  describe('filterPrematchFixtures', () => {
    // Import dynamically to avoid module loading issues
    let filterPrematchFixtures: (fixtures: Fixture[]) => Fixture[];

    beforeEach(async () => {
      // Reset modules to get fresh imports
      vi.resetModules();

      // Mock config before importing
      vi.doMock('../config.js', () => ({
        config: {
          opticOddsApiKey: 'test-api-key',
          opticOddsBaseUrl: 'https://api.opticodds.com/api/v3',
          maxConcurrentRequests: 5,
          maxSportsbooksPerRequest: 5,
          targetSportsbooks: ['betano', 'unibet'],
          sharpBook: 'pinnacle',
          // Main sports for fetching all sportsbooks
          allSportsFetch: ['soccer', 'basketball', 'american_football'],
        },
      }));

      const module = await import('./opticOddsClient.js');
      filterPrematchFixtures = module.filterPrematchFixtures;
    });

    it('should filter out past fixtures', () => {
      const now = new Date();
      const fixtures: Fixture[] = [
        {
          id: 'future1',
          sport: 'soccer',
          league: 'epl',
          start_date: new Date(now.getTime() + 60000).toISOString(),
          is_live: false,
        },
        {
          id: 'past1',
          sport: 'soccer',
          league: 'epl',
          start_date: new Date(now.getTime() - 60000).toISOString(),
          is_live: false,
        },
      ];

      const result = filterPrematchFixtures(fixtures);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('future1');
    });

    it('should filter out live fixtures', () => {
      const now = new Date();
      const fixtures: Fixture[] = [
        {
          id: 'future-live',
          sport: 'soccer',
          league: 'epl',
          start_date: new Date(now.getTime() + 60000).toISOString(),
          is_live: true,
        },
        {
          id: 'future-notlive',
          sport: 'soccer',
          league: 'epl',
          start_date: new Date(now.getTime() + 60000).toISOString(),
          is_live: false,
        },
      ];

      const result = filterPrematchFixtures(fixtures);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('future-notlive');
    });

    it('should return empty array when no prematch fixtures', () => {
      const now = new Date();
      const fixtures: Fixture[] = [
        {
          id: 'past',
          sport: 'soccer',
          league: 'epl',
          start_date: new Date(now.getTime() - 60000).toISOString(),
          is_live: false,
        },
      ];

      const result = filterPrematchFixtures(fixtures);

      expect(result).toHaveLength(0);
    });

    it('should handle empty array', () => {
      const result = filterPrematchFixtures([]);
      expect(result).toHaveLength(0);
    });

    it('should handle mixed fixtures correctly', () => {
      const now = new Date();
      const fixtures: Fixture[] = [
        { id: '1', sport: 'soccer', league: 'epl', start_date: new Date(now.getTime() + 3600000).toISOString(), is_live: false },
        { id: '2', sport: 'soccer', league: 'epl', start_date: new Date(now.getTime() - 3600000).toISOString(), is_live: false },
        { id: '3', sport: 'soccer', league: 'epl', start_date: new Date(now.getTime() + 7200000).toISOString(), is_live: true },
        { id: '4', sport: 'soccer', league: 'epl', start_date: new Date(now.getTime() + 1800000).toISOString(), is_live: false },
      ];

      const result = filterPrematchFixtures(fixtures);

      expect(result).toHaveLength(2);
      expect(result.map(f => f.id).sort()).toEqual(['1', '4']);
    });
  });

  describe('getAllRequiredSportsbooks', () => {
    let getAllRequiredSportsbooks: () => string[];

    beforeEach(async () => {
      vi.resetModules();

      vi.doMock('../config.js', () => ({
        config: {
          opticOddsApiKey: 'test-api-key',
          opticOddsBaseUrl: 'https://api.opticodds.com/api/v3',
          maxConcurrentRequests: 5,
          maxSportsbooksPerRequest: 5,
          targetSportsbooks: ['betano', 'unibet'],
          sharpBook: 'pinnacle',
        },
      }));

      const module = await import('./opticOddsClient.js');
      getAllRequiredSportsbooks = module.getAllRequiredSportsbooks;
    });

    it('should include target sportsbooks', () => {
      const books = getAllRequiredSportsbooks();
      expect(books).toContain('betano');
      expect(books).toContain('unibet');
    });

    it('should include sharp book', () => {
      const books = getAllRequiredSportsbooks();
      expect(books).toContain('pinnacle');
    });

    it('should include common books for fair odds calculation', () => {
      const books = getAllRequiredSportsbooks();
      expect(books).toContain('bet365');
      expect(books).toContain('betway');
      expect(books).toContain('draftkings');
    });

    it('should not have duplicates', () => {
      const books = getAllRequiredSportsbooks();
      const uniqueBooks = new Set(books);
      expect(uniqueBooks.size).toBe(books.length);
    });

    it('should return reasonable number of books', () => {
      const books = getAllRequiredSportsbooks();
      expect(books.length).toBeGreaterThanOrEqual(10);
      expect(books.length).toBeLessThanOrEqual(50);
    });
  });
});

describe('EV calculation formula', () => {
  it('should calculate positive EV when odds are favorable', () => {
    // If fair probability is 50% (0.5) and offered odds are 2.2
    // EV = (0.5 * 2.2 - 1) * 100 = 10%
    const fairProb = 0.5;
    const offeredOdds = 2.2;
    const ev = (fairProb * offeredOdds - 1) * 100;
    expect(ev).toBeCloseTo(10, 1);
  });

  it('should calculate negative EV when odds are unfavorable', () => {
    // If fair probability is 50% (0.5) and offered odds are 1.8
    // EV = (0.5 * 1.8 - 1) * 100 = -10%
    const fairProb = 0.5;
    const offeredOdds = 1.8;
    const ev = (fairProb * offeredOdds - 1) * 100;
    expect(ev).toBeCloseTo(-10, 1);
  });

  it('should be zero for break-even bets', () => {
    // If fair probability is 50% (0.5) and offered odds are 2.0
    // EV = (0.5 * 2.0 - 1) * 100 = 0%
    const fairProb = 0.5;
    const offeredOdds = 2.0;
    const ev = (fairProb * offeredOdds - 1) * 100;
    expect(ev).toBeCloseTo(0, 1);
  });

  it('should handle longshot bets', () => {
    // Fair prob 10%, offered odds 12.0
    // EV = (0.1 * 12.0 - 1) * 100 = 20%
    const fairProb = 0.1;
    const offeredOdds = 12.0;
    const ev = (fairProb * offeredOdds - 1) * 100;
    expect(ev).toBeCloseTo(20, 1);
  });

  it('should handle heavy favorite bets', () => {
    // Fair prob 90%, offered odds 1.15
    // EV = (0.9 * 1.15 - 1) * 100 = 3.5%
    const fairProb = 0.9;
    const offeredOdds = 1.15;
    const ev = (fairProb * offeredOdds - 1) * 100;
    expect(ev).toBeCloseTo(3.5, 1);
  });
});

describe('Odds conversion', () => {
  it('should convert decimal odds to implied probability', () => {
    expect(1 / 2.0).toBeCloseTo(0.5, 4);
    expect(1 / 1.5).toBeCloseTo(0.667, 2);
    expect(1 / 3.0).toBeCloseTo(0.333, 2);
  });

  it('should convert implied probability to decimal odds', () => {
    expect(1 / 0.5).toBeCloseTo(2.0, 4);
    expect(1 / 0.667).toBeCloseTo(1.5, 1);
    expect(1 / 0.333).toBeCloseTo(3.0, 1);
  });
});

describe('Sportsbook deduplication logic', () => {
  it('should deduplicate by ID', () => {
    const books = [
      { id: 'pinnacle', name: 'Pinnacle' },
      { id: 'bet365', name: 'Bet365' },
      { id: 'pinnacle', name: 'Pinnacle Duplicate' },
    ];

    const seenIds = new Set<string>();
    const uniqueBooks: typeof books = [];

    for (const book of books) {
      if (!seenIds.has(book.id)) {
        seenIds.add(book.id);
        uniqueBooks.push(book);
      }
    }

    expect(uniqueBooks).toHaveLength(2);
    expect(uniqueBooks[0].name).toBe('Pinnacle'); // First one wins
  });

  it('should sort alphabetically by name', () => {
    const books = [
      { id: 'z', name: 'Zebra' },
      { id: 'a', name: 'Alpha' },
      { id: 'm', name: 'Middle' },
    ];

    const sorted = [...books].sort((a, b) => a.name.localeCompare(b.name));

    expect(sorted[0].name).toBe('Alpha');
    expect(sorted[1].name).toBe('Middle');
    expect(sorted[2].name).toBe('Zebra');
  });
});
