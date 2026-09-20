import { describe, expect, it } from 'vitest';
import {
  advanceRound,
  endSeason,
  isSeasonComplete,
  startCareer,
  startNextSeason,
  type Career,
} from '@eleven-deep/engine';
import {
  emptyLifetime,
  endCareer,
  LIFETIME_KEY,
  loadLifetime,
  ownMatchesThisSeason,
  recordProgress,
  sameLifetime,
  saveLifetime,
  type LifetimeRecord,
} from '../lifetime';
import type { SaveStorage } from '../saves';

class FakeStorage implements SaveStorage {
  readonly items = new Map<string, string>();
  async getItem(key: string): Promise<string | null> {
    return this.items.get(key) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    this.items.set(key, value);
  }
  async removeItem(key: string): Promise<void> {
    this.items.delete(key);
  }
}

/** Plays out whatever is left of the season the career is in. */
function playSeason(career: Career): void {
  while (!isSeasonComplete(career)) advanceRound(career);
}

/** Season over, window opened and closed, next season under way. */
function rollOver(career: Career): void {
  endSeason(career);
  startNextSeason(career);
}

describe('lifetime totals', () => {
  it('starts a new career at zero', () => {
    const career = startCareer({ seed: 'lifetime-fresh' });
    const record = recordProgress(emptyLifetime(), 'a', career);

    expect(record).toEqual({
      matches: 0,
      seasons: 0,
      longestRun: 0,
      current: { key: 'a', matchesThisSeason: 0, seasons: 0 },
    });
  });

  it('counts the managed club’s matches, not the whole division’s', () => {
    const career = startCareer({ seed: 'lifetime-rounds' });
    for (let i = 0; i < 4; i++) advanceRound(career);

    const record = recordProgress(emptyLifetime(), 'a', career);

    // Four matchdays, and the club played on each of them that was not a bye.
    expect(record.matches).toBe(ownMatchesThisSeason(career));
    expect(record.matches).toBeGreaterThan(0);
    expect(record.matches).toBeLessThanOrEqual(4);
    // The rest of the division played too, and none of it is ours.
    expect(career.season.results.length).toBeGreaterThan(record.matches);
  });

  it('is idempotent: syncing without playing counts nothing', () => {
    const career = startCareer({ seed: 'lifetime-idempotent' });
    advanceRound(career);

    const once = recordProgress(emptyLifetime(), 'a', career);
    const twice = recordProgress(once, 'a', career);
    const thrice = recordProgress(twice, 'a', career);

    expect(twice.matches).toBe(once.matches);
    expect(sameLifetime(once, thrice)).toBe(true);
  });

  it('banks a season without counting its matches twice across the rollover', () => {
    const career = startCareer({ seed: 'lifetime-rollover' });
    let record = emptyLifetime();

    playSeason(career);
    record = recordProgress(record, 'a', career);
    const afterOneSeason = record.matches;
    expect(afterOneSeason).toBeGreaterThan(30);
    expect(record.seasons).toBe(0); // not seen out until endSeason

    /*
     * The dangerous moment. `endSeason` increments the history while leaving
     * the finished SeasonState in place for the transfer window, and only
     * `startNextSeason` swaps in an empty one -- so a sync lands on each side
     * of that, deliberately.
     */
    endSeason(career);
    record = recordProgress(record, 'a', career);
    expect(record.matches).toBe(afterOneSeason);
    expect(record.seasons).toBe(1);

    startNextSeason(career);
    record = recordProgress(record, 'a', career);
    expect(record.matches).toBe(afterOneSeason);

    advanceRound(career);
    record = recordProgress(record, 'a', career);
    expect(record.matches).toBe(afterOneSeason + ownMatchesThisSeason(career));
  });

  it('keeps counting across several seasons', () => {
    const career = startCareer({ seed: 'lifetime-multi' });
    let record = emptyLifetime();

    for (let season = 0; season < 3; season++) {
      playSeason(career);
      record = recordProgress(record, 'a', career);
      rollOver(career);
      record = recordProgress(record, 'a', career);
    }

    expect(record.seasons).toBe(3);
    expect(record.longestRun).toBe(3);
    // Three full seasons of league and cup, and no season counted twice.
    expect(record.matches).toBeGreaterThan(3 * 30);
    expect(record.matches).toBeLessThan(3 * 50);
  });

  it('adopts a career it has never counted, rather than starting it at zero', () => {
    const career = startCareer({ seed: 'lifetime-adopt' });
    for (let season = 0; season < 2; season++) {
      playSeason(career);
      rollOver(career);
    }
    advanceRound(career);

    // A save from before any of this existed: no `current`, nothing banked.
    const record = recordProgress(emptyLifetime(), 'a', career);

    expect(record.seasons).toBe(2);
    expect(record.longestRun).toBe(2);
    /*
     * Backfilled off the league tables, so the two finished seasons come back
     * but their cup matches do not. Short of the truth, and far closer to it
     * than zero.
     */
    expect(record.matches).toBeGreaterThan(2 * 30);
  });

  it('keeps the totals when a career ends and starts the next from its own zero', () => {
    const first = startCareer({ seed: 'lifetime-first' });
    let record = emptyLifetime();
    playSeason(first);
    record = recordProgress(record, 'a', first);
    rollOver(first);
    record = recordProgress(record, 'a', first);

    const banked = record.matches;
    record = endCareer(record);
    expect(record.current).toBeUndefined();
    expect(record.matches).toBe(banked);
    expect(record.seasons).toBe(1);

    const second = startCareer({ seed: 'lifetime-second' });
    record = recordProgress(record, 'b', second);
    expect(record.matches).toBe(banked);
    expect(record.seasons).toBe(1);

    advanceRound(second);
    record = recordProgress(record, 'b', second);
    expect(record.matches).toBe(banked + ownMatchesThisSeason(second));
  });

  it('remembers the best run, not the most recent one', () => {
    const long = startCareer({ seed: 'lifetime-long' });
    let record = emptyLifetime();
    for (let season = 0; season < 3; season++) {
      playSeason(long);
      rollOver(long);
      record = recordProgress(record, 'a', long);
    }
    expect(record.longestRun).toBe(3);

    record = endCareer(record);
    const short = startCareer({ seed: 'lifetime-short' });
    playSeason(short);
    rollOver(short);
    record = recordProgress(record, 'b', short);

    expect(record.seasons).toBe(4);
    expect(record.longestRun).toBe(3);
  });

  it('round-trips through storage', async () => {
    const storage = new FakeStorage();
    const record: LifetimeRecord = {
      matches: 472,
      seasons: 11,
      longestRun: 7,
      current: { key: 'a', matchesThisSeason: 12, seasons: 7 },
    };

    await saveLifetime(storage, record);
    expect(await loadLifetime(storage)).toEqual(record);
  });

  it('starts over rather than throwing on a corrupt blob', async () => {
    const storage = new FakeStorage();
    storage.items.set(LIFETIME_KEY, '{ not json');

    expect(await loadLifetime(storage)).toEqual(emptyLifetime());
  });

  it('reads a record written by an older build without a current career', async () => {
    const storage = new FakeStorage();
    storage.items.set(LIFETIME_KEY, JSON.stringify({ matches: 5, seasons: 1 }));

    expect(await loadLifetime(storage)).toEqual({
      matches: 5,
      seasons: 1,
      longestRun: 0,
      current: undefined,
    });
  });
});
