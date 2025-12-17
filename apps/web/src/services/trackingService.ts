import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  query,
  where,
  orderBy,
  updateDoc,
  Timestamp,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { OpportunityResponse } from '../api/client';

// Types
export type BetStatus = 'pending' | 'won' | 'lost' | 'push' | 'void';

export interface TrackedBet {
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

  // Bet details
  targetBookId: string;
  targetBookName: string;
  offeredOdds: number;
  fairOdds: number;
  evPercent: number;
  method: string;

  // Tracking metadata
  trackedAt: Date;
  status: BetStatus;
  settledAt?: Date;
  notes?: string;

  // For calculating actual profit
  stake?: number;
  potentialProfit?: number;
  actualProfit?: number;
}

// Collection reference
const COLLECTION_NAME = 'tracked_bets';
const trackedBetsCollection = collection(db, COLLECTION_NAME);

/**
 * Convert Firestore document to TrackedBet
 */
function docToTrackedBet(data: Record<string, unknown>): TrackedBet {
  return {
    id: data.id as string,
    fixtureId: data.fixtureId as string,
    sport: data.sport as string,
    league: data.league as string,
    leagueName: data.leagueName as string | undefined,
    homeTeam: data.homeTeam as string,
    awayTeam: data.awayTeam as string,
    startsAt: data.startsAt as string,
    market: data.market as string,
    marketName: data.marketName as string | undefined,
    selection: data.selection as string,
    line: data.line as number | undefined,
    playerName: data.playerName as string | undefined,
    targetBookId: data.targetBookId as string,
    targetBookName: data.targetBookName as string,
    offeredOdds: data.offeredOdds as number,
    fairOdds: data.fairOdds as number,
    evPercent: data.evPercent as number,
    method: data.method as string,
    trackedAt: (data.trackedAt as Timestamp)?.toDate() || new Date(),
    status: (data.status as BetStatus) || 'pending',
    settledAt: data.settledAt ? (data.settledAt as Timestamp).toDate() : undefined,
    notes: data.notes as string | undefined,
    stake: data.stake as number | undefined,
    potentialProfit: data.potentialProfit as number | undefined,
    actualProfit: data.actualProfit as number | undefined,
  };
}

/**
 * Remove undefined values from an object (Firestore doesn't accept undefined)
 */
function removeUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([_, v]) => v !== undefined)
  ) as T;
}

/**
 * Track a single bet
 * Accepts either flat structure (from API) or nested bestEV structure
 */
export async function trackBet(opportunity: OpportunityResponse): Promise<void> {
  const docRef = doc(trackedBetsCollection, opportunity.id);

  // Handle both flat structure (API response) and nested bestEV structure
  const targetBookId = opportunity.bestEV?.targetBookId || opportunity.targetBookId || '';
  const targetBookName = opportunity.bestEV?.targetBookName || opportunity.targetBook || '';
  const offeredOdds = opportunity.bestEV?.offeredOdds || opportunity.offeredOdds;
  const fairOdds = opportunity.bestEV?.fairOdds || opportunity.fairOdds;
  const evPercent = opportunity.bestEV?.evPercent || opportunity.evPercent;
  const method = opportunity.bestEV?.method || opportunity.method;

  const trackedBet = removeUndefined({
    id: opportunity.id,
    fixtureId: opportunity.fixtureId,
    sport: opportunity.sport,
    league: opportunity.league,
    leagueName: opportunity.leagueName || null,
    homeTeam: opportunity.homeTeam || '',
    awayTeam: opportunity.awayTeam || '',
    startsAt: opportunity.startsAt,
    market: opportunity.market,
    marketName: (opportunity as { marketName?: string }).marketName || null,
    selection: opportunity.selection,
    line: opportunity.line ?? null,
    playerName: opportunity.playerName || null,
    targetBookId,
    targetBookName,
    offeredOdds,
    fairOdds,
    evPercent,
    method,
    trackedAt: Timestamp.now(),
    status: 'pending' as BetStatus,
  });

  await setDoc(docRef, trackedBet);
}

/**
 * Track multiple bets (all bets for a match)
 */
export async function trackMultipleBets(opportunities: OpportunityResponse[]): Promise<void> {
  const promises = opportunities.map(opp => trackBet(opp));
  await Promise.all(promises);
}

/**
 * Untrack a bet
 */
export async function untrackBet(betId: string): Promise<void> {
  const docRef = doc(trackedBetsCollection, betId);
  await deleteDoc(docRef);
}

/**
 * Check if a bet is tracked
 */
export async function isTracked(betId: string): Promise<boolean> {
  const docRef = doc(trackedBetsCollection, betId);
  const docSnap = await getDoc(docRef);
  return docSnap.exists();
}

/**
 * Get a single tracked bet
 */
export async function getTrackedBet(betId: string): Promise<TrackedBet | null> {
  const docRef = doc(trackedBetsCollection, betId);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) {
    return null;
  }

  return docToTrackedBet(docSnap.data());
}

/**
 * Get all tracked bets
 */
export async function getAllTrackedBets(): Promise<TrackedBet[]> {
  const q = query(trackedBetsCollection, orderBy('trackedAt', 'desc'));
  const snapshot = await getDocs(q);

  return snapshot.docs.map(doc => docToTrackedBet(doc.data()));
}

/**
 * Get tracked bets by status
 */
export async function getTrackedBetsByStatus(status: BetStatus): Promise<TrackedBet[]> {
  const q = query(
    trackedBetsCollection,
    where('status', '==', status),
    orderBy('trackedAt', 'desc')
  );
  const snapshot = await getDocs(q);

  return snapshot.docs.map(doc => docToTrackedBet(doc.data()));
}

/**
 * Get tracked bets for a specific fixture (match)
 */
export async function getTrackedBetsForFixture(fixtureId: string): Promise<TrackedBet[]> {
  const q = query(
    trackedBetsCollection,
    where('fixtureId', '==', fixtureId)
  );
  const snapshot = await getDocs(q);

  return snapshot.docs.map(doc => docToTrackedBet(doc.data()));
}

/**
 * Update bet status (win/loss/push/void)
 */
export async function updateBetStatus(
  betId: string,
  status: BetStatus,
  actualProfit?: number,
  notes?: string
): Promise<void> {
  const docRef = doc(trackedBetsCollection, betId);

  const updates: Record<string, unknown> = {
    status,
    settledAt: Timestamp.now(),
  };

  if (actualProfit !== undefined) {
    updates.actualProfit = actualProfit;
  }

  if (notes) {
    updates.notes = notes;
  }

  await updateDoc(docRef, updates);
}

/**
 * Update stake for a tracked bet
 */
export async function updateStake(betId: string, stake: number): Promise<void> {
  const docRef = doc(trackedBetsCollection, betId);
  const bet = await getTrackedBet(betId);

  if (!bet) return;

  const potentialProfit = stake * (bet.offeredOdds - 1);

  await updateDoc(docRef, {
    stake,
    potentialProfit,
  });
}

/**
 * Subscribe to all tracked bets (real-time updates)
 */
export function subscribeToTrackedBets(
  callback: (bets: TrackedBet[]) => void
): Unsubscribe {
  const q = query(trackedBetsCollection, orderBy('trackedAt', 'desc'));

  return onSnapshot(q, (snapshot) => {
    const bets = snapshot.docs.map(doc => docToTrackedBet(doc.data()));
    callback(bets);
  });
}

/**
 * Subscribe to tracked bet IDs (for quick lookup)
 */
export function subscribeToTrackedBetIds(
  callback: (ids: Set<string>) => void
): Unsubscribe {
  const q = query(trackedBetsCollection);

  return onSnapshot(q, (snapshot) => {
    const ids = new Set(snapshot.docs.map(doc => doc.id));
    callback(ids);
  });
}

/**
 * Get tracking statistics
 */
export async function getTrackingStats(): Promise<{
  totalBets: number;
  pendingBets: number;
  wonBets: number;
  lostBets: number;
  pushBets: number;
  voidBets: number;
  totalStaked: number;
  totalProfit: number;
  roi: number;
  avgEV: number;
}> {
  const bets = await getAllTrackedBets();

  const stats = {
    totalBets: bets.length,
    pendingBets: 0,
    wonBets: 0,
    lostBets: 0,
    pushBets: 0,
    voidBets: 0,
    totalStaked: 0,
    totalProfit: 0,
    roi: 0,
    avgEV: 0,
  };

  let totalEV = 0;

  for (const bet of bets) {
    totalEV += bet.evPercent;

    if (bet.stake) {
      stats.totalStaked += bet.stake;
    }

    if (bet.actualProfit !== undefined) {
      stats.totalProfit += bet.actualProfit;
    }

    switch (bet.status) {
      case 'pending':
        stats.pendingBets++;
        break;
      case 'won':
        stats.wonBets++;
        break;
      case 'lost':
        stats.lostBets++;
        break;
      case 'push':
        stats.pushBets++;
        break;
      case 'void':
        stats.voidBets++;
        break;
    }
  }

  stats.avgEV = bets.length > 0 ? totalEV / bets.length : 0;
  stats.roi = stats.totalStaked > 0 ? (stats.totalProfit / stats.totalStaked) * 100 : 0;

  return stats;
}
