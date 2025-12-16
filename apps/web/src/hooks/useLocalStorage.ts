import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Custom hook for persisting state in localStorage
 *
 * INFINITE LOOP FIX NOTES:
 * ========================
 * The original implementation had several issues causing "Maximum update depth exceeded":
 *
 * 1. PRIMARY ISSUE: `setValue` depended on `storedValue` in its dependency array.
 *    - When setValue was called → storedValue updated → setValue got a NEW reference
 *    - If consumer code had setValue in a useEffect dependency array, the effect
 *      would re-run and call setValue again → INFINITE LOOP
 *
 * 2. SECONDARY ISSUE: `readValue` callback depended on `initialValue`.
 *    - If initialValue was an object/array literal (e.g., DEFAULT_SETTINGS),
 *      it was a new reference every render, making readValue unstable.
 *
 * 3. TERTIARY ISSUE: Functional updater used stale closure.
 *    - `value(storedValue)` captured storedValue at callback creation time,
 *      potentially returning stale values during rapid updates.
 *
 * SOLUTION:
 * - Use useRef to stabilize initialValue reference
 * - Use lazy initializer for useState (function, not function call)
 * - Use functional update form of setStoredValue to avoid storedValue dependency
 * - setValue now only depends on `key` (stable string), making it referentially stable
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  // FIX #1: Store initialValue in a ref to prevent unstable dependencies
  // when initialValue is an object/array literal (new reference each render).
  // We only use the first initialValue - subsequent changes are ignored
  // (this matches useState semantics where initialValue is only used once).
  const initialValueRef = useRef(initialValue);

  // FIX #2: Use lazy initializer (pass function, not function result).
  // This ensures localStorage is only read once on mount, not on every render.
  // The function receives no arguments and returns the initial state.
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === 'undefined') {
      return initialValueRef.current;
    }

    try {
      const item = window.localStorage.getItem(key);
      if (item === null) {
        return initialValueRef.current;
      }
      // Safe JSON parsing with fallback
      return JSON.parse(item) as T;
    } catch (error) {
      // Handle corrupted localStorage data gracefully
      console.warn(`Error reading localStorage key "${key}":`, error);
      return initialValueRef.current;
    }
  });

  // FIX #3: setValue is now STABLE - it only depends on `key` (a string).
  // This is the CRITICAL fix that prevents infinite loops.
  //
  // WHY THIS IS SAFE:
  // - `key` is a string primitive, so it won't cause unnecessary re-creations
  // - We use the functional form of setStoredValue: setStoredValue(prev => ...)
  // - This gives us access to the LATEST state without needing storedValue in deps
  // - The returned setValue function has a stable reference across renders
  // - Consumers can safely include setValue in useEffect dependency arrays
  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      // FIX #4: Use functional update to access latest state value.
      // This avoids stale closures and removes storedValue from dependencies.
      setStoredValue((prev) => {
        try {
          // Support both direct values and updater functions (same API as useState)
          const valueToStore = value instanceof Function ? value(prev) : value;

          // Persist to localStorage synchronously within the state update
          // This ensures state and localStorage stay in sync
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(key, JSON.stringify(valueToStore));
          }

          return valueToStore;
        } catch (error) {
          // On error (e.g., localStorage quota exceeded, circular JSON),
          // log warning and keep previous state unchanged
          console.warn(`Error setting localStorage key "${key}":`, error);
          return prev;
        }
      });
    },
    [key] // ONLY depends on key - this makes setValue referentially stable!
  );

  // Listen for changes from other tabs/windows (storage event only fires cross-tab)
  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      // Only react to changes for our specific key
      if (event.key === key && event.newValue !== null) {
        try {
          setStoredValue(JSON.parse(event.newValue));
        } catch {
          // Ignore parse errors from malformed data in other tabs
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [key]);

  return [storedValue, setValue];
}

/**
 * Settings interface for type safety
 */
export interface EVBetsSettings {
  selectedMethod: string;
  minEV: number;
  selectedTargets: string[]; // Playable books - where user can bet
  selectedLeagues: string[];
  sharpBook: string; // Sharp book for reference (e.g., Pinnacle)
  calculationBooks: string[]; // Books used for fair odds calculation
  filters: {
    sport: string;
    league: string;
    targetBook: string;
    minEV: string;
    maxEV: string;
    minBooks: string;
    maxOdds: string;
    timeWindow: string;
  };
}

// Default books for fair odds calculation
export const DEFAULT_CALCULATION_BOOKS = [
  'pinnacle',
  'bet365',
  'betano',
  'unibet',
  'betway',
  'bet99',
  'betfair',
  'betmgm',
  'draftkings',
  'fanduel',
  'caesars',
  'bovada',
  'betonline',
  '888sport',
  'bwin',
  'william_hill',
  'ladbrokes',
  'betsson',
  'betcris',
  'betrivers',
  'circa_sports',
  'sbobet',
  'bookmaker',
  'ggbet',
];

export const DEFAULT_SETTINGS: EVBetsSettings = {
  selectedMethod: 'TRIMMED_MEAN_PROB',
  minEV: 5,
  selectedTargets: [],
  selectedLeagues: [],
  sharpBook: 'pinnacle',
  calculationBooks: DEFAULT_CALCULATION_BOOKS,
  filters: {
    sport: '',
    league: '',
    targetBook: '',
    minEV: '',
    maxEV: '',
    minBooks: '',
    maxOdds: '',
    timeWindow: '',
  },
};

/**
 * Hook specifically for EV Bets settings
 *
 * STABILITY NOTE:
 * All returned functions (setSettings, updateSetting, updateFilters, resetSettings)
 * are now referentially stable because they only depend on setSettings,
 * which is itself stable (from the fixed useLocalStorage).
 */
export function useSettings() {
  const [settings, setSettings] = useLocalStorage<EVBetsSettings>('ev-bets-settings', DEFAULT_SETTINGS);

  // Stable: only depends on setSettings (which is now stable)
  const updateSetting = useCallback(
    <K extends keyof EVBetsSettings>(key: K, value: EVBetsSettings[K]) => {
      setSettings(prev => ({ ...prev, [key]: value }));
    },
    [setSettings]
  );

  // Stable: only depends on setSettings (which is now stable)
  const updateFilters = useCallback(
    (filters: Partial<EVBetsSettings['filters']>) => {
      setSettings(prev => ({
        ...prev,
        filters: { ...prev.filters, ...filters },
      }));
    },
    [setSettings]
  );

  // Stable: only depends on setSettings (which is now stable)
  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
  }, [setSettings]);

  return {
    settings,
    setSettings,
    updateSetting,
    updateFilters,
    resetSettings,
  };
}
