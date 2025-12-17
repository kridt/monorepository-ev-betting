# EV Bets App

A production-ready web application that identifies and displays Expected Value (EV) betting opportunities for pre-match soccer and NBA games.

## Features

- **Multi-Sport Support**: Soccer (Premier League, La Liga, Serie A, Bundesliga, Ligue 1) and NBA
- **5 Fair Odds Methods**: Trimmed Mean, Median, Sharp Book Reference, Logit Average, Bayesian Shrinkage
- **Real-time Updates**: 2-minute refresh cycle with batched API calls
- **Target Sportsbook Selection**: Configure which books to find +EV opportunities for
- **Dark Modern UI**: Built with React, Tailwind CSS, and React Query
- **Full Breakdown**: See exactly how EV is calculated for each opportunity

## Architecture

```
ev-bets-app/
├── apps/
│   ├── api/          # Fastify backend (Node.js)
│   └── web/          # React frontend (Vite)
├── packages/
│   └── shared/       # Shared types & Zod schemas
└── docs/             # Documentation
```

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm 8+

### Installation

```bash
# Install dependencies
pnpm install

# Set up environment
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env with your OpticOdds API key

# Start development
pnpm dev
```

The API will run on `http://localhost:4000` and the web app on `http://localhost:3000`.

## Configuration

### Environment Variables (apps/api/.env)

```env
OPTICODDS_API_KEY=your_api_key_here
PORT=4000
DB_PATH=./data/dev.db
REFRESH_INTERVAL_MS=120000
MIN_EV_PERCENT=5
TARGET_SPORTSBOOKS=betano,unibet,betway,leovegas,betsson
SHARP_BOOK=pinnacle
SOCCER_LEAGUES=england_-_premier_league,spain_-_la_liga
BASKETBALL_LEAGUES=usa_-_nba
```

### Target Sportsbooks

Currently configured targets:
- **Betano** (`betano`)
- **Unibet** (`unibet`)
- **Betway** (`betway`)
- **LeoVegas** (`leovegas`)
- **Betsson** (`betsson`)

Sharp book reference: **Pinnacle** (`pinnacle`)

Note: Bet365 is NOT available in OpticOdds.

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check with scheduler status |
| `GET /meta/sportsbooks` | List available sportsbooks |
| `GET /meta/leagues` | List available leagues |
| `GET /meta/methods` | List fair odds calculation methods |
| `GET /ev/opportunities` | List EV opportunities with filtering |
| `GET /ev/opportunities/:id` | Get opportunity detail with breakdown |
| `GET /fixtures/active` | List active pre-match fixtures |

## Fair Odds Methods

1. **TRIMMED_MEAN_PROB**: Removes outliers using MAD, then calculates mean implied probability
2. **MEDIAN_PROB**: Uses median implied probability (most robust)
3. **SHARP_BOOK_REFERENCE**: Uses de-vigged Pinnacle odds when available
4. **LOGIT_AVERAGE**: Averages in logit space to reduce extreme value bias
5. **BAYESIAN_SHRINKAGE**: Applies Bayesian shrinkage toward median prior

## Deployment

### Backend (Render)

1. Create a new Web Service on Render
2. Connect your repo
3. Build command: `pnpm install && pnpm build:api`
4. Start command: `node apps/api/dist/index.js`
5. Set environment variables

### Frontend (Vercel)

1. Import project on Vercel
2. Root directory: `apps/web`
3. Build command: `pnpm build`
4. Set `VITE_API_BASE_URL` to your Render API URL

## Development

```bash
# Run both API and web in parallel
pnpm dev

# Run only API
pnpm dev:api

# Run only web
pnpm dev:web

# Build all
pnpm build

# Run tests
pnpm test

# Lint
pnpm lint
```

## Tech Stack

- **Backend**: Fastify, Drizzle ORM, SQLite, Zod
- **Frontend**: React 18, Vite, Tailwind CSS, React Query
- **Shared**: TypeScript, Zod schemas
- **Package Manager**: pnpm workspaces

## License

MIT
