import { describe, expect, it } from 'vitest';
import {
  allClubs,
  createWorld,
  findClub,
  leagueOf,
  topLeague,
} from '../world/index.js';
import {
  startCareer,
  advanceRound,
  endSeason,
  isSeasonComplete,
  leagueTable,
  startNextSeason,
} from '../career/controller.js';
import { deserializeCareer, serializeCareer } from '../career/persistence.js';
import { createSeasonState, currentTable, currentTables, finaliseSeason, playRound } from '../league/season.js';
import { closeSeason } from '../career/career.js';
import { expectedAnnualRevenue, prizeMoney, tierShare } from '../economy/finances.js';
import { validatePyramid } from '../analysis/pyramid.js';
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
    const career = startCareer({ seed: 'pyramid-migrate', divisions: 1, cup: false });
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

describe('promotion and relegation', () => {
  it('swaps the bottom of a division with the top of the one below', () => {
    const world = createWorld({ seed: 'promotion', divisions: 2 });
    const rng = new Rng('promotion');
    const state = createSeasonState(world, rng, { economy: true, playerState: true });
    while (state.nextRound <= state.totalRounds) playRound(state);

    const before = finaliseSeason(state);
    const goingDown = before.tables[0]!.slice(-3).map((r) => r.clubId);
    const goingUp = before.tables[1]!.slice(0, 3).map((r) => r.clubId);

    const summary = closeSeason(world, rng, before);

    const top = new Set(world.leagues[0]!.clubs.map((c) => c.id));
    const second = new Set(world.leagues[1]!.clubs.map((c) => c.id));

    for (const id of goingUp) expect(top.has(id), `${id} up`).toBe(true);
    for (const id of goingDown) expect(second.has(id), `${id} down`).toBe(true);

    // Divisions stay the same size, and nobody ends up in two of them.
    expect(world.leagues[0]!.clubs).toHaveLength(20);
    expect(world.leagues[1]!.clubs).toHaveLength(20);
    expect(new Set(allClubs(world).map((c) => c.id)).size).toBe(40);

    expect(summary.promotions).toHaveLength(6);
    expect(summary.promotions.filter((p) => p.to === 1)).toHaveLength(3);
    expect(summary.promotions.filter((p) => p.to === 2)).toHaveLength(3);
  });

  it('does nothing at all in a world with one division', () => {
    const world = createWorld({ seed: 'promotion-single' });
    const rng = new Rng('promotion-single');
    const state = createSeasonState(world, rng, { economy: true, playerState: true });
    while (state.nextRound <= state.totalRounds) playRound(state);

    const summary = closeSeason(world, rng, finaliseSeason(state));
    expect(summary.promotions).toEqual([]);
    expect(world.leagues).toHaveLength(1);
  });

  it('pays the divisions differently, which is what makes the drop matter', () => {
    expect(tierShare(1)).toBe(1);
    expect(tierShare(2)).toBeLessThan(1);
    expect(tierShare(3)).toBeLessThan(tierShare(2));

    // Same club, same standing, one division apart.
    expect(prizeMoney(1, 20, 2)).toBeLessThan(prizeMoney(1, 20, 1));
    expect(expectedAnnualRevenue(70, 20, 2)).toBeLessThan(expectedAnnualRevenue(70, 20, 1));
    // But not to nothing: gate and sponsorship still follow the club itself.
    expect(expectedAnnualRevenue(70, 20, 2)).toBeGreaterThan(
      expectedAnnualRevenue(70, 20, 1) * 0.4,
    );
  });

  it('ranks reputation across the pyramid, not within a division', () => {
    /*
     * Winning the second tier must be worth less than winning the first, or a
     * club could ratchet its standing up by going down and winning promotion
     * again, over and over.
     */
    const world = createWorld({ seed: 'reputation-tiers', divisions: 2 });
    const rng = new Rng('reputation-tiers');
    const secondTierChampion = world.leagues[1]!.clubs[0]!;
    const before = secondTierChampion.reputation;

    const state = createSeasonState(world, rng, { economy: true, playerState: true });
    while (state.nextRound <= state.totalRounds) playRound(state);
    const result = finaliseSeason(state);

    const topOfSecond = result.tables[1]![0]!.clubId;
    const topOfFirst = result.tables[0]![0]!.clubId;
    closeSeason(world, rng, result);

    const secondWinner = findClub(world, topOfSecond)!;
    const firstWinner = findClub(world, topOfFirst)!;
    expect(secondWinner.reputation).toBeLessThan(firstWinner.reputation);
    void before;
  });
});

describe('the pyramid over a career', () => {
  it('passes every pyramid benchmark', () => {
    const report = validatePyramid({ seasons: 12, seed: 'pyramid-test' });
    const failures = report.checks
      .filter((c) => !c.pass)
      .map((c) => `${c.benchmark.label} = ${c.value.toFixed(2)} (want ${c.benchmark.target} +/- ${c.benchmark.tolerance})`);
    expect(failures).toEqual([]);
  });
});

describe('what a career plays by default', () => {
  it('is a two-division pyramid with a cup', () => {
    const career = startCareer({ seed: 'defaults' });
    expect(career.world.leagues).toHaveLength(2);
    expect(allClubs(career.world)).toHaveLength(40);
    expect(career.season.cup).toBeDefined();
  });

  it('keeps the cup it was playing across a save, without re-drawing it', () => {
    const career = startCareer({ seed: 'cup-save' });
    // Far enough in for the first two cup rounds to have been drawn and played.
    for (let i = 0; i < 12; i++) advanceRound(career);

    const before = career.season.cup!;
    const restored = deserializeCareer(serializeCareer(career));

    expect(restored.season.cup!.ties).toEqual(before.ties);
    expect(restored.season.cup!.remaining).toEqual(before.remaining);
    expect(restored.season.cup!.roundIndex).toBe(before.roundIndex);

    /*
     * And the generator is where it was. Re-drawing the bracket on load would
     * consume shuffles the uninterrupted career never made, so every match after
     * the save would play out differently -- which is exactly what happened.
     */
    expect(restored.rng.getState()).toBe(career.rng.getState());

    const a = advanceRound(career);
    const b = advanceRound(restored);
    expect(b.map((r) => [r.homeClubId, r.home.goals, r.away.goals])).toEqual(
      a.map((r) => [r.homeClubId, r.home.goals, r.away.goals]),
    );
  });

  it('gives the next season a new cup', () => {
    const career = startCareer({ seed: 'cup-next' });
    let guard = 0;
    while (!isSeasonComplete(career) && guard++ < 100) advanceRound(career);
    endSeason(career);
    startNextSeason(career);

    expect(career.season.cup).toBeDefined();
    expect(career.season.cup!.ties).toEqual([]);
    expect(career.season.cup!.remaining).toHaveLength(40);
  });
});
