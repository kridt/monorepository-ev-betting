# CLAUDE.md - Development Conventions

This file contains conventions and commands for AI-assisted development.

## Project Structure

```
ev-bets-app/                    # Root monorepo
├── apps/
│   ├── api/                    # Fastify backend
│   │   ├── src/
│   │   │   ├── db/             # Database schema & connection
│   │   │   ├── engine/         # EV calculation engine
│   │   │   ├── routes/         # API route handlers
│   │   │   ├── scheduler/      # Data pipeline scheduler
│   │   │   ├── services/       # External service clients
│   │   │   ├── config.ts       # Environment config
│   │   │   └── index.ts        # Entry point
│   │   └── .env                # Environment variables (DO NOT COMMIT)
│   └── web/                    # React frontend
│       └── src/
│           ├── api/            # API client
│           ├── components/     # Reusable components
│           └── pages/          # Page components
├── packages/
│   └── shared/                 # Shared types & schemas
│       └── src/
│           ├── types/          # Zod schemas & TypeScript types
│           └── constants.ts    # Shared constants
└── docs/                       # Documentation
```

## Commands

```bash
# Development
pnpm dev           # Run all apps in parallel
pnpm dev:api       # Run API only
pnpm dev:web       # Run web only

# Build
pnpm build         # Build all
pnpm build:api     # Build API
pnpm build:web     # Build web

# Quality
pnpm lint          # Lint all
pnpm lint:fix      # Fix lint issues
pnpm format        # Format with Prettier
pnpm typecheck     # TypeScript check

# Testing
pnpm test          # Run all tests
pnpm test:api      # Run API tests
```

## Key Files

- `CONTEXT.md` - Project memory & roadmap (MUST be kept up to date)
- `apps/api/.env` - API secrets (never commit)
- `packages/shared/src/constants.ts` - Shared constants & defaults
- `apps/api/src/engine/fairOdds.ts` - EV calculation methods
- `apps/api/src/scheduler/pipeline.ts` - Data fetch pipeline

## Conventions

### TypeScript
- Strict mode enabled
- No `any` types in production code
- Use Zod for runtime validation
- Prefer types from `@ev-bets/shared`

### Naming
- Files: camelCase (e.g., `opticOddsClient.ts`)
- Components: PascalCase (e.g., `Dashboard.tsx`)
- Constants: UPPER_SNAKE_CASE
- Variables/functions: camelCase

### API Design
- Use Fastify route handlers
- Validate with Zod schemas
- Return JSON with consistent shape
- Error responses include `error`, `message`, `statusCode`

### Database
- SQLite with Drizzle ORM
- Migrations via Drizzle Kit
- Use transactions for multi-table ops

### Frontend
- React Query for data fetching
- Tailwind for styling
- Dark theme by default
- Mobile-responsive

## Important Notes

1. **Never commit secrets** - .env files are gitignored
2. **Bet365 is unavailable** - Not in OpticOdds
3. **Batch sportsbooks** - Max 5 per OpticOdds request
4. **Pre-match only** - Filter out live fixtures
5. **Min 3 books** - Need 3+ books for fair odds calculation

## Agent Roles (for multi-agent work)

- **Architect**: Repo structure, service boundaries, data flow
- **API Integration**: OpticOdds client, batching, rate limits
- **EV/Quant**: Fair odds methods, de-vig, outlier detection
- **Backend**: Database, scheduler, API routes
- **Frontend**: React UI, filters, visualizations
- **QA**: E2E testing, deployment, documentation
