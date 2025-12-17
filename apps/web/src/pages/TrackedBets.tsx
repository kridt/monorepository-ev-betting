import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  subscribeToTrackedBets,
  updateBetStatus,
  updateStake,
  untrackBet,
  getTrackingStats,
  type TrackedBet,
  type BetStatus,
} from '../services/trackingService';
import clsx from 'clsx';

// Format helpers
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatMarketName(market: string): string {
  const marketMappings: Record<string, string> = {
    'player_shots_over_under': 'Shots',
    'player_shots_on_target_over_under': 'Shots on Target',
    'player_tackles_over_under': 'Tackles',
    'player_fouls_over_under': 'Fouls',
    'player_assists_over_under': 'Assists',
    'player_goals_over_under': 'Goals',
    'player_points_over_under': 'Points',
    'player_rebounds_over_under': 'Rebounds',
    'player_threes_over_under': '3PT Made',
    'player_steals_over_under': 'Steals',
    'player_turnovers_over_under': 'Turnovers',
    'player_pra_over_under': 'PRA',
    'moneyline': 'Winner',
    'spread': 'Spread',
    'total': 'Total',
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

const STATUS_OPTIONS: { value: BetStatus; label: string; color: string }[] = [
  { value: 'pending', label: 'Pending', color: 'bg-slate-500' },
  { value: 'won', label: 'Won', color: 'bg-emerald-500' },
  { value: 'lost', label: 'Lost', color: 'bg-red-500' },
  { value: 'push', label: 'Push', color: 'bg-yellow-500' },
  { value: 'void', label: 'Void', color: 'bg-slate-400' },
];

interface Stats {
  totalBets: number;
  pendingBets: number;
  wonBets: number;
  lostBets: number;
  pushBets: number;
  voidBets: number;
  totalStaked: number;
  totalProfit: number;
  roi: number;
  avgEV: number;
}

export default function TrackedBets() {
  const [bets, setBets] = useState<TrackedBet[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filter, setFilter] = useState<BetStatus | 'all'>('all');
  const [editingStake, setEditingStake] = useState<string | null>(null);
  const [stakeValue, setStakeValue] = useState('');
  const [loading, setLoading] = useState<string | null>(null);

  // Subscribe to real-time updates
  useEffect(() => {
    const unsubscribe = subscribeToTrackedBets((updatedBets) => {
      setBets(updatedBets);
    });

    return () => unsubscribe();
  }, []);

  // Fetch stats
  useEffect(() => {
    const fetchStats = async () => {
      const s = await getTrackingStats();
      setStats(s);
    };
    fetchStats();
  }, [bets]);

  const handleStatusChange = async (betId: string, status: BetStatus) => {
    setLoading(betId);
    try {
      const bet = bets.find(b => b.id === betId);
      let actualProfit: number | undefined;

      if (bet?.stake) {
        if (status === 'won') {
          actualProfit = bet.stake * (bet.offeredOdds - 1);
        } else if (status === 'lost') {
          actualProfit = -bet.stake;
        } else if (status === 'push' || status === 'void') {
          actualProfit = 0;
        }
      }

      await updateBetStatus(betId, status, actualProfit);
    } finally {
      setLoading(null);
    }
  };

  const handleStakeSave = async (betId: string) => {
    const stake = parseFloat(stakeValue);
    if (isNaN(stake) || stake <= 0) return;

    setLoading(betId);
    try {
      await updateStake(betId, stake);
      setEditingStake(null);
      setStakeValue('');
    } finally {
      setLoading(null);
    }
  };

  const handleUntrack = async (betId: string) => {
    setLoading(betId);
    try {
      await untrackBet(betId);
    } finally {
      setLoading(null);
    }
  };

  const filteredBets = filter === 'all' ? bets : bets.filter(b => b.status === filter);

  // Group by match
  const groupedByMatch = filteredBets.reduce((acc, bet) => {
    const key = bet.fixtureId;
    if (!acc[key]) {
      acc[key] = {
        fixtureId: bet.fixtureId,
        sport: bet.sport,
        homeTeam: bet.homeTeam,
        awayTeam: bet.awayTeam,
        startsAt: bet.startsAt,
        league: bet.league,
        bets: [],
      };
    }
    acc[key].bets.push(bet);
    return acc;
  }, {} as Record<string, { fixtureId: string; sport: string; homeTeam: string; awayTeam: string; startsAt: string; league: string; bets: TrackedBet[] }>);

  const matches = Object.values(groupedByMatch).sort((a, b) =>
    new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
  );

  return (
    <div className="space-y-6 pb-12">
      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-emerald-900/20 to-slate-900 border border-emerald-500/20 p-8">
        <div className="absolute inset-0 bg-grid-pattern opacity-5"></div>
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl"></div>

        <div className="relative">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 shadow-lg shadow-emerald-500/25">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path>
              </svg>
            </div>
            <div>
              <h1 className="text-3xl font-black text-white">Tracked Bets</h1>
              <p className="text-emerald-300/70">Monitor and manage your tracked opportunities</p>
            </div>
          </div>

          {/* Stats Row */}
          {stats && (
            <div className="flex flex-wrap items-center gap-4 mt-6">
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 backdrop-blur">
                <span className="text-2xl font-bold text-white">{stats.totalBets}</span>
                <span className="text-sm text-emerald-300/70">Total</span>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
                <span className="text-2xl font-bold text-yellow-400">{stats.pendingBets}</span>
                <span className="text-sm text-yellow-300/70">Pending</span>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <span className="text-2xl font-bold text-emerald-400">{stats.wonBets}</span>
                <span className="text-sm text-emerald-300/70">Won</span>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20">
                <span className="text-2xl font-bold text-red-400">{stats.lostBets}</span>
                <span className="text-sm text-red-300/70">Lost</span>
              </div>
              {stats.totalStaked > 0 && (
                <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
                  <span className={clsx(
                    'text-2xl font-bold',
                    stats.roi >= 0 ? 'text-emerald-400' : 'text-red-400'
                  )}>
                    {stats.roi >= 0 ? '+' : ''}{stats.roi.toFixed(1)}%
                  </span>
                  <span className="text-sm text-cyan-300/70">ROI</span>
                </div>
              )}
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-500/10 border border-purple-500/20">
                <span className="text-2xl font-bold text-purple-400">+{stats.avgEV.toFixed(1)}%</span>
                <span className="text-sm text-purple-300/70">Avg EV</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        <button
          onClick={() => setFilter('all')}
          className={clsx(
            'px-4 py-2 rounded-xl text-sm font-medium transition-all',
            filter === 'all'
              ? 'bg-white/10 text-white border border-white/20'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          )}
        >
          All ({bets.length})
        </button>
        {STATUS_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={clsx(
              'px-4 py-2 rounded-xl text-sm font-medium transition-all',
              filter === opt.value
                ? `${opt.color}/20 text-white border border-${opt.color.replace('bg-', '')}/30`
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            )}
          >
            {opt.label} ({bets.filter(b => b.status === opt.value).length})
          </button>
        ))}
      </div>

      {/* Empty State */}
      {filteredBets.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-20 h-20 rounded-full bg-slate-800/50 flex items-center justify-center mb-4">
            <svg className="w-10 h-10 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
            </svg>
          </div>
          <p className="text-slate-300 font-medium">No tracked bets</p>
          <p className="text-slate-500 text-sm mt-1">
            Track bets from the <Link to="/opportunities" className="text-emerald-400 hover:underline">Opportunities</Link> page
          </p>
        </div>
      )}

      {/* Bets List grouped by match */}
      {matches.length > 0 && (
        <div className="space-y-6">
          {matches.map((match) => (
            <div
              key={match.fixtureId}
              className="rounded-2xl border border-slate-700/50 bg-slate-900/60 overflow-hidden"
            >
              {/* Match Header */}
              <div className="px-6 py-4 flex items-center justify-between border-b border-slate-800/50 bg-slate-800/30">
                <div className="flex items-center gap-4">
                  <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-slate-800/50 text-xl">
                    {getSportIcon(match.sport)}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      {match.homeTeam} vs {match.awayTeam}
                    </h3>
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <span>{match.league.replace(/_/g, ' ')}</span>
                      <span>•</span>
                      <span>{formatDate(match.startsAt)} {formatTime(match.startsAt)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/50">
                  <span className="text-slate-400 text-sm">{match.bets.length}</span>
                  <span className="text-slate-600 text-xs">bets</span>
                </div>
              </div>

              {/* Bets */}
              <div className="p-4 space-y-3">
                {match.bets.map((bet) => (
                  <div
                    key={bet.id}
                    className={clsx(
                      'p-4 rounded-xl border transition-all',
                      bet.status === 'pending' && 'bg-slate-800/30 border-slate-700/50',
                      bet.status === 'won' && 'bg-emerald-900/20 border-emerald-500/30',
                      bet.status === 'lost' && 'bg-red-900/20 border-red-500/30',
                      bet.status === 'push' && 'bg-yellow-900/20 border-yellow-500/30',
                      bet.status === 'void' && 'bg-slate-800/20 border-slate-600/30'
                    )}
                  >
                    {/* Row 1: Selection + Market + EV */}
                    <div className="flex items-center justify-between gap-4 mb-3">
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-white text-lg">
                          {bet.playerName || bet.selection}
                        </span>
                        <span className="px-2 py-1 rounded-lg text-xs font-medium bg-slate-700/50 text-slate-300">
                          {formatMarketName(bet.market)}
                        </span>
                        {bet.line !== undefined && (
                          <span className={clsx(
                            'px-2.5 py-1 rounded-lg text-xs font-bold',
                            bet.selection.toLowerCase().includes('over')
                              ? 'bg-emerald-500/30 text-emerald-300'
                              : 'bg-red-500/30 text-red-300'
                          )}>
                            {bet.selection.toLowerCase().includes('over') ? 'O' : 'U'} {bet.line}
                          </span>
                        )}
                      </div>
                      <div className="px-3 py-1.5 rounded-lg bg-purple-500/20 text-purple-300 font-bold">
                        +{bet.evPercent.toFixed(1)}%
                      </div>
                    </div>

                    {/* Row 2: Bet Details */}
                    <div className="flex items-center gap-3 text-sm mb-4 p-3 rounded-lg bg-slate-900/50">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 text-xs">Odds</span>
                        <span className="text-cyan-300 font-mono font-bold">{bet.offeredOdds.toFixed(2)}</span>
                      </div>
                      <span className="text-slate-600">@</span>
                      <span className="text-white font-medium">{bet.targetBookName}</span>
                      <div className="w-px h-4 bg-slate-700"></div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 text-xs">Fair</span>
                        <span className="text-emerald-400 font-mono">{bet.fairOdds.toFixed(2)}</span>
                      </div>
                    </div>

                    {/* Row 3: Actions */}
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        {/* Stake Input */}
                        {editingStake === bet.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              value={stakeValue}
                              onChange={(e) => setStakeValue(e.target.value)}
                              placeholder="Stake"
                              className="w-24 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm"
                              autoFocus
                            />
                            <button
                              onClick={() => handleStakeSave(bet.id)}
                              className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                              </svg>
                            </button>
                            <button
                              onClick={() => { setEditingStake(null); setStakeValue(''); }}
                              className="p-1.5 rounded-lg bg-slate-700/50 text-slate-400 hover:bg-slate-700"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                              </svg>
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditingStake(bet.id); setStakeValue(bet.stake?.toString() || ''); }}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-700/50 text-slate-400 hover:bg-slate-700 text-sm"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                            </svg>
                            {bet.stake ? `$${bet.stake}` : 'Add Stake'}
                          </button>
                        )}

                        {/* Potential Profit */}
                        {bet.potentialProfit !== undefined && (
                          <div className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 text-sm">
                            <span className="text-slate-500">Win:</span>
                            <span className="font-bold">+${bet.potentialProfit.toFixed(2)}</span>
                          </div>
                        )}

                        {/* Actual Profit (if settled) */}
                        {bet.status !== 'pending' && bet.actualProfit !== undefined && (
                          <div className={clsx(
                            'flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-bold',
                            bet.actualProfit >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                          )}>
                            {bet.actualProfit >= 0 ? '+' : ''}{bet.actualProfit.toFixed(2)}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Status Select */}
                        <select
                          value={bet.status}
                          onChange={(e) => handleStatusChange(bet.id, e.target.value as BetStatus)}
                          disabled={loading === bet.id}
                          className={clsx(
                            'px-3 py-1.5 rounded-lg text-sm font-medium cursor-pointer',
                            'bg-slate-800 border border-slate-700 text-white',
                            'focus:outline-none focus:ring-2 focus:ring-emerald-500/50'
                          )}
                        >
                          {STATUS_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>

                        {/* Delete Button */}
                        <button
                          onClick={() => handleUntrack(bet.id)}
                          disabled={loading === bet.id}
                          className="p-2 rounded-lg text-red-400 hover:bg-red-500/20 transition-all"
                          title="Remove from tracking"
                        >
                          {loading === bet.id ? (
                            <div className="w-4 h-4 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin"></div>
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
