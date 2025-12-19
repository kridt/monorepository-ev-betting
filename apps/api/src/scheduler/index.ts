import { Mutex } from 'async-mutex';
import { runPipeline } from './pipeline.js';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';

// Mutex to prevent overlapping runs
const mutex = new Mutex();

// Interval handle
let intervalHandle: NodeJS.Timeout | null = null;

// Timeout for stuck runs (10 minutes - validation takes time)
const RUN_TIMEOUT_MS = 600000;

/**
 * Run the pipeline with mutex protection
 */
async function runWithLock(): Promise<void> {
  // Try to acquire lock, skip if already running
  if (mutex.isLocked()) {
    console.warn('[Scheduler] Pipeline already running, skipping this run');
    return;
  }

  const release = await mutex.acquire();
  const startTime = new Date();

  try {
    console.info('[Scheduler] Acquiring lock for pipeline run...');

    // Update scheduler status
    await db
      .update(schema.schedulerStatus)
      .set({
        isRunning: true,
        lastRunStart: startTime.toISOString(),
        lastRunError: null,
      })
      .where(eq(schema.schedulerStatus.id, 1));

    // Run pipeline with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Pipeline timeout exceeded')), RUN_TIMEOUT_MS);
    });

    const result = await Promise.race([runPipeline(), timeoutPromise]);

    const endTime = new Date();
    const duration = endTime.getTime() - startTime.getTime();

    console.info(`[Scheduler] Pipeline completed in ${duration}ms`);
    console.info(`[Scheduler] Processed ${result.fixturesProcessed} fixtures, found ${result.opportunitiesFound} opportunities`);

    // Update scheduler status
    await db
      .update(schema.schedulerStatus)
      .set({
        isRunning: false,
        lastRunEnd: endTime.toISOString(),
        fixturesProcessed: result.fixturesProcessed,
        opportunitiesFound: result.opportunitiesFound,
        lastRunError: result.errors.length > 0 ? result.errors.join('; ') : null,
        nextRun: new Date(Date.now() + config.refreshIntervalMs).toISOString(),
      })
      .where(eq(schema.schedulerStatus.id, 1));

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Scheduler] Pipeline error: ${errorMsg}`);

    // Update scheduler status with error
    await db
      .update(schema.schedulerStatus)
      .set({
        isRunning: false,
        lastRunEnd: new Date().toISOString(),
        lastRunError: errorMsg,
        nextRun: new Date(Date.now() + config.refreshIntervalMs).toISOString(),
      })
      .where(eq(schema.schedulerStatus.id, 1));

  } finally {
    release();
  }
}

/**
 * Start the scheduler
 */
export function startScheduler(): void {
  if (intervalHandle) {
    console.warn('[Scheduler] Scheduler already running');
    return;
  }

  console.info(`[Scheduler] Starting scheduler with ${config.refreshIntervalMs / 1000}s interval`);

  // Update next run time
  db.update(schema.schedulerStatus)
    .set({
      nextRun: new Date(Date.now() + config.refreshIntervalMs).toISOString(),
    })
    .where(eq(schema.schedulerStatus.id, 1))
    .then(() => {
      console.info('[Scheduler] Scheduler status updated');
    })
    .catch(err => {
      console.error('[Scheduler] Failed to update scheduler status:', err);
    });

  // Run immediately on start
  runWithLock();

  // Schedule recurring runs
  intervalHandle = setInterval(() => {
    runWithLock();
  }, config.refreshIntervalMs);

  console.info('[Scheduler] Scheduler started');
}

/**
 * Stop the scheduler
 */
export function stopScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.info('[Scheduler] Scheduler stopped');
  }

  // Update status
  db.update(schema.schedulerStatus)
    .set({
      isRunning: false,
      nextRun: null,
    })
    .where(eq(schema.schedulerStatus.id, 1))
    .catch(err => {
      console.error('[Scheduler] Failed to update scheduler status:', err);
    });
}

/**
 * Get scheduler status
 */
export async function getSchedulerStatus(): Promise<{
  isRunning: boolean;
  lastRun: string | null;
  nextRun: string | null;
  fixturesProcessed: number;
  opportunitiesFound: number;
  lastError: string | null;
}> {
  const status = await db.query.schedulerStatus.findFirst({
    where: eq(schema.schedulerStatus.id, 1),
  });

  if (!status) {
    return {
      isRunning: false,
      lastRun: null,
      nextRun: null,
      fixturesProcessed: 0,
      opportunitiesFound: 0,
      lastError: null,
    };
  }

  return {
    isRunning: status.isRunning ?? false,
    lastRun: status.lastRunEnd,
    nextRun: status.nextRun,
    fixturesProcessed: status.fixturesProcessed ?? 0,
    opportunitiesFound: status.opportunitiesFound ?? 0,
    lastError: status.lastRunError,
  };
}

/**
 * Manually trigger a pipeline run
 */
export async function triggerPipelineRun(): Promise<void> {
  console.info('[Scheduler] Manually triggering pipeline run');
  await runWithLock();
}
