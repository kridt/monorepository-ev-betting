import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useLocalStorage,
  useSettings,
  DEFAULT_SETTINGS,
  DEFAULT_CALCULATION_BOOKS,
  type EVBetsSettings,
} from './useLocalStorage';

describe('useLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('basic functionality', () => {
    it('should return initial value when localStorage is empty', () => {
      const { result } = renderHook(() => useLocalStorage('test-key', 'initial'));
      expect(result.current[0]).toBe('initial');
    });

    it('should return stored value from localStorage', () => {
      localStorage.setItem('test-key', JSON.stringify('stored-value'));
      const { result } = renderHook(() => useLocalStorage('test-key', 'initial'));
      expect(result.current[0]).toBe('stored-value');
    });

    it('should update value and persist to localStorage', () => {
      const { result } = renderHook(() => useLocalStorage('test-key', 'initial'));

      act(() => {
        result.current[1]('new-value');
      });

      expect(result.current[0]).toBe('new-value');
      expect(localStorage.setItem).toHaveBeenCalledWith('test-key', JSON.stringify('new-value'));
    });

    it('should support function updater', () => {
      const { result } = renderHook(() => useLocalStorage('counter', 0));

      act(() => {
        result.current[1](prev => prev + 1);
      });

      expect(result.current[0]).toBe(1);

      act(() => {
        result.current[1](prev => prev + 5);
      });

      expect(result.current[0]).toBe(6);
    });

    it('should handle complex objects', () => {
      const initialObj = { name: 'test', count: 0, items: ['a', 'b'] };
      const { result } = renderHook(() => useLocalStorage('obj-key', initialObj));

      expect(result.current[0]).toEqual(initialObj);

      act(() => {
        result.current[1]({ ...initialObj, count: 5 });
      });

      expect(result.current[0]).toEqual({ ...initialObj, count: 5 });
    });

    it('should handle arrays', () => {
      const { result } = renderHook(() => useLocalStorage<string[]>('arr-key', []));

      act(() => {
        result.current[1](['item1', 'item2']);
      });

      expect(result.current[0]).toEqual(['item1', 'item2']);
    });

    it('should handle parse errors gracefully', () => {
      // Store invalid JSON
      (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValueOnce('invalid-json');

      const { result } = renderHook(() => useLocalStorage('bad-key', 'fallback'));
      expect(result.current[0]).toBe('fallback');
    });
  });

  describe('storage event listener', () => {
    it('should update value when storage event fires', () => {
      const { result } = renderHook(() => useLocalStorage('sync-key', 'initial'));

      act(() => {
        // Simulate storage event from another tab
        const event = new StorageEvent('storage', {
          key: 'sync-key',
          newValue: JSON.stringify('external-update'),
        });
        window.dispatchEvent(event);
      });

      expect(result.current[0]).toBe('external-update');
    });

    it('should ignore storage events for different keys', () => {
      const { result } = renderHook(() => useLocalStorage('my-key', 'initial'));

      act(() => {
        const event = new StorageEvent('storage', {
          key: 'other-key',
          newValue: JSON.stringify('other-value'),
        });
        window.dispatchEvent(event);
      });

      expect(result.current[0]).toBe('initial');
    });
  });
});

describe('useSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('should return default settings initially', () => {
    const { result } = renderHook(() => useSettings());
    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('should have correct default values', () => {
    const { result } = renderHook(() => useSettings());
    const { settings } = result.current;

    expect(settings.selectedMethod).toBe('TRIMMED_MEAN_PROB');
    expect(settings.minEV).toBe(5);
    expect(settings.selectedTargets).toEqual([]);
    expect(settings.selectedLeagues).toEqual([]);
    expect(settings.sharpBook).toBe('pinnacle');
    expect(settings.calculationBooks).toEqual(DEFAULT_CALCULATION_BOOKS);
  });

  it('should update a single setting', () => {
    const { result } = renderHook(() => useSettings());

    act(() => {
      result.current.updateSetting('minEV', 10);
    });

    expect(result.current.settings.minEV).toBe(10);
  });

  it('should update selectedTargets', () => {
    const { result } = renderHook(() => useSettings());

    act(() => {
      result.current.updateSetting('selectedTargets', ['bet365', 'pinnacle']);
    });

    expect(result.current.settings.selectedTargets).toEqual(['bet365', 'pinnacle']);
  });

  it('should update calculationBooks', () => {
    const { result } = renderHook(() => useSettings());
    const newBooks = ['pinnacle', 'bet365', 'betano'];

    act(() => {
      result.current.updateSetting('calculationBooks', newBooks);
    });

    expect(result.current.settings.calculationBooks).toEqual(newBooks);
  });

  it('should update sharpBook', () => {
    const { result } = renderHook(() => useSettings());

    act(() => {
      result.current.updateSetting('sharpBook', 'betfair');
    });

    expect(result.current.settings.sharpBook).toBe('betfair');
  });

  it('should update filters', () => {
    const { result } = renderHook(() => useSettings());

    act(() => {
      result.current.updateFilters({ sport: 'soccer', minEV: '5' });
    });

    expect(result.current.settings.filters.sport).toBe('soccer');
    expect(result.current.settings.filters.minEV).toBe('5');
  });

  it('should reset settings to defaults', () => {
    const { result } = renderHook(() => useSettings());

    // Modify settings - use setSettings directly for reliable state update
    act(() => {
      result.current.setSettings({
        ...DEFAULT_SETTINGS,
        minEV: 20,
        sharpBook: 'betfair',
        selectedTargets: ['bet365'],
      });
    });

    expect(result.current.settings.minEV).toBe(20);
    expect(result.current.settings.sharpBook).toBe('betfair');

    // Reset
    act(() => {
      result.current.resetSettings();
    });

    expect(result.current.settings.minEV).toBe(DEFAULT_SETTINGS.minEV);
    expect(result.current.settings.sharpBook).toBe(DEFAULT_SETTINGS.sharpBook);
  });

  it('should persist settings to localStorage', () => {
    const { result } = renderHook(() => useSettings());

    act(() => {
      result.current.updateSetting('minEV', 15);
    });

    expect(localStorage.setItem).toHaveBeenCalled();
    const storedValue = JSON.parse(
      (localStorage.setItem as ReturnType<typeof vi.fn>).mock.calls.slice(-1)[0][1]
    );
    expect(storedValue.minEV).toBe(15);
  });

  it('should load persisted settings from localStorage', () => {
    const customSettings: EVBetsSettings = {
      ...DEFAULT_SETTINGS,
      minEV: 25,
      sharpBook: 'betfair',
      selectedTargets: ['unibet', 'betway'],
    };
    localStorage.setItem('ev-bets-settings', JSON.stringify(customSettings));

    const { result } = renderHook(() => useSettings());

    expect(result.current.settings.minEV).toBe(25);
    expect(result.current.settings.sharpBook).toBe('betfair');
    expect(result.current.settings.selectedTargets).toEqual(['unibet', 'betway']);
  });
});

describe('DEFAULT_CALCULATION_BOOKS', () => {
  it('should contain known sharp books', () => {
    expect(DEFAULT_CALCULATION_BOOKS).toContain('pinnacle');
    expect(DEFAULT_CALCULATION_BOOKS).toContain('betfair');
  });

  it('should contain major sportsbooks', () => {
    expect(DEFAULT_CALCULATION_BOOKS).toContain('bet365');
    expect(DEFAULT_CALCULATION_BOOKS).toContain('draftkings');
    expect(DEFAULT_CALCULATION_BOOKS).toContain('fanduel');
    expect(DEFAULT_CALCULATION_BOOKS).toContain('betmgm');
  });

  it('should contain GGBet', () => {
    expect(DEFAULT_CALCULATION_BOOKS).toContain('ggbet');
  });

  it('should have a reasonable number of books', () => {
    expect(DEFAULT_CALCULATION_BOOKS.length).toBeGreaterThanOrEqual(15);
    expect(DEFAULT_CALCULATION_BOOKS.length).toBeLessThanOrEqual(30);
  });

  it('should have no duplicate entries', () => {
    const uniqueBooks = new Set(DEFAULT_CALCULATION_BOOKS);
    expect(uniqueBooks.size).toBe(DEFAULT_CALCULATION_BOOKS.length);
  });
});

describe('EVBetsSettings type', () => {
  it('should have all required fields in DEFAULT_SETTINGS', () => {
    expect(DEFAULT_SETTINGS).toHaveProperty('selectedMethod');
    expect(DEFAULT_SETTINGS).toHaveProperty('minEV');
    expect(DEFAULT_SETTINGS).toHaveProperty('selectedTargets');
    expect(DEFAULT_SETTINGS).toHaveProperty('selectedLeagues');
    expect(DEFAULT_SETTINGS).toHaveProperty('sharpBook');
    expect(DEFAULT_SETTINGS).toHaveProperty('calculationBooks');
    expect(DEFAULT_SETTINGS).toHaveProperty('filters');
  });

  it('should have all required filter fields', () => {
    expect(DEFAULT_SETTINGS.filters).toHaveProperty('sport');
    expect(DEFAULT_SETTINGS.filters).toHaveProperty('league');
    expect(DEFAULT_SETTINGS.filters).toHaveProperty('targetBook');
    expect(DEFAULT_SETTINGS.filters).toHaveProperty('minEV');
    expect(DEFAULT_SETTINGS.filters).toHaveProperty('maxEV');
    expect(DEFAULT_SETTINGS.filters).toHaveProperty('minBooks');
    expect(DEFAULT_SETTINGS.filters).toHaveProperty('maxOdds');
    expect(DEFAULT_SETTINGS.filters).toHaveProperty('timeWindow');
  });
});
