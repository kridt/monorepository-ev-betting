# EV Bets App - Architecture

## ULTRATHINK Design Document

### A. Architecture Diagram (Text)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER BROWSER                                    │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    React + Vite + Tailwind                            │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │  │
│  │  │  Dashboard  │  │Opportunities│  │   Detail    │  │  Settings   │   │  │
│  │  │    Page     │  │    Table    │  │    View     │  │    Page     │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │  │
│  │                           │                                            │  │
│  │                    React Query                                         │  │
│  │                    (Cache + Refetch)                                   │  │
│  └───────────────────────────┼───────────────────────────────────────────┘  │
└──────────────────────────────┼──────────────────────────────────────────────┘
                               │ HTTP/JSON
                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                           FASTIFY API SERVER                                  │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                          API Routes Layer                              │  │
│  │  /health  /meta/*  /ev/opportunities  /ev/opportunities/:id  /fixtures │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                               │                                              │
│  ┌────────────────────────────┼────────────────────────────────────────────┐ │
│  │                    Service Layer                                        │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                   │ │
│  │  │   Scheduler  │  │  EV Engine   │  │  OpticOdds   │                   │ │
│  │  │  (2-min job) │  │  (5 methods) │  │   Client     │                   │ │
│  │  │   + Mutex    │  │              │  │ (batch/retry)│                   │ │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                   │ │
│  │         │                 │                 │                           │ │
│  │         ▼                 ▼                 │                           │ │
│  │  ┌──────────────────────────────────┐      │                           │ │
│  │  │         Data Pipeline            │      │                           │ │
│  │  │  Fetch → Normalize → Calculate   │◄─────┘                           │ │
│  │  │      → Persist → Cleanup         │                                  │ │
│  │  └──────────────────────────────────┘                                  │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                               │                                              │
│  ┌────────────────────────────┼────────────────────────────────────────────┐ │
│  │                    Repository Layer                                     │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                   │ │
│  │  │   Fixtures   │  │    Odds      │  │Opportunities │                   │ │
│  │  │    Repo      │  │    Repo      │  │    Repo      │                   │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘                   │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                               │                                              │
│  ┌────────────────────────────┼────────────────────────────────────────────┐ │
│  │                      Drizzle ORM                                        │ │
│  │                     (Type-safe SQL)                                     │ │
│  └────────────────────────────┼────────────────────────────────────────────┘ │
└───────────────────────────────┼──────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                            SQLite Database                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   fixtures   │  │odds_snapshots│  │ opportunities│  │  sportsbooks │       │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                         │
│  │   markets    │  │   leagues    │  │   config     │                         │
│  └──────────────┘  └──────────────┘  └──────────────┘                         │
└───────────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                          OpticOdds API                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   /sports    │  │   /leagues   │  │  /fixtures   │  │/fixtures/odds│       │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘       │
│  ┌──────────────┐  ┌──────────────┐                                           │
│  │ /sportsbooks │  │  /markets    │                                           │
│  └──────────────┘  └──────────────┘                                           │
└───────────────────────────────────────────────────────────────────────────────┘
```

### B. System Invariants

These invariants MUST hold at all times:

1. **Backend-Only Calculation Invariant**
   - EV calculations NEVER occur in browser
   - Frontend receives pre-computed opportunities only
   - No odds data transformation in frontend code

2. **Pre-match Only Invariant**
   - System excludes all fixtures where `start_date < now()`
   - Live/in-play fixtures never enter the pipeline
   - All displayed opportunities are for future events

3. **Minimum Coverage Invariant**
   - Fair odds require ≥3 sportsbook prices
   - Single-book markets are excluded from EV calculation
   - Insufficient data marked and logged

4. **Batching Invariant**
   - OpticOdds /fixtures/odds requests have max 5 sportsbooks
   - Sportsbooks passed as repeated query params (NOT comma-separated)
   - Concurrency limited to avoid rate limits

5. **No Overlap Invariant**
   - Scheduler mutex prevents concurrent pipeline runs
   - New run cannot start until previous completes
   - Timeout kills stuck runs after 90 seconds

6. **Data Freshness Invariant**
   - Odds snapshots have TTL of 5 minutes
   - Stale data marked with warning flag
   - Opportunities older than 5 min excluded from display

7. **Secret Protection Invariant**
   - API key never in git history
   - Never logged (even in errors)
   - Environment variables only

8. **Idempotency Invariant**
   - Pipeline runs are idempotent
   - Re-running produces same results for same inputs
   - No duplicate opportunities in database

9. **Explainability Invariant**
   - Every EV opportunity includes full calculation breakdown
   - Shows which books contributed to fair odds
   - Shows which books were excluded as outliers

10. **Type Safety Invariant**
    - All API responses validated with Zod
    - Shared types between frontend/backend
    - No `any` types in production code

### C. Sprint Plan with Checkpoints

#### Sprint 0: Foundation (Checkpoint: Monorepo builds)
- [ ] Create pnpm workspace config
- [ ] Scaffold /apps/api (Fastify + TypeScript)
- [ ] Scaffold /apps/web (Vite + React + Tailwind)
- [ ] Scaffold /packages/shared (types + schemas)
- [ ] Configure ESLint + Prettier
- [ ] Set up tsconfig inheritance
- [ ] Create .env.example files
- [ ] Add .gitignore
- **Checkpoint:** `pnpm install && pnpm build` succeeds

#### Sprint 1: OpticOdds Integration (Checkpoint: Can fetch odds)
- [ ] Build opticOddsClient.ts with:
  - [ ] X-Api-Key header injection
  - [ ] Retry with exponential backoff (3 attempts)
  - [ ] Concurrency limiter (p-limit, max 5 concurrent)
  - [ ] Sportsbook batching helper
  - [ ] Safe logging (redact API key)
- [ ] Add endpoint wrappers:
  - [ ] fetchSports()
  - [ ] fetchLeagues(sport)
  - [ ] fetchSportsbooks(sport)
  - [ ] fetchFixtures(sport, league, prematchOnly)
  - [ ] fetchOdds(fixtureId, sportsbooks[], markets[])
- [ ] Write integration tests with mocked responses
- **Checkpoint:** Successfully fetch real odds from OpticOdds

#### Sprint 2: EV Engine (Checkpoint: All 5 methods pass tests)
- [ ] TDD: Write tests first for each method
- [ ] Implement odds normalization:
  - [ ] American → Decimal → Implied Prob
  - [ ] De-vig for two-sided markets
  - [ ] Overround normalization for multi-way
- [ ] Implement fair odds methods:
  - [ ] TRIMMED_MEAN_PROB (MAD outlier removal)
  - [ ] MEDIAN_PROB
  - [ ] SHARP_BOOK_REFERENCE (Pinnacle de-vig)
  - [ ] LOGIT_AVERAGE
  - [ ] BAYESIAN_SHRINKAGE
- [ ] Implement EV calculation
- [ ] Implement outlier detection/logging
- **Checkpoint:** All EV engine tests pass

#### Sprint 3: Database & Persistence (Checkpoint: CRUD works)
- [ ] Design Drizzle schema:
  - [ ] fixtures table
  - [ ] odds_snapshots table
  - [ ] opportunities table
  - [ ] sportsbooks table
  - [ ] markets table
  - [ ] leagues table
  - [ ] config table
- [ ] Implement repositories:
  - [ ] FixturesRepository
  - [ ] OddsRepository
  - [ ] OpportunitiesRepository
  - [ ] ConfigRepository
- [ ] Write repository tests
- **Checkpoint:** Can insert and query all tables

#### Sprint 4: Pipeline & Scheduler (Checkpoint: Auto-refresh works)
- [ ] Implement data pipeline:
  - [ ] Fetch pre-match fixtures
  - [ ] Batch fetch odds
  - [ ] Normalize and group by selection
  - [ ] Calculate fair odds (all methods)
  - [ ] Calculate EV for target books
  - [ ] Persist opportunities
  - [ ] Cleanup stale data
- [ ] Implement scheduler:
  - [ ] setInterval with REFRESH_INTERVAL_MS
  - [ ] Mutex lock (async-mutex)
  - [ ] Timeout protection
  - [ ] Error handling and logging
- **Checkpoint:** Pipeline runs every 2 min, data appears in DB

#### Sprint 5: API Routes (Checkpoint: All endpoints documented)
- [ ] Implement routes:
  - [ ] GET /health
  - [ ] GET /meta/sportsbooks
  - [ ] POST /meta/targets
  - [ ] GET /meta/leagues
  - [ ] POST /meta/leagues
  - [ ] GET /meta/methods
  - [ ] GET /ev/opportunities (with filters, pagination)
  - [ ] GET /ev/opportunities/:id
  - [ ] GET /fixtures/active
- [ ] Add request validation (Zod)
- [ ] Add error handling middleware
- [ ] Write API tests (supertest-like)
- **Checkpoint:** All routes return valid responses

#### Sprint 6: Frontend UI (Checkpoint: UI displays data)
- [ ] Set up React Query client
- [ ] Create API client (typed)
- [ ] Build pages:
  - [ ] Dashboard (KPIs, status)
  - [ ] Opportunities table (filters, sort, pagination)
  - [ ] Opportunity detail (full breakdown)
  - [ ] Settings (method, targets, leagues, min EV)
- [ ] Apply dark theme (Tailwind)
- [ ] Add loading/error states
- [ ] Add minimal tests (smoke tests)
- **Checkpoint:** Can browse and filter opportunities

#### Sprint 7: Integration & Polish (Checkpoint: E2E works)
- [ ] Wire frontend to backend
- [ ] Test full flow
- [ ] Add demo data toggle (if no live opportunities)
- [ ] Write README.md with:
  - [ ] Local setup instructions
  - [ ] Render deploy steps
  - [ ] Vercel deploy steps
- [ ] Create CLAUDE.md with conventions
- [ ] Final code review
- **Checkpoint:** Full system works end-to-end

---

## Agent Responsibilities

### Architect Agent
- ✅ Defined repo structure
- ✅ Defined service boundaries (Client → Engine → Repo → DB)
- ✅ Defined data flow
- ✅ Defined caching strategy (DB + in-memory TTL)
- ✅ Defined batching rules
- ✅ Defined deployment targets

### API Integration Agent
- Pending: Read OpticOdds docs thoroughly
- Pending: Verify all endpoints and params
- Pending: Implement client with batching
- Pending: Test rate limit handling

### EV/Quant Agent
- Pending: Design 5 fair-odds methods
- Pending: Implement de-vig logic
- Pending: Implement outlier handling
- Pending: Write tests first (TDD)

### Backend Agent
- Pending: Implement database schema
- Pending: Implement scheduler
- Pending: Implement repositories
- Pending: Implement API endpoints

### Frontend/UX Agent
- Pending: Build dark UI
- Pending: Implement React Query integration
- Pending: Build filter components
- Pending: Build detail breakdown view

### QA/Release Agent
- Pending: End-to-end testing
- Pending: README + deployment docs
- Pending: Secret audit
- Pending: Output sanity check
