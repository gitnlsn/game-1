import { describe, expect, it } from 'vitest';
import { Rng } from '../rng/index.js';
import {
  createCupState,
  cupComplete,
  CUP_TUNING,
  firstRoundClubs,
  resolveShootout,
} from '../league/cup.js';
import { createSeasonState, currentTable, playRound } from '../league/season.js';
import { cupRoundName } from '../career/controller.js';
import { allClubs, createWorld } from '../world/index.js';
import type { SeasonState } from '../league/season.js';

function runSeason(seed: string, cup: boolean, divisions = 2): SeasonState {
  const world = createWorld({ seed, divisions });
  const state = createSeasonState(world, new Rng(seed), { cup, playerState: true });
  while (state.nextRound <= state.totalRounds) playRound(state);
  return state;
}

describe('the bracket', () => {
  it('sheds the odd clubs in the first round and never later', () => {
    // 40 -> 8 ties (16 clubs) leaves 32, and every round after halves cleanly.
    expect(firstRoundClubs(40)).toBe(16);
    expect(firstRoundClubs(32)).toBe(0);
    expect(firstRoundClubs(20)).toBe(8);
    expect(firstRoundClubs(2)).toBe(0);
    expect(firstRoundClubs(1)).toBe(0);
  });

  it('plays a clean knockout from a field that is not a power of two', () => {
    const state = runSeason('cup-shape', true);
    const cup = state.cup!;

    const perRound = new Map<number, number>();
    for (const tie of cup.ties) perRound.set(tie.round, (perRound.get(tie.round) ?? 0) + 1);

    expect([...perRound.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [1, 8], [2, 16], [3, 8], [4, 4], [5, 2], [6, 1],
    ]);
    expect(cupComplete(cup)).toBe(true);
    expect(cup.winnerClubId).toBeDefined();
  });

  it('gives the first-round byes to the bigger clubs', () => {
    const world = createWorld({ seed: 'cup-byes', divisions: 2 });
    const ordered = [...allClubs(world)].sort((a, b) => a.reputation - b.reputation);
    const cup = createCupState(new Rng('cup-byes'), ordered.map((c) => c.id));

    const entering = new Set(cup.remaining.slice(0, firstRoundClubs(40)));
    const byReputation = new Map(allClubs(world).map((c) => [c.id, c.reputation]));

    const worstBye = Math.min(
      ...cup.remaining.slice(firstRoundClubs(40)).map((id) => byReputation.get(id)!),
    );
    const bestEntrant = Math.max(...[...entering].map((id) => byReputation.get(id)!));
    // The clubs made to play their way in are exactly the smallest sixteen.
    expect(bestEntrant).toBeLessThanOrEqual(worstBye);
  });
});

describe('a knockout tie', () => {
  it('always produces a winner', () => {
    const state = runSeason('cup-winner', true);
    for (const tie of state.cup!.ties) {
      expect(tie.winnerClubId, `round ${tie.round}`).toBeDefined();
      expect([tie.homeClubId, tie.awayClubId]).toContain(tie.winnerClubId);
    }
  });

  it('goes to extra time only when the ninety was level, and to penalties only after that', () => {
    const state = runSeason('cup-stages', true);
    let aet = 0;
    let shootouts = 0;

    for (const tie of state.cup!.ties) {
      const result = tie.result!;
      const level = result.home.goals === result.away.goals;
      expect(!!tie.extraTime, `round ${tie.round}`).toBe(level);

      if (tie.extraTime) {
        aet++;
        const stillLevel = tie.extraTime.home === tie.extraTime.away;
        expect(!!tie.shootout).toBe(stillLevel);
        if (tie.shootout) shootouts++;
      }
    }
    // Both routes have to actually happen, or this test is asserting nothing.
    expect(aet).toBeGreaterThan(0);
    expect(shootouts).toBeGreaterThan(0);
  });

  it('never ends a shootout level, however long it takes', () => {
    const world = createWorld({ seed: 'shootout' });
    const [home, away] = allClubs(world);
    const rng = new Rng('shootout');

    for (let i = 0; i < 300; i++) {
      const score = resolveShootout(rng, home!, away!);
      expect(score.home).not.toBe(score.away);
      // Sudden death only starts after five each, so nobody wins 1-0.
      expect(Math.max(score.home, score.away)).toBeGreaterThan(0);
    }
  });
});

describe('the cup alongside the league', () => {
  it('keeps cup ties out of the league table', () => {
    const state = runSeason('cup-table', true);

    for (const league of state.world.leagues) {
      for (const row of currentTable(state, league.id)) {
        expect(row.played, row.clubName).toBe(38);
      }
    }

    // And the cup really did put two clubs from one division against each other,
    // which is the case that a table built on pairings alone gets wrong.
    const first = new Set(state.world.leagues[0]!.clubs.map((c) => c.id));
    const sameDivisionTies = state.cup!.ties.filter(
      (tie) => first.has(tie.homeClubId) && first.has(tie.awayClubId),
    );
    expect(sameDivisionTies.length).toBeGreaterThan(0);
  });

  it('is played on its own matchdays', () => {
    const state = runSeason('cup-calendar', true);
    const cupRounds = new Set(
      state.fixtures.filter((f) => f.competitionId === 'cup').map((f) => f.round),
    );
    for (const round of cupRounds) expect(CUP_TUNING.rounds).toContain(round);
  });

  it('changes nothing when it is switched off', () => {
    const withoutCup = runSeason('cup-off', false);
    expect(withoutCup.cup).toBeUndefined();
    expect(withoutCup.results.every((r) => r.competitionId !== 'cup')).toBe(true);
    expect(withoutCup.results).toHaveLength(2 * 380);
  });

  it('gives clubs more football, which is the point of it', () => {
    const without = runSeason('cup-load', false);
    const with_ = runSeason('cup-load', true);
    expect(with_.results.length).toBeGreaterThan(without.results.length);
    expect(with_.results.length - without.results.length).toBe(39);
  });
});

describe('naming a round', () => {
  it('names the late rounds properly', () => {
    expect(cupRoundName(2)).toBe('Final');
    expect(cupRoundName(4)).toBe('Semi-finals');
    expect(cupRoundName(8)).toBe('Quarter-finals');
    expect(cupRoundName(16)).toBe('Round of 16');
    expect(cupRoundName(1)).toBe('Winners');
  });

  it('does not call the first round "of" a number nobody is playing', () => {
    // 40 clubs are left but only 16 play; the other 24 have byes.
    expect(cupRoundName(40)).toBe('First round');
    expect(cupRoundName(20)).toBe('First round');
    expect(cupRoundName(32)).toBe('Round of 32');
  });
});
