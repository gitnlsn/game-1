import { describe, expect, it } from 'vitest';
import {
  CUP_TUNING,
  advanceRound,
  cupRun,
  deserializeCareer,
  endSeason,
  isSeasonComplete,
  leagueTable,
  serializeCareer,
  startCareer,
  type Career,
} from '@eleven-deep/engine';
import { seasonCalendar, type CalendarEntry } from '../calendar';

/**
 * Eight clubs with a cup: a three-round knockout on matchdays 5, 12 and 20, and
 * sixteen league matchdays. Small enough to play out, big enough to produce a
 * bye, an elimination and a blank cup tail all in one season.
 *
 * Note `totalRounds` is `max(leagueRounds, 42)` whenever a cup is on, so this
 * career has a 42-matchday calendar whose tail is empty. That is the engine, not
 * the calendar.
 */
function cupCareer(seed = 'app-calendar'): Career {
  return startCareer({ seed, clubCount: 8, divisions: 1, cup: true });
}

/** Four clubs, no cup: a six-matchday season a test can play out. */
function plainCareer(seed = 'app-calendar-plain'): Career {
  return startCareer({ seed, clubCount: 4, divisions: 1, cup: false });
}

/** Five clubs: an odd division, so the phantom club gives real league byes. */
function oddCareer(seed = 'app-calendar-odd'): Career {
  return startCareer({ seed, clubCount: 5, divisions: 1, cup: false });
}

function playOut(career: Career): void {
  while (!isSeasonComplete(career)) advanceRound(career);
}

describe('seasonCalendar', () => {
  it('covers every matchday exactly once, in order', () => {
    const career = cupCareer();
    const calendar = seasonCalendar(career);

    expect(calendar.entries).toHaveLength(career.season.totalRounds);
    expect(calendar.entries.map((entry) => entry.matchday)).toEqual(
      Array.from({ length: career.season.totalRounds }, (_, index) => index + 1),
    );
    expect(calendar.totalRounds).toBe(career.season.totalRounds);
  });

  it('marks exactly the reserved cup matchdays as midweek', () => {
    const calendar = seasonCalendar(cupCareer());

    for (const entry of calendar.entries) {
      expect(entry.midweek, `matchday ${entry.matchday}`).toBe(
        CUP_TUNING.rounds.includes(entry.matchday),
      );
    }
  });

  it('has no midweek and no cup rows at all without a cup', () => {
    const calendar = seasonCalendar(plainCareer());

    expect(calendar.entries.some((entry) => entry.midweek)).toBe(false);
    expect(calendar.entries.some((entry) => entry.kind === 'cupTie')).toBe(false);
    expect(calendar.entries.some((entry) => entry.kind === 'cupRound')).toBe(false);
  });

  it('shows nothing played before a ball is kicked', () => {
    const calendar = seasonCalendar(plainCareer());

    expect(calendar.currentMatchday).toBe(1);
    expect(calendar.entries[0]!.status).toBe('current');
    expect(calendar.entries.slice(1).every((entry) => entry.status === 'upcoming')).toBe(true);
    expect(calendar.entries.some((entry) => scoreOf(entry) !== undefined)).toBe(false);
  });

  it('moves the current matchday along as rounds are played', () => {
    const career = plainCareer();
    advanceRound(career);
    advanceRound(career);

    const calendar = seasonCalendar(career);

    expect(calendar.currentMatchday).toBe(3);
    expect(calendar.entries[0]!.status).toBe('played');
    expect(calendar.entries[1]!.status).toBe('played');
    expect(calendar.entries[2]!.status).toBe('current');
    expect(calendar.entries[3]!.status).toBe('upcoming');
  });

  /*
   * The join is the part that can silently go wrong, so it is checked against
   * the engine's own arithmetic rather than against hand-written scores. If the
   * fixture-to-result join drops a match, or an away fixture comes back the
   * wrong way round, these totals stop agreeing with the table.
   */
  it('reproduces the league table from its own rows', () => {
    const career = plainCareer();
    playOut(career);

    const calendar = seasonCalendar(career);
    const league = calendar.entries.filter(
      (entry): entry is CalendarEntry & { kind: 'league' } => entry.kind === 'league',
    );
    const played = league.filter((entry) => entry.score !== undefined);
    const row = leagueTable(career).find((r) => r.clubId === career.managedClubId)!;

    expect(played).toHaveLength(row.played);
    expect(played.filter((entry) => entry.outcome === 'W')).toHaveLength(row.won);
    expect(played.filter((entry) => entry.outcome === 'D')).toHaveLength(row.drawn);
    expect(played.filter((entry) => entry.outcome === 'L')).toHaveLength(row.lost);
    expect(played.reduce((sum, entry) => sum + entry.score!.for, 0)).toBe(row.goalsFor);
    expect(played.reduce((sum, entry) => sum + entry.score!.against, 0)).toBe(row.goalsAgainst);
  });

  it('agrees with its own scores about who won', () => {
    const career = plainCareer();
    playOut(career);

    for (const entry of seasonCalendar(career).entries) {
      const score = scoreOf(entry);
      if (!score || entry.kind !== 'league') continue;
      const expected = score.for > score.against ? 'W' : score.for === score.against ? 'D' : 'L';
      expect(entry.outcome, `matchday ${entry.matchday}`).toBe(expected);
    }
  });

  /*
   * The one hazard no seed will find by accident. Two clubs in the same division
   * can be drawn together in the cup, and a `MatchResult` has no matchday -- so
   * without the competition in the join key, the cup result would be reported as
   * the league result for a match that has not been played.
   */
  it('does not let a cup result stand in for a league fixture', () => {
    const career = cupCareer();
    advanceRound(career);

    const me = career.managedClubId;
    const future = career.season.fixtures.find(
      (fixture) =>
        fixture.round > career.season.nextRound &&
        (fixture.homeClubId === me || fixture.awayClubId === me) &&
        fixture.competitionId !== career.season.cup!.competitionId,
    )!;

    const synthetic = {
      homeClubId: future.homeClubId,
      awayClubId: future.awayClubId,
      competitionId: career.season.cup!.competitionId,
      home: { clubId: future.homeClubId, goals: 3, shots: 9, shotsOnTarget: 5, possession: 50 },
      away: { clubId: future.awayClubId, goals: 0, shots: 4, shotsOnTarget: 1, possession: 50 },
      events: [],
    };

    career.season.results.push(synthetic);
    const wrongCompetition = entryAt(seasonCalendar(career), future.round);
    expect(wrongCompetition.kind).toBe('league');
    expect(scoreOf(wrongCompetition)).toBeUndefined();

    // The same pairing under the league's own competition does land, which
    // proves the guard is the competition and not an accident of the key.
    career.season.results.pop();
    career.season.results.push({ ...synthetic, competitionId: future.competitionId });
    expect(scoreOf(entryAt(seasonCalendar(career), future.round))).toBeDefined();
  });

  it('puts the cup on its reserved matchdays and agrees with the cup run', () => {
    const career = cupCareer();
    for (let round = 0; round < 20; round++) advanceRound(career);

    const calendar = seasonCalendar(career);
    const ties = calendar.entries.filter(
      (entry): entry is CalendarEntry & { kind: 'cupTie' } => entry.kind === 'cupTie',
    );
    const run = cupRun(career)!;

    expect(ties).toHaveLength(run.ties.length);
    for (const tie of ties) {
      expect(CUP_TUNING.rounds).toContain(tie.matchday);
      expect(tie.midweek).toBe(true);
    }
    for (const [index, tie] of run.ties.entries()) {
      if (!tie.winnerClubId) continue;
      const expected = tie.winnerClubId === career.managedClubId ? 'W' : 'L';
      expect(ties[index]!.outcome).toBe(expected);
    }
  });

  it('names a played cup round by the field that was actually in it', () => {
    const career = cupCareer();
    for (let round = 0; round < 20; round++) advanceRound(career);

    const calendar = seasonCalendar(career);
    // Eight clubs: quarter-finals, semi-finals, final on the first three
    // reserved matchdays.
    expect(roundNameAt(calendar, 5)).toBe('Quarter-finals');
    expect(roundNameAt(calendar, 12)).toBe('Semi-finals');
    expect(roundNameAt(calendar, 20)).toBe('Final');
  });

  it('leaves reserved matchdays beyond the cup empty', () => {
    const career = cupCareer();
    playOut(career);

    const calendar = seasonCalendar(career);
    // A three-round cup uses matchdays 5, 12 and 20; the other three reserved
    // matchdays belong to a competition that has already been won.
    for (const matchday of [28, 36, 42]) {
      expect(entryAt(calendar, matchday).kind, `matchday ${matchday}`).toBe('free');
    }
  });

  it('says the draw is still to come, never that it is a bye', () => {
    const career = cupCareer();
    // Stop on matchday 5 itself: the round is drawn when it is played, so at
    // this point there is no fixture and no opponent yet.
    while (career.season.nextRound < 5) advanceRound(career);

    const entry = entryAt(seasonCalendar(career), 5);

    expect(entry.status).toBe('current');
    expect(entry.kind).toBe('cupRound');
    if (entry.kind !== 'cupRound') throw new Error('expected a cup round');
    expect(entry.state).toBe('undrawn');
    expect(entry.roundName).not.toBe('');
    expect(entry.roundShort).not.toBe('');
  });

  it('marks every later cup round as out, once knocked out', () => {
    const career = cupCareer();
    playOut(career);

    const calendar = seasonCalendar(career);
    const run = cupRun(career)!;
    if (run.won) return; // this seed went all the way; nothing to assert

    const lost = run.ties.find((tie) => tie.winnerClubId !== career.managedClubId);
    if (!lost) return;

    const knockedOutOn = CUP_TUNING.rounds[lost.round - 1]!;
    const later = calendar.entries.filter(
      (entry) =>
        entry.kind === 'cupRound' &&
        entry.matchday > knockedOutOn &&
        CUP_TUNING.rounds.includes(entry.matchday),
    );

    for (const entry of later) {
      if (entry.kind !== 'cupRound') continue;
      expect(entry.state, `matchday ${entry.matchday}`).toBe('eliminated');
    }
  });

  /*
   * Extra time and penalties are rare enough that hunting for a seed that
   * produces one is brittle. A `CupTie` is plain, public, serialisable state, so
   * the honest way to check the arithmetic is to write one and re-derive.
   */
  it('keeps extra time and the shootout in the engine\'s own terms', () => {
    const career = cupCareer();
    for (let round = 0; round < 12; round++) advanceRound(career);

    const me = career.managedClubId;
    const tie = career.season.cup!.ties.find(
      (candidate) => candidate.homeClubId === me || candidate.awayClubId === me,
    )!;
    const atHome = tie.homeClubId === me;

    tie.score = { home: 2, away: 2 };
    tie.extraTime = { home: 1, away: 1 };
    tie.shootout = { home: 4, away: 2 };
    tie.winnerClubId = tie.homeClubId;

    const entry = entryAt(seasonCalendar(career), CUP_TUNING.rounds[tie.round - 1]!);
    if (entry.kind !== 'cupTie') throw new Error('expected a cup tie');

    // The ninety, not an aggregate.
    expect(entry.score).toEqual({ for: 2, against: 2 });
    // The thirty alone, exactly as the engine stores it.
    expect(entry.extraTime).toEqual({ for: 1, against: 1 });
    expect(entry.shootout).toEqual(atHome ? { for: 4, against: 2 } : { for: 2, against: 4 });
    expect(entry.outcome).toBe(atHome ? 'W' : 'L');
  });

  it('orients a cup tie from the managed club\'s end', () => {
    const career = cupCareer();
    for (let round = 0; round < 12; round++) advanceRound(career);

    const me = career.managedClubId;
    const tie = career.season.cup!.ties.find(
      (candidate) => candidate.homeClubId === me || candidate.awayClubId === me,
    )!;

    tie.score = { home: 3, away: 1 };
    delete tie.extraTime;
    delete tie.shootout;
    tie.winnerClubId = tie.homeClubId;

    const entry = entryAt(seasonCalendar(career), CUP_TUNING.rounds[tie.round - 1]!);
    if (entry.kind !== 'cupTie') throw new Error('expected a cup tie');

    const atHome = tie.homeClubId === me;
    expect(entry.home).toBe(atHome);
    expect(entry.score).toEqual(atHome ? { for: 3, against: 1 } : { for: 1, against: 3 });
    expect(entry.outcome).toBe(atHome ? 'W' : 'L');
  });

  it('leaves a league bye blank rather than dropping the matchday', () => {
    const career = oddCareer();
    playOut(career);

    const calendar = seasonCalendar(career);
    const free = calendar.entries.filter((entry) => entry.kind === 'free');
    const league = calendar.entries.filter((entry) => entry.kind === 'league');

    // Five clubs: everyone sits out two matchdays of the ten.
    expect(free.length).toBeGreaterThan(0);
    expect(league).toHaveLength((5 - 1) * 2);
    expect(league.length + free.length).toBe(calendar.totalRounds);
  });

  it('places the window after the last matchday, shut while the season runs', () => {
    const career = plainCareer();
    const calendar = seasonCalendar(career);

    expect(calendar.window.open).toBe(false);
    expect(calendar.window.afterMatchday).toBe(calendar.totalRounds);
    expect(calendar.window.season).toBe(career.world.season);
  });

  it('opens the window once the season is done, with no matchday current', () => {
    const career = plainCareer();
    const season = career.world.season;
    playOut(career);
    endSeason(career);

    const calendar = seasonCalendar(career);

    expect(calendar.window.open).toBe(true);
    expect(calendar.window.season).toBe(season);
    expect(calendar.currentMatchday).toBeUndefined();
    expect(calendar.entries.every((entry) => entry.status === 'played')).toBe(true);
  });

  /*
   * A save keeps only goal events for most matches, so the question is whether
   * the calendar survives that. It does: scorelines live on the team stats and
   * cup ties are persisted whole.
   */
  it('survives a save and reload unchanged', () => {
    const career = cupCareer();
    for (let round = 0; round < 20; round++) advanceRound(career);

    const restored = deserializeCareer(serializeCareer(career));

    expect(seasonCalendar(restored)).toEqual(seasonCalendar(career));
  });
});

function entryAt(calendar: { entries: CalendarEntry[] }, matchday: number): CalendarEntry {
  return calendar.entries.find((entry) => entry.matchday === matchday)!;
}

function roundNameAt(calendar: { entries: CalendarEntry[] }, matchday: number): string {
  const entry = entryAt(calendar, matchday);
  if (entry.kind !== 'cupTie' && entry.kind !== 'cupRound') return '';
  return entry.roundName;
}

function scoreOf(entry: CalendarEntry): { for: number; against: number } | undefined {
  return entry.kind === 'league' || entry.kind === 'cupTie' ? entry.score : undefined;
}
