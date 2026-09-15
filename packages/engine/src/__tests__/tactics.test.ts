import { beforeAll, describe, expect, it } from 'vitest';
import { Rng } from '../rng/index.js';
import { simulateMatch } from '../match/engine.js';
import {
  BALANCED,
  describeTactics,
  isBalanced,
  resolveTactics,
  tacticShapes,
  TACTIC_AXES,
  type Tactics,
} from '../match/tactics.js';
import {
  TACTIC_DOMINANCE,
  TACTIC_SETTINGS,
  validateTactics,
  type TacticsReport,
} from '../analysis/tactics.js';
import { createWorld } from '../world/index.js';
import { DEFAULT_FORMATION, FORMATIONS } from '../world/positions.js';
import {
  startCareer,
  currentTeamSheet,
  setTactics,
  setTeamSheet,
  tactics as readTactics,
} from '../career/controller.js';
import { deserializeCareer, serializeCareer } from '../career/persistence.js';
import type { Club, TeamSheet } from '../types.js';

function sheet(clubId: string, t?: Tactics): TeamSheet {
  return {
    clubId,
    formation: DEFAULT_FORMATION,
    starters: new Array<string | undefined>(FORMATIONS[DEFAULT_FORMATION]!.length).fill(undefined),
    bench: [],
    ...(t ? { tactics: t } : {}),
  };
}

describe('tactics', () => {
  it('clamps anything a caller hands it, and fills in what they left out', () => {
    expect(resolveTactics(undefined)).toEqual(BALANCED);
    expect(resolveTactics({ mentality: 99 }).mentality).toBe(2);
    expect(resolveTactics({ mentality: -99 }).mentality).toBe(-2);
    // An axis nobody set is balanced, not undefined.
    expect(resolveTactics({ mentality: 1 }).width).toBe(0);
  });

  it('describes a set-up in words, so a screen has something to print', () => {
    expect(describeTactics(BALANCED)).toBe('Balanced');
    expect(describeTactics({ ...BALANCED, mentality: 2 })).toBe('Very attacking');
    expect(describeTactics({ ...BALANCED, tempo: -1 })).toBe('Patient');
    expect(describeTactics({ ...BALANCED, mentality: 1, width: 2 })).toBe('Attacking, Very wide');
    expect(isBalanced(BALANCED)).toBe(true);
  });

  /*
   * The load-bearing test. Every effect is a multiplier that is exactly 1 at 0,
   * so a sheet with no instructions has to produce a bit-identical match -- which
   * is what lets the validator digests stay put across this whole feature.
   */
  /*
   * The load-bearing assertion of the whole feature. Everything else rests on
   * Balanced being neutral: it is why both validator digests are byte-identical
   * across this change, and why a save written before tactics existed plays the
   * same. Asserting it on the shaping function rather than on a simulated match
   * is what makes it airtight -- comparing a Balanced sheet against no sheet at
   * all passes happily even if Balanced stops being neutral, because BOTH paths
   * go through the same non-neutral default.
   */
  it('is exactly neutral at Balanced', () => {
    expect(BALANCED).toEqual({ mentality: 0, tempo: 0, pressing: 0, width: 0 });

    const shapes = tacticShapes(BALANCED);
    expect(shapes.attack).toBe(1);
    expect(shapes.defence).toBe(1);
    expect(shapes.control).toBe(1);
    expect(shapes.shot).toBe(1);
    expect(shapes.aerialShift).toBe(0);
    expect(shapes.fatigueLoad).toBe(0);
  });

  it('pays for everything it buys', () => {
    const attacking = tacticShapes({ ...BALANCED, mentality: 2 });
    expect(attacking.attack).toBeGreaterThan(1);
    expect(attacking.defence).toBeLessThan(1);

    const pressing = tacticShapes({ ...BALANCED, pressing: 2 });
    expect(pressing.control).toBeGreaterThan(1);
    expect(pressing.defence).toBeLessThan(1);
    expect(pressing.fatigueLoad).toBeGreaterThan(0);

    const direct = tacticShapes({ ...BALANCED, tempo: 2 });
    expect(direct.shot).toBeGreaterThan(1);
    expect(direct.control).toBeLessThan(1);

    // Width is the one axis that trades nothing: it changes which players the
    // chances suit, which is a question about your squad rather than about risk.
    const wide = tacticShapes({ ...BALANCED, width: 2 });
    expect(wide.aerialShift).toBeGreaterThan(0);
    expect(wide.attack).toBe(1);
    expect(wide.defence).toBe(1);
  });

  it('changes nothing at all when nobody has set any', () => {
    const world = createWorld({ seed: 'tactics-noop' });
    const [home, away] = world.leagues[0]!.clubs as [Club, Club];

    for (const seed of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']) {
      const without = simulateMatch(new Rng(seed), home, away);
      const withBalanced = simulateMatch(new Rng(seed), home, away, {
        homeSheet: sheet(home.id, BALANCED),
        awaySheet: sheet(away.id, BALANCED),
      });

      // The whole event list, not just the score: a difference anywhere in the
      // match is a difference, even one the scoreline happens to absorb.
      expect(withBalanced, seed).toEqual(without);
    }
  });

  it('leaves the generator in the same place, so nothing downstream shifts', () => {
    /*
     * Scaling a probability is free -- `chance` draws once whatever the rate --
     * but only while the rate is unchanged. This is the guarantee the validator
     * digests rest on: a Balanced side consumes the generator identically, so
     * every match after this one in a season plays out the same too.
     *
     * Note the narrowness of the claim. Once a setting is NOT balanced, outcomes
     * change and later draw counts diverge with them; that is correct, and it is
     * why no AI club is given instructions.
     */
    const world = createWorld({ seed: 'tactics-state' });
    const [home, away] = world.leagues[0]!.clubs as [Club, Club];

    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const bare = new Rng(seed);
      simulateMatch(bare, home, away);

      const instructed = new Rng(seed);
      simulateMatch(instructed, home, away, {
        homeSheet: sheet(home.id, BALANCED),
        awaySheet: sheet(away.id, BALANCED),
      });

      expect(instructed.getState(), seed).toBe(bare.getState());
    }
  });

  it('actually changes how a side plays', () => {
    const world = createWorld({ seed: 'tactics-effect' });
    const [home, away] = world.leagues[0]!.clubs as [Club, Club];

    let balancedPossession = 0;
    let pressingPossession = 0;
    for (let i = 0; i < 40; i++) {
      balancedPossession += simulateMatch(new Rng(`p${i}`), home, away).home.possession;
      pressingPossession += simulateMatch(new Rng(`p${i}`), home, away, {
        homeSheet: sheet(home.id, { ...BALANCED, pressing: 2 }),
      }).home.possession;
    }
    expect(pressingPossession).toBeGreaterThan(balancedPossession);
  });

  it('keeps the manager\'s instructions across a save', () => {
    const career = startCareer({ seed: 'tactics-save', managedClubId: 'c1' });
    setTactics(career, { mentality: 2, width: -1 });

    const restored = deserializeCareer(serializeCareer(career));

    expect(readTactics(restored)).toEqual({ mentality: 2, tempo: 0, pressing: 0, width: -1 });
    expect(currentTeamSheet(restored).tactics).toEqual(readTactics(restored));
  });

  it('survives the eleven being saved over it', () => {
    /*
     * The failure this pins actually happened: the selection screen writes the
     * sheet at kick-off from a draft it built before the manager touched the
     * instructions, so the instructions were wiped every single match and the
     * club screen read "Balanced" again the moment the game reloaded.
     */
    const career = startCareer({ seed: 'tactics-clobber', managedClubId: 'c1' });
    setTactics(career, { mentality: 2, pressing: 2 });

    const withoutTactics = { ...currentTeamSheet(career) };
    delete withoutTactics.tactics;
    setTeamSheet(career, withoutTactics);

    expect(readTactics(career)).toEqual({ mentality: 2, tempo: 0, pressing: 2, width: 0 });
  });

  it('still lets a caller change them through the sheet', () => {
    const career = startCareer({ seed: 'tactics-explicit', managedClubId: 'c1' });
    setTactics(career, { mentality: 2 });
    setTeamSheet(career, { ...currentTeamSheet(career), tactics: resolveTactics({ width: -2 }) });

    expect(readTactics(career)).toEqual({ mentality: 0, tempo: 0, pressing: 0, width: -2 });
  });

  it('leaves the rest of the team sheet alone when only tactics change', () => {
    const career = startCareer({ seed: 'tactics-sheet', managedClubId: 'c1' });
    const before = currentTeamSheet(career);
    setTactics(career, { pressing: 2 });

    const after = currentTeamSheet(career);
    expect(after.starters).toEqual(before.starters);
    expect(after.formation).toBe(before.formation);
  });
});

/**
 * Tactics are only a decision if no setting is simply correct. This is slow
 * because it has to be: the effects are a few percent, and a few percent is not
 * measurable over a handful of matches.
 */
describe('no setting dominates', () => {
  let report: TacticsReport;
  beforeAll(() => {
    report = validateTactics({ seed: 'tactics-test', repeats: 10 });
  });

  it('offers no free wins and lays no traps', () => {
    const offenders = report.settings
      .filter((s) => s.ratio > TACTIC_DOMINANCE.ceiling || s.ratio < TACTIC_DOMINANCE.floor)
      .map((s) => `${s.label} at ${(s.ratio * 100).toFixed(1)}%`);
    expect(offenders).toEqual([]);
  });

  it('gives different squads different right answers', () => {
    // If one setting tops every squad it is not a choice, it is the correct move.
    expect(new Set(report.bestBySquad).size).toBeGreaterThan(1);
  });

  it('makes the axes play differently even where they are worth the same', () => {
    const find = (key: string) => report.settings.find((s) => s.key === key)!;
    // Direct football is higher-scoring at both ends; patient football is lower.
    expect(find('tempo+').goalsFor).toBeGreaterThan(find('tempo-').goalsFor);
    expect(find('tempo+').goalsAgainst).toBeGreaterThan(find('tempo-').goalsAgainst);
    // Attacking outscores defensive, and is scored against more.
    expect(find('mentality+').goalsFor).toBeGreaterThan(find('mentality-').goalsFor);
    expect(find('mentality+').goalsAgainst).toBeGreaterThan(find('mentality-').goalsAgainst);
  });

  it('covers every axis at both extremes', () => {
    expect(TACTIC_SETTINGS).toHaveLength(TACTIC_AXES.length * 2 + 1);
  });
});
