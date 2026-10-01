import { describe, expect, it } from 'vitest';
import { Rng } from '../rng/index.js';
import {
  agePlayerKeepingAbility,
  developPlayer,
  developStep,
  exactAbility,
  TRAINING_FOCUS_KEYS,
} from '../career/aging.js';
import {
  advanceRound,
  endSeason,
  isSeasonComplete,
  leagueWeeks,
  managedClub,
  progressionOf,
  seasonChange,
  setTrainingFocus,
  startCareer,
  startNextSeason,
  trainingFocus,
  type Career,
} from '../career/controller.js';
import { deserializeCareer, serializeCareer } from '../career/persistence.js';
import { createWorld, allClubs } from '../world/index.js';
import { currentAbility } from '../world/players.js';
import type { Player } from '../types.js';

function players(seed: string): Player[] {
  const world = createWorld({ seed, divisions: 2 });
  return allClubs(world).flatMap((club) => club.squad);
}

const clone = (p: Player): Player => JSON.parse(JSON.stringify(p));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('developing through the season', () => {
  it('lands on average where a single end-of-season step does', () => {
    const pool = players('steps-vs-once');
    const once: number[] = [];
    const steps: number[] = [];
    const rngOnce = new Rng('once');
    const rngSteps = new Rng('steps');

    for (const base of pool) {
      const context = { minutes: 2400, seasonMatches: 38, coaching: 1 };
      const a = clone(base);
      developPlayer(rngOnce, a, context);
      once.push(currentAbility(a) - currentAbility(base));

      const b = clone(base);
      for (let i = 0; i < 10; i++) developStep(rngSteps, b, { ...context, fraction: 0.1 });
      agePlayerKeepingAbility(b, context);
      steps.push(exactAbility(b) - currentAbility(base));
    }

    expect(Math.abs(mean(steps) - mean(once))).toBeLessThan(0.35);
    const young = pool.map((p, i) => ({ p, i })).filter(({ p }) => p.age <= 20);
    expect(
      Math.abs(mean(young.map(({ i }) => steps[i]!)) - mean(young.map(({ i }) => once[i]!))),
    ).toBeLessThan(0.6);
  });

  it('keeps growth too small for a whole attribute point instead of losing it', () => {
    const player = clone(players('carry').find((p) => p.age <= 19)!);
    const rng = new Rng('carry');
    let expected = exactAbility(player);
    for (let i = 0; i < 20; i++) {
      expected += developStep(rng, player, { minutes: 3000, seasonMatches: 38, coaching: 1, fraction: 0.05 });
      expect(exactAbility(player)).toBeCloseTo(expected, 1);
    }
  });

  it('ageing at the close season changes his shape but not his level', () => {
    const veteran = clone(players('age-shape').find((p) => p.age >= 31)!);
    const before = exactAbility(veteran);
    agePlayerKeepingAbility(veteran);
    expect(exactAbility(veteran)).toBeCloseTo(before, 1);
  });
});

describe('training focus', () => {
  it('puts growth into the focused attributes without changing how much he grows', () => {
    const pool = players('focus').filter((p) => p.age <= 20 && p.position === 'ST');
    const focused: number[] = [];
    const balanced: number[] = [];
    let focusedKeyGain = 0;
    let balancedKeyGain = 0;

    for (const base of pool) {
      const context = { minutes: 3000, seasonMatches: 38, coaching: 1 };
      const f = clone(base);
      const b = clone(base);
      const rngF = new Rng(`f:${base.id}`);
      const rngB = new Rng(`f:${base.id}`);
      for (let i = 0; i < 10; i++) {
        developStep(rngF, f, { ...context, fraction: 0.1, focus: 'passing' });
        developStep(rngB, b, { ...context, fraction: 0.1 });
      }
      focused.push(exactAbility(f) - exactAbility(base));
      balanced.push(exactAbility(b) - exactAbility(base));
      focusedKeyGain += f.attributes.passing - base.attributes.passing;
      balancedKeyGain += b.attributes.passing - base.attributes.passing;
    }

    expect(pool.length).toBeGreaterThan(3);
    expect(focusedKeyGain).toBeGreaterThan(balancedKeyGain);
    // Passing is not a striker's attribute, so part of his growth goes there.
    expect(mean(focused)).toBeLessThanOrEqual(mean(balanced) + 0.01);
    expect(mean(focused)).toBeGreaterThan(mean(balanced) * 0.5);
  });

  it('every focus names real attributes', () => {
    for (const keys of Object.values(TRAINING_FOCUS_KEYS)) {
      for (const key of keys) expect(players('keys')[0]!.attributes[key]).toBeTypeOf('number');
    }
  });
});

function playRounds(career: Career, rounds: number): void {
  for (let i = 0; i < rounds && !isSeasonComplete(career); i++) advanceRound(career);
}

describe('in a career', () => {
  it('develops players every few weeks and draws their curve', () => {
    const c = startCareer({ seed: 'career-dev', divisions: 1, cup: false });
    const player = managedClub(c).squad[0]!;
    expect(progressionOf(c, player.id)).toHaveLength(1);

    playRounds(c, 8);
    expect(c.developedWeeks).toBe(8);
    expect(progressionOf(c, player.id).length).toBe(3);
    expect(seasonChange(c, player)).toBeDefined();
  });

  it('finishes the season fully developed and starts the next at zero', () => {
    const c = startCareer({ seed: 'career-season', divisions: 1, cup: false });
    playRounds(c, 60);
    endSeason(c);
    expect(c.developedWeeks).toBe(leagueWeeks(c.season).total);
    startNextSeason(c);
    expect(c.developedWeeks).toBe(0);
  });

  it('keeps youth development inside the benchmark range', () => {
    const c = startCareer({ seed: 'career-bench', divisions: 2, cup: true });
    const gains: number[] = [];
    for (let season = 0; season < 2; season++) {
      playRounds(c, 80);
      const summary = endSeason(c);
      gains.push(summary.development.regularYouthGain);
      startNextSeason(c);
    }
    // The harness benchmark is 4 ± 3.
    expect(mean(gains)).toBeGreaterThan(1);
    expect(mean(gains)).toBeLessThan(7);
  });

  it('only your own players can be given a focus, and it survives a save', () => {
    const c = startCareer({ seed: 'career-focus', divisions: 1, cup: false });
    const own = managedClub(c).squad[0]!;
    const other = allClubs(c.world).find((club) => club.id !== c.managedClubId)!.squad[0]!;

    expect(setTrainingFocus(c, own.id, 'finishing')).toBe(true);
    expect(setTrainingFocus(c, other.id, 'finishing')).toBe(false);

    playRounds(c, 4);
    const loaded = deserializeCareer(serializeCareer(c));
    expect(trainingFocus(loaded, own.id)).toBe('finishing');
    expect(progressionOf(loaded, own.id)).toEqual(progressionOf(c, own.id));
    expect(loaded.developedWeeks).toBe(c.developedWeeks);
  });

  it('a step does not touch the career generator', () => {
    const c = startCareer({ seed: 'career-rng', divisions: 1, cup: false });
    playRounds(c, 3);
    const a = deserializeCareer(serializeCareer(c));
    const b = deserializeCareer(serializeCareer(c));
    setTrainingFocus(b, managedClub(b).squad[0]!.id, 'physical');
    advanceRound(a);
    advanceRound(b);
    // Same draw from the career generator either way; only attributes differ.
    expect(a.rng.getState()).toBe(b.rng.getState());
  });
});
