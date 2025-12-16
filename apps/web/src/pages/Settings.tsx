import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchSportsbooks, fetchLeagues, fetchMethods, setTargets, setLeagues } from '../api/client';
import { useSettings, DEFAULT_CALCULATION_BOOKS } from '../hooks/useLocalStorage';
import clsx from 'clsx';

// Known sharp books (for styling)
const SHARP_BOOK_IDS = ['pinnacle', 'betfair', 'circa_sports', 'sbobet', 'bookmaker', 'matchbook', 'pinnacle_alt'];

export default function Settings() {
  const queryClient = useQueryClient();
  const { settings, setSettings } = useSettings();

  // Track if this is the initial mount to avoid unnecessary localStorage writes
  const isInitialMount = useRef(true);

  const { data: sportsbooks, isLoading: sportsbooksLoading } = useQuery({
    queryKey: ['sportsbooks'],
    queryFn: fetchSportsbooks,
  });

  const { data: leagues, isLoading: leaguesLoading } = useQuery({
    queryKey: ['leagues'],
    queryFn: fetchLeagues,
  });

  const { data: methods } = useQuery({
    queryKey: ['methods'],
    queryFn: fetchMethods,
  });

  // Local state initialized from settings
  const [selectedTargets, setSelectedTargets] = useState<string[]>(settings.selectedTargets ?? []);
  const [selectedLeagues, setSelectedLeagues] = useState<string[]>(settings.selectedLeagues ?? []);
  const [selectedMethod, setSelectedMethodLocal] = useState<string>(settings.selectedMethod ?? 'TRIMMED_MEAN_PROB');
  const [minEV, setMinEVLocal] = useState(settings.minEV ?? 5);
  const [sharpBook, setSharpBookLocal] = useState(settings.sharpBook ?? 'pinnacle');
  const [calculationBooks, setCalculationBooksLocal] = useState<string[]>(settings.calculationBooks ?? DEFAULT_CALCULATION_BOOKS);
  const [searchPlayable, setSearchPlayable] = useState('');
  const [searchCalculation, setSearchCalculation] = useState('');

  // Sync all settings to localStorage when any local state changes
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    setSettings({
      selectedTargets,
      selectedLeagues,
      selectedMethod,
      minEV,
      sharpBook,
      calculationBooks,
      filters: settings.filters,
    });
  }, [selectedTargets, selectedLeagues, selectedMethod, minEV, sharpBook, calculationBooks]);

  // Initialize from fetched data (only if local state is empty)
  useEffect(() => {
    if (sportsbooks?.targetIds && selectedTargets.length === 0) {
      setSelectedTargets(sportsbooks.targetIds);
    }
  }, [sportsbooks?.targetIds]);

  useEffect(() => {
    if (leagues?.enabledIds && selectedLeagues.length === 0) {
      setSelectedLeagues(leagues.enabledIds);
    }
  }, [leagues?.enabledIds]);

  const targetsMutation = useMutation({
    mutationFn: setTargets,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sportsbooks'] });
    },
  });

  const leaguesMutation = useMutation({
    mutationFn: setLeagues,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leagues'] });
    },
  });

  // Handlers
  const handleTargetToggle = (bookId: string) => {
    setSelectedTargets(prev =>
      prev.includes(bookId) ? prev.filter(id => id !== bookId) : [...prev, bookId]
    );
  };

  const handleCalculationToggle = (bookId: string) => {
    setCalculationBooksLocal(prev =>
      prev.includes(bookId) ? prev.filter(id => id !== bookId) : [...prev, bookId]
    );
  };

  const handleLeagueToggle = (leagueId: string) => {
    setSelectedLeagues(prev =>
      prev.includes(leagueId) ? prev.filter(id => id !== leagueId) : [...prev, leagueId]
    );
  };

  const handleSaveTargets = () => {
    targetsMutation.mutate(selectedTargets);
  };

  const handleSaveLeagues = () => {
    leaguesMutation.mutate(selectedLeagues);
  };

  const selectAllCalculation = () => {
    if (sportsbooks?.data) {
      setCalculationBooksLocal(sportsbooks.data.map(b => b.id));
    }
  };

  const selectNoneCalculation = () => {
    // Keep at least the sharp book
    setCalculationBooksLocal([sharpBook]);
  };

  const resetCalculationToDefaults = () => {
    setCalculationBooksLocal(DEFAULT_CALCULATION_BOOKS);
  };

  // All sportsbooks from API with sharp book info
  const allSportsbooks = useMemo(() => {
    if (!sportsbooks?.data) return [];
    return sportsbooks.data.map(book => ({
      ...book,
      isSharp: SHARP_BOOK_IDS.includes(book.id),
    }));
  }, [sportsbooks?.data]);

  // Filtered lists
  const filteredPlayableBooks = useMemo(() => {
    const search = searchPlayable.toLowerCase();
    return allSportsbooks.filter(book =>
      book.name.toLowerCase().includes(search) || book.id.toLowerCase().includes(search)
    );
  }, [searchPlayable, allSportsbooks]);

  const filteredCalculationBooks = useMemo(() => {
    const search = searchCalculation.toLowerCase();
    return allSportsbooks.filter(book =>
      book.name.toLowerCase().includes(search) || book.id.toLowerCase().includes(search)
    );
  }, [searchCalculation, allSportsbooks]);

  // Group leagues by sport
  const soccerLeagues = leagues?.data?.filter(l => l.sportId === 'soccer') ?? [];
  const basketballLeagues = leagues?.data?.filter(l => l.sportId === 'basketball') ?? [];

  // Sharp books for selection
  const sharpBookOptions = allSportsbooks.filter(b => b.isSharp);

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div className="animate-fade-in">
        <h1 className="text-3xl font-black gradient-text">Settings</h1>
        <p className="text-dark-400 mt-2">Configure your EV calculation preferences and bookmaker settings</p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 animate-fade-in-up">
        <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30">
          <div className="text-2xl font-black text-blue-400">
            {sportsbooksLoading ? '...' : allSportsbooks.length}
          </div>
          <div className="text-xs text-blue-300/70 uppercase tracking-wide mt-1">Available Books</div>
        </div>
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
          <div className="text-2xl font-black text-emerald-400">{selectedTargets.length}</div>
          <div className="text-xs text-emerald-300/70 uppercase tracking-wide mt-1">Playable Books</div>
        </div>
        <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/30">
          <div className="text-2xl font-black text-purple-400">1</div>
          <div className="text-xs text-purple-300/70 uppercase tracking-wide mt-1">Sharp Book</div>
        </div>
        <div className="p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/30">
          <div className="text-2xl font-black text-cyan-400">{calculationBooks.length}</div>
          <div className="text-xs text-cyan-300/70 uppercase tracking-wide mt-1">Calculation Books</div>
        </div>
        <div className="p-4 rounded-xl bg-orange-500/10 border border-orange-500/30">
          <div className="text-2xl font-black text-orange-400">{selectedLeagues.length}</div>
          <div className="text-xs text-orange-300/70 uppercase tracking-wide mt-1">Leagues</div>
        </div>
      </div>

      {/* EV Settings */}
      <div className="card-gradient animate-fade-in-up" style={{ animationDelay: '100ms' }}>
        <h2 className="text-lg font-bold text-dark-100 mb-6 flex items-center gap-3">
          <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-purple-600">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
            </svg>
          </span>
          EV Calculation Settings
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Sharp Book Selection */}
          <div className="p-5 rounded-xl bg-purple-500/10 border border-purple-500/30">
            <label className="block text-xs font-semibold text-purple-400 uppercase tracking-wider mb-3">
              Sharp Book Reference
            </label>
            <select
              className="w-full px-4 py-2.5 rounded-xl bg-dark-800/80 border border-purple-500/30 text-white focus:outline-none focus:border-purple-500 transition-all"
              value={sharpBook}
              onChange={e => setSharpBookLocal(e.target.value)}
            >
              {sharpBookOptions.map(book => (
                <option key={book.id} value={book.id}>
                  {book.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-purple-300/60 mt-3 leading-relaxed">
              Sharp books have the most accurate odds. Used as reference for SHARP_BOOK_REFERENCE method.
            </p>
          </div>

          {/* Method */}
          <div className="p-5 rounded-xl bg-dark-800/50 border border-dark-700/30">
            <label className="block text-xs font-semibold text-dark-400 uppercase tracking-wider mb-3">Fair Odds Method</label>
            <select
              className="select"
              value={selectedMethod}
              onChange={e => setSelectedMethodLocal(e.target.value)}
            >
              {methods?.data?.map(method => (
                <option key={method.id} value={method.id}>
                  {method.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-dark-500 mt-3 leading-relaxed">
              {methods?.data?.find(m => m.id === selectedMethod)?.description}
            </p>
          </div>

          {/* Min EV */}
          <div className="p-5 rounded-xl bg-dark-800/50 border border-dark-700/30">
            <label className="block text-xs font-semibold text-dark-400 uppercase tracking-wider mb-3">Minimum EV %</label>
            <div className="relative">
              <input
                type="number"
                className="input pr-12"
                value={minEV}
                min={0}
                max={50}
                step={0.5}
                onChange={e => setMinEVLocal(parseFloat(e.target.value))}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-dark-500 font-medium">%</span>
            </div>
            <p className="text-xs text-dark-500 mt-3 leading-relaxed">
              Only show opportunities with at least <span className="text-indigo-400 font-semibold">{minEV}%</span> EV
            </p>
          </div>
        </div>
      </div>

      {/* Playable Sportsbooks */}
      <div className="card-gradient animate-fade-in-up" style={{ animationDelay: '200ms' }}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-600 to-cyan-600">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
            </span>
            <div>
              <h2 className="text-lg font-bold text-dark-100">Playable Sportsbooks</h2>
              <p className="text-sm text-dark-400 mt-0.5">
                Books where you can place bets • <span className="text-emerald-400 font-semibold">{selectedTargets.length} selected</span>
              </p>
            </div>
          </div>
          <button
            className="btn btn-primary"
            onClick={handleSaveTargets}
            disabled={targetsMutation.isPending}
          >
            {targetsMutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>

        {/* Search and Counter */}
        <div className="flex items-center gap-4 mb-4">
          <div className="flex-1 relative">
            <input
              type="text"
              placeholder="Search sportsbooks..."
              className="w-full px-4 py-2.5 rounded-xl bg-dark-800/50 border border-dark-700/50 text-white placeholder-dark-500 focus:outline-none focus:border-emerald-500/50 transition-all"
              value={searchPlayable}
              onChange={e => setSearchPlayable(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-dark-800/50 border border-dark-700/50">
            <span className="text-dark-400 text-sm">Showing</span>
            <span className="text-emerald-400 font-bold">{filteredPlayableBooks.length}</span>
            <span className="text-dark-400 text-sm">of</span>
            <span className="text-white font-bold">{allSportsbooks.length}</span>
          </div>
        </div>

        {sportsbooksLoading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="spinner-lg" />
            <p className="text-dark-400 mt-4">Loading sportsbooks...</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
            {filteredPlayableBooks.map((book) => (
              <label
                key={book.id}
                className={clsx(
                  'relative flex items-center p-3 rounded-xl border cursor-pointer transition-all duration-300 group',
                  selectedTargets.includes(book.id)
                    ? 'bg-gradient-to-br from-emerald-600/20 to-cyan-600/20 border-emerald-500/50 shadow-lg shadow-emerald-500/10'
                    : 'bg-dark-800/50 border-dark-700/50 hover:border-dark-600 hover:bg-dark-700/50'
                )}
              >
                <input
                  type="checkbox"
                  className="hidden"
                  checked={selectedTargets.includes(book.id)}
                  onChange={() => handleTargetToggle(book.id)}
                />
                <div className={clsx(
                  'flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center mr-3 transition-all',
                  selectedTargets.includes(book.id)
                    ? 'bg-emerald-500 border-emerald-500'
                    : 'border-dark-600 group-hover:border-dark-500'
                )}>
                  {selectedTargets.includes(book.id) && (
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path>
                    </svg>
                  )}
                </div>
                <span className="text-sm text-dark-200 font-medium truncate">{book.name}</span>
                {book.isSharp && (
                  <span className="ml-auto pl-2 text-purple-400 text-xs">★</span>
                )}
              </label>
            ))}
          </div>
        )}

        {targetsMutation.isSuccess && (
          <div className="flex items-center gap-2 mt-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
            <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
            </svg>
            <p className="text-emerald-400 text-sm font-medium">Playable books saved!</p>
          </div>
        )}
      </div>

      {/* Fair Odds Calculation Books */}
      <div className="card-gradient animate-fade-in-up" style={{ animationDelay: '300ms' }}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-600 to-blue-600">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
              </svg>
            </span>
            <div>
              <h2 className="text-lg font-bold text-dark-100">Fair Odds Calculation</h2>
              <p className="text-sm text-dark-400 mt-0.5">
                Books used to calculate fair odds • <span className="text-cyan-400 font-semibold">{calculationBooks.length} selected</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-dark-400 hover:text-white hover:bg-dark-700/50 transition-all"
              onClick={selectAllCalculation}
            >
              Select All
            </button>
            <button
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-dark-400 hover:text-white hover:bg-dark-700/50 transition-all"
              onClick={selectNoneCalculation}
            >
              Select None
            </button>
            <button
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 transition-all"
              onClick={resetCalculationToDefaults}
            >
              Reset to Defaults
            </button>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/20 mb-4">
          <p className="text-sm text-cyan-300/80">
            <span className="font-semibold text-cyan-300">How it works:</span> Fair odds are calculated by averaging odds across multiple sportsbooks.
            More books = more accurate fair odds. Sharp books (marked with ★) are more accurate but have limited markets.
            We recommend keeping at least 10-15 books selected for best results.
          </p>
        </div>

        {/* Search and Counter */}
        <div className="flex items-center gap-4 mb-4">
          <div className="flex-1 relative">
            <input
              type="text"
              placeholder="Search sportsbooks..."
              className="w-full px-4 py-2.5 rounded-xl bg-dark-800/50 border border-dark-700/50 text-white placeholder-dark-500 focus:outline-none focus:border-cyan-500/50 transition-all"
              value={searchCalculation}
              onChange={e => setSearchCalculation(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-dark-800/50 border border-dark-700/50">
            <span className="text-dark-400 text-sm">Showing</span>
            <span className="text-cyan-400 font-bold">{filteredCalculationBooks.length}</span>
            <span className="text-dark-400 text-sm">of</span>
            <span className="text-white font-bold">{allSportsbooks.length}</span>
            <span className="text-dark-500 text-sm">•</span>
            <span className="text-cyan-400 font-bold">{calculationBooks.length}</span>
            <span className="text-dark-400 text-sm">selected</span>
          </div>
        </div>

        {sportsbooksLoading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="spinner-lg" />
            <p className="text-dark-400 mt-4">Loading sportsbooks...</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
            {filteredCalculationBooks.map((book) => (
              <label
                key={book.id}
                className={clsx(
                  'relative flex items-center p-3 rounded-xl border cursor-pointer transition-all duration-300 group',
                  calculationBooks.includes(book.id)
                    ? book.isSharp
                      ? 'bg-gradient-to-br from-purple-600/20 to-pink-600/20 border-purple-500/50 shadow-lg shadow-purple-500/10'
                      : 'bg-gradient-to-br from-cyan-600/20 to-blue-600/20 border-cyan-500/50 shadow-lg shadow-cyan-500/10'
                    : 'bg-dark-800/50 border-dark-700/50 hover:border-dark-600 hover:bg-dark-700/50'
                )}
              >
                <input
                  type="checkbox"
                  className="hidden"
                  checked={calculationBooks.includes(book.id)}
                  onChange={() => handleCalculationToggle(book.id)}
                />
                <div className={clsx(
                  'flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center mr-3 transition-all',
                  calculationBooks.includes(book.id)
                    ? book.isSharp
                      ? 'bg-purple-500 border-purple-500'
                      : 'bg-cyan-500 border-cyan-500'
                    : 'border-dark-600 group-hover:border-dark-500'
                )}>
                  {calculationBooks.includes(book.id) && (
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path>
                    </svg>
                  )}
                </div>
                <span className="text-sm text-dark-200 font-medium truncate">{book.name}</span>
                {book.isSharp && (
                  <span className="ml-auto pl-2 text-purple-400 text-xs font-semibold">★ Sharp</span>
                )}
              </label>
            ))}
          </div>
        )}

        {calculationBooks.length < 5 && (
          <div className="flex items-center gap-2 mt-4 p-3 rounded-lg bg-orange-500/10 border border-orange-500/30">
            <svg className="w-5 h-5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
            </svg>
            <p className="text-orange-400 text-sm font-medium">
              Warning: Less than 5 books selected. Fair odds may be less accurate.
            </p>
          </div>
        )}
      </div>

      {/* Leagues */}
      <div className="card-gradient animate-fade-in-up" style={{ animationDelay: '400ms' }}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-orange-600 to-amber-600">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
            </span>
            <div>
              <h2 className="text-lg font-bold text-dark-100">Enabled Leagues</h2>
              <p className="text-sm text-dark-400 mt-0.5">
                Leagues to scan for opportunities • <span className="text-orange-400 font-semibold">{selectedLeagues.length} selected</span>
              </p>
            </div>
          </div>
          <button
            className="btn btn-primary"
            onClick={handleSaveLeagues}
            disabled={leaguesMutation.isPending}
          >
            {leaguesMutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>

        {leaguesLoading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="spinner-lg" />
            <p className="text-dark-400 mt-4">Loading leagues...</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Soccer */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <span className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <span className="text-xs">⚽</span>
                </span>
                <h3 className="text-sm font-bold text-dark-300 uppercase tracking-wider">Soccer</h3>
                <span className="px-2 py-0.5 rounded-full bg-dark-800 text-dark-500 text-xs">
                  {soccerLeagues.length} available
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {soccerLeagues.map(league => (
                  <label
                    key={league.id}
                    className={clsx(
                      'flex items-center p-3 rounded-lg border cursor-pointer transition-all duration-300 text-xs group',
                      selectedLeagues.includes(league.id)
                        ? 'bg-gradient-to-br from-emerald-600/20 to-cyan-600/20 border-emerald-500/50'
                        : 'bg-dark-800/50 border-dark-700/50 hover:border-dark-600'
                    )}
                  >
                    <input
                      type="checkbox"
                      className="hidden"
                      checked={selectedLeagues.includes(league.id)}
                      onChange={() => handleLeagueToggle(league.id)}
                    />
                    <div className={clsx(
                      'flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center mr-2 transition-all',
                      selectedLeagues.includes(league.id)
                        ? 'bg-emerald-500 border-emerald-500'
                        : 'border-dark-600 group-hover:border-dark-500'
                    )}>
                      {selectedLeagues.includes(league.id) && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path>
                        </svg>
                      )}
                    </div>
                    <span className="text-dark-200 truncate font-medium">
                      {league.name.replace(/_/g, ' ')}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Basketball */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <span className="w-6 h-6 rounded-full bg-orange-500/20 flex items-center justify-center">
                  <span className="text-xs">🏀</span>
                </span>
                <h3 className="text-sm font-bold text-dark-300 uppercase tracking-wider">Basketball</h3>
                <span className="px-2 py-0.5 rounded-full bg-dark-800 text-dark-500 text-xs">
                  {basketballLeagues.length} available
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {basketballLeagues.map(league => (
                  <label
                    key={league.id}
                    className={clsx(
                      'flex items-center p-3 rounded-lg border cursor-pointer transition-all duration-300 text-xs group',
                      selectedLeagues.includes(league.id)
                        ? 'bg-gradient-to-br from-orange-600/20 to-amber-600/20 border-orange-500/50'
                        : 'bg-dark-800/50 border-dark-700/50 hover:border-dark-600'
                    )}
                  >
                    <input
                      type="checkbox"
                      className="hidden"
                      checked={selectedLeagues.includes(league.id)}
                      onChange={() => handleLeagueToggle(league.id)}
                    />
                    <div className={clsx(
                      'flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center mr-2 transition-all',
                      selectedLeagues.includes(league.id)
                        ? 'bg-orange-500 border-orange-500'
                        : 'border-dark-600 group-hover:border-dark-500'
                    )}>
                      {selectedLeagues.includes(league.id) && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path>
                        </svg>
                      )}
                    </div>
                    <span className="text-dark-200 truncate font-medium">
                      {league.name.replace(/_/g, ' ')}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {leaguesMutation.isSuccess && (
          <div className="flex items-center gap-2 mt-6 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
            <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
            </svg>
            <p className="text-emerald-400 text-sm font-medium">Leagues saved!</p>
          </div>
        )}
      </div>

      {/* Method Info */}
      <div className="card-gradient animate-fade-in-up" style={{ animationDelay: '500ms' }}>
        <h2 className="text-lg font-bold text-dark-100 mb-4 flex items-center gap-3">
          <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-pink-600 to-rose-600">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          </span>
          Fair Odds Methods
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {methods?.data?.map((method) => (
            <div
              key={method.id}
              className={clsx(
                'p-4 rounded-xl border transition-all',
                selectedMethod === method.id
                  ? 'bg-gradient-to-br from-indigo-600/20 to-purple-600/20 border-indigo-500/50'
                  : 'bg-dark-800/50 border-dark-700/30'
              )}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className={clsx(
                  'w-2 h-2 rounded-full',
                  selectedMethod === method.id ? 'bg-indigo-500 animate-pulse' : 'bg-dark-600'
                )}></span>
                <h3 className="font-bold text-dark-100">{method.name}</h3>
                {selectedMethod === method.id && (
                  <span className="ml-auto px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-semibold">
                    Active
                  </span>
                )}
              </div>
              <p className="text-sm text-dark-400">{method.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
