# game1 — football management simulation

A football management sim for mobile. The simulation is a pure TypeScript package
with no React and no Node dependencies, so the exact same code runs in the CLI
tuning harness and on-device.

```
packages/engine   the simulation: world generation, match engine, league
apps/mobile       Expo / React Native app
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

pnpm test                               # 110 tests
pnpm typecheck
```

## The app

```bash
pnpm mobile          # Expo dev server: scan the QR code with Expo Go
pnpm mobile:web      # or run it in a browser
```

Expo / React Native, four tabs — **Club**, **Squad**, **Table**, **Money**. Pick a
club (a big one expects trophies, a small one expects you to survive), play the
season a round at a time, and watch the squad age around you. Careers save to
device storage after every round and resume on launch.

The app imports `@game1/engine` as a normal package and holds a `Career` in React
context. The engine mutates the world in place, so the context carries a version
counter that screens re-render against — the engine has no idea React exists, and
that is the point: the same code runs in the CLI harness and on the phone.

`pnpm mobile` rebuilds the engine first, because the app consumes its compiled
output from `packages/engine/dist` rather than its TypeScript source. When
working on both at once, run `pnpm --filter @game1/engine build:watch` alongside.

A few notes on how it is put together:

- **Saves are the whole world, not a replay.** A career serialises to about
  500 KB once a season has been played (316 KB fresh) — squads dominate it. Match logs are trimmed on save: goals are kept
  everywhere so the scoring charts survive, but substitutions and bookings are
  kept only for your own recent matches, which cuts a season's save by half.
  Saving a round takes well under a millisecond; a whole round — ten matches
  simulated, state updated, game saved — measures 10–20 ms.
- **Reloading resumes exactly.** The RNG's internal state is saved with the
  world, so a career picks up mid-season and produces the same results it would
  have without the interruption. There is a test for precisely that.
- **Player objects have identity.** `world.players` holds the same objects the
  squads do, so loading rebuilds the lookup table from the squads rather than
  deserialising twice. Get that wrong and a transfer moves one copy while the
  rest of the game reads another.

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

A keeper is not one number: **reflexes and positioning** decide the save,
**handling** decides whether the save stays saved, and **distribution** helps his
side keep the ball. Measured over 6,000 matches, moving a keeper's reflexes by
±20 is worth 0.43 goals a game, his handling 0.17 and his distribution 0.07 —
three distinct jobs rather than one average.

On top: per-match form rolls, late-game fatigue, individual in-match tiring, and
a game-state effect where trailing sides push and leading sides sit deeper. Both
halves of that are now modelled and both are bounded: an unbounded chasing term
drives a comfortable leader's attack strength *negative*, which makes the
attack-versus-defence ratio meaningless.

Matches also produce bookings, sendings-off, injuries and up to five
substitutions a side, and they write back to the players involved: minutes,
goals, fitness, form and morale.

Every tunable number lives in `MATCH_TUNING` in `src/match/engine.ts`.

## Fitness, form and rotation

Every player carries a status: condition, form, morale, and any injury or ban.
These feed into `effectiveness()`, which is how much of their ability a player
actually brings today — and because **selection uses that same number**,
rotation falls out of it rather than needing a separate rule. A tired player is
weighted down further still, because resting someone now protects later matches.

Playing a full match costs condition in proportion to the player's stamina, and
a week's rest gives back a flat amount plus a share of whatever is missing.
Those two settle an ever-present around 65 condition and a rotated player near
full fitness, which is what makes squad depth worth paying for. Across a season
a club uses ~21 players, with its most-used eleven taking ~78% of the minutes.

## Hidden potential and scouting

How good a player might become is **engine-private**. `Player.hiddenPotential` is
the simulation's ground truth; nothing player-facing may read it, and the UI goes
through `scoutedPotential`, which returns a *range* rather than a number.

A scout's blind spot on a given player is drawn once and fixed for the life of the
world, from a throwaway generator seeded on the world and the player id. Only the
*width* of the band shrinks as you learn more, so an estimate closes in on the
truth rather than jumping about — "we had him at 70–84, now 74–79, he turned out
76" reads as learning, where redrawing the midpoint each time would read as dice.

That throwaway generator matters more than it looks: reports are read on every
render, so drawing from the career's own RNG would mean opening the squad screen
changed next week's results. There is a test asserting the career's RNG state is
untouched after reading every report in a squad.

Knowledge accrues for free and deterministically. You inherit your squad already
knowing it well — your coaches have watched them daily — except the teenagers who
have never played, which is the doubt actually worth having. After that you learn
by watching: minutes played for your own, and facing a side for theirs. So the
squad list shows a tight `80–86` against an established 23-year-old and a wide
`48–66` against an 18-year-old nobody has seen.

**The AI deliberately cheats**, and the code says so. Giving nineteen rival clubs
noisy potential would misprice every under-26 through `marketValue`, moving squad
values, transfer volume and squad ages — recalibrating the whole economy to buy a
fairness property nobody can observe. Your edge was never information parity; it
is that you can *act*. `marketValue` likewise keeps the true number, because it is
the market's price. `scoutedValue` runs the same curve on your estimate, and the
gap between the two is where a bargain or a mistake lives.

## Development

Ability moves toward what the age curve says it should be, but **how fast
depends on how much football a player got and how good their coaching is**. A 19
year old who starts every week closes most of the gap to his potential; the same
player watching from the bench barely moves. Over a career an under-21 regular
gains about 4.9 ability a season against 2.1 for one who does not play — a gap
of nearly 3 points a year, which is what makes giving a prospect games an actual
decision rather than a free choice.

Ageing is not uniform: players lose pace, stamina and strength from around 29
while composure, positioning and vision keep improving into their thirties. So
an ageing playmaker holds his value in a way an ageing winger does not.

Coaching quality is deliberately a narrow band. A big club developing players
faster feeds straight back into winning, reputation and revenue, and in a closed
single-division league nothing damps that loop — real football has relegation,
cups and foreign buyers pulling against it.

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
seasons / 15,200 matches, all 19 benchmarks within tolerance:

| Metric | Engine | Real |
| --- | --- | --- |
| Goals per match | 2.64 | 2.75 |
| Home / away goals | 1.44 / 1.20 | 1.52 / 1.23 |
| Home wins / draws / away wins | 43.2% / 23.9% / 32.9% | 44% / 25% / 31% |
| Shots (on target) per match | 24.1 (9.0) | 25 (8.7) |
| Goalless matches | 6.4% | 7.5% |
| Won by 4+ goals | 5.1% | 3.5% |
| Champion points | 85.4 | 86 |
| Top scorer goals | 25.9 | 24 |
| Yellow / red cards per match | 3.84 / 0.104 | 3.9 / 0.10 |
| Substitutions per match | 8.52 | 8.5 |
| Injuries per club per season | 11.4 | ~12 |
| Players used per club | 21.1 | ~24 |

It also reports the **strength/position correlation** — how reliably the better
squad finishes higher. Real leagues sit around 0.75–0.85; the engine is at 0.849 — at the top of that range, and worth watching.
Pushing this to 1.0 would be easy and would ruin the game: nothing unexpected
would ever happen.

Two caveats on the table above. Champion points sit toward the low end of the
benchmark, which is right for a Brazilian-style league (Série A champions
typically take 70–80) but low for the Premier League — worth splitting per
competition once there are several. And blowouts sit at 5.1% against a real
3.5%, right at the edge of tolerance.

That last number is the honest cost of individual duels. Giving attributes a
direct effect necessarily widens the spread of scorelines: a good forward against
a poor defender creates chances a team average cannot express, and that shows up
as bigger wins. The two are in direct tension, and the balance here was chosen to
keep every other benchmark comfortable. Pushing the duel harder was tried — it
buys sharper individual effects at the cost of draws, last-place points and a
league that gets measurably more predictable.

Performance: world generation 8ms; a full 380-match season 94ms with fitness,
injuries, cards and finances all tracked (30ms for the match engine alone).

### Economic calibration

`pnpm sim economy` runs a full career and checks that the league still works
after decades. There is no match-by-match real-world dataset to calibrate
against here, so these benchmarks encode "a league that is still worth playing
in year 25": clubs roughly break even, money does not pool in one place, no
single club hoovers up the talent, and league quality neither inflates nor
decays. Across 8 seeds x 25 seasons:

| Metric | Engine (mean) | Range | Target |
| --- | --- | --- | --- |
| Wages as % of revenue | 59.2 | 56–62 | 57 ± 13 |
| Clubs in debt % | 12.4 | 6–21 | 18 ± 12 |
| Transfers per window | 23.3 | 22–27 | 30 ± 15 |
| Titles won by top club % | 32.0 | 24–48 | 40 ± 22 |
| Top / median squad value | 2.45 | 1.5–3.8 | 4 ± 2.5 |
| Best-50 players at one club % | 15.8 | 12–20 | 14 ± 10 |
| League cash as % of revenue | 17.0 | 1.5–33 | 25 ± 45 |
| Cash drift, late vs early | −2.5 | −21–6 | 0 ± 30 |
| Squad quality vs season 1 % | 100.6 | 98–103 | 100 ± 8 |
| U21 regular, ability/season | 4.83 | 4.6–5.1 | 4 ± 3 |
| Gain: U21 regular vs benched | 2.73 | 2.5–3.0 | 2.5 ± 2 |
| Over-31 ability/season | −2.00 | −2.0 | −2.5 ± 2 |

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
- **One club can win a lot.** Title dominance averages ~40% over 25 seasons and
  reached 68% on one seed. That is inside the real range (over 25 seasons the
  most successful club took ~52% of Premier League titles and ~72% of
  Bundesliga), and it is checked not to be a hoarding dynasty: top/median squad
  value sits at 2.6 and no club holds more than ~20% of the best fifty players.
- **No cups or continental football.** Clubs play 38 matches and nothing else,
  so they rotate less than real clubs do — which is why the minutes-share target
  is 72% rather than the ~62% a real fixture list would produce.

**On cash**: the level oscillates between roughly −7% and +56% of revenue with no
trend, so policing the level alone fails on ordinary variation — the old window
put its lower edge at exactly zero and did fail. `Cash drift` measures the last
third of a career against the first third, which is what actually distinguishes a
stable economy from one quietly printing or burning money.

Five benchmarks were corrected after first being set badly, which is worth
recording. "Distinct champions as a share of seasons" falls as a career
lengthens even when nothing changes, and "richest / median cash balance" divides
by a median sitting near zero whenever clubs carry debt — both replaced with
horizon-independent measures. The clubs-in-debt and title-dominance targets were
both set more optimistically than real football warrants and were moved to match
it. Changing a measuring stick to make a number pass is a real risk, so each
change carries its reasoning in the code.

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

- [x] Fitness, form and morale, with rotation emerging from selection
- [x] Injuries, bookings, suspensions and five substitutions a side
- [x] Development driven by playing time and coaching quality
- [x] Expo mobile app: club selection, round-by-round play, squad, table,
      finances, season review, and saves that resume exactly

Next:

- [ ] Team selection and tactics in the app — currently the XI picks itself
- [ ] A transfer screen, so the window is something you do rather than watch
- [ ] Multiple divisions, promotion and relegation, cups
- [ ] Loans, so a blocked prospect can go and play somewhere else
- [ ] Foreign clubs, so the transfer market is not closed
- [ ] Manager decisions: team talks, training schedules
