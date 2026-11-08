# Chart levels: one engine for the chart and Atlas (2026-11-08)

## Problem
Before Atlas ran, the Analyze chart drew levels from a client-side `findLocalLevels` (mobile `lib/chartAnalysis.ts`): 5-bar swing points, 1% clustering, top 3 by count, with no check of which side of price a level is on. After Atlas ran, the chart swapped to the backend scored levels. The two disagreed, and the pre-Atlas set mislabeled levels below price as resistance.

AAPL 3M, last close $342.37 (Nov 6, 2026):
- Old resistance: 344.57, 334.99 (below price), 320.28 (below price)
- New: R $346.44, R $351.73 / S $340.09, S $333.29, all on the correct side

## Decision
One level engine. Before Atlas, the chart shows only the nearest support and nearest resistance from the backend scorer. After Atlas, the same levels (same prices, same ids) stay on the chart, and the levels used in trade ideas are tagged "entry" or "target".

## Changes
Backend
- `lib/chartLevels.ts` (new): `levelsFromIndicators()` is the single path used by Atlas and the chart. `computeChartLevels()` uses the last 100 bars (`LEVEL_WINDOW_BARS`). `pickTradeLevel()` / `withReferencedLevels()` make sure every trade-idea level is drawn.
- `routes/levels.ts` (new), mounted at `POST /api/levels`: public, no OpenAI call, no usage counted, input validation, 5-minute in-memory cache.
- `lib/runAtlasAnalysis.ts`: uses `levelsFromIndicators`; trade ideas prefer levels that are displayed and now carry `entryLevelId` / `targetLevelId`; a referenced level outside the display set is added to it.
- `lib/__tests__/chartLevels.test.ts` (new) and `npm test chartLevels`: side-of-price check, 100-bar window, identical ids/prices to the Atlas path for every regime, trade-level helpers.

Core types
- `TradeIdea.entryLevelId?`, `TradeIdea.targetLevelId?`, `AILevel.role?`, `ChartLevels`, `ChartLevelsResponse` (types only, no runtime change).

Mobile
- `lib/chartAnalysis.ts`: removed `findLocalLevels`; added `fetchChartLevels()` and `ANALYSIS_WINDOW_BARS = 100` (also used by `runGuestAnalyze`).
- `app/(tabs)/analyze.tsx`: levels query replaces the local calculation; nearest support/resistance pre-Atlas; Atlas levels with roles after; "Levels unavailable · tap to retry" if the request fails. There is no fallback to another calculation.
- `components/StockChart.tsx`: `LevelTags` draws a price tag at the right end of each line (for example "R $346.44" or "S $340.09 · entry") in both line and candle charts; overlapping tags are skipped, and role-tagged levels take priority.

## Tap-a-level panel (added 2026-11-08)
- Tapping a level line (invisible 24px tap strip along the whole line) or its price tag opens `components/LevelDetailSheet.tsx`. It is a bottom sheet on phones and a right-side panel on web at 900px or wider.
- Contents:
  - Kind and price, with the zone.
  - Stats: distance (% and ATR), strength (confluence band and score) and status (at price / in play / nearby / further out / distant).
  - "What support/resistance means", from the shared education copy (`short` and `why`).
  - "Why this level": a checklist built from the confluence factors that scored. Fibonacci lines read "Lines up with the {level} Fibonacci retracement of the recent swing". Round numbers that are whole dollars drop the cents (for example "$345", not "$345.00"). A level with no scoring factors falls back to its description.
  - Atlas section: before Atlas, an "Ask Atlas" button that runs the normal analyze flow (guest signup redirect and weekly-limit handling included). The locked label is "See Atlas options". After Atlas, the trade idea that uses this level (entry or target, scenario, "wrong if") or "Atlas did not use this level in a trade idea."
  - On native after Atlas, an alert toggle that uses the existing alert flow.
- Copy logic lives in pure `lib/levelExplain.ts`, so it can be tested in Node.
- The selection is by level id, so the panel stays on the same level if Atlas finishes while it is open.
- Product line: the panel describes; Atlas says what to do.

## Scoring observations
Round-number points skip a step when it is at most 2% of price. The 1% band around each multiple would otherwise cover every price, which is why multiples of $5 used to score every level near $340. Coarser steps ($10, $25, $50, $100) still count. $340.09 is the $340 round number. $346.44 is not, because $345 was only a $5 step.

Still not fixed: on AAPL 3M, every level near price got the volume-node points. One high-volume node covered about $332–$349 and held about 54% of volume. Touch counts are the most bars whose high or low came within tolerance of a single swing point (for example, 33 of 100 bars), while the score stops adding after 5 touches. Dropping the volume points would not change the Strong label on those three levels. Strong starts at 60, and touches, Fibonacci, and the moving average already clear it.

## Invariants
- `ANALYSIS_WINDOW_BARS` (mobile) must equal `LEVEL_WINDOW_BARS` (backend).
- Market regime affects overextension only, never level scoring. The test fails if that changes.

## Deploy order
Deploy the backend first. If the app ships before `/api/levels` is live, users see "Levels unavailable".

## Not built yet
- "Show all levels" toggle on the chart (data is already returned as `allSupportLevels` / `allResistanceLevels`).
- Plain-English summary card under the chart.
