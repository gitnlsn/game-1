import { describe, expect, it } from 'vitest';
import {
  allClubs,
  createWorld,
  findClub,
  leagueOf,
  topLeague,
} from '../world/index.js';
import { startCareer, advanceRound, isSeasonComplete, leagueTable } from '../career/controller.js';
import { deserializeCareer, serializeCareer } from '../career/persistence.js';
import { createSeasonState, currentTable, currentTables, playRound } from '../league/season.js';
import { Rng } from '../rng/index.js';
import type { Career } from '../career/controller.js';

function playSeason(career: Career): void {
  let guard = 0;
  while (!isSeasonComplete(career) && guard++ < 100) advanceRound(career);
}

describe('a world with divisions', () => {
  it('is exactly the old single-league world when there is one division', () => {
    const one = createWorld({ seed: 'pyramid-default' });
    expect(one.leagues).toHaveLength(1);
    expect(one.leagues[0]!.tier).toBe(1);
    expect(allClubs(one)).toHaveLength(20);
  });

  it('splits a pyramid by standing, with no club in two places', () => {
    const world = createWorld({ seed: 'pyramid-two', divisions: 2 });

    expect(world.leagues).toHaveLength(2);
    expect(world.leagues.map((l) => l.tier)).toEqual([1, 2]);
    expect(allClubs(world)).toHaveLength(40);
    expect(new Set(allClubs(world).map((c) => c.id)).size).toBe(40);

    // The ladder is continuous: the worst club in the top flight is still better
    // than the best in the second, or promotion would mean nothing.
    const [first, second] = world.leagues;
    const weakestUp = Math.min(...first!.clubs.map((c) => c.reputation));
    const strongestDown = Math.max(...second!.clubs.map((c) => c.reputation));
    expect(weakestUp).toBeGreaterThanOrEqual(strongestDown);
  });

  it('finds a club and its division wherever it plays', () => {
    const world = createWorld({ seed: 'pyramid-lookup', divisions: 2 });
    const second = world.leagues[1]!.clubs[3]!;

    expect(findClub(world, second.id)).toBe(second);
    expect(leagueOf(world, second.id)!.id).toBe(world.leagues[1]!.id);
    expect(topLeague(world).tier).toBe(1);
    expect(findClub(world, 'nobody')).toBeUndefined();
  });

  it('keeps each division to its own fixtures and its own table', () => {
    const world = createWorld({ seed: 'pyramid-season', divisions: 2 });
    const state = createSeasonState(world, new Rng('pyramid-season'));

    // Both divisions play on the same matchdays.
    expect(state.totalRounds).toBe(38);
    for (const league of world.leagues) {
      const mine = state.fixtures.filter((f) => f.competitionId === league.id);
      expect(mine).toHaveLength(20 * 19);
      const members = new Set(league.clubs.map((c) => c.id));
      for (const fixture of mine) {
        expect(members.has(fixture.homeClubId)).toBe(true);
        expect(members.has(fixture.awayClubId)).toBe(true);
      }
    }

    while (state.nextRound <= state.totalRounds) playRound(state);

    const tables = currentTables(state);
    expect(tables).toHaveLength(2);
    for (const table of tables) {
      expect(table).toHaveLength(20);
      for (const row of table) expect(row.played).toBe(38);
    }
    // A club only appears in its own division's table.
    expect(currentTable(state, 'l1').map((r) => r.clubId).sort()).toEqual(
      world.leagues[0]!.clubs.map((c) => c.id).sort(),
    );
  });

  it('plays a whole pyramid season through a career and saves it', () => {
    const career = startCareer({ seed: 'pyramid-career', divisions: 2 });
    playSeason(career);

    expect(leagueTable(career)).toHaveLength(20);

    const restored = deserializeCareer(serializeCareer(career));
    expect(restored.world.leagues).toHaveLength(2);
    expect(allClubs(restored.world)).toHaveLength(40);
    /*
     * Squads must hold the SAME player objects as the lookup table, or a
     * transfer moves one copy and every later read sees the other. The flat club
     * list in the save exists precisely to keep that true across divisions.
     */
    for (const club of allClubs(restored.world)) {
      for (const player of club.squad) {
        expect(restored.world.players.get(player.id)).toBe(player);
      }
    }
  });
});

describe('saves written before the pyramid', () => {
  it('resume as a one-division world with a readable table', () => {
    const career = startCareer({ seed: 'pyramid-migrate' });
    for (let i = 0; i < 5; i++) advanceRound(career);

    const saved = JSON.parse(serializeCareer(career)) as Record<string, any>;
    // Rebuild the v5 shape: one `league` object, and fixtures naming nothing.
    saved.version = 5;
    saved.league = {
      id: saved.leagues[0].id,
      name: saved.leagues[0].name,
      nationality: saved.leagues[0].nationality,
    };
    delete saved.leagues;
    saved.season.fixtures = saved.season.fixtures.map((f: Record<string, unknown>) => {
      const copy = { ...f };
      delete copy.competitionId;
      return copy;
    });

    const loaded = deserializeCareer(JSON.stringify(saved));

    expect(loaded.world.leagues).toHaveLength(1);
    expect(loaded.world.leagues[0]!.tier).toBe(1);
    expect(allClubs(loaded.world)).toHaveLength(20);
    // The table is the real check: results are matched to a division through
    // its fixtures, so an unnamed fixture list would produce 20 blank rows.
    const table = leagueTable(loaded);
    expect(table).toHaveLength(20);
    expect(table.reduce((sum, row) => sum + row.played, 0)).toBe(5 * 20);
  });
});
