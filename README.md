# game1 — football management simulation

A football management sim for mobile. The simulation is a pure TypeScript package
with no React and no Node dependencies, so the exact same code runs in the CLI
tuning harness and on-device.

```
packages/engine   the simulation: world generation, match engine, league
apps/mobile       Expo / React Native app (not built yet)
```

## Running it

```bash
pnpm install

pnpm sim season   --seed brasil2026     # simulate a season, print the table
pnpm sim validate --seasons 40          # calibration report against real benchmarks
pnpm sim match    --home 2 --away 5     # one match with goals and stats
pnpm sim squad    --club 2              # a squad with abilities and potentials

pnpm test                               # 30 tests
```

## How the match engine works

It is an **explicit stochastic model** — hand-authored probability, not machine
learning. There is no training data for fictional players, and more importantly a
hand-authored model can be *tuned*: when the draw rate is too low you change one
named constant, re-run `pnpm sim validate`, and see the effect on every metric.

One match:

1. **Lineup** — greedy best-available per formation slot, with an out-of-position
   penalty (`positionFamiliarity`). A great AM will take a CM slot in a 4-3-3.
2. **Ratings** — the XI collapses into attack / midfield / defence / goalkeeping.
   Each slot contributes to each phase by a weight, so shape matters: full backs
   feed the attack, a DM props up the defence.
3. **Possession** — from the midfield ratio, sharpened by an exponent, plus a
   small home bias.
4. **90+ minutes** — each minute has a ~53% chance of an attacking sequence;
   possession decides whose it is.
5. **Sequence** — chance created → shot → on target → past the keeper. Every step
   is a function of the attributes involved on both sides, not a global constant.
6. **Attribution** — scorer and assister drawn from weighted distributions.

On top: per-match form rolls, late-game fatigue, and a game-state effect where
trailing sides push and leading sides sit deeper.

Every tunable number lives in `MATCH_TUNING` in `src/match/engine.ts`.

## Determinism

Every random decision goes through the seeded `Rng` in `src/rng`. `Math.random()`
is never used. Same seed = same world, same season, same results — which is how
saves stay tiny (store the seed and the decisions, not the state) and how bugs
stay reproducible.

## Calibration

`pnpm sim validate` simulates many seasons and checks the output against
benchmarks from recent top-five-European-league seasons. Current state, 40
seasons / 15,200 matches, all 13 benchmarks within tolerance:

| Metric | Engine | Real |
| --- | --- | --- |
| Goals per match | 2.72 | 2.75 |
| Home / away goals | 1.52 / 1.20 | 1.52 / 1.23 |
| Home wins / draws / away wins | 44.5% / 24.2% / 31.3% | 44% / 25% / 31% |
| Shots (on target) per match | 24.7 (9.1) | 25 (8.7) |
| Goalless matches | 6.6% | 7.5% |
| Won by 4+ goals | 5.4% | 3.5% |
| Champion points | 78.2 | 86 |
| Top scorer goals | 25.7 | 24 |

It also reports the **strength/position correlation** — how reliably the better
squad finishes higher. Real leagues sit around 0.75–0.85; the engine is at 0.832.
Pushing this to 1.0 would be easy and would ruin the game: nothing unexpected
would ever happen.

Two caveats on the table above: champion points at 78 sits at the low end of the
benchmark, which is right for a Brazilian-style league (Série A champions
typically take 70–80) but low for the Premier League — worth splitting per
competition once there are several. And blowouts at 5.4% are still above the
real 3.5%; getting closer needs squad rotation and injuries, which do not exist
yet.

Performance: world generation 5ms, a full 380-match season 30ms.

## Not real players

Every player and club is procedurally generated from per-nationality name pools.
There is no real-player database by design: squad data is licensed (it is exactly
what Football Manager pays for), and a fresh world each save is better for the
game. `BLOCKED_NAMES` in `src/world/clubs.ts` stops the club generator from
stumbling onto a real name by accident.

## Roadmap

Built:

- [x] Seeded deterministic RNG
- [x] Procedural players: 16 attributes, potential, age curve
- [x] Procedural clubs and squads by reputation
- [x] Formations, lineup selection, out-of-position penalties
- [x] Minute-by-minute match engine, calibrated
- [x] Double round-robin fixtures, table, scorers
- [x] Validation harness

Next:

- [ ] Money: wages, transfer fees, gate receipts, prize money, sponsorship
- [ ] Transfer market and AI clubs that buy and sell
- [ ] Player development: training, playing time, decline, wonderkids
- [ ] Injuries, suspensions, squad rotation, morale
- [ ] Multiple divisions, promotion and relegation, cups
- [ ] Expo mobile app
