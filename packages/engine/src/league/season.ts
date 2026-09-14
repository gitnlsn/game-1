import { Rng } from '../rng/index.js';
import type { Fixture, MatchResult, SeasonResult, World } from '../types.js';
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

export function simulateSeason(
  world: World,
  rng: Rng,
  options: SimulateSeasonOptions = {},
): SeasonResult {
  const clubs = world.league.clubs;
  const clubById = new Map(clubs.map((club) => [club.id, club]));
  const fixtures = options.fixtures ?? generateFixtures(clubs.map((c) => c.id), rng);

  const results: MatchResult[] = [];
  // Running points, so gate receipts can respond to how the season is going.
  const points = new Map<string, number>();
  const played = new Map<string, number>();
  let currentRound = 0;

  for (const fixture of fixtures) {
    const home = clubById.get(fixture.homeClubId);
    const away = clubById.get(fixture.awayClubId);
    if (!home || !away) throw new Error(`simulateSeason: unknown club in fixture round ${fixture.round}`);

    if (fixture.round !== currentRound) {
      currentRound = fixture.round;

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
    }

    if (options.economy) {
      const games = played.get(home.id) ?? 0;
      const pointsPerGame = games === 0 ? 1.3 : (points.get(home.id) ?? 0) / games;
      applyMatchdayIncome(home, away, pointsPerGame);
    }

    const result = simulateMatch(rng, home, away, {
      ...(options.playerState ? { updatePlayerState: true } : {}),
    });
    results.push(result);

    const homePoints = result.home.goals > result.away.goals ? 3 : result.home.goals === result.away.goals ? 1 : 0;
    points.set(home.id, (points.get(home.id) ?? 0) + homePoints);
    points.set(away.id, (points.get(away.id) ?? 0) + (homePoints === 3 ? 0 : homePoints === 1 ? 1 : 3));
    played.set(home.id, (played.get(home.id) ?? 0) + 1);
    played.set(away.id, (played.get(away.id) ?? 0) + 1);

    options.onMatch?.(result, fixture);
  }

  return {
    table: buildTable(clubs, results),
    results,
    scorers: buildScorers(world, results),
  };
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
