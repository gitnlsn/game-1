import { Rng } from '../rng/index.js';
import type { Fixture, MatchResult, SeasonResult, TableRow, TeamSheet, World } from '../types.js';
import { simulateMatch } from '../match/engine.js';
import { generateFixtures } from './fixtures.js';
import { buildTable } from './table.js';
import { allClubs, findClub } from '../world/index.js';
import { effectiveWageBill } from '../transfers/loans.js';
import {
  advanceCupRound,
  createCupState,
  CUP_TUNING,
  cupComplete,
  cupRoundMatchday,
  currentTies,
  drawCupRound,
  resolveCupTie,
  type CupState,
} from './cup.js';
import { advancePlayerWeek } from '../world/status.js';
import {
  applyMatchdayIncome,
  payWeeklyOperatingCosts,
  payWeeklySponsorship,
  payWeeklyWages,
} from '../economy/finances.js';

export interface SimulateSeasonOptions {
  fixtures?: Fixture[];
  /** Called after each match, for UI progress or day-by-day play later. */
  onMatch?: (result: MatchResult, fixture: Fixture) => void;
  /**
   * Apply matchday income and weekly wages as the season runs. Off by default so
   * a one-off season can be simulated without touching club finances.
   */
  economy?: boolean;
  /**
   * Track fitness, minutes, cards and injuries across the season. Off by default
   * so a season can be simulated without mutating the players.
   */
  playerState?: boolean;
  /**
   * Team sheets by club id. A club with no entry is picked for by the engine, so
   * the headless path -- where nobody supplies one -- is untouched.
   */
  teamSheets?: Iterable<readonly [string, TeamSheet]>;
  /**
   * Run a knockout cup alongside the league. Off by default, so every headless
   * harness keeps measuring exactly what it measured before.
   */
  cup?: boolean;
  /**
   * A knockout already in progress, restored from a save.
   *
   * Given this, the bracket is NOT drawn: drawing one consumes shuffles from the
   * generator that the uninterrupted career never made, so a resumed season
   * played out differently from one that was never saved.
   */
  restoreCup?: CupState;
}

/**
 * A season in progress. Kept as explicit state rather than a loop so a game can
 * play one round at a time and show the results, while `simulateSeason` runs the
 * whole thing at once for the tuning harness.
 */
export interface SeasonState {
  world: World;
  rng: Rng;
  fixtures: Fixture[];
  results: MatchResult[];
  /** The next round to be played, 1-based. */
  nextRound: number;
  totalRounds: number;
  options: SimulateSeasonOptions;
  /** Running points and games, so gate receipts respond to how the season is going. */
  points: Map<string, number>;
  played: Map<string, number>;
  /**
   * Held here rather than on Club because clubStrength() and the transfer AI both
   * take a Club, and would start depending on the human's selection by accident.
   * A Map also serialises trivially, where a callback would not.
   */
  teamSheets: Map<string, TeamSheet>;
  /** The knockout, when one is being played. */
  cup?: CupState;
}

export function createSeasonState(
  world: World,
  rng: Rng,
  options: SimulateSeasonOptions = {},
): SeasonState {
  /*
   * One fixture list covering every division. They run in parallel on the same
   * matchdays, which is what lets a single `nextRound` drive the whole pyramid
   * -- and later lets a cup round slot in among them.
   */
  const leagueFixtures =
    options.fixtures ??
    world.leagues.flatMap((league) =>
      generateFixtures(league.clubs.map((c) => c.id), rng, league.id),
    );
  // With a cup, league rounds are spread across the matchdays the cup does not
  // use, so nobody is asked to play twice in a day.
  const fixtures =
    options.cup && !options.fixtures ? spreadAroundCup(leagueFixtures) : leagueFixtures;

  const leagueRounds = fixtures.reduce((max, fixture) => Math.max(max, fixture.round), 0);
  const totalRounds = options.cup
    ? Math.max(leagueRounds, CUP_TUNING.rounds[CUP_TUNING.rounds.length - 1] ?? 0)
    : leagueRounds;

  const state: SeasonState = {
    world,
    rng,
    fixtures,
    results: [],
    nextRound: 1,
    totalRounds,
    options,
    points: new Map(),
    played: new Map(),
    teamSheets: new Map(options.teamSheets ?? []),
  };

  if (options.restoreCup) {
    state.cup = options.restoreCup;
  } else if (options.cup) {
    // Weakest first: `createCupState` gives the byes to the other end.
    state.cup = createCupState(
      rng,
      [...allClubs(world)]
        .sort((a, b) => a.reputation - b.reputation)
        .map((club) => club.id),
    );
  }

  return state;
}

/**
 * Moves league rounds off the matchdays the cup has claimed.
 *
 * Round 1 goes to the first free matchday, round 2 to the second, and so on, so
 * the league still runs in order and every club still plays at most once a day.
 */
function spreadAroundCup(fixtures: readonly Fixture[]): Fixture[] {
  const reserved = new Set<number>(CUP_TUNING.rounds);
  const rounds = [...new Set(fixtures.map((f) => f.round))].sort((a, b) => a - b);

  const mapping = new Map<number, number>();
  let matchday = 0;
  for (const round of rounds) {
    do matchday++;
    while (reserved.has(matchday));
    mapping.set(round, matchday);
  }

  return fixtures.map((fixture) => ({ ...fixture, round: mapping.get(fixture.round) ?? fixture.round }));
}

/**
 * Ties for the cup round due on this matchday, drawn now because who is in them
 * depends on who survived the last one.
 */
function drawCupIfDue(state: SeasonState): void {
  const cup = state.cup;
  if (!cup || cupComplete(cup)) return;
  if (cupRoundMatchday(cup) !== state.nextRound) return;
  if (currentTies(cup).length > 0) return;

  state.fixtures.push(...drawCupRound(cup));
}

export function seasonComplete(state: SeasonState): boolean {
  return state.nextRound > state.totalRounds;
}

/** The fixtures that make up the next round, before it is played. */
export function upcomingRound(state: SeasonState): Fixture[] {
  return state.fixtures.filter((fixture) => fixture.round === state.nextRound);
}

/** True when this matchday is a midweek one, played without a week's rest. */
export function isMidweek(state: SeasonState, round: number): boolean {
  return state.cup !== undefined && CUP_TUNING.rounds.includes(round);
}

/**
 * Plays one round: a week passes first (wages, recovery, bans ticking down),
 * then every match in the round is played.
 *
 * A **midweek** matchday is the exception, and it is what makes a cup run cost
 * something. No week passes before it: nobody recovers, no wages are paid, and
 * the side that played on Saturday plays again on Wednesday on the same legs.
 * Give the cup its own free week instead and it adds rest rather than removing
 * it -- which is exactly what happened when it did, and why the minutes share of
 * a settled eleven went UP when a cup was added.
 */
export function playRound(state: SeasonState): MatchResult[] {
  if (seasonComplete(state)) return [];

  const { world, rng, options } = state;
  const clubs = allClubs(world);
  const clubById = new Map(clubs.map((club) => [club.id, club]));

  const midweek = isMidweek(state, state.nextRound);

  if (options.economy && !midweek) {
    /*
     * Per division, not across the pyramid. Operating costs are a share of what
     * a club is expected to earn, and that expectation is priced off how many
     * home matches it plays -- hand it the whole world's club count and every
     * side is run as though it played twice the football it does, which
     * bankrupted the entire second division in twenty seasons.
     *
     * Skipped midweek, because no week has passed. Paying here too would bill a
     * 38-week season for 44 weeks of wages.
     */
    for (const league of world.leagues) {
      for (const club of league.clubs) {
        payWeeklySponsorship(club);
        payWeeklyWages(club, effectiveWageBill(world, club));
        payWeeklyOperatingCosts(club, league.clubs.length, league.tier);
      }
    }
  }

  // A week passes between rounds: everyone recovers, bans and lay-offs tick.
  if (options.playerState && !midweek) {
    for (const club of clubs) {
      for (const player of club.squad) advancePlayerWeek(player);
    }
  }

  drawCupIfDue(state);

  const roundResults: MatchResult[] = [];
  const cupTies = state.cup ? new Map(currentTies(state.cup).map((tie) => [
    `${tie.homeClubId}>${tie.awayClubId}`, tie,
  ])) : undefined;

  for (const fixture of state.fixtures) {
    if (fixture.round !== state.nextRound) continue;

    const home = clubById.get(fixture.homeClubId);
    const away = clubById.get(fixture.awayClubId);
    if (!home || !away) {
      throw new Error(`playRound: unknown club in fixture round ${fixture.round}`);
    }

    if (options.economy) {
      const games = state.played.get(home.id) ?? 0;
      const pointsPerGame = games === 0 ? 1.3 : (state.points.get(home.id) ?? 0) / games;
      applyMatchdayIncome(home, away, pointsPerGame);
    }

    const homeSheet = state.teamSheets.get(home.id);
    const awaySheet = state.teamSheets.get(away.id);
    const matchOptions = {
      ...(options.playerState ? { updatePlayerState: true } : {}),
      ...(homeSheet ? { homeSheet } : {}),
      ...(awaySheet ? { awaySheet } : {}),
    };

    const tie = cupTies?.get(`${home.id}>${away.id}`);
    const played = tie
      ? resolveCupTie(rng, tie, home, away, matchOptions)
      : simulateMatch(rng, home, away, matchOptions);
    const result: MatchResult = { ...played, competitionId: fixture.competitionId };

    state.results.push(result);
    roundResults.push(result);
    options.onMatch?.(result, fixture);

    // A cup tie earns no league points, and the table is built from league
    // fixtures anyway -- but skipping here keeps the running points honest,
    // which is what gate receipts are priced off.
    if (tie) continue;

    const homePoints =
      result.home.goals > result.away.goals ? 3 : result.home.goals === result.away.goals ? 1 : 0;
    const awayPoints = homePoints === 3 ? 0 : homePoints;
    state.points.set(home.id, (state.points.get(home.id) ?? 0) + homePoints);
    state.points.set(away.id, (state.points.get(away.id) ?? 0) + awayPoints);
    state.played.set(home.id, (state.played.get(home.id) ?? 0) + 1);
    state.played.set(away.id, (state.played.get(away.id) ?? 0) + 1);
  }

  if (state.cup && cupRoundMatchday(state.cup) === state.nextRound) {
    advanceCupRound(state.cup);
  }

  state.nextRound += 1;
  return roundResults;
}

/**
 * The table of one division as it stands, mid-season or at the end. Only results
 * played in that division count, which is what keeps cup ties out of it.
 */
export function currentTable(state: SeasonState, leagueId?: string): TableRow[] {
  const league = leagueId
    ? state.world.leagues.find((l) => l.id === leagueId)
    : state.world.leagues[0];
  if (!league) return [];

  /*
   * Built from the clubs that PLAYED in the competition, not from whoever is in
   * the division now. Once the close season has moved three clubs each way, six
   * of the finished season's participants are somewhere else -- and a table
   * built on current membership silently dropped every result involving them, so
   * a save taken during the open window came back reading "32 played" for a
   * 38-game season.
   */
  const played = new Set<string>();
  for (const fixture of state.fixtures) {
    if (fixture.competitionId !== league.id) continue;
    played.add(fixture.homeClubId);
    played.add(fixture.awayClubId);
  }

  const clubs =
    played.size === 0
      ? league.clubs
      : [...played].flatMap((id) => {
          const club = findClub(state.world, id);
          return club ? [club] : [];
        });

  return buildTable(
    clubs,
    state.results.filter((result) => result.competitionId === league.id),
  );
}

/** Every division's table, top tier first. */
export function currentTables(state: SeasonState): TableRow[][] {
  return state.world.leagues.map((league) => currentTable(state, league.id));
}

export function finaliseSeason(state: SeasonState): SeasonResult {
  const tables = currentTables(state);
  return {
    table: tables[0] ?? [],
    tables,
    results: state.results,
    scorers: buildScorers(state.world, state.results),
  };
}

/** Plays a whole season in one go. */
export function simulateSeason(
  world: World,
  rng: Rng,
  options: SimulateSeasonOptions = {},
): SeasonResult {
  const state = createSeasonState(world, rng, options);
  while (!seasonComplete(state)) playRound(state);
  return finaliseSeason(state);
}

function buildScorers(world: World, results: readonly MatchResult[]): SeasonResult['scorers'] {
  const goals = new Map<string, number>();
  for (const result of results) {
    for (const event of result.events) {
      if (event.type !== 'goal') continue;
      goals.set(event.playerId, (goals.get(event.playerId) ?? 0) + 1);
    }
  }

  const clubByPlayer = new Map<string, string>();
  for (const club of allClubs(world)) {
    for (const player of club.squad) clubByPlayer.set(player.id, club.name);
  }

  return [...goals.entries()]
    .map(([playerId, count]) => ({
      playerId,
      playerName: world.players.get(playerId)?.displayName ?? playerId,
      clubName: clubByPlayer.get(playerId) ?? '',
      goals: count,
    }))
    .sort((a, b) => b.goals - a.goals || a.playerName.localeCompare(b.playerName));
}
