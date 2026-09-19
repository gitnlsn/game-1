import { describe, expect, it } from 'vitest';
import {
  advanceRound,
  endSeason,
  isSeasonComplete,
  leagueTable,
  managedClub,
  managedLeague,
  managedPosition,
  startCareer,
  type Career,
} from '@eleven-deep/engine';
import { careerSummary } from '../summary';

/**
 * Four clubs in one division with no cup: a six-round season, so a test can
 * play a whole one out without the suite noticing.
 */
function smallCareer(seed = 'app-summary'): Career {
  return startCareer({ seed, clubCount: 4, divisions: 1, cup: false });
}

describe('careerSummary', () => {
  it('names the club, the city and the division', () => {
    const career = smallCareer();
    const summary = careerSummary(career);

    expect(summary.clubName).toBe(managedClub(career).name);
    expect(summary.city).toBe(managedClub(career).city);
    expect(summary.leagueName).toBe(managedLeague(career).name);
    expect(summary.season).toBe(career.world.season);
  });

  it('withholds a position until a ball has been kicked', () => {
    const summary = careerSummary(smallCareer());

    expect(summary.position).toBeUndefined();
    expect(summary.played).toBe(0);
    expect(summary.points).toBe(0);
  });

  it('reports the position and points the table reports, once played', () => {
    const career = smallCareer();
    advanceRound(career);

    const summary = careerSummary(career);
    const row = leagueTable(career).find((r) => r.clubId === career.managedClubId);

    expect(summary.position).toBe(managedPosition(career));
    expect(summary.played).toBe(1);
    expect(summary.points).toBe(row?.points);
  });

  it('counts the league games from the size of this division', () => {
    expect(careerSummary(smallCareer()).leagueGames).toBe(6);
  });

  it('points at the next fixture while one is left', () => {
    const summary = careerSummary(smallCareer());

    expect(summary.next.kind).toBe('fixture');
    if (summary.next.kind !== 'fixture') return;
    expect(summary.next.round).toBe(1);
    expect(summary.next.opponent).not.toBe(managedClub(smallCareer()).name);
    expect(summary.next.isCup).toBe(false);
  });

  it('says the season is over once the fixtures run out', () => {
    const career = smallCareer();
    while (!isSeasonComplete(career)) advanceRound(career);

    expect(careerSummary(career).next.kind).toBe('seasonOver');
  });

  it('says the window is open once the season has been wrapped up', () => {
    const career = smallCareer();
    while (!isSeasonComplete(career)) advanceRound(career);
    endSeason(career);

    expect(careerSummary(career).next.kind).toBe('window');
  });

  /*
   * The precedence is the part most likely to regress, and getting it wrong
   * means the title screen invites a sacked manager into the transfer market.
   */
  it('puts a dismissal ahead of an open window', () => {
    const career = smallCareer();
    while (!isSeasonComplete(career)) advanceRound(career);
    endSeason(career);
    career.board.sacked = true;
    career.board.sackReason = 'Results have not been good enough.';

    const summary = careerSummary(career);
    expect(summary.next.kind).toBe('sacked');
    if (summary.next.kind !== 'sacked') return;
    expect(summary.next.reason).toBe('Results have not been good enough.');
  });

  it('falls back to a plain sentence when the board gave no reason', () => {
    const career = smallCareer();
    career.board.sacked = true;

    const summary = careerSummary(career);
    if (summary.next.kind !== 'sacked') return;
    expect(summary.next.reason).toMatch(/board/i);
  });
});
