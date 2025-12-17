import { Link } from 'react-router-dom';
import { useRemoved } from '../hooks/useRemoved';
import type { RemovedBet } from '../services/removedService';
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

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
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

export default function Removed() {
  const { removedBets, restore, restoreFixture, clearAll } = useRemoved();

  // Group by fixture
  const groupedByMatch = removedBets.reduce((acc, bet) => {
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
  }, {} as Record<string, { fixtureId: string; sport: string; homeTeam: string; awayTeam: string; startsAt: string; league: string; bets: RemovedBet[] }>);

  const matches = Object.values(groupedByMatch).sort((a, b) =>
    new Date(b.bets[0].removedAt).getTime() - new Date(a.bets[0].removedAt).getTime()
  );

  return (
    <div className="space-y-6 pb-12">
      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-red-900/20 to-slate-900 border border-red-500/20 p-8">
        <div className="absolute inset-0 bg-grid-pattern opacity-5"></div>
        <div className="absolute top-0 right-0 w-96 h-96 bg-red-500/10 rounded-full blur-3xl"></div>

        <div className="relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-red-500/50 to-orange-500/50 shadow-lg shadow-red-500/25">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path>
                </svg>
              </div>
              <div>
                <h1 className="text-3xl font-black text-white">Hidden Bets</h1>
                <p className="text-red-300/70">Bets you've hidden from the opportunities list</p>
              </div>
            </div>

            {removedBets.length > 0 && (
              <button
                onClick={clearAll}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-all"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                </svg>
                Clear All
              </button>
            )}
          </div>

          {/* Stats */}
          <div className="flex flex-wrap items-center gap-4 mt-6">
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 backdrop-blur">
              <span className="text-2xl font-bold text-white">{removedBets.length}</span>
              <span className="text-sm text-red-300/70">Hidden Bets</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 backdrop-blur">
              <span className="text-2xl font-bold text-slate-400">{matches.length}</span>
              <span className="text-sm text-slate-500">Matches</span>
            </div>
            <div className="text-sm text-slate-500">
              Hidden bets auto-delete after 7 days
            </div>
          </div>
        </div>
      </div>

      {/* Empty State */}
      {removedBets.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-20 h-20 rounded-full bg-slate-800/50 flex items-center justify-center mb-4">
            <svg className="w-10 h-10 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
            </svg>
          </div>
          <p className="text-slate-300 font-medium">No hidden bets</p>
          <p className="text-slate-500 text-sm mt-1">
            Hide bets from the <Link to="/opportunities" className="text-purple-400 hover:underline">Opportunities</Link> page
          </p>
        </div>
      )}

      {/* Hidden Bets grouped by match */}
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
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/50">
                    <span className="text-slate-400 text-sm">{match.bets.length}</span>
                    <span className="text-slate-600 text-xs">hidden</span>
                  </div>
                  <button
                    onClick={() => restoreFixture(match.fixtureId)}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30 transition-all"
                    title="Restore all bets for this match"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                    </svg>
                    <span className="hidden sm:inline">Restore All</span>
                  </button>
                </div>
              </div>

              {/* Bets */}
              <div className="p-4 space-y-3">
                {match.bets.map((bet) => (
                  <div
                    key={bet.id}
                    className="p-4 rounded-xl bg-slate-800/30 border border-slate-700/50 transition-all hover:border-slate-600/50"
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
                      <div className="flex items-center gap-3">
                        <div className="px-3 py-1.5 rounded-lg bg-purple-500/20 text-purple-300 font-bold">
                          +{bet.evPercent.toFixed(1)}%
                        </div>
                      </div>
                    </div>

                    {/* Row 2: Bet Details */}
                    <div className="flex items-center gap-3 text-sm mb-4 p-3 rounded-lg bg-slate-900/50">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 text-xs">Odds</span>
                        <span className="text-cyan-300 font-mono font-bold">{bet.offeredOdds.toFixed(2)}</span>
                      </div>
                      <span className="text-slate-600">@</span>
                      <span className="text-white font-medium">{bet.targetBook}</span>
                      <div className="w-px h-4 bg-slate-700"></div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 text-xs">Fair</span>
                        <span className="text-emerald-400 font-mono">{bet.fairOdds.toFixed(2)}</span>
                      </div>
                      <div className="flex-1"></div>
                      <div className="flex items-center gap-1 text-slate-500 text-xs">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        Hidden {formatRelativeTime(bet.removedAt)}
                      </div>
                    </div>

                    {/* Row 3: Restore Button */}
                    <div className="flex items-center justify-end">
                      <button
                        onClick={() => restore(bet.id)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30 transition-all"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                        </svg>
                        Restore
                      </button>
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
