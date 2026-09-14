import { Rng } from '../rng/index.js';
import type { Fixture, MatchResult, SeasonResult, TableRow, World } from '../types.js';
import { simulateMatch } from '../match/engine.js';
import { generateFixtures } from './fixtures.js';
import { buildTable } from './table.js';
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
}

export function createSeasonState(
  world: World,
  rng: Rng,
  options: SimulateSeasonOptions = {},
): SeasonState {
  const clubs = world.league.clubs;
  const fixtures = options.fixtures ?? generateFixtures(clubs.map((c) => c.id), rng);
  const totalRounds = fixtures.reduce((max, fixture) => Math.max(max, fixture.round), 0);

  return {
    world,
    rng,
    fixtures,
    results: [],
    nextRound: 1,
    totalRounds,
    options,
    points: new Map(),
    played: new Map(),
  };
}

export function seasonComplete(state: SeasonState): boolean {
  return state.nextRound > state.totalRounds;
}

/** The fixtures that make up the next round, before it is played. */
export function upcomingRound(state: SeasonState): Fixture[] {
  return state.fixtures.filter((fixture) => fixture.round === state.nextRound);
}

/**
 * Plays one round: a week passes first (wages, recovery, bans ticking down),
 * then every match in the round is played.
 */
export function playRound(state: SeasonState): MatchResult[] {
  if (seasonComplete(state)) return [];

  const { world, rng, options } = state;
  const clubs = world.league.clubs;
  const clubById = new Map(clubs.map((club) => [club.id, club]));

  if (options.economy) {
    for (const club of clubs) {
      payWeeklySponsorship(club);
      payWeeklyWages(club);
      payWeeklyOperatingCosts(club, clubs.length);
    }
  }

  // A week passes between rounds: everyone recovers, bans and lay-offs tick.
  if (options.playerState) {
    for (const club of clubs) {
      for (const player of club.squad) advancePlayerWeek(player);
    }
  }

  const roundResults: MatchResult[] = [];

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

    const result = simulateMatch(rng, home, away, {
      ...(options.playerState ? { updatePlayerState: true } : {}),
    });
    state.results.push(result);
    roundResults.push(result);

    const homePoints =
      result.home.goals > result.away.goals ? 3 : result.home.goals === result.away.goals ? 1 : 0;
    const awayPoints = homePoints === 3 ? 0 : homePoints;
    state.points.set(home.id, (state.points.get(home.id) ?? 0) + homePoints);
    state.points.set(away.id, (state.points.get(away.id) ?? 0) + awayPoints);
    state.played.set(home.id, (state.played.get(home.id) ?? 0) + 1);
    state.played.set(away.id, (state.played.get(away.id) ?? 0) + 1);

    options.onMatch?.(result, fixture);
  }

  state.nextRound += 1;
  return roundResults;
}

/** The table as it stands right now, mid-season or at the end. */
export function currentTable(state: SeasonState): TableRow[] {
  return buildTable(state.world.league.clubs, state.results);
}

export function finaliseSeason(state: SeasonState): SeasonResult {
  return {
    table: currentTable(state),
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
  for (const club of world.league.clubs) {
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
