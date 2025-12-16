import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchHealth, fetchOpportunities } from '../api/client';
import clsx from 'clsx';

function getEVBadgeClass(ev: number): string {
  if (ev >= 15) return 'badge-ev-elite';
  if (ev >= 10) return 'badge-ev-high';
  if (ev >= 7) return 'badge-ev-medium';
  return 'badge-ev-low';
}

function getEVDisplayClass(ev: number): string {
  if (ev >= 15) return 'ev-display-elite';
  if (ev >= 10) return 'ev-display-high';
  if (ev >= 7) return 'ev-display-medium';
  return 'ev-display-low';
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

export default function Dashboard() {
  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 30000,
  });

  const { data: opportunities, isLoading: oppLoading } = useQuery({
    queryKey: ['opportunities', { pageSize: 10, sortBy: 'evPercent', sortDir: 'desc' }],
    queryFn: () =>
      fetchOpportunities({
        pageSize: 10,
        sortBy: 'evPercent',
        sortDir: 'desc',
      }),
    refetchInterval: 60000,
  });

  const isLoading = healthLoading || oppLoading;

  return (
    <div className="space-y-8">
      {/* Header with gradient */}
      <div className="animate-fade-in">
        <h1 className="text-3xl font-black gradient-text">Dashboard</h1>
        <p className="text-dark-400 mt-2">Real-time EV opportunities at your fingertips</p>
      </div>

      {/* Stats Grid with staggered animation */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="stat-card animate-fade-in-up" style={{ animationDelay: '100ms' }}>
          <span className="stat-label flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
            Total Opportunities
          </span>
          <span className="stat-value">
            {isLoading ? (
              <span className="shimmer inline-block w-16 h-8 rounded"></span>
            ) : (
              opportunities?.stats?.totalOpportunities ?? 0
            )}
          </span>
        </div>

        <div className="stat-card animate-fade-in-up" style={{ animationDelay: '200ms' }}>
          <span className="stat-label flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            Average EV
          </span>
          <span className={clsx('stat-value', !isLoading && 'text-emerald-400')}>
            {isLoading ? (
              <span className="shimmer inline-block w-16 h-8 rounded"></span>
            ) : (
              `${(opportunities?.stats?.avgEV ?? 0).toFixed(1)}%`
            )}
          </span>
        </div>

        <div className="stat-card animate-fade-in-up" style={{ animationDelay: '300ms' }}>
          <span className="stat-label flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></span>
            Max EV
          </span>
          <span className={clsx(
            'stat-value',
            !isLoading && getEVDisplayClass(opportunities?.stats?.maxEV ?? 0).replace('ev-display-', 'text-').replace('-400', '-400')
          )}>
            {isLoading ? (
              <span className="shimmer inline-block w-16 h-8 rounded"></span>
            ) : (
              `${(opportunities?.stats?.maxEV ?? 0).toFixed(1)}%`
            )}
          </span>
        </div>

        <div className="stat-card animate-fade-in-up" style={{ animationDelay: '400ms' }}>
          <span className="stat-label flex items-center gap-2">
            <span className={clsx(
              'w-2 h-2 rounded-full',
              health?.scheduler?.isRunning ? 'bg-cyan-500 animate-pulse' : 'bg-dark-500'
            )}></span>
            Last Update
          </span>
          <span className="stat-value text-lg">
            {isLoading ? (
              <span className="shimmer inline-block w-20 h-6 rounded"></span>
            ) : health?.scheduler?.lastRun ? (
              formatTime(health.scheduler.lastRun)
            ) : (
              'Never'
            )}
          </span>
          <span className="text-xs text-dark-500 mt-1 flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            Next: {health?.scheduler?.nextRun ? formatTime(health.scheduler.nextRun) : '-'}
          </span>
        </div>
      </div>

      {/* Top Opportunities Card */}
      <div className="card-gradient animate-fade-in-up" style={{ animationDelay: '500ms' }}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-dark-100 flex items-center gap-3">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-purple-600">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path>
              </svg>
            </span>
            Top Opportunities
          </h2>
          <Link
            to="/opportunities"
            className="btn btn-secondary text-sm group"
          >
            View all
            <svg className="w-4 h-4 ml-1 inline transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path>
            </svg>
          </Link>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="spinner-lg" />
            <p className="text-dark-400 mt-4">Loading opportunities...</p>
          </div>
        ) : opportunities?.data?.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-dark-800 flex items-center justify-center">
              <svg className="w-8 h-8 text-dark-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
            </div>
            <p className="text-dark-300 font-medium">No opportunities found yet</p>
            <p className="text-dark-500 text-sm mt-1">
              The system is scanning markets. This may take a few minutes.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="ev-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Selection</th>
                  <th>Book</th>
                  <th>Odds</th>
                  <th>EV</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {opportunities?.data?.slice(0, 10).map((opp, index) => (
                  <tr
                    key={opp.id}
                    className="table-row-new hover:bg-gradient-to-r hover:from-dark-800/50 hover:to-transparent"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <td>
                      <Link
                        to={`/opportunities/${opp.id}`}
                        className="group"
                      >
                        <div className="font-medium text-dark-100 group-hover:text-indigo-400 transition-colors">
                          {opp.homeTeam} vs {opp.awayTeam}
                        </div>
                        <div className="text-xs text-dark-500 flex items-center gap-1 mt-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-dark-600"></span>
                          {opp.league?.replace(/_/g, ' ')}
                        </div>
                      </Link>
                    </td>
                    <td>
                      <div className="text-dark-200">{opp.selection}</div>
                      {opp.playerName && (
                        <div className="text-xs text-purple-400 mt-0.5">{opp.playerName}</div>
                      )}
                    </td>
                    <td>
                      <span className="px-2 py-1 rounded bg-dark-800 text-dark-300 text-sm font-medium">
                        {opp.targetBook}
                      </span>
                    </td>
                    <td>
                      <div className="font-mono text-dark-100 font-semibold">{opp.offeredOdds.toFixed(2)}</div>
                      <div className="text-xs text-dark-500 flex items-center gap-1">
                        <span className="text-dark-600">Fair:</span>
                        <span className="text-emerald-500">{opp.fairOdds.toFixed(2)}</span>
                      </div>
                    </td>
                    <td>
                      <span className={clsx('badge', getEVBadgeClass(opp.evPercent))}>
                        +{opp.evPercent.toFixed(1)}%
                      </span>
                    </td>
                    <td>
                      <div className="text-dark-300 font-medium">{formatDate(opp.startsAt)}</div>
                      <div className="text-xs text-dark-500">{formatTime(opp.startsAt)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* System Status Card */}
      <div className="card animate-fade-in-up" style={{ animationDelay: '600ms' }}>
        <h2 className="text-lg font-bold text-dark-100 mb-5 flex items-center gap-2">
          <span className="flex items-center justify-center w-6 h-6 rounded bg-dark-700">
            <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"></path>
            </svg>
          </span>
          System Status
        </h2>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="group">
            <span className="text-xs text-dark-500 uppercase tracking-wider">API Status</span>
            <div className="flex items-center mt-2">
              <div className={clsx(
                'relative w-3 h-3 rounded-full mr-2',
                health?.status === 'ok' ? 'bg-emerald-500' : 'bg-yellow-500'
              )}>
                {health?.status === 'ok' && (
                  <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-75"></span>
                )}
              </div>
              <span className="text-dark-200 font-medium capitalize">{health?.status ?? 'Unknown'}</span>
            </div>
          </div>

          <div className="group">
            <span className="text-xs text-dark-500 uppercase tracking-wider">Database</span>
            <div className="flex items-center mt-2">
              <div className={clsx(
                'relative w-3 h-3 rounded-full mr-2',
                health?.database?.connected ? 'bg-emerald-500' : 'bg-red-500'
              )}>
                {health?.database?.connected && (
                  <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-75"></span>
                )}
              </div>
              <span className="text-dark-200 font-medium">
                {health?.database?.connected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>

          <div>
            <span className="text-xs text-dark-500 uppercase tracking-wider">Fixtures</span>
            <p className="text-2xl font-bold text-dark-100 mt-2">
              {health?.database?.fixtureCount ?? 0}
            </p>
          </div>

          <div>
            <span className="text-xs text-dark-500 uppercase tracking-wider">Opportunities</span>
            <p className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400 mt-2">
              {health?.database?.opportunityCount ?? 0}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
