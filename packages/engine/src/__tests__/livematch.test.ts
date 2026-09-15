import { describe, expect, it } from 'vitest';
import { Rng } from '../rng/index.js';
import {
  changeMatchTactics,
  finishMatch,
  matchComplete,
  matchSide,
  simulateMatch,
  startMatch,
  stepMatch,
  substitute,
  MATCH_TUNING,
} from '../match/engine.js';
import { BALANCED } from '../match/tactics.js';
import { allClubs, createWorld } from '../world/index.js';
import {
  advanceRound,
  beginLiveMatch,
  endLiveMatch,
  leagueTable,
  startCareer,
} from '../career/controller.js';
import { DEFAULT_FORMATION, FORMATIONS } from '../world/positions.js';
import type { Club, TeamSheet } from '../types.js';

const world = createWorld({ seed: 'live' });
const [home, away] = allClubs(world) as [Club, Club];

function sheet(clubId: string): TeamSheet {
  return {
    clubId,
    formation: DEFAULT_FORMATION,
    starters: new Array<string | undefined>(FORMATIONS[DEFAULT_FORMATION]!.length).fill(undefined),
    bench: [],
  };
}

describe('playing a match a minute at a time', () => {
  /*
   * The load-bearing test for the whole thing. A live match must not be a second
   * implementation of the rules that drifts from the one every benchmark is
   * calibrated against -- so the stepped path has to produce the same football
   * AND consume the generator identically.
   */
  it('is the same match as simulating it in one go', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const oneGo = new Rng(seed);
      const expected = simulateMatch(oneGo, home, away);

      const stepped = new Rng(seed);
      const match = startMatch(stepped, home, away);
      while (!matchComplete(match)) stepMatch(match);
      const actual = finishMatch(match);

      expect(actual, seed).toEqual(expected);
      expect(stepped.getState(), seed).toBe(oneGo.getState());
    }
  });

  it('hands back only what happened in the minute just played', () => {
    const match = startMatch(new Rng('minutes'), home, away);
    let collected = 0;

    while (!matchComplete(match)) {
      const before = match.minute;
      const events = stepMatch(match);
      expect(match.minute).toBe(before + 1);
      for (const event of events) expect(event.minute).toBe(match.minute);
      collected += events.length;
    }

    expect(collected).toBe(match.events.length);
    // And stepping past the whistle does nothing at all.
    expect(stepMatch(match)).toEqual([]);
    expect(match.minute).toBe(match.finalMinute);
  });
});

describe('running a side by hand', () => {
  function liveMatch(seed: string) {
    return startMatch(new Rng(seed), home, away, {
      homeSheet: sheet(home.id),
      manualSide: 'home',
    });
  }

  it('stops the engine substituting for the side you are running', () => {
    let homeTactical = 0;
    let awayTactical = 0;

    for (const seed of ['m-a', 'm-b', 'm-c', 'm-d', 'm-e', 'm-f']) {
      const match = liveMatch(seed);
      while (!matchComplete(match)) stepMatch(match);

      /*
       * Counted against injuries, not in isolation. A forced change when
       * somebody pulls up is not the engine second-guessing the manager, and it
       * has to keep happening -- finishing with ten men because the manager was
       * not watching would be a worse bug than the one this prevents.
       */
      const injuries = match.events.filter((e) => e.type === 'injury');
      const subs = match.events.filter((e) => e.type === 'substitution');
      homeTactical +=
        subs.filter((e) => e.clubId === home.id).length -
        injuries.filter((e) => e.clubId === home.id).length;
      awayTactical += subs.filter((e) => e.clubId === away.id).length;
    }

    expect(homeTactical).toBeLessThanOrEqual(0);
    // The other side is still managed by the engine, and busily.
    expect(awayTactical).toBeGreaterThan(6);
  });

  it('makes the substitution you ask for', () => {
    const match = liveMatch('sub');
    for (let i = 0; i < 60; i++) stepMatch(match);

    const side = matchSide(match, 'home');
    const off = side.onPitch.find((p) => p.position !== 'GK')!;
    const on = side.bench[0]!;
    // Not from zero: an injury may already have forced a change.
    const usedBefore = side.substitutionsUsed;

    expect(substitute(match, 'home', off.player.id, on.id).done).toBe(true);

    const after = matchSide(match, 'home');
    expect(after.onPitch.map((p) => p.player.id)).toContain(on.id);
    expect(after.onPitch.map((p) => p.player.id)).not.toContain(off.player.id);
    expect(after.onPitch).toHaveLength(side.onPitch.length);
    expect(after.substitutionsUsed).toBe(usedBefore + 1);
    expect(after.substitutionsLeft).toBe(MATCH_TUNING.maxSubstitutions - usedBefore - 1);

    const event = [...match.events].reverse().find((e) => e.type === 'substitution')!;
    expect(event.playerId).toBe(off.player.id);
    expect(event.replacementPlayerId).toBe(on.id);
  });

  it('refuses the changes it cannot make', () => {
    const match = liveMatch('refuse');
    for (let i = 0; i < 50; i++) stepMatch(match);

    const side = matchSide(match, 'home');
    const onPitch = side.onPitch[1]!.player.id;
    const benched = side.bench[0]!.id;

    expect(substitute(match, 'home', 'nobody', benched).reason).toBe('not_on_pitch');
    expect(substitute(match, 'home', onPitch, 'nobody').reason).toBe('not_on_bench');
    // The away side is not yours to change.
    expect(substitute(match, 'away', onPitch, benched).reason).toBe('wrong_side');
  });

  it('runs out of substitutions', () => {
    const match = liveMatch('exhaust');
    for (let i = 0; i < 46; i++) stepMatch(match);

    const start = matchSide(match, 'home').substitutionsUsed;
    for (let i = start; i < MATCH_TUNING.maxSubstitutions; i++) {
      const side = matchSide(match, 'home');
      const off = side.onPitch.find((p) => p.position !== 'GK')!;
      expect(substitute(match, 'home', off.player.id, side.bench[0]!.id).done).toBe(true);
    }

    const side = matchSide(match, 'home');
    expect(side.substitutionsLeft).toBe(0);
    const off = side.onPitch.find((p) => p.position !== 'GK')!;
    expect(substitute(match, 'home', off.player.id, side.bench[0]!.id).reason).toBe('none_left');
  });

  it('lets you change the instructions, and they bite from the next minute', () => {
    const match = liveMatch('tactics');
    for (let i = 0; i < 60; i++) stepMatch(match);

    expect(matchSide(match, 'home').tactics).toEqual(BALANCED);
    const attackBefore = match.home.rating.attack;
    const defenceBefore = match.home.rating.defence;

    const next = changeMatchTactics(match, 'home', { mentality: 2 });

    expect(next.mentality).toBe(2);
    expect(matchSide(match, 'home').tactics.mentality).toBe(2);
    // Rebuilt immediately: a manager who goes attacking at 80 minutes has the
    // last ten of them, not none.
    expect(match.home.rating.attack).toBeGreaterThan(attackBefore);
    // And it costs what it should: more men forward is less cover behind them.
    expect(match.home.rating.defence).toBeLessThan(defenceBefore);
  });

  it('changes the football when you actually manage', () => {
    /*
     * Chasing a game by going all-out attacking has to show up as more shots,
     * or the control is a button that does nothing.
     */
    const shotsWith = (manage: boolean) => {
      let shots = 0;
      for (const seed of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']) {
        const match = startMatch(new Rng(seed), home, away, {
          homeSheet: sheet(home.id),
          manualSide: 'home',
        });
        while (!matchComplete(match)) {
          if (manage && match.minute === 60) changeMatchTactics(match, 'home', { mentality: 2 });
          stepMatch(match);
        }
        shots += match.home.shots;
      }
      return shots;
    };

    expect(shotsWith(true)).toBeGreaterThan(shotsWith(false));
  });
});

describe('playing your own match while the round goes on', () => {
  it('plays everybody else and holds yours back', () => {
    const career = startCareer({ seed: 'live-round', managedClubId: 'c1' });
    const roundBefore = career.season.nextRound;

    const live = beginLiveMatch(career)!;
    expect(live).toBeDefined();

    // The rest of the round is done; the round itself is not.
    expect(live.otherResults.length).toBeGreaterThan(0);
    expect(live.otherResults.every((r) => r.homeClubId !== 'c1' && r.awayClubId !== 'c1')).toBe(true);
    expect(career.season.nextRound).toBe(roundBefore);

    const result = endLiveMatch(live, career);

    expect([result.homeClubId, result.awayClubId]).toContain('c1');
    expect(career.season.nextRound).toBe(roundBefore + 1);
    // And it counts: the table has to show the game as played.
    const row = leagueTable(career).find((r) => r.clubId === 'c1')!;
    expect(row.played).toBe(1);
  });

  it('books the points the same way an ordinary round does', () => {
    const live = startCareer({ seed: 'live-points', managedClubId: 'c1' });
    const auto = startCareer({ seed: 'live-points', managedClubId: 'c1' });

    const session = beginLiveMatch(live)!;
    const result = endLiveMatch(session, live);
    advanceRound(auto);

    const liveRow = leagueTable(live).find((r) => r.clubId === 'c1')!;
    const won = result.homeClubId === 'c1'
      ? result.home.goals > result.away.goals
      : result.away.goals > result.home.goals;
    const drew = result.home.goals === result.away.goals;

    expect(liveRow.played).toBe(1);
    expect(liveRow.points).toBe(won ? 3 : drew ? 1 : 0);

    // Both paths leave the season in the same place, even though the football
    // itself differs -- the matches are played in a different order.
    expect(live.season.nextRound).toBe(auto.season.nextRound);
    expect(live.season.results).toHaveLength(auto.season.results.length);
  });

  it('lets the manager substitute in his own match and nobody else\'s', () => {
    const career = startCareer({ seed: 'live-sub', managedClubId: 'c1' });
    const live = beginLiveMatch(career)!;

    for (let i = 0; i < 60; i++) stepMatch(live.match);

    const side = matchSide(live.match, live.side);
    const off = side.onPitch.find((p) => p.position !== 'GK')!;
    expect(substitute(live.match, live.side, off.player.id, side.bench[0]!.id).done).toBe(true);

    const other = live.side === 'home' ? 'away' : 'home';
    const theirs = matchSide(live.match, other);
    expect(
      substitute(live.match, other, theirs.onPitch[1]!.player.id, theirs.bench[0]!.id).reason,
    ).toBe('wrong_side');

    endLiveMatch(live, career);
  });

  it('records minutes for whoever actually played', () => {
    const career = startCareer({ seed: 'live-minutes', managedClubId: 'c1' });
    const live = beginLiveMatch(career)!;
    const brought = matchSide(live.match, live.side).bench[0]!;

    for (let i = 0; i < 55; i++) stepMatch(live.match);
    const off = matchSide(live.match, live.side).onPitch.find((p) => p.position !== 'GK')!;
    substitute(live.match, live.side, off.player.id, brought.id);

    endLiveMatch(live, career);

    // The substitute played, and so did the man he replaced.
    expect(brought.status.minutes).toBeGreaterThan(0);
    expect(off.player.status.minutes).toBeGreaterThan(0);
    expect(brought.status.appearances).toBe(1);
  });
});
