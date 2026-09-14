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
pnpm sim validate --seasons 40          # match engine calibration vs real benchmarks
pnpm sim match    --home 2 --away 5     # one match with goals and stats
pnpm sim squad    --club 2              # squad with abilities, values, wages

pnpm sim career   --seasons 12          # year-by-year: champions, transfers, spend
pnpm sim economy  --seasons 25          # multi-season economic health check

pnpm test                               # 55 tests
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

## The economy

Money is in neutral units; the UI picks the currency symbol. Everything is
derived from two curves and a club's reputation.

**Player value** is exponential in ability — the last few points of quality cost
the most — then modified by an age curve peaking in the early twenties, a
premium for unrealised potential in players under 26, and a steep discount for a
running-down contract. A player in the final year of their deal is worth about a
third of the same player with four years left.

**Wages derive from value** rather than having their own curve, so the two can
never drift apart, and they are deliberately compressed: a player worth twice as
much does not earn twice as much. That matches how real wage structures work and
keeps a squad's bill proportionate to what the squad is worth.

**Revenue** is gate receipts (attendance responds to how the season is going and
to who the visitors are), commercial income paid weekly through the season, and
prize money paid at the end — a merit payment plus an equal broadcast share.
**Costs** are wages, non-wage operating costs, transfer fees, ground expansion
and owner drawings.

A club that runs into the red cuts spending, sells players, and if nobody will
buy them, tears up contracts to shed wages. A club with money in the bank and a
full ground expands it. Those two loops are what stop the league drifting into
either universal bankruptcy or universal billionaires.

## The transfer market

AI clubs work down a list of squad needs — the positions where they fall
furthest short of the standard their reputation implies — and look for the best
player who improves them, whom they can afford in both fee and wages, and who
would actually come. Players do not drop far down the pyramid unless they are
not starting where they are. Selling clubs price by how much they need the
player: a squad player goes for about market value, a key player for more than
double.

Contracts run down and expire; clubs renew who they rate and can afford, and
release the rest into a free-agent pool that smaller clubs restock from. Youth
come through the academy at the standard the club plays to, and every player
ages on a development curve — improving toward their potential into their
mid-twenties, losing pace from around 29 while their reading of the game keeps
improving, and eventually retiring.

Club reputation follows league position slowly, so the hierarchy set at world
generation is not permanent: a well-run club climbs over several seasons and
earns the bigger stadium, sponsorship and squad that come with it.

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

### Economic calibration

`pnpm sim economy` runs a full career and checks that the league still works
after decades. There is no match-by-match real-world dataset to calibrate
against here, so these benchmarks encode "a league that is still worth playing
in year 25": clubs roughly break even, money does not pool in one place, no
single club hoovers up the talent, and league quality neither inflates nor
decays. Across 8 seeds x 25 seasons:

| Metric | Engine (mean) | Range | Target |
| --- | --- | --- | --- |
| Wages as % of revenue | 60.8 | 59–62 | 57 ± 13 |
| Clubs in debt % | 17.1 | 11–22 | 18 ± 12 |
| Transfers per window | 20.5 | 18–23 | 30 ± 15 |
| Titles won by top club % | 33.5 | 28–44 | 22 ± 15 |
| Top / median squad value | 2.9 | 2.2–3.9 | 4 ± 2.5 |
| Best-50 players at one club % | 19.5 | 16–24 | 14 ± 10 |
| League cash as % of revenue | 15.6 | 4–26 | 25 ± 25 |
| Squad quality vs season 1 % | 100.3 | 99–103 | 100 ± 8 |

The last row is the one that matters most and it is the bug this whole harness
exists to catch. Academy players were originally generated below the standard of
the players they replaced, so every intake made the league slightly worse. It is
invisible in a single season and invisible in the league table; after twenty
seasons the wage bill had fallen by a third because the players were simply
worse. Nothing but a multi-season check finds that.

Honest caveats on the economy:

- **Operating costs are a calibrated catch-all**, not a sum of real line items.
  A real league loses money to clubs abroad; a closed league has no such sink, so
  this share absorbs it and is set to keep the money supply roughly flat.
- **The league is closed.** There are no foreign clubs to buy from or sell to,
  and in reality most signings come from outside a club's own division. That is
  why the transfer target is ~30 per window rather than the 60+ a league with an
  outside market would see.
- **One club can dominate.** Title share reached 44% on one seed. That is
  realistic for football — Bayern win the Bundesliga far more often than that —
  but a run where one club wins half the titles is possible.
- **Development is minimal.** Ability currently follows age and potential only.
  Training, playing time and form arrive in milestone 3, and should also soften
  the remaining blowout rate by making squads rotate.

Two benchmarks were corrected after first being set badly, which is worth
recording: "distinct champions as a share of seasons" falls as a career
lengthens even when nothing changes, and "richest / median cash balance" divides
by a median sitting near zero whenever clubs carry debt. Both were replaced with
horizon-independent measures that survive a longer run.

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

- [x] Money: wages, contracts, gate receipts, prize money, sponsorship,
      operating costs, stadium expansion
- [x] Player valuation and a transfer market with AI clubs that buy, sell and
      release
- [x] Contracts, renewals, free agents, academy intake, ageing and retirement
- [x] Club reputation that follows results, so the hierarchy can change
- [x] Multi-season career loop and economic validation harness

Next:

- [ ] Player development: training, playing time, form, wonderkids
- [ ] Injuries, suspensions, squad rotation, morale
- [ ] Multiple divisions, promotion and relegation, cups
- [ ] Expo mobile app
- [ ] Foreign clubs, so the transfer market is not closed
