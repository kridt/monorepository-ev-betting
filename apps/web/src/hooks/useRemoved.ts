import { useState, useEffect, useCallback } from 'react';
import {
  removeBet,
  removeMultipleBets,
  restoreBet,
  restoreFixtureBets,
  subscribeToRemovedIds,
  subscribeToRemovedBets,
  clearAllRemoved,
  cleanupOldRemovedBets,
  type RemovedBet,
} from '../services/removedService';

/**
 * Hook for removed functionality in opportunity lists
 */
export function useRemoved() {
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [removedBets, setRemovedBets] = useState<RemovedBet[]>([]);

  // Subscribe to removed bet IDs for filtering
  useEffect(() => {
    const unsubscribe = subscribeToRemovedIds((ids) => {
      setRemovedIds(ids);
    });

    return () => unsubscribe();
  }, []);

  // Subscribe to full removed bets data (for Removed page)
  useEffect(() => {
    const unsubscribe = subscribeToRemovedBets((bets) => {
      setRemovedBets(bets);
    });

    // Cleanup old bets on mount
    cleanupOldRemovedBets();

    return () => unsubscribe();
  }, []);

  // Check if a bet is removed
  const isRemoved = useCallback(
    (betId: string) => removedIds.has(betId),
    [removedIds]
  );

  // Remove a single bet
  const remove = useCallback((opportunity: Parameters<typeof removeBet>[0]) => {
    removeBet(opportunity);
  }, []);

  // Remove multiple bets
  const removeMultiple = useCallback((opportunities: Parameters<typeof removeMultipleBets>[0]) => {
    removeMultipleBets(opportunities);
  }, []);

  // Restore a bet
  const restore = useCallback((betId: string) => {
    restoreBet(betId);
  }, []);

  // Restore all bets for a fixture
  const restoreFixture = useCallback((fixtureId: string) => {
    restoreFixtureBets(fixtureId);
  }, []);

  // Clear all removed bets
  const clearAll = useCallback(() => {
    clearAllRemoved();
  }, []);

  // Remove all bets for a fixture
  const removeAllForFixture = useCallback(
    (opportunities: Parameters<typeof removeMultipleBets>[0], fixtureId: string) => {
      const fixtureBets = opportunities.filter(opp => opp.fixtureId === fixtureId);
      removeMultipleBets(fixtureBets);
    },
    []
  );

  return {
    removedIds,
    removedBets,
    isRemoved,
    remove,
    removeMultiple,
    restore,
    restoreFixture,
    clearAll,
    removeAllForFixture,
  };
}
