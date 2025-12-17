import { useState, useEffect, useCallback } from 'react';
import {
  trackBet,
  trackMultipleBets,
  untrackBet,
  subscribeToTrackedBetIds,
  type TrackedBet,
} from '../services/trackingService';
import type { OpportunityResponse } from '../api/client';

/**
 * Hook for tracking functionality in opportunity lists
 */
export function useTracking() {
  const [trackedIds, setTrackedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<string | null>(null);

  // Subscribe to tracked bet IDs for real-time updates
  useEffect(() => {
    const unsubscribe = subscribeToTrackedBetIds((ids) => {
      setTrackedIds(ids);
    });

    return () => unsubscribe();
  }, []);

  // Check if a bet is tracked
  const isTracked = useCallback(
    (betId: string) => trackedIds.has(betId),
    [trackedIds]
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
    isTracked,
    track,
    untrack,
    toggleTrack,
    trackAllForFixture,
    isLoading: (id: string) => loading === id,
    isAnyLoading: loading !== null,
  };
}
