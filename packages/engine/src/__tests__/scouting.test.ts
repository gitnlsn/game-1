import { describe, expect, it } from 'vitest';
import {
  advanceRound,
  endSeason,
  isSeasonComplete,
  startNextSeason,
  managedClub,
  scoutPlayer,
  scoutsAvailable,
  scoutReport,
  scoutValuation,
  startCareer,
  type Career,
} from '../career/controller.js';
import { deserializeCareer, serializeCareer } from '../career/persistence.js';
import {
  createScoutingState,
  creditOwnSquad,
  knowledgeOf,
  scoutCapacity,
  scoutedPotential,
  SCOUTING_TUNING,
} from '../world/scouting.js';
import { createWorld } from '../world/index.js';
import { currentAbility } from '../world/players.js';
import { marketValue } from '../economy/valuation.js';

function playSeason(career: Career): void {
  let guard = 0;
  while (!isSeasonComplete(career) && guard++ < 60) advanceRound(career);
}

describe('scoutedPotential', () => {
  const world = createWorld({ seed: 'scout' });
  const player = world.leagues[0]!.clubs[0]!.squad[0]!;

  it('never reveals the true number, but brackets it sensibly', () => {
    const state = createScoutingState();
    const report = scoutedPotential(world.seed, state, player);

    expect(report.low).toBeLessThanOrEqual(report.estimate);
    expect(report.estimate).toBeLessThanOrEqual(report.high);
    // You can always see what a player already does.
    expect(report.low).toBeGreaterThanOrEqual(Math.floor(currentAbility(player)));
    expect(report.high).toBeLessThanOrEqual(99);
  });

  it('is stable: reading it twice gives the same answer', () => {
    const state = createScoutingState();
    const a = scoutedPotential(world.seed, state, player);
    const b = scoutedPotential(world.seed, state, player);
    expect(a).toEqual(b);
  });

  it('narrows onto the truth as knowledge grows, without jumping about', () => {
    const state = createScoutingState();
    const widths: number[] = [];
    const estimates: number[] = [];

    for (const knowledge of [0, 3, 6, 12, 30]) {
      state.reports[player.id] = { playerId: player.id, knowledge, updatedSeason: 1 };
      const report = scoutedPotential(world.seed, state, player);
      widths.push(report.high - report.low);
      estimates.push(report.estimate);
    }

    // Strictly tightening.
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]!).toBeLessThan(widths[i - 1]!);
    }
    // And converging on the real value rather than wandering.
    const err = (e: number) => Math.abs(e - player.hiddenPotential);
    expect(err(estimates[estimates.length - 1]!)).toBeLessThanOrEqual(err(estimates[0]!));
  });

  it('is nearly exact once a player is thoroughly known', () => {
    const state = createScoutingState();
    state.reports[player.id] = { playerId: player.id, knowledge: 100, updatedSeason: 1 };
    const report = scoutedPotential(world.seed, state, player);

    expect(Math.abs(report.estimate - player.hiddenPotential)).toBeLessThanOrEqual(
      SCOUTING_TUNING.sigmaFloor + 1,
    );
    expect(report.confidence).toBeGreaterThan(0.9);
  });

  it('is vague about a stranger', () => {
    const state = createScoutingState();
    const report = scoutedPotential(world.seed, state, player);
    expect(report.confidence).toBeLessThan(0.15);
    expect(report.label).toBe('Unknown quantity');
  });

  it('gives different players different blind spots', () => {
    const state = createScoutingState();
    const errors = world.leagues[0]!.clubs[0]!.squad.map((p) => {
      const r = scoutedPotential(world.seed, state, p);
      return r.estimate - p.hiddenPotential;
    });
    // Not all biased the same way -- some look better than they are, some worse.
    expect(errors.some((e) => e > 0)).toBe(true);
    expect(errors.some((e) => e < 0)).toBe(true);
  });
});

describe('scouting and the career', () => {
  it('never advances the career RNG when a report is read', () => {
    /*
     * This is the property the whole design hangs on. Reports are read on every
     * render, so if reading one consumed randomness, opening the squad screen
     * would change next week's results.
     */
    const career = startCareer({ seed: 'scout-rng' });
    const before = career.rng.getState();

    for (const player of managedClub(career).squad) {
      scoutReport(career, player);
      scoutValuation(career, player);
    }

    expect(career.rng.getState()).toBe(before);
  });

  it('learns more about players who actually play', () => {
    const career = startCareer({ seed: 'scout-minutes' });
    const club = managedClub(career);
    playSeason(career);

    const ranked = [...club.squad].sort((a, b) => b.status.minutes - a.status.minutes);
    const regular = ranked[0]!;
    const unused = ranked[ranked.length - 1]!;
    expect(regular.status.minutes).toBeGreaterThan(unused.status.minutes);

    endSeason(career);

    expect(knowledgeOf(career.scouting, regular.id)).toBeGreaterThan(
      knowledgeOf(career.scouting, unused.id),
    );
    // And that shows up as a tighter read on the one who played.
    const regularReport = scoutReport(career, regular);
    const unusedReport = scoutReport(career, unused);
    expect(regularReport.high - regularReport.low).toBeLessThan(
      unusedReport.high - unusedReport.low,
    );
  });

  it('learns about opponents by facing them', () => {
    const career = startCareer({ seed: 'scout-opponents' });
    const before = Object.keys(career.scouting.reports).length;
    playSeason(career);
    const after = Object.keys(career.scouting.reports).length;

    // Started knowing only your own squad; a season of fixtures adds the rest.
    expect(before).toBeLessThan(30);
    expect(after).toBeGreaterThan(before * 3);
  });

  it('keeps reports across a save, and drops players who have left', () => {
    const career = startCareer({ seed: 'scout-save' });
    playSeason(career);
    endSeason(career);
    startNextSeason(career);

    const loaded = deserializeCareer(serializeCareer(career));
    expect(Object.keys(loaded.scouting.reports).length).toBe(
      Object.keys(career.scouting.reports).length,
    );

    // Nothing is remembered about a player who no longer exists.
    for (const id of Object.keys(loaded.scouting.reports)) {
      expect(loaded.world.players.has(id)).toBe(true);
    }
  });

  it('upgrades a save written before scouting existed', () => {
    const career = startCareer({ seed: 'scout-migrate' });
    const saved = JSON.parse(serializeCareer(career));

    /*
     * Wind it back to the real version 1 shape: no scouting, and every player
     * carrying `potential` rather than `hiddenPotential`. Deleting `scouting`
     * alone is not enough -- doing only that produced a test that passed while
     * a genuine v1 save broke, because the players already had the new field.
     */
    delete saved.scouting;
    saved.version = 1;
    for (const club of saved.clubs) {
      for (const player of club.squad) {
        player.potential = player.hiddenPotential;
        delete player.hiddenPotential;
      }
    }

    const loaded = deserializeCareer(JSON.stringify(saved));
    expect(loaded.scouting.reports).toEqual({});

    for (const club of loaded.world.leagues[0]!.clubs) {
      for (const player of club.squad) {
        expect(player.hiddenPotential, player.displayName).toBeGreaterThan(0);
        // The number the whole economy is priced off must survive the upgrade.
        expect(Number.isFinite(marketValue(player))).toBe(true);
      }
    }

    const report = scoutReport(loaded, managedClub(loaded).squad[0]!);
    expect(Number.isFinite(report.estimate)).toBe(true);
    expect(() => advanceRound(loaded)).not.toThrow();
  });
});

describe('scoutedValue', () => {
  it('differs from the market price, because your read differs from the market\'s', () => {
    const career = startCareer({ seed: 'scout-value' });
    const squad = managedClub(career).squad;

    const gaps = squad.map((p) => scoutValuation(career, p) - marketValue(p));
    // Some look like bargains on your reading, some like traps.
    expect(gaps.some((g) => g > 0)).toBe(true);
    expect(gaps.some((g) => g < 0)).toBe(true);
  });
});


describe('scout assignments', () => {
  /**
   * A young player at another club: knowledge starts at zero, and his ceiling is
   * far enough above what he already does that the band is not pinned against
   * either end of the scale.
   */
  function prospect(career: Career) {
    for (const club of career.world.leagues[0]!.clubs) {
      if (club.id === career.managedClubId) continue;
      const young = club.squad.find((p) => p.age <= 20);
      if (young) return young;
    }
    throw new Error('no prospect in the world');
  }

  it('narrows the band on a player you send a scout to watch', () => {
    const career = startCareer({ seed: 'scout-assign', managedClubId: 'c1' });
    const target = prospect(career);

    const before = scoutReport(career, target);
    expect(scoutPlayer(career, target.id)).toBe(true);
    const after = scoutReport(career, target);

    expect(after.high - after.low).toBeLessThan(before.high - before.low);
    expect(after.confidence).toBeGreaterThan(before.confidence);
  });

  it('runs out, so who you watch is a decision', () => {
    const career = startCareer({ seed: 'scout-capacity', managedClubId: 'c1' });
    const capacity = scoutCapacity(managedClub(career).reputation);
    expect(scoutsAvailable(career)).toBe(capacity);

    const rival = career.world.leagues[0]!.clubs.find((c) => c.id !== career.managedClubId)!;
    for (let i = 0; i < capacity; i++) {
      expect(scoutPlayer(career, rival.squad[i]!.id)).toBe(true);
    }

    expect(scoutsAvailable(career)).toBe(0);
    // The one player too many is refused, and costs nothing.
    const overflow = rival.squad[capacity]!;
    expect(scoutPlayer(career, overflow.id)).toBe(false);
    expect(knowledgeOf(career.scouting, overflow.id)).toBe(0);
  });

  it('gives a bigger club more scouts than a small one', () => {
    const clubs = createWorld({ seed: 'scout-reputation' }).leagues[0]!.clubs;
    const weakest = clubs.reduce((a, b) => (a.reputation <= b.reputation ? a : b));
    const strongest = clubs.reduce((a, b) => (a.reputation >= b.reputation ? a : b));
    expect(scoutCapacity(strongest.reputation)).toBeGreaterThan(
      scoutCapacity(weakest.reputation),
    );
  });

  it('refuses a player who does not exist rather than spending capacity', () => {
    const career = startCareer({ seed: 'scout-missing', managedClubId: 'c1' });
    expect(scoutPlayer(career, 'nobody')).toBe(false);
    expect(scoutsAvailable(career)).toBe(scoutCapacity(managedClub(career).reputation));
  });

  it('refreshes the allowance each season', () => {
    const career = startCareer({ seed: 'scout-refresh', managedClubId: 'c1' });
    const rival = career.world.leagues[0]!.clubs.find((c) => c.id !== career.managedClubId)!;
    scoutPlayer(career, rival.squad[0]!.id);
    expect(scoutsAvailable(career)).toBeLessThan(scoutCapacity(managedClub(career).reputation));

    playSeason(career);
    endSeason(career);
    startNextSeason(career);

    expect(scoutsAvailable(career)).toBe(scoutCapacity(managedClub(career).reputation));
  });

  it('survives a save, spent capacity included', () => {
    const career = startCareer({ seed: 'scout-save', managedClubId: 'c1' });
    const target = prospect(career);
    scoutPlayer(career, target.id);

    const restored = deserializeCareer(serializeCareer(career));

    expect(restored.scouting.capacityUsed).toBe(career.scouting.capacityUsed);
    expect(scoutsAvailable(restored)).toBe(scoutsAvailable(career));
    expect(scoutReport(restored, restored.world.players.get(target.id)!)).toEqual(
      scoutReport(career, target),
    );
  });

  it('upgrades a save written before scouts had a budget', () => {
    const career = startCareer({ seed: 'scout-capacity-migrate', managedClubId: 'c1' });
    const saved = JSON.parse(serializeCareer(career));
    delete saved.scouting.capacityUsed;
    saved.version = 4;

    const loaded = deserializeCareer(JSON.stringify(saved));
    // A career mid-flight gets a full allowance rather than NaN scouts left.
    expect(loaded.scouting.capacityUsed).toBe(0);
    expect(scoutsAvailable(loaded)).toBe(scoutCapacity(managedClub(loaded).reputation));
  });

  it('never touches the career generator, so scouting cannot change results', () => {
    const career = startCareer({ seed: 'scout-purity', managedClubId: 'c1' });
    const rival = career.world.leagues[0]!.clubs.find((c) => c.id !== career.managedClubId)!;
    const state = career.rng.getState();

    scoutPlayer(career, rival.squad[0]!.id);
    scoutReport(career, rival.squad[0]!);
    scoutValuation(career, rival.squad[0]!);

    expect(career.rng.getState()).toEqual(state);
  });
});
