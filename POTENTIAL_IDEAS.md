# Potential Ideas for EV Bets App

Based on reference UI analysis. These are features to consider for future implementation.

---

## 1. Bet Tracking System
- **Track / Remove buttons** on each opportunity
- **Tabs**: New Bets | Tracked | Removed with counts
- Persist tracked bets (localStorage or database)
- Show tracked bet count in header

## 2. De-vig Method Selection
Current: Trimmed Mean + Sharp Book Reference
Consider adding:
- **Multiplicative** - Most common de-vig method
- **Power** - Power de-vig for balanced markets
- **Additive** - Simple additive de-vig
- **Worst Case** - Conservative, uses worst implied probability
- Radio buttons with "Hover for description"

## 3. Enhanced Historical Hit Rate
Expand current Validate button to show:
- **Last 15 games breakdown** (not just 10)
- **Home/Away split percentages** - "Home: 67% (9g), Away: 50% (6g)"
- **L5 indicator** - Last 5 games with hot/cold icon
- **Recent results** - Color-coded game-by-game values (1, 0, 3, 0, 0...)
- **Hit Rate Odds** - Implied odds from hit rate

## 4. Bet Grading System (A/B/C/D)
Visual quality indicator badge on each bet
Possible criteria:
- EV% thresholds (A = 15%+, B = 10%+, C = 5%+, D = 3%+)
- Combined with book count reliability
- Combined with hit rate validation

## 5. Units/Stake Recommendation
Show suggested bet size: "Units: 0.75"
Options:
- **Kelly Criterion** - Optimal bankroll %
- **Fractional Kelly** - Safer 25-50% Kelly
- **Fixed by EV tier** - 0.5u for low, 1u for high

## 6. Market Type Filters (Sport-Specific)
**Basketball:**
- Points, Rebounds, Assists, 3PT, Combos, Other

**Football:**
- Shots, Tackles, Fouls, Cards, Goals, Assists

## 7. Real-time Sync Progress UI
- "Match 31 of 40" progress indicator
- "20/20 bookmakers" fetch progress bar
- "Updated 22s ago" timestamp
- "SYNCING" / "LIVE" status badges
- Cache timer countdown

## 8. Playable vs Average Books Visual
- **Green badges** for target/playable books
- **Gray badges** for market-maker books (used for average only)
- Clear visual distinction in the UI

## 9. API Debug Panel
- Collapsible panel showing:
  - API request/response times
  - Cache hit/miss rates
  - Error logs
  - Rate limit status

## 10. Betting Guide & Tips Section
- Collapsible educational content
- Explains EV betting concepts
- Market-specific tips

---

## Implementation Priority (Suggested)
1. All bookmaker odds display (IN PROGRESS)
2. Bet tracking system
3. Enhanced hit rate display
4. Bet grading
5. Units recommendation
6. Market filters
7. Sync progress UI

---

*Last updated: 2024-12-15*
