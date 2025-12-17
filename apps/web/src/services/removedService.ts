/**
 * Service for managing removed bets in localStorage
 * Removed bets are hidden from the opportunities list but can be restored
 */

const STORAGE_KEY = 'ev_removed_bets';

export interface RemovedBet {
  id: string;
  fixtureId: string;
  sport: string;
  league: string;
  leagueName?: string;
  homeTeam: string;
  awayTeam: string;
  startsAt: string;
  market: string;
  marketName?: string;
  selection: string;
  line?: number;
  playerName?: string;
  evPercent: number;
  targetBook: string;
  targetBookId?: string;
  offeredOdds: number;
  fairOdds: number;
  method: string;
  removedAt: string; // ISO date string
}

type Listener = (bets: RemovedBet[]) => void;
const listeners: Set<Listener> = new Set();

/**
 * Get all removed bets from localStorage
 */
export function getRemovedBets(): RemovedBet[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

/**
 * Get removed bet IDs as a Set for quick lookup
 */
export function getRemovedIds(): Set<string> {
  const bets = getRemovedBets();
  return new Set(bets.map(b => b.id));
}

/**
 * Save removed bets to localStorage and notify listeners
 */
function saveAndNotify(bets: RemovedBet[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bets));
  listeners.forEach(listener => listener(bets));
}

/**
 * Remove a bet (hide from opportunities)
 */
export function removeBet(opportunity: {
  id: string;
  fixtureId: string;
  sport: string;
  league: string;
  leagueName?: string;
  homeTeam?: string;
  awayTeam?: string;
  startsAt: string;
  market: string;
  marketName?: string;
  selection: string;
  line?: number;
  playerName?: string;
  evPercent: number;
  targetBook: string;
  targetBookId?: string;
  offeredOdds: number;
  fairOdds: number;
  method: string;
}): void {
  const bets = getRemovedBets();

  // Don't add duplicates
  if (bets.some(b => b.id === opportunity.id)) {
    return;
  }

  const removedBet: RemovedBet = {
    id: opportunity.id,
    fixtureId: opportunity.fixtureId,
    sport: opportunity.sport,
    league: opportunity.league,
    leagueName: opportunity.leagueName,
    homeTeam: opportunity.homeTeam || '',
    awayTeam: opportunity.awayTeam || '',
    startsAt: opportunity.startsAt,
    market: opportunity.market,
    marketName: opportunity.marketName,
    selection: opportunity.selection,
    line: opportunity.line,
    playerName: opportunity.playerName,
    evPercent: opportunity.evPercent,
    targetBook: opportunity.targetBook,
    targetBookId: opportunity.targetBookId,
    offeredOdds: opportunity.offeredOdds,
    fairOdds: opportunity.fairOdds,
    method: opportunity.method,
    removedAt: new Date().toISOString(),
  };

  bets.unshift(removedBet); // Add to beginning
  saveAndNotify(bets);
}

/**
 * Remove multiple bets at once (e.g., all bets for a fixture)
 */
export function removeMultipleBets(opportunities: Array<{
  id: string;
  fixtureId: string;
  sport: string;
  league: string;
  leagueName?: string;
  homeTeam?: string;
  awayTeam?: string;
  startsAt: string;
  market: string;
  marketName?: string;
  selection: string;
  line?: number;
  playerName?: string;
  evPercent: number;
  targetBook: string;
  targetBookId?: string;
  offeredOdds: number;
  fairOdds: number;
  method: string;
}>): void {
  const bets = getRemovedBets();
  const existingIds = new Set(bets.map(b => b.id));

  const newBets = opportunities
    .filter(opp => !existingIds.has(opp.id))
    .map(opp => ({
      id: opp.id,
      fixtureId: opp.fixtureId,
      sport: opp.sport,
      league: opp.league,
      leagueName: opp.leagueName,
      homeTeam: opp.homeTeam || '',
      awayTeam: opp.awayTeam || '',
      startsAt: opp.startsAt,
      market: opp.market,
      marketName: opp.marketName,
      selection: opp.selection,
      line: opp.line,
      playerName: opp.playerName,
      evPercent: opp.evPercent,
      targetBook: opp.targetBook,
      targetBookId: opp.targetBookId,
      offeredOdds: opp.offeredOdds,
      fairOdds: opp.fairOdds,
      method: opp.method,
      removedAt: new Date().toISOString(),
    }));

  saveAndNotify([...newBets, ...bets]);
}

/**
 * Restore a removed bet (show in opportunities again)
 */
export function restoreBet(betId: string): void {
  const bets = getRemovedBets();
  const filtered = bets.filter(b => b.id !== betId);
  saveAndNotify(filtered);
}

/**
 * Restore all removed bets for a fixture
 */
export function restoreFixtureBets(fixtureId: string): void {
  const bets = getRemovedBets();
  const filtered = bets.filter(b => b.fixtureId !== fixtureId);
  saveAndNotify(filtered);
}

/**
 * Clear all removed bets
 */
export function clearAllRemoved(): void {
  saveAndNotify([]);
}

/**
 * Check if a bet is removed
 */
export function isRemoved(betId: string): boolean {
  return getRemovedIds().has(betId);
}

/**
 * Subscribe to changes in removed bets
 */
export function subscribeToRemovedBets(callback: Listener): () => void {
  listeners.add(callback);
  // Immediately call with current data
  callback(getRemovedBets());

  return () => {
    listeners.delete(callback);
  };
}

/**
 * Subscribe to removed IDs only (for quick filtering)
 */
export function subscribeToRemovedIds(callback: (ids: Set<string>) => void): () => void {
  const wrappedCallback = (bets: RemovedBet[]) => {
    callback(new Set(bets.map(b => b.id)));
  };

  listeners.add(wrappedCallback);
  wrappedCallback(getRemovedBets());

  return () => {
    listeners.delete(wrappedCallback);
  };
}

/**
 * Clean up old removed bets (older than 7 days)
 */
export function cleanupOldRemovedBets(): void {
  const bets = getRemovedBets();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const filtered = bets.filter(b => new Date(b.removedAt) > sevenDaysAgo);

  if (filtered.length !== bets.length) {
    saveAndNotify(filtered);
  }
}
