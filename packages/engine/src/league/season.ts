import { Rng } from '../rng/index.js';
import type { Fixture, MatchResult, SeasonResult, World } from '../types.js';
import { simulateMatch } from '../match/engine.js';
import { generateFixtures } from './fixtures.js';
import { buildTable } from './table.js';

export interface SimulateSeasonOptions {
  fixtures?: Fixture[];
  /** Called after each match, for UI progress or day-by-day play later. */
  onMatch?: (result: MatchResult, fixture: Fixture) => void;
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
  for (const fixture of fixtures) {
    const home = clubById.get(fixture.homeClubId);
    const away = clubById.get(fixture.awayClubId);
    if (!home || !away) throw new Error(`simulateSeason: unknown club in fixture round ${fixture.round}`);

    const result = simulateMatch(rng, home, away);
    results.push(result);
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
