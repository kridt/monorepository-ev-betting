import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { fetchOpportunities, fetchMethods, fetchBatchFixtureStats, validateBet, type NBAValidationResult, type OpportunityResponse } from '../api/client';
// NBA validation is now pre-computed on the server and included in the API response (opp.nbaValidation)
import { useSettings } from '../hooks/useLocalStorage';
import { useTracking } from '../hooks/useTracking';
import { useRemoved } from '../hooks/useRemoved';
import type { FixtureStats, ValidationResult, BookOdds } from '@ev-bets/shared';
import clsx from 'clsx';

// Types
interface Opportunity {
  id: string;
  fixtureId: string;
  sport: string;
  league: string;
  leagueName?: string;
  homeTeam?: string;
  awayTeam?: string;
  startsAt: string;
  market: string;
  selection: string;
  line?: number;
  playerName?: string;
  evPercent: number;
  targetBook: string;
  targetBookId?: string;
  offeredOdds: number;
  fairOdds: number;
  method: string;
  bookCount: number;
  bookOdds?: BookOdds[];
  nbaValidation?: NBAValidationResult; // Pre-computed NBA validation from server
}

interface GroupedMatch {
  fixtureId: string;
  sport: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  startsAt: string;
  opportunities: Opportunity[];
  bestEV: number;
  avgEV: number;
}

// Helper functions
function getEVTier(ev: number): 'legendary' | 'epic' | 'rare' | 'common' {
  if (ev >= 50) return 'legendary';
  if (ev >= 20) return 'epic';
  if (ev >= 10) return 'rare';
  return 'common';
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  }
  if (date.toDateString() === tomorrow.toDateString()) {
    return 'Tomorrow';
  }
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatMarketName(market: string): string {
  const marketMappings: Record<string, string> = {
    'player_shots_over_under': 'Shots',
    'player_shots_on_target_over_under': 'Shots on Target',
    'player_tackles_over_under': 'Tackles',
    'player_fouls_over_under': 'Fouls',
    'player_assists_over_under': 'Assists',
    'player_goals_over_under': 'Goals',
    'player_passes_over_under': 'Passes',
    'player_crosses_over_under': 'Crosses',
    'player_clearances_over_under': 'Clearances',
    'player_interceptions_over_under': 'Interceptions',
    'player_blocks_over_under': 'Blocks',
    'player_offsides_over_under': 'Offsides',
    'player_saves_over_under': 'Saves',
    'player_cards_over_under': 'Cards',
    'player_yellow_cards_over_under': 'Yellow Cards',
    'player_red_cards_over_under': 'Red Cards',
    'moneyline': 'Winner',
    'spread': 'Spread',
    'total': 'Total',
    'btts': 'BTTS',
    'double_chance': 'Double Chance',
    'draw_no_bet': 'Draw No Bet',
    'player_points_over_under': 'Points',
    'player_rebounds_over_under': 'Rebounds',
    'player_threes_over_under': '3PT Made',
    'player_steals_over_under': 'Steals',
    'player_turnovers_over_under': 'Turnovers',
    'player_pra_over_under': 'PRA',
    'player_pr_over_under': 'P+R',
    'player_pa_over_under': 'P+A',
    'player_ra_over_under': 'R+A',
  };

  if (marketMappings[market]) {
    return marketMappings[market];
  }

  return market
    .replace(/_over_under$/, '')
    .replace(/^player_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function getSportIcon(sport: string): string {
  return sport === 'basketball' ? '🏀' : '⚽';
}

// Check if a market is a player prop
function isPlayerProp(market: string): boolean {
  const m = market.toLowerCase();
  return m.startsWith('player_') ||
    m.includes('points') ||
    m.includes('rebounds') ||
    m.includes('assists') ||
    m.includes('steals') ||
    m.includes('blocks') ||
    m.includes('threes') ||
    m.includes('turnovers') ||
    m.includes('pra') ||
    m.includes('shots') ||
    m.includes('tackles') ||
    m.includes('fouls') ||
    m.includes('passes');
}

// Check if selection looks like a player prop (Name Over/Under X.X)
function isPlayerPropSelection(selection: string): boolean {
  return /^.+\s+(over|under)\s+[\d.]+$/i.test(selection);
}

// Extract player name from selection (e.g., "Jaylen Brown Over 42.5" -> "Jaylen Brown")
function extractPlayerName(selection: string, playerName?: string): string | undefined {
  if (playerName) return playerName;
  // Try to extract from selection by removing "Over X.X" or "Under X.X"
  const match = selection.match(/^(.+?)\s+(over|under)\s+[\d.]+$/i);
  return match ? match[1].trim() : undefined;
}

function getOrdinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

// Sort options for matches
type MatchSortOption = 'startsAt' | 'bestEV' | 'avgEV' | 'opportunityCount';

const SORT_OPTIONS: { value: MatchSortOption; label: string; description: string }[] = [
  { value: 'startsAt', label: 'Start Time', description: 'Next starting first' },
  { value: 'bestEV', label: 'Best EV', description: 'Highest EV first' },
  { value: 'avgEV', label: 'Average EV', description: 'Highest avg EV first' },
  { value: 'opportunityCount', label: 'Most Bets', description: 'Most opportunities first' },
];

function groupByMatch(opportunities: Opportunity[], sortBy: MatchSortOption = 'startsAt'): GroupedMatch[] {
  const grouped = new Map<string, GroupedMatch>();

  for (const opp of opportunities) {
    const key = opp.fixtureId;

    if (!grouped.has(key)) {
      grouped.set(key, {
        fixtureId: opp.fixtureId,
        sport: opp.sport,
        league: opp.league,
        homeTeam: opp.homeTeam || 'TBD',
        awayTeam: opp.awayTeam || 'TBD',
        startsAt: opp.startsAt,
        opportunities: [],
        bestEV: 0,
        avgEV: 0,
      });
    }

    const match = grouped.get(key)!;
    match.opportunities.push(opp);
    match.bestEV = Math.max(match.bestEV, opp.evPercent);
  }

  // Calculate avg EV and sort opportunities within each match
  for (const match of grouped.values()) {
    match.avgEV = match.opportunities.reduce((sum, o) => sum + o.evPercent, 0) / match.opportunities.length;
    match.opportunities.sort((a, b) => b.evPercent - a.evPercent);
  }

  // Sort matches based on selected option
  const matches = Array.from(grouped.values());

  switch (sortBy) {
    case 'startsAt':
      // Sort by start time ascending (next starting first)
      return matches.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    case 'bestEV':
      // Sort by best EV descending
      return matches.sort((a, b) => b.bestEV - a.bestEV);
    case 'avgEV':
      // Sort by average EV descending
      return matches.sort((a, b) => b.avgEV - a.avgEV);
    case 'opportunityCount':
      // Sort by number of opportunities descending
      return matches.sort((a, b) => b.opportunities.length - a.opportunities.length);
    default:
      return matches.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }
}

export default function Opportunities() {
  const { settings, updateFilters } = useSettings();
  const { trackedIds, isTracked, toggleTrack, trackAllForFixture, isLoading: isTrackingLoading } = useTracking();
  const { removedIds, isRemoved, remove, removeAllForFixture } = useRemoved();

  const [filters, setFilters] = useState({
    sport: settings.filters.sport || '',
    league: settings.filters.league || '',
    targetBook: settings.filters.targetBook || '',
    minEV: settings.filters.minEV || '',
    maxEV: settings.filters.maxEV || '',
    minBooks: settings.filters.minBooks || '',
    maxOdds: settings.filters.maxOdds || '',
    timeWindow: settings.filters.timeWindow || '',
    q: '',
    method: '',
    sortBy: 'startsAt' as MatchSortOption, // Default to start time (next starting first)
  });
  const [page, setPage] = useState(1);
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
  const [showFilters, setShowFilters] = useState(false);
  const [validationResults, setValidationResults] = useState<Record<string, ValidationResult | null>>({});
  const [validatingIds, setValidatingIds] = useState<Set<string>>(new Set());
  // NBA validation is pre-computed on the server - no client-side state needed

  // Mutation for validating bets
  const validateMutation = useMutation({
    mutationFn: validateBet,
    onSuccess: (response, variables) => {
      // Create a unique key for this bet
      const key = `${variables.playerName}-${variables.market}-${variables.line}`;
      setValidationResults(prev => ({
        ...prev,
        [key]: response.data,
      }));
    },
  });

  const handleValidate = (e: React.MouseEvent, opp: Opportunity) => {
    e.preventDefault(); // Prevent link navigation
    e.stopPropagation();

    if (!opp.playerName || opp.line === undefined) return;

    const key = `${opp.playerName}-${opp.market}-${opp.line}`;

    // Don't validate again if already done
    if (validationResults[key] !== undefined) return;

    setValidatingIds(prev => new Set(prev).add(opp.id));

    validateMutation.mutate(
      {
        playerName: opp.playerName,
        market: opp.market,
        line: opp.line,
        selection: opp.selection,
        matchCount: 10,
      },
      {
        onSettled: () => {
          setValidatingIds(prev => {
            const next = new Set(prev);
            next.delete(opp.id);
            return next;
          });
        },
      }
    );
  };

  const getValidationResult = (opp: Opportunity): ValidationResult | null | undefined => {
    if (!opp.playerName || opp.line === undefined) return undefined;
    const key = `${opp.playerName}-${opp.market}-${opp.line}`;
    return validationResults[key];
  };
  // NBA validation is pre-computed - use opp.nbaValidation directly from API response

  // Persist filters to localStorage (except search query)
  useEffect(() => {
    updateFilters({
      sport: filters.sport,
      league: filters.league,
      targetBook: filters.targetBook,
      minEV: filters.minEV,
      maxEV: filters.maxEV,
      minBooks: filters.minBooks,
      maxOdds: filters.maxOdds,
      timeWindow: filters.timeWindow,
    });
  }, [filters.sport, filters.league, filters.targetBook, filters.minEV, filters.maxEV, filters.minBooks, filters.maxOdds, filters.timeWindow, updateFilters]);

  const { data: methods } = useQuery({
    queryKey: ['methods'],
    queryFn: fetchMethods,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['opportunities', filters, page],
    queryFn: () => {
      const params: Parameters<typeof fetchOpportunities>[0] = {
        sport: filters.sport,
        league: filters.league,
        targetBook: filters.targetBook,
        q: filters.q,
        method: filters.method,
        page,
        pageSize: 100, // Get more to group properly
        sortBy: 'evPercent',
        sortDir: 'desc',
      };
      if (filters.minEV) params.minEV = parseFloat(filters.minEV);
      if (filters.maxEV) params.maxEV = parseFloat(filters.maxEV);
      if (filters.minBooks) params.minBooks = parseInt(filters.minBooks, 10);
      if (filters.maxOdds) params.maxOdds = parseFloat(filters.maxOdds);
      if (filters.timeWindow) params.timeWindow = filters.timeWindow;
      return fetchOpportunities(params);
    },
    refetchInterval: 60000,
  });
  // NBA validation is pre-computed on the server - no auto-validation needed

  const groupedMatches = useMemo(() => {
    if (!data?.data) return [];
    // Filter out tracked and removed bets
    const filteredData = data.data.filter(
      opp => !trackedIds.has(opp.id) && !removedIds.has(opp.id)
    );
    // Group by match, sort by selected option, and limit to 10 matches
    return groupByMatch(filteredData, filters.sortBy).slice(0, 10);
  }, [data?.data, filters.sortBy, trackedIds, removedIds]);

  // Get soccer fixture IDs for stats fetching
  const soccerFixtureIds = useMemo(() => {
    return groupedMatches
      .filter(m => m.sport === 'soccer')
      .map(m => m.fixtureId);
  }, [groupedMatches]);

  // Fetch stats for soccer fixtures
  const { data: statsData } = useQuery({
    queryKey: ['fixture-stats', soccerFixtureIds],
    queryFn: () => fetchBatchFixtureStats(soccerFixtureIds),
    enabled: soccerFixtureIds.length > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  });

  // Map fixture ID to stats
  const fixtureStats: Record<string, FixtureStats | null> = statsData?.data || {};

  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const DEFAULT_VISIBLE = 5;
  const SHOW_MORE_INCREMENT = 5;

  const getVisibleCount = (fixtureId: string) => {
    return visibleCounts[fixtureId] ?? DEFAULT_VISIBLE;
  };

  const showMore = (fixtureId: string) => {
    setVisibleCounts(prev => ({
      ...prev,
      [fixtureId]: (prev[fixtureId] ?? DEFAULT_VISIBLE) + SHOW_MORE_INCREMENT,
    }));
  };

  const showLess = (fixtureId: string) => {
    setVisibleCounts(prev => ({
      ...prev,
      [fixtureId]: DEFAULT_VISIBLE,
    }));
  };

  const showAllForMatch = (fixtureId: string, total: number) => {
    setVisibleCounts(prev => ({
      ...prev,
      [fixtureId]: total,
    }));
  };

  const clearFilters = () => {
    setFilters({
      sport: '',
      league: '',
      targetBook: '',
      minEV: '',
      maxEV: '',
      minBooks: '',
      maxOdds: '',
      timeWindow: '',
      q: '',
      method: '',
      sortBy: 'startsAt', // Reset to default sort
    });
    setPage(1);
  };

  // Check for active filters (exclude sortBy since it always has a value)
  const hasActiveFilters = Object.entries(filters).some(([key, v]) => key !== 'sortBy' && v !== '');
  const totalOpportunities = data?.data?.length || 0;

  return (
    <div className="space-y-6 pb-12">
      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 border border-purple-500/20 p-8">
        <div className="absolute inset-0 bg-grid-pattern opacity-5"></div>
        <div className="absolute top-0 right-0 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl"></div>

        <div className="relative">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-cyan-500 shadow-lg shadow-purple-500/25">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path>
              </svg>
            </div>
            <div>
              <h1 className="text-3xl font-black text-white">EV Opportunities</h1>
              <p className="text-purple-300/70">Positive expected value bets across all markets</p>
            </div>
          </div>

          {/* Stats Row */}
          <div className="flex flex-wrap items-center gap-4 mt-6">
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 backdrop-blur">
              <span className="text-2xl font-bold text-white">{groupedMatches.length}</span>
              <span className="text-sm text-purple-300/70">Matches</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 backdrop-blur">
              <span className="text-2xl font-bold text-emerald-400">{totalOpportunities}</span>
              <span className="text-sm text-purple-300/70">Opportunities</span>
            </div>
            {data?.stats && (
              <>
                <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 border border-emerald-500/30">
                  <span className="text-2xl font-bold text-emerald-400">+{data.stats.maxEV?.toFixed(1)}%</span>
                  <span className="text-sm text-emerald-300/70">Best EV</span>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 backdrop-blur">
                  <span className="text-2xl font-bold text-cyan-400">+{data.stats.avgEV?.toFixed(1)}%</span>
                  <span className="text-sm text-purple-300/70">Avg EV</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={clsx(
              'flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-all duration-300',
              showFilters
                ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/25'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700/80 border border-slate-700/50'
            )}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"></path>
            </svg>
            Filters
            {hasActiveFilters && (
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-white/20 text-xs">
                {Object.entries(filters).filter(([key, v]) => key !== 'sortBy' && v !== '').length}
              </span>
            )}
          </button>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-red-400 hover:bg-red-500/10 transition-all duration-300"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Sort Dropdown */}
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"></path>
            </svg>
            <select
              className="px-3 py-2 rounded-xl bg-slate-800/80 border border-slate-700/50 text-white text-sm font-medium focus:outline-none focus:border-purple-500/50 transition-all cursor-pointer"
              value={filters.sortBy}
              onChange={e => handleFilterChange('sortBy', e.target.value)}
            >
              {SORT_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <span className="text-sm text-slate-500">{data?.pagination?.total || 0} total bets</span>
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="animate-slideDown rounded-2xl bg-slate-900/80 border border-slate-700/50 p-6 backdrop-blur-xl">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {/* Search */}
            <div className="col-span-2 md:col-span-1">
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Search</label>
              <input
                type="text"
                className="w-full px-3 py-2.5 rounded-xl bg-slate-800/50 border border-slate-700/50 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 transition-all"
                placeholder="Team, player..."
                value={filters.q}
                onChange={e => handleFilterChange('q', e.target.value)}
              />
            </div>

            {/* Sport */}
            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Sport</label>
              <select
                className="w-full px-3 py-2.5 rounded-xl bg-slate-800/50 border border-slate-700/50 text-white focus:outline-none focus:border-purple-500/50 transition-all"
                value={filters.sport}
                onChange={e => handleFilterChange('sport', e.target.value)}
              >
                <option value="">All Sports</option>
                {data?.filters?.sports?.map(sport => (
                  <option key={sport} value={sport}>{sport.charAt(0).toUpperCase() + sport.slice(1)}</option>
                ))}
              </select>
            </div>

            {/* League */}
            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">League</label>
              <select
                className="w-full px-3 py-2.5 rounded-xl bg-slate-800/50 border border-slate-700/50 text-white focus:outline-none focus:border-purple-500/50 transition-all"
                value={filters.league}
                onChange={e => handleFilterChange('league', e.target.value)}
              >
                <option value="">All Leagues</option>
                {data?.filters?.leagues?.map(league => (
                  <option key={league} value={league}>{league.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>

            {/* Sportsbook */}
            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Book</label>
              <select
                className="w-full px-3 py-2.5 rounded-xl bg-slate-800/50 border border-slate-700/50 text-white focus:outline-none focus:border-purple-500/50 transition-all"
                value={filters.targetBook}
                onChange={e => handleFilterChange('targetBook', e.target.value)}
              >
                <option value="">All Books</option>
                {data?.filters?.targetBooks?.map(book => (
                  <option key={book} value={book}>{book.charAt(0).toUpperCase() + book.slice(1)}</option>
                ))}
              </select>
            </div>

            {/* Time Window */}
            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Time</label>
              <select
                className="w-full px-3 py-2.5 rounded-xl bg-slate-800/50 border border-slate-700/50 text-white focus:outline-none focus:border-purple-500/50 transition-all"
                value={filters.timeWindow}
                onChange={e => handleFilterChange('timeWindow', e.target.value)}
              >
                <option value="">All Time</option>
                <option value="3h">Next 3h</option>
                <option value="6h">Next 6h</option>
                <option value="12h">Next 12h</option>
                <option value="24h">Next 24h</option>
                <option value="48h">Next 48h</option>
              </select>
            </div>
          </div>

          {/* Advanced Filters Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-slate-800/50">
            <div className="col-span-2 md:col-span-4">
              <span className="text-xs font-medium text-purple-400 uppercase tracking-wider">Advanced Filters</span>
            </div>

            {/* Min EV */}
            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Min EV%</label>
              <input
                type="number"
                className="w-full px-3 py-2.5 rounded-xl bg-slate-800/50 border border-slate-700/50 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500/50 transition-all"
                placeholder="5"
                min="0"
                step="0.5"
                value={filters.minEV}
                onChange={e => handleFilterChange('minEV', e.target.value)}
              />
            </div>

            {/* Max EV */}
            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Max EV%</label>
              <input
                type="number"
                className="w-full px-3 py-2.5 rounded-xl bg-slate-800/50 border border-slate-700/50 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500/50 transition-all"
                placeholder="100"
                min="0"
                step="0.5"
                value={filters.maxEV}
                onChange={e => handleFilterChange('maxEV', e.target.value)}
              />
            </div>

            {/* Min Books */}
            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Min Books</label>
              <input
                type="number"
                className="w-full px-3 py-2.5 rounded-xl bg-slate-800/50 border border-slate-700/50 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500/50 transition-all"
                placeholder="3"
                min="1"
                max="20"
                step="1"
                value={filters.minBooks}
                onChange={e => handleFilterChange('minBooks', e.target.value)}
              />
            </div>

            {/* Max Odds */}
            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Max Odds</label>
              <input
                type="number"
                className="w-full px-3 py-2.5 rounded-xl bg-slate-800/50 border border-slate-700/50 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500/50 transition-all"
                placeholder="5.00"
                min="1"
                step="0.1"
                value={filters.maxOdds}
                onChange={e => handleFilterChange('maxOdds', e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="relative">
            <div className="w-16 h-16 rounded-full border-4 border-purple-500/20 border-t-purple-500 animate-spin"></div>
            <div className="absolute inset-0 w-16 h-16 rounded-full border-4 border-transparent border-r-cyan-500 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }}></div>
          </div>
          <p className="mt-6 text-slate-400 animate-pulse">Loading opportunities...</p>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
            <svg className="w-10 h-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          </div>
          <p className="text-red-400 font-medium">Error loading opportunities</p>
          <p className="text-slate-500 text-sm mt-1">{(error as Error).message}</p>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && groupedMatches.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-20 h-20 rounded-full bg-slate-800/50 flex items-center justify-center mb-4">
            <svg className="w-10 h-10 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          </div>
          <p className="text-slate-300 font-medium">No opportunities found</p>
          <p className="text-slate-500 text-sm mt-1">Try adjusting your filters or check back later</p>
        </div>
      )}

      {/* Matches List */}
      {!isLoading && !error && groupedMatches.length > 0 && (
        <div className="space-y-6">
          {groupedMatches.map((match, matchIndex) => {
            const evTier = getEVTier(match.bestEV);
            const visibleCount = getVisibleCount(match.fixtureId);
            const visibleOpportunities = match.opportunities.slice(0, visibleCount);
            const hasMore = match.opportunities.length > visibleCount;
            const remainingCount = match.opportunities.length - visibleCount;

            return (
              <div
                key={match.fixtureId}
                className={clsx(
                  'group rounded-2xl border overflow-hidden transition-all duration-500',
                  'animate-fadeInUp',
                  evTier === 'legendary' && 'border-amber-500/50 shadow-lg shadow-amber-500/10 bg-gradient-to-br from-slate-900 via-amber-950/10 to-slate-900',
                  evTier === 'epic' && 'border-purple-500/30 shadow-lg shadow-purple-500/5 bg-gradient-to-br from-slate-900 via-purple-950/10 to-slate-900',
                  evTier === 'rare' && 'border-cyan-500/20 bg-slate-900/80',
                  evTier === 'common' && 'border-slate-700/50 bg-slate-900/60'
                )}
                style={{ animationDelay: `${matchIndex * 50}ms` }}
              >
                {/* Match Header */}
                <div className="px-6 py-4 flex items-center justify-between border-b border-slate-800/50">
                  <div className="flex items-center gap-4">
                    {/* Sport Icon */}
                    <div className={clsx(
                      'flex items-center justify-center w-12 h-12 rounded-xl text-2xl',
                      evTier === 'legendary' && 'bg-gradient-to-br from-amber-500/20 to-orange-500/20 shadow-lg shadow-amber-500/20',
                      evTier === 'epic' && 'bg-gradient-to-br from-purple-500/20 to-pink-500/20',
                      evTier === 'rare' && 'bg-cyan-500/10',
                      evTier === 'common' && 'bg-slate-800/50'
                    )}>
                      {getSportIcon(match.sport)}
                    </div>

                    {/* Match Info */}
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        <h3 className={clsx(
                          'text-lg font-bold',
                          evTier === 'legendary' && 'text-amber-100',
                          evTier === 'epic' && 'text-purple-100',
                          (evTier === 'rare' || evTier === 'common') && 'text-white'
                        )}>
                          {match.homeTeam} <span className="text-slate-500 font-normal">vs</span> {match.awayTeam}
                        </h3>
                        {evTier === 'legendary' && (
                          <span className="animate-pulse">🔥</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-sm text-slate-500">
                        <span>{match.league.replace(/_/g, ' ')}</span>
                        <span>•</span>
                        <span>{formatDate(match.startsAt)} {formatTime(match.startsAt)}</span>
                      </div>
                      {/* Team Stats (Soccer only) */}
                      {match.sport === 'soccer' && fixtureStats[match.fixtureId] && (
                        <div className="flex items-center gap-4 mt-2 text-xs">
                          {fixtureStats[match.fixtureId]?.homeTeam && (
                            <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-slate-800/30">
                              <span className="text-slate-400 font-medium">
                                {fixtureStats[match.fixtureId]?.homeTeam?.shortName || match.homeTeam.slice(0, 3).toUpperCase()}:
                              </span>
                              {fixtureStats[match.fixtureId]?.homeTeam?.form && (
                                <span className="font-mono tracking-wide">
                                  {fixtureStats[match.fixtureId]?.homeTeam?.form?.split('').map((result, i) => (
                                    <span
                                      key={i}
                                      className={clsx(
                                        'font-bold',
                                        result === 'W' && 'text-emerald-400',
                                        result === 'D' && 'text-slate-400',
                                        result === 'L' && 'text-red-400'
                                      )}
                                    >
                                      {result}
                                    </span>
                                  ))}
                                </span>
                              )}
                              {fixtureStats[match.fixtureId]?.homeTeam?.position && (
                                <span className="text-cyan-400">
                                  ({fixtureStats[match.fixtureId]?.homeTeam?.position}{getOrdinalSuffix(fixtureStats[match.fixtureId]?.homeTeam?.position || 0)})
                                </span>
                              )}
                              {fixtureStats[match.fixtureId]?.homeTeam?.avgGoalsScored !== undefined && (
                                <span className="text-emerald-400">
                                  {fixtureStats[match.fixtureId]?.homeTeam?.avgGoalsScored?.toFixed(1)} gpg
                                </span>
                              )}
                            </div>
                          )}
                          {fixtureStats[match.fixtureId]?.awayTeam && (
                            <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-slate-800/30">
                              <span className="text-slate-400 font-medium">
                                {fixtureStats[match.fixtureId]?.awayTeam?.shortName || match.awayTeam.slice(0, 3).toUpperCase()}:
                              </span>
                              {fixtureStats[match.fixtureId]?.awayTeam?.form && (
                                <span className="font-mono tracking-wide">
                                  {fixtureStats[match.fixtureId]?.awayTeam?.form?.split('').map((result, i) => (
                                    <span
                                      key={i}
                                      className={clsx(
                                        'font-bold',
                                        result === 'W' && 'text-emerald-400',
                                        result === 'D' && 'text-slate-400',
                                        result === 'L' && 'text-red-400'
                                      )}
                                    >
                                      {result}
                                    </span>
                                  ))}
                                </span>
                              )}
                              {fixtureStats[match.fixtureId]?.awayTeam?.position && (
                                <span className="text-cyan-400">
                                  ({fixtureStats[match.fixtureId]?.awayTeam?.position}{getOrdinalSuffix(fixtureStats[match.fixtureId]?.awayTeam?.position || 0)})
                                </span>
                              )}
                              {fixtureStats[match.fixtureId]?.awayTeam?.avgGoalsScored !== undefined && (
                                <span className="text-emerald-400">
                                  {fixtureStats[match.fixtureId]?.awayTeam?.avgGoalsScored?.toFixed(1)} gpg
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Stats & Actions */}
                  <div className="flex items-center gap-4">
                    {/* Opportunity Count */}
                    <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/50">
                      <span className="text-slate-400 text-sm">{match.opportunities.length}</span>
                      <span className="text-slate-600 text-xs">bets</span>
                    </div>

                    {/* Avg EV */}
                    <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/50">
                      <span className="text-cyan-400 text-sm font-medium">+{match.avgEV.toFixed(1)}%</span>
                      <span className="text-slate-600 text-xs">avg</span>
                    </div>

                    {/* Best EV */}
                    <div className={clsx(
                      'flex items-center gap-2 px-4 py-2 rounded-xl font-bold',
                      evTier === 'legendary' && 'bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-400 shadow-lg shadow-amber-500/10',
                      evTier === 'epic' && 'bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-purple-400',
                      evTier === 'rare' && 'bg-cyan-500/10 text-cyan-400',
                      evTier === 'common' && 'bg-emerald-500/10 text-emerald-400'
                    )}>
                      +{match.bestEV.toFixed(1)}%
                    </div>

                    {/* Track All Button */}
                    <button
                      onClick={() => trackAllForFixture(match.opportunities as unknown as OpportunityResponse[], match.fixtureId)}
                      disabled={isTrackingLoading(`fixture-${match.fixtureId}`)}
                      className={clsx(
                        'flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-300',
                        'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30',
                        'disabled:opacity-50 disabled:cursor-not-allowed'
                      )}
                      title="Track all bets for this match"
                    >
                      {isTrackingLoading(`fixture-${match.fixtureId}`) ? (
                        <div className="w-4 h-4 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin"></div>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                        </svg>
                      )}
                      <span className="hidden lg:inline">Track All</span>
                    </button>

                    {/* Remove All Button */}
                    <button
                      onClick={() => removeAllForFixture(match.opportunities, match.fixtureId)}
                      className={clsx(
                        'flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-300',
                        'bg-slate-700/50 text-slate-400 hover:bg-red-500/20 hover:text-red-400 border border-slate-600/50 hover:border-red-500/30'
                      )}
                      title="Hide all bets for this match"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path>
                      </svg>
                      <span className="hidden lg:inline">Hide All</span>
                    </button>
                  </div>
                </div>

                {/* Opportunities List */}
                <div className="p-3 space-y-2">
                  {visibleOpportunities.map((opp, oppIndex) => {
                      const oppTier = getEVTier(opp.evPercent);
                      const playableBooks = opp.bookOdds?.filter(b => b.isTarget) || [];
                      const otherBooks = opp.bookOdds?.filter(b => !b.isTarget) || [];
                      const isEven = oppIndex % 2 === 0;

                      return (
                        <div
                          key={opp.id}
                          className={clsx(
                            'px-5 py-4 rounded-xl transition-all duration-300 hover:scale-[1.01]',
                            'animate-fadeInSlide',
                            // Base background with alternating pattern
                            isEven ? 'bg-slate-800/40' : 'bg-slate-800/20',
                            // Tier-specific styling
                            oppTier === 'legendary' && 'bg-gradient-to-r from-amber-950/40 via-amber-900/20 to-slate-800/40 border border-amber-500/40 shadow-lg shadow-amber-500/10',
                            oppTier === 'epic' && 'bg-gradient-to-r from-purple-950/40 via-purple-900/20 to-slate-800/40 border border-purple-500/30 shadow-md shadow-purple-500/10',
                            oppTier === 'rare' && 'border border-cyan-500/20 hover:border-cyan-500/40',
                            oppTier === 'common' && 'border border-slate-700/50 hover:border-slate-600/50',
                            // Left accent border
                            oppTier === 'legendary' && 'border-l-4 border-l-amber-500',
                            oppTier === 'epic' && 'border-l-4 border-l-purple-500',
                            oppTier === 'rare' && 'border-l-4 border-l-cyan-500',
                            oppTier === 'common' && 'border-l-4 border-l-emerald-500/50'
                          )}
                          style={{ animationDelay: `${oppIndex * 50}ms` }}
                        >
                          {/* Row 1: Player/Selection | Market | Line | EV% */}
                          <div className="flex items-center justify-between gap-4 mb-3">
                            <div className="flex items-center gap-3 min-w-0">
                              {/* Rank Number */}
                              <span className={clsx(
                                'shrink-0 flex items-center justify-center w-7 h-7 rounded-lg text-xs font-bold',
                                oppTier === 'legendary' && 'bg-amber-500/30 text-amber-300',
                                oppTier === 'epic' && 'bg-purple-500/30 text-purple-300',
                                oppTier === 'rare' && 'bg-cyan-500/20 text-cyan-400',
                                oppTier === 'common' && 'bg-slate-700/80 text-slate-400'
                              )}>
                                #{oppIndex + 1}
                              </span>

                              {/* Player/Selection Name */}
                              <span className={clsx(
                                'font-semibold text-lg truncate',
                                oppTier === 'legendary' && 'text-amber-100',
                                oppTier === 'epic' && 'text-purple-100',
                                (oppTier === 'rare' || oppTier === 'common') && 'text-white'
                              )}>
                                {opp.playerName || opp.selection}
                              </span>

                              {/* Market Badge */}
                              <span className={clsx(
                                'shrink-0 px-2.5 py-1 rounded-lg text-xs font-semibold',
                                oppTier === 'legendary' && 'bg-amber-900/50 text-amber-200 border border-amber-700/50',
                                oppTier === 'epic' && 'bg-purple-900/50 text-purple-200 border border-purple-700/50',
                                oppTier === 'rare' && 'bg-slate-700 text-cyan-300 border border-slate-600',
                                oppTier === 'common' && 'bg-slate-700 text-slate-300 border border-slate-600'
                              )}>
                                {formatMarketName(opp.market)}
                              </span>

                              {/* Line Badge */}
                              {opp.line !== undefined && (
                                <span className={clsx(
                                  'shrink-0 px-3 py-1 rounded-lg text-xs font-bold',
                                  opp.selection.toLowerCase().includes('over')
                                    ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/40'
                                    : 'bg-red-500/30 text-red-300 border border-red-500/40'
                                )}>
                                  {opp.selection.toLowerCase().includes('over') ? '↑ OVER' : '↓ UNDER'} {opp.line}
                                </span>
                              )}
                            </div>

                            {/* EV Badge */}
                            <div className={clsx(
                              'shrink-0 px-4 py-2 rounded-xl font-black text-lg',
                              oppTier === 'legendary' && 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/30 animate-pulse',
                              oppTier === 'epic' && 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/20',
                              oppTier === 'rare' && 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-md',
                              oppTier === 'common' && 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/40'
                            )}>
                              +{opp.evPercent.toFixed(1)}%
                            </div>
                          </div>

                          {/* Row 2: Bet info */}
                          <div className="flex items-center gap-3 text-sm mb-4 p-3 rounded-lg bg-slate-900/50 border border-slate-700/30">
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500 text-xs uppercase tracking-wide">Bet</span>
                              <span className="text-cyan-300 font-mono font-bold text-base">{opp.offeredOdds.toFixed(2)}</span>
                            </div>
                            <span className="text-slate-600">@</span>
                            <span className="text-white font-medium">{opp.targetBook}</span>
                            <div className="w-px h-4 bg-slate-700"></div>
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500 text-xs uppercase tracking-wide">Fair</span>
                              <span className="text-emerald-400 font-mono font-bold text-base">{opp.fairOdds.toFixed(2)}</span>
                            </div>
                            <div className="w-px h-4 bg-slate-700"></div>
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500 text-xs uppercase tracking-wide">Edge</span>
                              <span className="text-amber-400 font-mono font-bold">
                                +{((opp.offeredOdds - opp.fairOdds) / opp.fairOdds * 100).toFixed(0)}%
                              </span>
                            </div>
                          </div>

                          {/* Row 3: Playable Books */}
                          <div className="flex flex-wrap items-center gap-2 mb-3">
                            <span className="text-xs text-emerald-500 font-semibold uppercase tracking-wide mr-1">
                              ✓ Playable
                            </span>
                            {playableBooks.length > 0 ? (
                              playableBooks.map(book => (
                                <span
                                  key={book.sportsbookId}
                                  className={clsx(
                                    'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                                    book.sportsbookId === opp.targetBookId
                                      ? 'bg-emerald-500/40 text-emerald-200 border-2 border-emerald-400 shadow-md shadow-emerald-500/20'
                                      : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30'
                                  )}
                                >
                                  {book.sportsbookId === opp.targetBookId && '★ '}
                                  {book.sportsbookName}: <span className="font-mono">{book.decimalOdds.toFixed(2)}</span>
                                </span>
                              ))
                            ) : (
                              // Fallback: show target book from opportunity data when bookOdds is missing
                              <span className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/40 text-emerald-200 border-2 border-emerald-400 shadow-md shadow-emerald-500/20">
                                ★ {opp.targetBook}: <span className="font-mono">{opp.offeredOdds.toFixed(2)}</span>
                              </span>
                            )}
                          </div>

                          {/* Row 4: All Other Books (always show bookmaker names when available) */}
                          {otherBooks.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5 mb-3">
                              <span className="text-xs text-slate-500 font-medium mr-1">
                                Market ({otherBooks.length}):
                              </span>
                              {otherBooks.map(book => (
                                <span
                                  key={book.sportsbookId}
                                  className={clsx(
                                    'px-2 py-1 rounded-md text-xs font-medium',
                                    book.isSharp
                                      ? 'bg-purple-500/30 text-purple-300 border border-purple-500/40'
                                      : book.isOutlier
                                      ? 'bg-slate-800/50 text-slate-500 border border-slate-700/30 opacity-60'
                                      : 'bg-slate-700/70 text-slate-400 border border-slate-600/50'
                                  )}
                                  title={book.isOutlier ? 'Outlier - excluded from fair odds calculation' : undefined}
                                >
                                  {book.isSharp && '★ '}{book.sportsbookName}: <span className="font-mono">{book.decimalOdds.toFixed(2)}</span>
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Row 5: Actions & Validation */}
                          <div className="flex items-center gap-3">
                            {/* Track Button */}
                            <button
                              onClick={() => toggleTrack(opp as unknown as OpportunityResponse)}
                              disabled={isTrackingLoading(opp.id)}
                              className={clsx(
                                'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-300',
                                isTracked(opp.id)
                                  ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 hover:bg-red-500/20 hover:text-red-300 hover:border-red-500/40'
                                  : 'bg-slate-700/50 text-slate-400 hover:bg-emerald-500/20 hover:text-emerald-300 border border-slate-600/50 hover:border-emerald-500/40',
                                'disabled:opacity-50 disabled:cursor-not-allowed'
                              )}
                              title={isTracked(opp.id) ? 'Untrack this bet' : 'Track this bet'}
                            >
                              {isTrackingLoading(opp.id) ? (
                                <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin"></div>
                              ) : isTracked(opp.id) ? (
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"></path>
                                </svg>
                              ) : (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path>
                                </svg>
                              )}
                              <span>{isTracked(opp.id) ? 'Tracked' : 'Track'}</span>
                            </button>

                            {/* Hide Button */}
                            <button
                              onClick={() => remove(opp)}
                              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-300 bg-slate-700/50 text-slate-400 hover:bg-red-500/20 hover:text-red-400 border border-slate-600/50 hover:border-red-500/30"
                              title="Hide this bet (can restore later)"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path>
                              </svg>
                              <span>Hide</span>
                            </button>

                            {/* NBA Validation (for basketball player props) - Pre-computed from server */}
                            {match.sport === 'basketball' && opp.line !== undefined && (isPlayerProp(opp.market) || isPlayerPropSelection(opp.selection)) && (() => {
                              const nbaValidation = opp.nbaValidation;

                              // Show validation result if available
                              if (nbaValidation) {
                                return (
                                  <div className={clsx(
                                    'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium',
                                    nbaValidation.hitRate >= 70 && 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
                                    nbaValidation.hitRate >= 50 && nbaValidation.hitRate < 70 && 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
                                    nbaValidation.hitRate < 50 && 'bg-red-500/20 text-red-400 border border-red-500/30'
                                  )}>
                                    <span className="text-orange-400">🏀</span>
                                    <span className="font-bold">{nbaValidation.hits}/{nbaValidation.matchesChecked}</span>
                                    <span className="text-slate-400">({nbaValidation.hitRate}%)</span>
                                    <span className="text-slate-500">avg: {nbaValidation.avgValue}</span>
                                    {nbaValidation.seasonAvg !== undefined && (
                                      <span className="text-cyan-400">szn: {nbaValidation.seasonAvg}</span>
                                    )}
                                  </div>
                                );
                              }

                              // No validation data available
                              return (
                                <div className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-700/30 text-slate-500 text-xs">
                                  <span className="text-orange-400">🏀</span>
                                  <span>No NBA stats</span>
                                </div>
                              );
                            })()}

                            {/* Football Validation (for soccer player props) */}
                            {match.sport === 'soccer' && opp.line !== undefined && (isPlayerProp(opp.market) || isPlayerPropSelection(opp.selection)) && extractPlayerName(opp.selection, opp.playerName) && (() => {
                              const validation = getValidationResult(opp);
                              const isValidating = validatingIds.has(opp.id);

                              // Already validated - show result
                              if (validation !== undefined) {
                                if (validation === null) {
                                  return (
                                    <div className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-700/50 text-slate-500 text-xs">
                                      No historical data
                                    </div>
                                  );
                                }
                                return (
                                  <div className={clsx(
                                    'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium',
                                    validation.hitRate >= 70 && 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
                                    validation.hitRate >= 50 && validation.hitRate < 70 && 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
                                    validation.hitRate < 50 && 'bg-red-500/20 text-red-400 border border-red-500/30'
                                  )}>
                                    <span className="font-bold">{validation.hits}/{validation.matchesChecked}</span>
                                    <span className="text-slate-400">({validation.hitRate.toFixed(0)}%)</span>
                                    <span className="text-slate-500">avg: {validation.avgValue.toFixed(1)}</span>
                                  </div>
                                );
                              }

                              // Validating - show spinner
                              if (isValidating) {
                                return (
                                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-700/50 text-slate-400 text-xs">
                                    <div className="w-3 h-3 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin"></div>
                                    <span>Loading...</span>
                                  </div>
                                );
                              }

                              // Not validated yet - show button
                              return (
                                <button
                                  onClick={(e) => handleValidate(e, opp)}
                                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 hover:text-purple-300 text-xs font-medium transition-all border border-purple-500/30"
                                  title="Check historical hit rate"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
                                  </svg>
                                  Load Hit Rate
                                </button>
                              );
                            })()}
                          </div>
                        </div>
                      );
                    })}
                </div>

                {/* Show More / Show Less Buttons */}
                {(hasMore || visibleCount > DEFAULT_VISIBLE) && (
                  <div className="px-6 py-4 flex items-center justify-center gap-3 bg-slate-900/50 border-t border-slate-800/30">
                    {hasMore && (
                      <button
                        onClick={() => showMore(match.fixtureId)}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-500/20 to-cyan-500/20 hover:from-purple-500/30 hover:to-cyan-500/30 text-purple-300 hover:text-white font-medium text-sm transition-all duration-300 border border-purple-500/30 hover:border-purple-500/50 hover:shadow-lg hover:shadow-purple-500/10"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                        </svg>
                        Show {Math.min(remainingCount, SHOW_MORE_INCREMENT)} More
                        <span className="text-slate-500 text-xs">({remainingCount} remaining)</span>
                      </button>
                    )}
                    {!hasMore && match.opportunities.length > DEFAULT_VISIBLE && (
                      <button
                        onClick={() => showAllForMatch(match.fixtureId, match.opportunities.length)}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-slate-500 hover:text-slate-300 text-sm transition-all"
                      >
                        Showing all {match.opportunities.length} bets
                      </button>
                    )}
                    {visibleCount > DEFAULT_VISIBLE && (
                      <button
                        onClick={() => showLess(match.fixtureId)}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 text-sm transition-all duration-300"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7"></path>
                        </svg>
                        Show Less
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {data?.pagination && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-8">
          <button
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800/50 text-slate-300 hover:bg-slate-700/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path>
            </svg>
            Previous
          </button>

          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Page</span>
            <span className="px-3 py-1 rounded-lg bg-slate-800/50 text-white font-medium">{page}</span>
            <span className="text-slate-500">of {data.pagination.totalPages}</span>
          </div>

          <button
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800/50 text-slate-300 hover:bg-slate-700/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            disabled={page >= data.pagination.totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            Next
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path>
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
