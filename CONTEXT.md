# EV Bets App – Project Context

**Last Updated:** 2025-12-15

## 1. Project Summary

A production-ready web application that identifies and displays Expected Value (EV) betting opportunities for pre-match soccer and NBA games. The system aggregates odds from 20-30 sportsbooks via OpticOdds API, calculates fair odds using 5 different statistical methods, and surfaces bets where user-selected target sportsbooks offer odds that exceed fair value by ≥5%. All calculations happen server-side; the frontend is a display layer only. Focus is on player props and team totals markets.

## 2. Core Requirements (Locked)

- **All EV calculations on backend** - Frontend never computes EV
- **Pre-match only** - Exclude all in-play/live markets
- **Minimum EV threshold: 5%** - Configurable via environment
- **5 fair-odds methods** - All must be implemented and selectable
- **Target sportsbooks** - User selects which books to surface EV for
- **2-minute refresh cycle** - Scheduler with no overlap protection
- **TypeScript end-to-end** - Strict typing with Zod validation
- **No secrets in repo** - .env files with .gitignore protection
- **Batching rule** - Max 5 sportsbooks per OpticOdds odds request
- **Deploy targets** - Render (API) + Vercel (Web)

## 3. Current Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         MONOREPO (pnpm)                         │
├─────────────────────────────────────────────────────────────────┤
│  /apps/web           │  React + Vite + Tailwind (Dark UI)      │
│                      │  React Query for data fetching           │
│                      │  Deploy: Vercel                          │
├──────────────────────┼──────────────────────────────────────────┤
│  /apps/api           │  Node.js + Fastify (chosen for speed)    │
│                      │  SQLite + Drizzle ORM                    │
│                      │  EV Engine + Scheduler                   │
│                      │  Deploy: Render                          │
├──────────────────────┼──────────────────────────────────────────┤
│  /packages/shared    │  TypeScript types + Zod schemas          │
│                      │  Shared between frontend/backend         │
└──────────────────────┴──────────────────────────────────────────┘

Data Flow:
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  OpticOdds   │───▶│  API Server  │───▶│   SQLite     │───▶│   Frontend   │
│  (External)  │    │  (Scheduler) │    │   (Cache)    │    │   (Display)  │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
       │                   │
       │                   ▼
       │            ┌──────────────┐
       └───────────▶│  EV Engine   │
                    │  (5 methods) │
                    └──────────────┘
```

## 4. Data Sources

### OpticOdds API
- **Base URL:** https://api.opticodds.com/api/v3
- **Auth:** X-Api-Key header
- **Rate Limits:** Implement backoff + concurrency limiting

### Sports Covered
- **Soccer:** Top European leagues (EPL, La Liga, Serie A, Bundesliga, Ligue 1) + additional top-tier
- **Basketball:** NBA (usa_-_nba league ID)

### Market Types (Target)
- **Player Props:** Goals, assists, shots, SOT, cards (soccer); Points, rebounds, assists, threes (NBA)
- **Team Totals:** Shots on target, offsides, corners (soccer); Team totals (NBA)
- **Main Markets:** Moneyline, spreads, totals (as available)

### Refresh Strategy
- 2-minute interval via setInterval
- Mutex lock prevents overlapping runs
- Full pipeline: Fixtures → Odds → Normalize → Calculate EV → Persist

## 5. EV Logic

### Fair Odds Methods

| Method | Description | Use Case |
|--------|-------------|----------|
| TRIMMED_MEAN_PROB | Remove outliers (MAD/IQR), compute mean of implied probs | Default, robust consensus |
| MEDIAN_PROB | Median implied probability | Baseline, most robust |
| SHARP_BOOK_REFERENCE | De-vig Pinnacle odds (fallback to median if unavailable) | When sharp book has the market |
| LOGIT_AVERAGE | Average in logit space, invert back | Reduces extreme value bias |
| BAYESIAN_SHRINKAGE | Shrink toward median prior | Smooths noisy estimates |

### De-Vig Logic
- Two-sided markets: Remove juice proportionally from both sides
- Multi-way markets: Normalize overround across all outcomes
- Single selection: Use robust methods (median/trimmed mean)

### EV Calculation
```
EV% = (p_fair × offered_decimal - 1) × 100
```
Where:
- `p_fair` = Fair probability from chosen method
- `offered_decimal` = Target sportsbook's decimal odds

### Filtering
- Only surface if EV% >= MIN_EV_PERCENT (default 5%)
- Must have odds from target sportsbook
- Must have sufficient sportsbook coverage for fair odds calculation (≥3 books minimum)

## 6. Current State

### Implemented
- [x] Project directory created
- [x] CONTEXT.md initialized
- [x] OpticOdds API exploration (sportsbooks, sports, leagues)
- [x] Monorepo scaffold (pnpm workspaces)
- [x] Shared types package with Zod schemas
- [x] OpticOdds client with batching/retry/concurrency limiting
- [x] EV engine with all 5 fair-odds methods
- [x] Database schema (Drizzle + SQLite)
- [x] Scheduler with mutex lock
- [x] API routes (health, meta, opportunities, fixtures)
- [x] Frontend UI (Dashboard, Opportunities, Detail, Settings)
- [x] README.md and CLAUDE.md documentation

### Partially Implemented
- [ ] Tests (vitest setup exists but no test files yet)
- [ ] Book breakdown in opportunity detail (requires re-fetching odds)

### Not Started
- [ ] E2E tests
- [ ] Demo data toggle for UI dev

## 7. Immediate Next Tasks

1. ~~Run `pnpm install` to install all dependencies~~ DONE
2. ~~Run `pnpm build` to verify TypeScript compiles~~ DONE
3. ~~Run `pnpm dev` to start development servers~~ DONE
4. ~~Verify the pipeline runs and fetches data from OpticOdds~~ DONE (7,141 opportunities found!)
5. Add unit tests for EV engine
6. Deploy API to Render
7. Deploy frontend to Vercel

## 8. Future Improvements / Ideas Backlog

- [ ] WebSocket/SSE for real-time updates instead of polling
- [ ] Historical EV tracking for ROI analysis
- [ ] Bankroll management calculator
- [ ] Notifications/alerts for high-EV opportunities
- [ ] Mobile app version
- [ ] Additional sports (NFL, NHL, etc.)
- [ ] Kelly criterion stake sizing
- [ ] Odds movement tracking
- [ ] Multi-book arbitrage detection
- [ ] Custom fair-odds method configuration
- [ ] User accounts with saved preferences
- [ ] Premium tier with more frequent updates

## 9. Risks & Open Questions

### Risks
1. **Bet365 unavailable** - User's primary target book not in OpticOdds
2. **Player props coverage** - Need to verify OpticOdds has sufficient prop market data
3. **Rate limiting** - Must carefully manage API calls to avoid throttling
4. **Market mapping** - OpticOdds market names may differ from expected; need normalization
5. **Data freshness** - 2-minute refresh may miss fast line movements

### Open Questions
1. **[RESOLVED] Which sportsbooks should be targets?**
   - Bet365 not available
   - **DECISION:** Betano, Unibet, Betway as targets
   - **DECISION:** Pinnacle as sharp book reference

2. **Which specific leagues to enable?**
   - Default: EPL, La Liga, Serie A, Bundesliga, Ligue 1, NBA
   - User can configure

3. **Market priority if props unavailable?**
   - Fallback to main markets (ML, spreads, totals)?

## 10. Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2025-12-15 | Use Fastify over Express | Better performance, built-in validation, TypeScript-first |
| 2025-12-15 | Use Drizzle over Prisma | Lighter weight, better SQLite support, SQL-like syntax |
| 2025-12-15 | Use SQLite for storage | Simple, file-based, easy swap to Postgres later |
| 2025-12-15 | Pinnacle as sharp reference | Industry standard sharp book for de-vig baseline |
| 2025-12-15 | Target books: Betano, Unibet, Betway | User selection; Bet365 unavailable in OpticOdds |

---

## Session Notes

### 2025-12-15 - Initial Session
- Project initialized
- Discovered Bet365 NOT available in OpticOdds (critical for user)
- Confirmed Betano, Unibet, Pinnacle available
- User selected: Betano, Unibet, Betway as targets; Pinnacle as sharp reference

### 2025-12-15 - Full Implementation Complete
- Created complete monorepo structure with pnpm workspaces
- Built shared types package with comprehensive Zod schemas
- Implemented OpticOdds client with batching (max 5 books), retry, and concurrency limiting

### 2025-12-15 - Bug Fixes & Testing
- Fixed `better-sqlite3` native compilation issue - switched to `@libsql/client` for cross-platform support
- Fixed OpticOdds fixtures response schema - `sport` and `league` are objects, not strings
- Fixed OpticOdds odds response schema - added passthrough for unknown fields like `deep_link`, `order_book`, `source_ids`
- Fixed pipeline to correctly extract sportsbook ID from odds entries (inside each entry, not at fixture level)
- Fixed timestamp handling - API returns Unix timestamps as numbers
- Fixed null handling for `player_id`, `team_id`, `points` fields
- **VERIFIED WORKING**: Pipeline successfully fetches 154 fixtures, finds 7,141+ EV opportunities, persists to SQLite
- API running on port 4000, Web UI on port 3000/3001
- Built EV engine with all 5 fair-odds methods:
  - TRIMMED_MEAN_PROB: MAD outlier removal + mean
  - MEDIAN_PROB: Robust median baseline
  - SHARP_BOOK_REFERENCE: Pinnacle de-vig with fallback
  - LOGIT_AVERAGE: Logit space averaging
  - BAYESIAN_SHRINKAGE: Prior-based smoothing
- Set up SQLite database with Drizzle ORM
- Built scheduler with mutex lock for 2-min refresh cycles
- Created all API routes
- Built dark-themed React frontend with React Query
- Ready for `pnpm install && pnpm dev`
