/**
 * Player Cache Scheduler
 *
 * Automatically updates the player stats caches:
 * - NBA (Basketball): 9:00 AM daily via OpticOdds
 * - Soccer: 3:00 AM daily via SportMonks (takes longer due to rate limits)
 *
 * Runs as part of the main server process.
 */

import { updateAllPlayers, getCacheStats } from '../services/playerCache.js';
import { updateSoccerCache, getSoccerCacheStats } from '../services/soccerPlayerCache.js';
import { config } from '../config.js';

// NBA scheduler
let nbaSchedulerHandle: NodeJS.Timeout | null = null;
let isNbaRunning = false;

// Soccer scheduler
let soccerSchedulerHandle: NodeJS.Timeout | null = null;
let isSoccerRunning = false;

// Legacy alias
let schedulerHandle: NodeJS.Timeout | null = null;
let isRunning = false;

/**
 * Calculate milliseconds until next 9:00 AM
 */
function msUntilNextRun(targetHour: number = 9, targetMinute: number = 0): number {
  const now = new Date();
  const target = new Date(now);

  target.setHours(targetHour, targetMinute, 0, 0);

  // If it's already past 9am today, schedule for tomorrow
  if (now >= target) {
    target.setDate(target.getDate() + 1);
  }

  return target.getTime() - now.getTime();
}

/**
 * Format time until next run for logging
 */
function formatTimeUntil(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

/**
 * Run the cache update
 */
async function runCacheUpdate(): Promise<void> {
  if (isRunning) {
    console.info('[CacheScheduler] Update already in progress, skipping');
    return;
  }

  isRunning = true;
  console.info('[CacheScheduler] Starting scheduled cache update...');

  try {
    const result = await updateAllPlayers();

    console.info('[CacheScheduler] Cache update complete:');
    console.info(`  - Players updated: ${result.playersUpdated}`);
    console.info(`  - Players added: ${result.playersAdded}`);
    console.info(`  - Games added: ${result.gamesAdded}`);
    console.info(`  - Duration: ${Math.round(result.duration / 1000)}s`);

    if (result.errors.length > 0) {
      console.warn(`  - Errors: ${result.errors.length}`);
    }
  } catch (error) {
    console.error('[CacheScheduler] Error during cache update:', error);
  } finally {
    isRunning = false;

    // Schedule next run
    scheduleNextRun();
  }
}

/**
 * Schedule the next cache update
 */
function scheduleNextRun(): void {
  const msUntil = msUntilNextRun(9, 0); // 9:00 AM
  const nextRunTime = new Date(Date.now() + msUntil);

  console.info(`[CacheScheduler] Next cache update scheduled for ${nextRunTime.toLocaleString()} (in ${formatTimeUntil(msUntil)})`);

  schedulerHandle = setTimeout(() => {
    runCacheUpdate();
  }, msUntil);
}

/**
 * Start the cache scheduler
 */
export async function startCacheScheduler(): Promise<void> {
  console.info('[CacheScheduler] Starting cache scheduler (daily at 9:00 AM)');

  // Check current cache stats
  try {
    const stats = await getCacheStats();
    console.info(`[CacheScheduler] Current cache: ${stats.totalPlayers} players, ${stats.totalGames} games`);

    // If cache is empty, run update immediately
    if (stats.totalPlayers === 0) {
      console.info('[CacheScheduler] Cache is empty, running initial update...');
      await runCacheUpdate();
      return; // runCacheUpdate will schedule the next run
    }
  } catch (error) {
    console.error('[CacheScheduler] Error checking cache stats:', error);
  }

  // Schedule next run
  scheduleNextRun();
}

/**
 * Stop the cache scheduler
 */
export function stopCacheScheduler(): void {
  if (schedulerHandle) {
    clearTimeout(schedulerHandle);
    schedulerHandle = null;
    console.info('[CacheScheduler] Cache scheduler stopped');
  }
}

/**
 * Manually trigger a cache update
 */
export async function triggerCacheUpdate(): Promise<void> {
  console.info('[CacheScheduler] Manual cache update triggered');
  await runCacheUpdate();
}

/**
 * Get scheduler status
 */
export function getCacheSchedulerStatus(): {
  isRunning: boolean;
  nextRunTime: Date | null;
  msUntilNextRun: number | null;
} {
  if (!schedulerHandle) {
    return { isRunning, nextRunTime: null, msUntilNextRun: null };
  }

  const msUntil = msUntilNextRun(9, 0);
  return {
    isRunning,
    nextRunTime: new Date(Date.now() + msUntil),
    msUntilNextRun: msUntil,
  };
}

// ============================================================================
// Soccer Cache Scheduler (SportMonks)
// ============================================================================

/**
 * Run the soccer cache update
 */
async function runSoccerCacheUpdate(): Promise<void> {
  if (isSoccerRunning) {
    console.info('[SoccerCacheScheduler] Update already in progress, skipping');
    return;
  }

  // Check if SportMonks API key is configured
  if (!config.sportMonksApiKey) {
    console.info('[SoccerCacheScheduler] SportMonks API key not configured, skipping');
    scheduleSoccerNextRun();
    return;
  }

  isSoccerRunning = true;
  console.info('[SoccerCacheScheduler] Starting scheduled soccer cache update...');

  try {
    const result = await updateSoccerCache();

    console.info('[SoccerCacheScheduler] Soccer cache update complete:');
    console.info(`  - Leagues processed: ${result.leaguesProcessed}`);
    console.info(`  - Teams processed: ${result.teamsProcessed}`);
    console.info(`  - Players updated: ${result.playersUpdated}`);
    console.info(`  - Players added: ${result.playersAdded}`);
    console.info(`  - Games added: ${result.gamesAdded}`);
    console.info(`  - Duration: ${Math.round(result.duration / 1000)}s`);

    if (result.errors.length > 0) {
      console.warn(`  - Errors: ${result.errors.length}`);
    }
  } catch (error) {
    console.error('[SoccerCacheScheduler] Error during soccer cache update:', error);
  } finally {
    isSoccerRunning = false;

    // Schedule next run
    scheduleSoccerNextRun();
  }
}

/**
 * Schedule the next soccer cache update (3:00 AM daily)
 */
function scheduleSoccerNextRun(): void {
  const msUntil = msUntilNextRun(3, 0); // 3:00 AM
  const nextRunTime = new Date(Date.now() + msUntil);

  console.info(`[SoccerCacheScheduler] Next soccer cache update scheduled for ${nextRunTime.toLocaleString()} (in ${formatTimeUntil(msUntil)})`);

  soccerSchedulerHandle = setTimeout(() => {
    runSoccerCacheUpdate();
  }, msUntil);
}

/**
 * Start the soccer cache scheduler
 */
export async function startSoccerCacheScheduler(): Promise<void> {
  // Check if SportMonks API key is configured
  if (!config.sportMonksApiKey) {
    console.info('[SoccerCacheScheduler] SportMonks API key not configured, soccer cache disabled');
    return;
  }

  console.info('[SoccerCacheScheduler] Starting soccer cache scheduler (daily at 3:00 AM)');

  // Check current cache stats
  try {
    const stats = await getSoccerCacheStats();
    console.info(`[SoccerCacheScheduler] Current soccer cache: ${stats.totalPlayers} players, ${stats.totalGames} games, ${stats.totalLeagues} leagues`);

    // If cache is empty, run update immediately
    if (stats.totalPlayers === 0) {
      console.info('[SoccerCacheScheduler] Soccer cache is empty, running initial update...');
      // Run in background to not block server startup
      runSoccerCacheUpdate().catch(err => {
        console.error('[SoccerCacheScheduler] Initial update failed:', err);
      });
      return; // runSoccerCacheUpdate will schedule the next run
    }
  } catch (error) {
    console.error('[SoccerCacheScheduler] Error checking soccer cache stats:', error);
  }

  // Schedule next run
  scheduleSoccerNextRun();
}

/**
 * Stop the soccer cache scheduler
 */
export function stopSoccerCacheScheduler(): void {
  if (soccerSchedulerHandle) {
    clearTimeout(soccerSchedulerHandle);
    soccerSchedulerHandle = null;
    console.info('[SoccerCacheScheduler] Soccer cache scheduler stopped');
  }
}

/**
 * Manually trigger a soccer cache update
 */
export async function triggerSoccerCacheUpdate(): Promise<void> {
  console.info('[SoccerCacheScheduler] Manual soccer cache update triggered');
  await runSoccerCacheUpdate();
}

/**
 * Get soccer scheduler status
 */
export function getSoccerCacheSchedulerStatus(): {
  isRunning: boolean;
  nextRunTime: Date | null;
  msUntilNextRun: number | null;
} {
  if (!soccerSchedulerHandle) {
    return { isRunning: isSoccerRunning, nextRunTime: null, msUntilNextRun: null };
  }

  const msUntil = msUntilNextRun(3, 0);
  return {
    isRunning: isSoccerRunning,
    nextRunTime: new Date(Date.now() + msUntil),
    msUntilNextRun: msUntil,
  };
}

/**
 * Get combined cache status for both NBA and Soccer
 */
export async function getAllCacheStatus(): Promise<{
  nba: {
    isRunning: boolean;
    nextRunTime: Date | null;
    totalPlayers: number;
    totalGames: number;
  };
  soccer: {
    isRunning: boolean;
    nextRunTime: Date | null;
    totalPlayers: number;
    totalGames: number;
    totalLeagues: number;
    totalTeams: number;
  };
}> {
  const nbaStats = await getCacheStats();
  const soccerStats = await getSoccerCacheStats();

  return {
    nba: {
      isRunning: isNbaRunning || isRunning,
      nextRunTime: nbaSchedulerHandle || schedulerHandle
        ? new Date(Date.now() + msUntilNextRun(9, 0))
        : null,
      totalPlayers: nbaStats.totalPlayers,
      totalGames: nbaStats.totalGames,
    },
    soccer: {
      isRunning: isSoccerRunning,
      nextRunTime: soccerSchedulerHandle
        ? new Date(Date.now() + msUntilNextRun(3, 0))
        : null,
      totalPlayers: soccerStats.totalPlayers,
      totalGames: soccerStats.totalGames,
      totalLeagues: soccerStats.totalLeagues,
      totalTeams: soccerStats.totalTeams,
    },
  };
}
