/**
 * Outlier detection using Median Absolute Deviation (MAD)
 *
 * MAD is more robust than standard deviation for detecting outliers
 * because it's less affected by extreme values.
 */

/**
 * Calculate median of an array
 */
export function median(values: number[]): number {
  if (values.length === 0) {
    throw new Error('Cannot calculate median of empty array');
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/**
 * Calculate mean of an array
 */
export function mean(values: number[]): number {
  if (values.length === 0) {
    throw new Error('Cannot calculate mean of empty array');
  }
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Calculate Median Absolute Deviation
 */
export function mad(values: number[]): number {
  const med = median(values);
  const absoluteDeviations = values.map(v => Math.abs(v - med));
  return median(absoluteDeviations);
}

/**
 * Detect outliers using MAD
 *
 * A value is an outlier if:
 * |x - median| / MAD > threshold
 *
 * Common threshold is 3.5 (corresponding to ~3 standard deviations)
 */
export function detectOutliersMAD(
  values: number[],
  threshold: number = 3.5
): { indices: number[]; isOutlier: boolean[] } {
  if (values.length < 3) {
    // Not enough data to detect outliers
    return {
      indices: [],
      isOutlier: values.map(() => false),
    };
  }

  const med = median(values);
  const madValue = mad(values);

  // If MAD is 0, all values are the same (no outliers)
  if (madValue === 0) {
    return {
      indices: [],
      isOutlier: values.map(() => false),
    };
  }

  // Scale factor to make MAD comparable to standard deviation
  // For normally distributed data, MAD * 1.4826 ≈ std dev
  const scaledMAD = madValue * 1.4826;

  const isOutlier = values.map(v => Math.abs(v - med) / scaledMAD > threshold);
  const indices = isOutlier.map((outlier, i) => (outlier ? i : -1)).filter(i => i !== -1);

  return { indices, isOutlier };
}

/**
 * Calculate trimmed mean after removing outliers
 */
export function trimmedMean(values: number[], threshold: number = 3.5): number {
  if (values.length === 0) {
    throw new Error('Cannot calculate trimmed mean of empty array');
  }

  if (values.length < 3) {
    return mean(values);
  }

  const { isOutlier } = detectOutliersMAD(values, threshold);
  const trimmedValues = values.filter((_, i) => !isOutlier[i]);

  if (trimmedValues.length === 0) {
    // All values were outliers, fall back to median
    return median(values);
  }

  return mean(trimmedValues);
}

/**
 * Get values with outliers marked
 */
export function getValuesWithOutlierStatus<T extends { value: number }>(
  items: T[],
  getValue: (item: T) => number = item => item.value,
  threshold: number = 3.5
): { item: T; isOutlier: boolean }[] {
  const values = items.map(getValue);
  const { isOutlier } = detectOutliersMAD(values, threshold);

  return items.map((item, i) => ({
    item,
    isOutlier: isOutlier[i] ?? false,
  }));
}
