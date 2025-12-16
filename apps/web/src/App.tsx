import { Routes, Route, NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Dashboard from './pages/Dashboard';
import Opportunities from './pages/Opportunities';
import OpportunityDetail from './pages/OpportunityDetail';
import Settings from './pages/Settings';
import { fetchHealth } from './api/client';
import clsx from 'clsx';

function App() {
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 30000, // 30 seconds
  });

  const isSchedulerRunning = health?.scheduler?.isRunning ?? false;

  return (
    <div className="min-h-screen bg-dark-950 text-dark-100">
      {/* Header with gradient border */}
      <header className="bg-dark-900/95 backdrop-blur-md border-b border-dark-800/50 sticky top-0 z-50">
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo with glow */}
            <div className="flex items-center space-x-3 group">
              <div className="relative w-10 h-10 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/25 group-hover:shadow-indigo-500/40 transition-all duration-300">
                <span className="text-white font-black text-sm">EV</span>
                <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/20 to-transparent"></div>
              </div>
              <div>
                <span className="text-xl font-black gradient-text">EV Bets</span>
                <div className="text-[10px] text-dark-500 -mt-1">Positive Value Finder</div>
              </div>
            </div>

            {/* Navigation with animated underline */}
            <nav className="flex items-center space-x-1">
              <NavLink
                to="/"
                className={({ isActive }) =>
                  clsx(
                    'nav-link relative px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300',
                    isActive
                      ? 'text-white bg-gradient-to-r from-indigo-600/20 to-purple-600/20'
                      : 'text-dark-400 hover:text-white hover:bg-dark-800/50'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path>
                      </svg>
                      Dashboard
                    </span>
                    {isActive && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full"></span>}
                  </>
                )}
              </NavLink>
              <NavLink
                to="/opportunities"
                className={({ isActive }) =>
                  clsx(
                    'nav-link relative px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300',
                    isActive
                      ? 'text-white bg-gradient-to-r from-indigo-600/20 to-purple-600/20'
                      : 'text-dark-400 hover:text-white hover:bg-dark-800/50'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path>
                      </svg>
                      Opportunities
                    </span>
                    {isActive && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full"></span>}
                  </>
                )}
              </NavLink>
              <NavLink
                to="/settings"
                className={({ isActive }) =>
                  clsx(
                    'nav-link relative px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300',
                    isActive
                      ? 'text-white bg-gradient-to-r from-indigo-600/20 to-purple-600/20'
                      : 'text-dark-400 hover:text-white hover:bg-dark-800/50'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                      </svg>
                      Settings
                    </span>
                    {isActive && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full"></span>}
                  </>
                )}
              </NavLink>
            </nav>

            {/* Status indicator with pulse */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-dark-800/80 border border-dark-700/50">
                <div className="relative">
                  <div
                    className={clsx(
                      'w-2 h-2 rounded-full',
                      health?.status === 'ok' ? 'bg-emerald-500' : 'bg-yellow-500'
                    )}
                  />
                  {health?.status === 'ok' && (
                    <div className="absolute inset-0 w-2 h-2 rounded-full bg-emerald-500 animate-ping opacity-75"></div>
                  )}
                </div>
                <span className="text-xs font-medium text-dark-300">
                  {isSchedulerRunning ? (
                    <span className="flex items-center gap-1">
                      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Scanning
                    </span>
                  ) : (
                    'Live'
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/opportunities" element={<Opportunities />} />
          <Route path="/opportunities/:id" element={<OpportunityDetail />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>

      {/* Footer with gradient */}
      <footer className="bg-dark-900/80 backdrop-blur-sm border-t border-dark-800/50 py-6 mt-auto">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-purple-500/30 to-transparent"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm text-dark-400 text-center">
              <span className="gradient-text font-semibold">EV Bets</span> - Find positive expected value betting opportunities
            </p>
            <p className="text-xs text-dark-600">
              Powered by advanced odds analysis
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
