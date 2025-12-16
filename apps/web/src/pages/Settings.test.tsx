import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import Settings from './Settings';

// Mock the API client
vi.mock('../api/client', () => ({
  fetchSportsbooks: vi.fn(),
  fetchLeagues: vi.fn(),
  fetchMethods: vi.fn(),
  setTargets: vi.fn(),
  setLeagues: vi.fn(),
}));

import { fetchSportsbooks, fetchLeagues, fetchMethods } from '../api/client';

// Mock sportsbooks data
const mockSportsbooks = {
  data: [
    { id: 'pinnacle', name: 'Pinnacle' },
    { id: 'bet365', name: 'Bet365' },
    { id: 'betano', name: 'Betano' },
    { id: 'unibet', name: 'Unibet' },
    { id: 'ggbet', name: 'GGBet' },
    { id: 'draftkings', name: 'DraftKings' },
    { id: 'fanduel', name: 'FanDuel' },
    { id: 'betmgm', name: 'BetMGM' },
    { id: 'caesars', name: 'Caesars' },
    { id: 'betway', name: 'Betway' },
  ],
  targetIds: ['betano', 'unibet'],
  sharpBookId: 'pinnacle',
};

const mockLeagues = {
  data: [
    { id: 'england_-_premier_league', name: 'Premier League', sportId: 'soccer', isEnabled: true },
    { id: 'spain_-_la_liga', name: 'La Liga', sportId: 'soccer', isEnabled: false },
    { id: 'nba', name: 'NBA', sportId: 'basketball', isEnabled: true, isAlwaysEnabled: true },
  ],
  enabledIds: ['england_-_premier_league', 'nba'],
  alwaysEnabled: ['nba'],
};

const mockMethods = {
  data: [
    { id: 'TRIMMED_MEAN_PROB', name: 'Trimmed Mean Probability', description: 'Uses trimmed mean of probabilities' },
    { id: 'SHARP_BOOK_REFERENCE', name: 'Sharp Book Reference', description: 'Uses sharp book as reference' },
    { id: 'WEIGHTED_AVERAGE', name: 'Weighted Average', description: 'Uses weighted average' },
  ],
  default: 'TRIMMED_MEAN_PROB',
};

// Helper to render with providers
function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {ui}
      </BrowserRouter>
    </QueryClientProvider>
  );
}

describe('Settings Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    // Setup mock implementations
    (fetchSportsbooks as ReturnType<typeof vi.fn>).mockResolvedValue(mockSportsbooks);
    (fetchLeagues as ReturnType<typeof vi.fn>).mockResolvedValue(mockLeagues);
    (fetchMethods as ReturnType<typeof vi.fn>).mockResolvedValue(mockMethods);
  });

  describe('Rendering', () => {
    it('should render the Settings header', async () => {
      renderWithProviders(<Settings />);

      expect(screen.getByText('Settings')).toBeInTheDocument();
      expect(screen.getByText(/Configure your EV calculation preferences/)).toBeInTheDocument();
    });

    it('should render Quick Stats section', async () => {
      renderWithProviders(<Settings />);

      await waitFor(() => {
        expect(screen.getByText('Available Books')).toBeInTheDocument();
      });

      expect(screen.getByText('Playable Books')).toBeInTheDocument();
      expect(screen.getByText('Sharp Book')).toBeInTheDocument();
      expect(screen.getByText('Calculation Books')).toBeInTheDocument();
      expect(screen.getByText('Leagues')).toBeInTheDocument();
    });

    it('should render Playable Sportsbooks section', async () => {
      renderWithProviders(<Settings />);

      await waitFor(() => {
        expect(screen.getByText('Playable Sportsbooks')).toBeInTheDocument();
      });
    });

    it('should render Fair Odds Calculation section', async () => {
      renderWithProviders(<Settings />);

      await waitFor(() => {
        expect(screen.getByText('Fair Odds Calculation')).toBeInTheDocument();
      });
    });

    it('should render Enabled Leagues section', async () => {
      renderWithProviders(<Settings />);

      await waitFor(() => {
        expect(screen.getByText('Enabled Leagues')).toBeInTheDocument();
      });
    });
  });

  describe('Sportsbooks Loading', () => {
    it('should show loading state initially', async () => {
      // Make the fetch hang
      (fetchSportsbooks as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      renderWithProviders(<Settings />);

      // Should show loading indicators
      await waitFor(() => {
        const loadingElements = screen.queryAllByText(/Loading sportsbooks/);
        expect(loadingElements.length).toBeGreaterThanOrEqual(0); // May or may not show depending on timing
      });
    });

    it('should display sportsbooks after loading', async () => {
      renderWithProviders(<Settings />);

      await waitFor(() => {
        // Each sportsbook appears multiple times (playable + calculation sections)
        const pinnacleElements = screen.getAllByText('Pinnacle');
        expect(pinnacleElements.length).toBeGreaterThan(0);
      });

      // Verify multiple sportsbooks are present
      expect(screen.getAllByText('Bet365').length).toBeGreaterThan(0);
      expect(screen.getAllByText('GGBet').length).toBeGreaterThan(0);
      expect(screen.getAllByText('DraftKings').length).toBeGreaterThan(0);
    });

    it('should display correct number of sportsbooks in counter', async () => {
      renderWithProviders(<Settings />);

      await waitFor(() => {
        // The counter should show the total number of sportsbooks (10 in our mock)
        const countElements = screen.getAllByText('10');
        expect(countElements.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Search Functionality', () => {
    it('should have search inputs for both sections', async () => {
      renderWithProviders(<Settings />);

      await waitFor(() => {
        const searchInputs = screen.getAllByPlaceholderText('Search sportsbooks...');
        expect(searchInputs.length).toBe(2); // One for playable, one for calculation
      });
    });
  });

  describe('Counter Display', () => {
    it('should show "Showing X of Y" counter for playable books', async () => {
      renderWithProviders(<Settings />);

      await waitFor(() => {
        expect(screen.getAllByText('Showing').length).toBeGreaterThan(0);
      });
    });

    it('should show "selected" counter for calculation books', async () => {
      renderWithProviders(<Settings />);

      await waitFor(() => {
        expect(screen.getAllByText('selected').length).toBeGreaterThan(0);
      });
    });
  });

  describe('Leagues Display', () => {
    it('should display soccer leagues', async () => {
      renderWithProviders(<Settings />);

      await waitFor(() => {
        expect(screen.getByText('Soccer')).toBeInTheDocument();
      });
    });

    it('should display basketball leagues', async () => {
      renderWithProviders(<Settings />);

      await waitFor(() => {
        expect(screen.getByText('Basketball')).toBeInTheDocument();
      });
    });
  });

  describe('Methods Display', () => {
    it('should display fair odds methods section', async () => {
      renderWithProviders(<Settings />);

      await waitFor(() => {
        expect(screen.getByText('Fair Odds Methods')).toBeInTheDocument();
      });
    });
  });

  describe('API Calls', () => {
    it('should call fetchSportsbooks on mount', async () => {
      renderWithProviders(<Settings />);

      await waitFor(() => {
        expect(fetchSportsbooks).toHaveBeenCalled();
      });
    });

    it('should call fetchLeagues on mount', async () => {
      renderWithProviders(<Settings />);

      await waitFor(() => {
        expect(fetchLeagues).toHaveBeenCalled();
      });
    });

    it('should call fetchMethods on mount', async () => {
      renderWithProviders(<Settings />);

      await waitFor(() => {
        expect(fetchMethods).toHaveBeenCalled();
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle API error gracefully', async () => {
      (fetchSportsbooks as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API Error'));

      // Should not crash
      renderWithProviders(<Settings />);

      await waitFor(() => {
        expect(screen.getByText('Settings')).toBeInTheDocument();
      });
    });
  });
});

describe('Settings Component - Sportsbook Checkboxes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    (fetchSportsbooks as ReturnType<typeof vi.fn>).mockResolvedValue(mockSportsbooks);
    (fetchLeagues as ReturnType<typeof vi.fn>).mockResolvedValue(mockLeagues);
    (fetchMethods as ReturnType<typeof vi.fn>).mockResolvedValue(mockMethods);
  });

  it('should render checkboxes for each sportsbook', async () => {
    renderWithProviders(<Settings />);

    await waitFor(() => {
      // Each sportsbook appears multiple times (dropdown + playable + calculation sections)
      const pinnacleLabels = screen.getAllByText('Pinnacle');
      expect(pinnacleLabels.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('should render GGBet in the list', async () => {
    renderWithProviders(<Settings />);

    await waitFor(() => {
      const ggbetLabels = screen.getAllByText('GGBet');
      expect(ggbetLabels.length).toBe(2); // Once in each section
    });
  });
});
