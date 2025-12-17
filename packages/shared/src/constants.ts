// Fair odds calculation methods
export const FAIR_ODDS_METHODS = [
  'TRIMMED_MEAN_PROB',
  'SHARP_BOOK_REFERENCE',
] as const;

export type FairOddsMethod = (typeof FAIR_ODDS_METHODS)[number];

// Simple "idiot-proof" descriptions for UI
export const FAIR_ODDS_METHOD_SIMPLE: Record<FairOddsMethod, string> = {
  TRIMMED_MEAN_PROB:
    'Best overall choice. Ignores crazy odds and averages the rest.',
  SHARP_BOOK_REFERENCE:
    'Trusts the sharpest book (Pinnacle). Great when available.',
};

// Detailed technical descriptions for UI
export const FAIR_ODDS_METHOD_DESCRIPTIONS: Record<FairOddsMethod, string> = {
  TRIMMED_MEAN_PROB:
    'Removes outlier odds using MAD (Median Absolute Deviation), then calculates the mean implied probability. Robust consensus approach.',
  SHARP_BOOK_REFERENCE:
    'Uses de-vigged Pinnacle odds when available. Falls back to TRIMMED_MEAN_PROB if Pinnacle does not have the market.',
};

// Full detailed explanations with examples
export const FAIR_ODDS_METHOD_DETAILED: Record<FairOddsMethod, {
  howItWorks: string;
  bestFor: string;
  pros: string[];
  cons: string[];
  example: string;
}> = {
  TRIMMED_MEAN_PROB: {
    howItWorks: 'First, it calculates the median odds and measures how far each bookmaker\'s odds are from that median (using MAD - Median Absolute Deviation). Any odds that are more than 2.5 MAD away from the median are removed as "outliers". Then it calculates the average of the remaining odds. This gives you a market consensus without being skewed by one book offering crazy odds.',
    bestFor: 'Most markets, especially popular events with 10+ books offering odds.',
    pros: [
      'Automatically removes manipulated or incorrect odds',
      'Uses data from many books for accuracy',
      'Balanced approach between being aggressive and conservative'
    ],
    cons: [
      'Needs at least 5+ books to work well',
      'May remove legitimate sharp odds as "outliers"'
    ],
    example: 'If 10 books have odds of 2.0, 2.05, 2.1, 2.0, 2.15, 2.0, 2.1, 5.0, 2.05, 2.1 - the 5.0 outlier is removed, and the fair odds calculated from the remaining 9.'
  },
  SHARP_BOOK_REFERENCE: {
    howItWorks: 'Uses odds from Pinnacle (considered the sharpest global bookmaker) and removes their profit margin (vig) to get the true probability. Pinnacle is known for accepting large bets from professional gamblers, so their odds reflect real money and expert opinions.',
    bestFor: 'Major markets where Pinnacle offers odds. Most accurate for high-liquidity events.',
    pros: [
      'Based on the sharpest, most accurate book',
      'Reflects where professional money is going',
      'Most accurate for popular markets'
    ],
    cons: [
      'Only works when Pinnacle has the market',
      'Falls back to Trimmed Mean if Pinnacle unavailable',
      'Pinnacle doesn\'t cover niche markets'
    ],
    example: 'Pinnacle offers Team A at 1.95 and Team B at 1.95 (total 102.6% with vig). After de-vigging, the fair odds are approximately 2.0 for each (50% true probability).'
  },
};

// Sports
export const SUPPORTED_SPORTS = ['soccer', 'basketball'] as const;
export type SupportedSport = (typeof SUPPORTED_SPORTS)[number];

// Default configuration
export const DEFAULT_CONFIG = {
  MIN_EV_PERCENT: 5,
  REFRESH_INTERVAL_MS: 120000, // 2 minutes
  MAX_SPORTSBOOKS_PER_REQUEST: 5,
  MIN_BOOKS_FOR_FAIR_ODDS: 3,
  ODDS_TTL_MS: 300000, // 5 minutes
  MAX_CONCURRENT_REQUESTS: 5,
  RETRY_ATTEMPTS: 3,
  RETRY_BASE_DELAY_MS: 1000,
} as const;

// Default leagues (27 leagues covered by SportMonks)
export const DEFAULT_SOCCER_LEAGUES = [
  // Austria
  'austria_-_bundesliga',
  // Belgium
  'belgium_-_jupiler_pro_league',
  // Croatia
  'croatia_-_1_hnl',
  // Denmark
  'denmark_-_superliga',
  // England
  'england_-_premier_league',
  'england_-_championship',
  'england_-_fa_cup',
  'england_-_league_cup',
  // Europe
  'uefa_-_europa_league',
  // France
  'france_-_ligue_1',
  // Germany
  'germany_-_bundesliga',
  // Italy
  'italy_-_serie_a',
  'italy_-_serie_b',
  'italy_-_coppa_italia',
  // Netherlands
  'netherlands_-_eredivisie',
  // Norway
  'norway_-_eliteserien',
  // Poland
  'poland_-_ekstraklasa',
  // Portugal
  'portugal_-_primeira_liga',
  // Russia
  'russia_-_premier_league',
  // Scotland
  'scotland_-_premiership',
  // Spain
  'spain_-_la_liga',
  'spain_-_la_liga_2',
  'spain_-_copa_del_rey',
  // Sweden
  'sweden_-_allsvenskan',
  // Switzerland
  'switzerland_-_super_league',
  // Turkey
  'turkey_-_super_lig',
  // Ukraine
  'ukraine_-_premier_league',
];

export const DEFAULT_BASKETBALL_LEAGUES = ['nba'];

// Target sportsbooks (user configurable)
export const DEFAULT_TARGET_SPORTSBOOKS = ['betano', 'unibet', 'betway', 'leovegas', 'betsson'];

// Sharp book for reference
export const SHARP_BOOK_ID = 'pinnacle';
