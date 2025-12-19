import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchOpportunityDetail } from '../api/client';
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

function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function OpportunityDetail() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['opportunity', id],
    queryFn: () => fetchOpportunityDetail(id!),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <div className="spinner-lg" />
        <p className="text-dark-400 mt-4">Loading opportunity details...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-24">
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-500/20 flex items-center justify-center">
          <svg className="w-10 h-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
        </div>
        <p className="text-red-400 text-xl font-medium">Error loading opportunity</p>
        <p className="text-dark-500 mt-2">{(error as Error).message}</p>
        <Link to="/opportunities" className="btn btn-primary mt-6 inline-flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path>
          </svg>
          Back to Opportunities
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-24">
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-dark-800 flex items-center justify-center">
          <svg className="w-10 h-10 text-dark-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
        </div>
        <p className="text-dark-300 text-xl font-medium">Opportunity not found</p>
        <Link to="/opportunities" className="btn btn-primary mt-6 inline-flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path>
          </svg>
          Back to Opportunities
        </Link>
      </div>
    );
  }

  const opp = data.data;

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm animate-fade-in">
        <Link to="/opportunities" className="text-dark-400 hover:text-indigo-400 transition-colors flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path>
          </svg>
          Opportunities
        </Link>
        <svg className="w-4 h-4 text-dark-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path>
        </svg>
        <span className="text-dark-200 font-medium">Detail</span>
      </div>

      {/* Header Card */}
      <div className="card-gradient animate-fade-in-up relative overflow-hidden" style={{ animationDelay: '100ms' }}>
        {/* Background decoration */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-indigo-600/10 to-purple-600/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl"></div>

        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                </svg>
              </span>
              <div className="px-3 py-1 rounded-full bg-dark-800/80 border border-dark-700/50 text-xs font-medium text-dark-300">
                {opp.sport} • {opp.league?.replace(/_/g, ' ')}
              </div>
            </div>
            <h1 className="text-3xl font-black text-dark-100">
              {opp.homeTeam} <span className="text-dark-500">vs</span> {opp.awayTeam}
            </h1>
            <p className="text-dark-400 mt-2 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              {formatDateTime(opp.startsAt)}
            </p>
          </div>
          <div className="flex flex-col items-end">
            <div className={clsx('ev-display text-5xl font-black', getEVDisplayClass(opp.bestEV.evPercent))}>
              +{opp.bestEV.evPercent.toFixed(1)}%
            </div>
            <span className="text-dark-500 text-sm mt-1">Expected Value</span>
          </div>
        </div>
      </div>

      {/* Selection Info */}
      <div className="card animate-fade-in-up" style={{ animationDelay: '200ms' }}>
        <h2 className="text-lg font-bold text-dark-100 mb-5 flex items-center gap-3">
          <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-600 to-blue-600">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
            </svg>
          </span>
          Selection Details
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="p-4 rounded-xl bg-dark-800/50 border border-dark-700/30">
            <span className="text-xs text-dark-500 uppercase tracking-wider font-semibold">Market</span>
            <p className="text-dark-100 mt-2 font-medium">{opp.market}</p>
          </div>
          <div className="p-4 rounded-xl bg-dark-800/50 border border-dark-700/30">
            <span className="text-xs text-dark-500 uppercase tracking-wider font-semibold">Selection</span>
            <p className="text-dark-100 mt-2 font-medium">{opp.selection}</p>
          </div>
          {opp.playerName && (
            <div className="p-4 rounded-xl bg-dark-800/50 border border-dark-700/30">
              <span className="text-xs text-dark-500 uppercase tracking-wider font-semibold">Player</span>
              <p className="text-purple-400 mt-2 font-medium">{opp.playerName}</p>
            </div>
          )}
          {opp.line !== undefined && (
            <div className="p-4 rounded-xl bg-dark-800/50 border border-dark-700/30">
              <span className="text-xs text-dark-500 uppercase tracking-wider font-semibold">Line</span>
              <p className="text-dark-100 mt-2 font-medium">{opp.line}</p>
            </div>
          )}
        </div>
      </div>

      {/* Historical Validation Stats */}
      <div className="card animate-fade-in-up" style={{ animationDelay: '250ms' }}>
        <h2 className="text-lg font-bold text-dark-100 mb-5 flex items-center gap-3">
          <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600 to-pink-600">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
            </svg>
          </span>
          Historical Stats
        </h2>
        {opp.validation ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 rounded-xl bg-gradient-to-br from-dark-800 to-dark-800/50 border border-dark-700/30">
              <span className="text-xs text-dark-500 uppercase tracking-wider font-semibold">Hit Rate</span>
              <p className={clsx(
                'text-4xl font-black mt-3',
                opp.validation.hitRate >= 70 && 'text-emerald-400',
                opp.validation.hitRate >= 50 && opp.validation.hitRate < 70 && 'text-yellow-400',
                opp.validation.hitRate < 50 && 'text-red-400'
              )}>
                {opp.validation.hitRate}%
              </p>
              <div className="text-sm text-dark-400 mt-2">
                {opp.validation.hits}/{opp.validation.matchesChecked} games
              </div>
            </div>
            <div className="p-6 rounded-xl bg-gradient-to-br from-dark-800 to-dark-800/50 border border-dark-700/30">
              <span className="text-xs text-dark-500 uppercase tracking-wider font-semibold">Average Value</span>
              <p className="text-4xl font-black mt-3 text-cyan-400">
                {opp.validation.avgValue}
              </p>
              <div className="text-sm text-dark-400 mt-2">
                Last {opp.validation.matchesChecked} games
              </div>
            </div>
            <div className="p-6 rounded-xl bg-gradient-to-br from-dark-800 to-dark-800/50 border border-dark-700/30">
              <span className="text-xs text-dark-500 uppercase tracking-wider font-semibold">Line</span>
              <p className="text-4xl font-black mt-3 text-dark-200">
                {opp.validation.line}
              </p>
              <div className="text-sm text-dark-400 mt-2">
                {opp.validation.direction === 'over' ? 'Over' : 'Under'}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-6 rounded-xl bg-dark-800/30 border border-dark-700/30 text-center">
            <p className="text-dark-400">Stats pending - validation runs automatically on the server</p>
          </div>
        )}
      </div>

      {/* EV Calculation */}
      <div className="card-gradient animate-fade-in-up" style={{ animationDelay: '300ms' }}>
        <h2 className="text-lg font-bold text-dark-100 mb-6 flex items-center gap-3">
          <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-600 to-green-600">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
            </svg>
          </span>
          EV Calculation
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Target Book */}
          <div className="relative p-6 rounded-xl bg-gradient-to-br from-dark-800 to-dark-800/50 border border-dark-700/30 overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-indigo-600/20 to-transparent rounded-full -translate-y-1/2 translate-x-1/2"></div>
            <span className="text-xs text-dark-500 uppercase tracking-wider font-semibold">Target Book</span>
            <p className="text-2xl font-bold text-dark-100 mt-3">{opp.bestEV.targetBookName}</p>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-dark-400">Offered:</span>
              <span className="text-3xl font-mono font-bold text-emerald-400">
                {opp.bestEV.offeredOdds.toFixed(2)}
              </span>
            </div>
            <div className="text-xs text-dark-500 mt-2">
              Implied: {((1 / opp.bestEV.offeredOdds) * 100).toFixed(1)}%
            </div>
          </div>

          {/* Fair Value */}
          <div className="relative p-6 rounded-xl bg-gradient-to-br from-dark-800 to-dark-800/50 border border-dark-700/30 overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-purple-600/20 to-transparent rounded-full -translate-y-1/2 translate-x-1/2"></div>
            <span className="text-xs text-dark-500 uppercase tracking-wider font-semibold">Fair Value</span>
            <p className="text-2xl font-bold text-dark-100 mt-3">
              {opp.bestEV.fairOdds.toFixed(2)}
            </p>
            <div className="mt-4 flex items-center gap-2">
              <span className="text-dark-400">Method:</span>
              <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 text-xs font-medium">
                {opp.bestEV.method.replace(/_/g, ' ')}
              </span>
            </div>
            <div className="text-xs text-dark-500 mt-2">
              Fair Prob: {((1 / opp.bestEV.fairOdds) * 100).toFixed(1)}%
            </div>
          </div>

          {/* Edge */}
          <div className="relative p-6 rounded-xl bg-gradient-to-br from-dark-800 to-dark-800/50 border border-dark-700/30 overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-emerald-600/20 to-transparent rounded-full -translate-y-1/2 translate-x-1/2"></div>
            <span className="text-xs text-dark-500 uppercase tracking-wider font-semibold">Your Edge</span>
            <p className={clsx('text-4xl font-black mt-3', getEVDisplayClass(opp.bestEV.evPercent))}>
              +{opp.bestEV.evPercent.toFixed(2)}%
            </p>
            <div className="mt-4 flex items-center gap-2">
              <span className="text-dark-400">Books Used:</span>
              <span className="text-dark-200 font-semibold">{opp.bookCount}</span>
            </div>
          </div>
        </div>

        {/* Formula */}
        <div className="mt-6 p-5 bg-dark-900/80 rounded-xl border border-dark-800/50">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-4 h-4 text-dark-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
            </svg>
            <span className="text-xs text-dark-500 uppercase tracking-wider font-semibold">Formula</span>
          </div>
          <p className="text-dark-300 font-mono text-sm">
            EV% = (fairProb × offeredOdds - 1) × 100
          </p>
          <p className="text-indigo-400 font-mono text-sm mt-2">
            EV% = ({(1 / opp.bestEV.fairOdds).toFixed(4)} × {opp.bestEV.offeredOdds.toFixed(2)} - 1)
            × 100 = <span className="text-emerald-400 font-bold">{opp.bestEV.evPercent.toFixed(2)}%</span>
          </p>
        </div>
      </div>

      {/* Explanation */}
      {data.explanation && data.explanation.length > 0 && (
        <div className="card animate-fade-in-up" style={{ animationDelay: '400ms' }}>
          <h2 className="text-lg font-bold text-dark-100 mb-5 flex items-center gap-3">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-amber-600 to-orange-600">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
            </span>
            Why This is +EV
          </h2>
          <ul className="space-y-3">
            {data.explanation.map((bullet, index) => (
              <li key={index} className="flex items-start gap-3 p-3 rounded-lg bg-dark-800/30 hover:bg-dark-800/50 transition-colors">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                  </svg>
                </span>
                <span className="text-dark-300">{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* All Methods Comparison */}
      <div className="card-gradient animate-fade-in-up" style={{ animationDelay: '500ms' }}>
        <h2 className="text-lg font-bold text-dark-100 mb-6 flex items-center gap-3">
          <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-pink-600 to-rose-600">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"></path>
            </svg>
          </span>
          EV by Calculation Method
        </h2>
        <div className="overflow-x-auto">
          <table className="ev-table">
            <thead>
              <tr>
                <th>Method</th>
                <th>Fair Odds</th>
                <th>Fair Prob</th>
                <th>EV at {opp.bestEV.targetBookName}</th>
                <th>Books Used</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(opp.fairOdds || {}).map(([method, result], index) => {
                const ev =
                  result.fairProbability > 0
                    ? (result.fairProbability * opp.bestEV.offeredOdds - 1) * 100
                    : 0;

                return (
                  <tr
                    key={method}
                    className="table-row-new"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <td className="font-medium text-dark-200">{method.replace(/_/g, ' ')}</td>
                    <td className="font-mono">
                      {result.fairDecimalOdds > 0 ? result.fairDecimalOdds.toFixed(2) : '-'}
                    </td>
                    <td>
                      {result.fairProbability > 0
                        ? `${(result.fairProbability * 100).toFixed(1)}%`
                        : '-'}
                    </td>
                    <td>
                      {ev > 0 ? (
                        <span className={clsx('badge', getEVBadgeClass(ev))}>
                          +{ev.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-dark-500">-</span>
                      )}
                    </td>
                    <td>
                      <span className="text-dark-300">{result.booksUsed}</span>
                      {result.booksExcluded > 0 && (
                        <span className="text-dark-500 text-xs ml-1">
                          ({result.booksExcluded} excluded)
                        </span>
                      )}
                    </td>
                    <td>
                      {result.isFallback ? (
                        <span className="px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400 text-xs font-medium">
                          {result.fallbackReason}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-xs font-medium">
                          OK
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Back button */}
      <div className="flex justify-end animate-fade-in" style={{ animationDelay: '600ms' }}>
        <Link to="/opportunities" className="btn btn-secondary group">
          <svg className="w-4 h-4 mr-2 transition-transform group-hover:-translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path>
          </svg>
          Back to Opportunities
        </Link>
      </div>
    </div>
  );
}
