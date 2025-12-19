import { useState, useEffect, useCallback } from 'react';
import {
  trackBet,
  trackMultipleBets,
  untrackBet,
  subscribeToTrackedBetIds,
  subscribeToTrackedPlayerMatches,
  createPlayerMatchKey,
  type TrackedBet,
  type PlayerMatchKey,
} from '../services/trackingService';
import type { OpportunityResponse } from '../api/client';

/**
 * Hook for tracking functionality in opportunity lists
 */
export function useTracking() {
  const [trackedIds, setTrackedIds] = useState<Set<string>>(new Set());
  const [trackedPlayerMatches, setTrackedPlayerMatches] = useState<Set<PlayerMatchKey>>(new Set());
  const [loading, setLoading] = useState<string | null>(null);

  // Subscribe to tracked bet IDs for real-time updates
  useEffect(() => {
    const unsubscribe = subscribeToTrackedBetIds((ids) => {
      setTrackedIds(ids);
    });

    return () => unsubscribe();
  }, []);

  // Subscribe to tracked player+match combinations
  useEffect(() => {
    const unsubscribe = subscribeToTrackedPlayerMatches((playerMatches) => {
      setTrackedPlayerMatches(playerMatches);
    });

    return () => unsubscribe();
  }, []);

  // Check if a bet is tracked
  const isTracked = useCallback(
    (betId: string) => trackedIds.has(betId),
    [trackedIds]
  );

  // Check if any bet for this player+match combo is already tracked
  // This is used to hide other bets from the same player in the same match
  const isPlayerMatchTracked = useCallback(
    (fixtureId: string, playerName: string | undefined | null) => {
      const key = createPlayerMatchKey(fixtureId, playerName);
      return key ? trackedPlayerMatches.has(key) : false;
    },
    [trackedPlayerMatches]
  );

  // Track a single bet
  const track = useCallback(async (opportunity: OpportunityResponse) => {
    setLoading(opportunity.id);
    try {
      await trackBet(opportunity);
    } finally {
      setLoading(null);
    }
  }, []);

  // Untrack a bet
  const untrack = useCallback(async (betId: string) => {
    setLoading(betId);
    try {
      await untrackBet(betId);
    } finally {
      setLoading(null);
    }
  }, []);

  // Toggle tracking
  const toggleTrack = useCallback(
    async (opportunity: OpportunityResponse) => {
      if (isTracked(opportunity.id)) {
        await untrack(opportunity.id);
      } else {
        await track(opportunity);
      }
    },
    [isTracked, track, untrack]
  );

  // Track all opportunities for a fixture
  const trackAllForFixture = useCallback(
    async (opportunities: OpportunityResponse[], fixtureId: string) => {
      setLoading(`fixture-${fixtureId}`);
      try {
        const untracked = opportunities.filter(
          (opp) => opp.fixtureId === fixtureId && !trackedIds.has(opp.id)
        );
        await trackMultipleBets(untracked);
      } finally {
        setLoading(null);
      }
    },
    [trackedIds]
  );

  return {
    trackedIds,
    trackedPlayerMatches,
    isTracked,
    isPlayerMatchTracked,
    track,
    untrack,
    toggleTrack,
    trackAllForFixture,
    isLoading: (id: string) => loading === id,
    isAnyLoading: loading !== null,
  };
}
