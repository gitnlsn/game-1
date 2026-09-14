import { describe, expect, it } from 'vitest';
import {
  advanceRound,
  endSeason,
  isSeasonComplete,
  leagueTable,
  managedClub,
  managedPosition,
  managedResults,
  nextFixture,
  startCareer,
} from '../career/controller.js';
import { deserializeCareer, serializeCareer } from '../career/persistence.js';

function playWholeSeason(career: ReturnType<typeof startCareer>): void {
  let guard = 0;
  while (!isSeasonComplete(career) && guard++ < 100) advanceRound(career);
}

describe('career controller', () => {
  it('plays a season one round at a time', () => {
    const career = startCareer({ seed: 'controller' });
    expect(career.season.totalRounds).toBe(38);
    expect(isSeasonComplete(career)).toBe(false);

    const first = advanceRound(career);
    expect(first).toHaveLength(10);
    expect(leagueTable(career).reduce((sum, row) => sum + row.played, 0)).toBe(20);

    playWholeSeason(career);
    expect(isSeasonComplete(career)).toBe(true);
    expect(career.season.results).toHaveLength(380);
    for (const row of leagueTable(career)) expect(row.played).toBe(38);

    // Playing on past the end must not invent extra fixtures.
    expect(advanceRound(career)).toHaveLength(0);
    expect(career.season.results).toHaveLength(380);
  });

  it('tracks the managed club through the season', () => {
    const career = startCareer({ seed: 'managed', managedClubId: 'c5' });
    expect(managedClub(career).id).toBe('c5');

    const upcoming = nextFixture(career);
    expect(upcoming).toBeDefined();
    expect(upcoming!.opponent.id).not.toBe('c5');

    advanceRound(career);
    const played = managedResults(career);
    expect(played).toHaveLength(1);
    expect([played[0]!.homeClubId, played[0]!.awayClubId]).toContain('c5');

    const position = managedPosition(career);
    expect(position).toBeGreaterThanOrEqual(1);
    expect(position).toBeLessThanOrEqual(20);
  });

  it('rolls into the next season and keeps the world coherent', () => {
    const career = startCareer({ seed: 'rollover' });
    expect(() => endSeason(career)).toThrow(/rounds left/);

    playWholeSeason(career);
    const summary = endSeason(career);

    expect(summary.championName).not.toBe('');
    expect(career.history).toHaveLength(1);
    expect(career.world.season).toBe(2);
    // A fresh season is ready to play.
    expect(isSeasonComplete(career)).toBe(false);
    expect(career.season.results).toHaveLength(0);
    expect(nextFixture(career)).toBeDefined();

    // Everyone starts the new season with their season counters cleared.
    for (const club of career.world.league.clubs) {
      for (const player of club.squad) expect(player.status.minutes).toBe(0);
    }
  });
});

describe('save and load', () => {
  it('resumes exactly where an uninterrupted career would have gone', () => {
    const direct = startCareer({ seed: 'save-test', managedClubId: 'c3' });
    const viaSave = startCareer({ seed: 'save-test', managedClubId: 'c3' });

    for (let i = 0; i < 6; i++) {
      advanceRound(direct);
      advanceRound(viaSave);
    }

    // Round-trip through a save, then keep playing both.
    const resumed = deserializeCareer(serializeCareer(viaSave));

    for (let i = 0; i < 6; i++) {
      advanceRound(direct);
      advanceRound(resumed);
    }

    const scoreline = (c: typeof direct) =>
      c.season.results.map((r) => `${r.homeClubId}${r.home.goals}-${r.away.goals}${r.awayClubId}`);

    expect(scoreline(resumed)).toEqual(scoreline(direct));
    expect(leagueTable(resumed)).toEqual(leagueTable(direct));
  });

  it('keeps squad players and the lookup table pointing at the same objects', () => {
    const career = startCareer({ seed: 'identity' });
    advanceRound(career);
    const loaded = deserializeCareer(serializeCareer(career));

    for (const club of loaded.world.league.clubs) {
      for (const player of club.squad) {
        // Identity, not just equality: a transfer mutates one object and both
        // views have to see it.
        expect(loaded.world.players.get(player.id)).toBe(player);
      }
    }
    expect(loaded.world.players.size).toBeGreaterThan(400);
  });

  it('survives a full season boundary', () => {
    const career = startCareer({ seed: 'save-season' });
    playWholeSeason(career);
    endSeason(career);
    advanceRound(career);

    const loaded = deserializeCareer(serializeCareer(career));
    expect(loaded.world.season).toBe(2);
    expect(loaded.history).toHaveLength(1);
    expect(loaded.season.results).toHaveLength(10);

    playWholeSeason(loaded);
    expect(() => endSeason(loaded)).not.toThrow();
  });

  it('refuses a save from an incompatible version', () => {
    const career = startCareer({ seed: 'version' });
    const saved = JSON.parse(serializeCareer(career));
    saved.version = 999;
    expect(() => deserializeCareer(JSON.stringify(saved))).toThrow(/Unsupported save version/);
  });
});
