import { beforeAll, describe, expect, it } from 'vitest';
import { validateEngine, type ValidationReport } from '../analysis/validate.js';
import { validateEconomy, type EconomyReport } from '../analysis/economy.js';

/**
 * Guards the match engine's calibration. These are wider than the tolerances in
 * BENCHMARKS because this runs few seasons and so is noisier -- the point is to
 * catch a tuning change that breaks the engine's shape, not to replace
 * `pnpm sim validate`, which is the real calibration tool.
 *
 * Every assertion here is deliberately TWO-SIDED. One-sided guards let half the
 * failure space through: the money supply once collapsed to a negative number
 * and the suite stayed green because the only assertion was an upper bound.
 */
describe('engine calibration', () => {
  let report: ValidationReport;
  // In beforeAll, not the describe body, or this runs during collection -- where
  // it cannot be skipped by a filter and a throw reads as a collection error.
  beforeAll(() => {
    report = validateEngine({ seasons: 10, seed: 'calibration-test' });
  });

  it('produces a realistic number of goals', () => {
    expect(report.metrics.goalsPerMatch).toBeGreaterThan(2.4);
    expect(report.metrics.goalsPerMatch).toBeLessThan(3.1);
  });

  it('gives the home side an advantage without making it decisive', () => {
    expect(report.metrics.homeWinPct).toBeGreaterThan(40);
    expect(report.metrics.homeWinPct).toBeLessThan(50);
    expect(report.metrics.homeGoalsPerMatch).toBeGreaterThan(report.metrics.awayGoalsPerMatch!);
  });

  it('draws a realistic share of matches', () => {
    expect(report.metrics.drawPct).toBeGreaterThan(19);
    expect(report.metrics.drawPct).toBeLessThan(30);
  });

  it('keeps blowouts rare without eliminating them', () => {
    expect(report.metrics.blowoutPct).toBeGreaterThan(2);
    expect(report.metrics.blowoutPct).toBeLessThan(8);
  });

  it('books and sends off players at roughly the real rate', () => {
    expect(report.metrics.yellowsPerMatch).toBeGreaterThan(2.5);
    expect(report.metrics.yellowsPerMatch).toBeLessThan(5.5);
    // Second yellows dominate this number: pick offenders uniformly and it lands
    // several times too high. The lower bound matters just as much -- a league
    // with no sendings off at all is not a football league.
    expect(report.metrics.redsPerMatch).toBeGreaterThan(0.02);
    expect(report.metrics.redsPerMatch).toBeLessThan(0.25);
  });

  it('injures and rotates players at a plausible rate', () => {
    expect(report.metrics.injuriesPerClubSeason).toBeGreaterThan(5);
    expect(report.metrics.injuriesPerClubSeason).toBeLessThan(22);
    expect(report.metrics.playersUsedPerClub).toBeGreaterThan(15);
    expect(report.metrics.playersUsedPerClub).toBeLessThan(30);
    expect(report.metrics.subsPerMatch).toBeGreaterThan(5);
    expect(report.metrics.subsPerMatch).toBeLessThan(10.1);
    // Squad depth has to matter: the same eleven cannot play every minute, and
    // equally a side that never settles on an eleven is not being managed.
    expect(report.metrics.topElevenMinuteShare).toBeGreaterThan(55);
    expect(report.metrics.topElevenMinuteShare).toBeLessThan(88);
  });

  it('rewards stronger squads without making the league deterministic', () => {
    expect(report.strengthPositionCorrelation).toBeGreaterThan(0.7);
    expect(report.strengthPositionCorrelation).toBeLessThan(0.93);
  });
});

/**
 * Guards the economy against the failures that actually happened while building
 * it: a frozen transfer market, clubs printing money, and youth intake pitched
 * too low so the whole league quietly decayed over a career.
 */
describe('economy calibration', () => {
  let report: EconomyReport;
  beforeAll(() => {
    report = validateEconomy({ seasons: 15, seed: 'calibration-economy' });
  });

  it('keeps wages a realistic share of revenue', () => {
    expect(report.metrics.wageToRevenuePct).toBeGreaterThan(45);
    expect(report.metrics.wageToRevenuePct).toBeLessThan(75);
  });

  it('keeps the transfer market moving without churning', () => {
    expect(report.metrics.transfersPerWindow).toBeGreaterThan(8);
    expect(report.metrics.transfersPerWindow).toBeLessThan(60);
  });

  it('neither prints nor burns money', () => {
    // The level oscillates; the drift is what says whether the economy is stable.
    expect(report.metrics.cashToRevenuePct).toBeGreaterThan(-40);
    expect(report.metrics.cashToRevenuePct).toBeLessThan(120);
    expect(Math.abs(report.metrics.cashDriftPct!)).toBeLessThan(45);
  });

  it('keeps clubs solvent enough to function', () => {
    expect(report.metrics.clubsInDebtPct).toBeGreaterThanOrEqual(0);
    expect(report.metrics.clubsInDebtPct).toBeLessThan(45);
  });

  it('does not let one club hoard the talent, or flatten the league', () => {
    expect(report.metrics.topTalentShare).toBeGreaterThan(4);
    expect(report.metrics.topTalentShare).toBeLessThan(35);
    expect(report.metrics.titleDominancePct).toBeGreaterThan(8);
    expect(report.metrics.titleDominancePct).toBeLessThan(65);
    expect(report.metrics.squadValueRatio).toBeGreaterThan(1.2);
    expect(report.metrics.squadValueRatio).toBeLessThan(8);
  });

  it('holds league quality steady across a career', () => {
    // The decay bug this catches was invisible in a single season: youth were
    // generated below the standard of the players they replaced.
    expect(report.metrics.talentDriftPct).toBeGreaterThan(92);
    expect(report.metrics.talentDriftPct).toBeLessThan(108);
  });

  it('makes playing time the thing that develops a prospect', () => {
    // If this gap closes, giving a young player games has stopped being a
    // decision worth making.
    expect(report.metrics.youthDevelopmentGap).toBeGreaterThan(1);
    expect(report.metrics.youthDevelopmentGap).toBeLessThan(6);
    expect(report.metrics.regularYouthGain).toBeGreaterThan(2);
    expect(report.metrics.regularYouthGain).toBeLessThan(9);
    expect(report.metrics.veteranDecline).toBeGreaterThan(-6);
    expect(report.metrics.veteranDecline).toBeLessThan(0);
  });

  it('keeps squads full and sensibly aged', () => {
    expect(report.metrics.avgSquadSize).toBeGreaterThan(21);
    expect(report.metrics.avgSquadSize).toBeLessThan(31);
    expect(report.metrics.avgSquadAge).toBeGreaterThan(23);
    expect(report.metrics.avgSquadAge).toBeLessThan(28);
  });
});

/**
 * The calibration tests above run on their own fixed seeds. That is exactly how
 * `cashToRevenuePct` came to fail on the default CLI seed while `pnpm test`
 * stayed green -- a metric can sit inside tolerance on one seed and outside it
 * on another. This sweep makes every benchmark answer for itself across several
 * worlds, including the seed the CLI actually defaults to.
 */
describe('multi-seed calibration sweep', () => {
  const seeds = ['economy', 'sweep-a', 'sweep-b'];
  let reports: { seed: string; report: EconomyReport }[];

  beforeAll(() => {
    reports = seeds.map((seed) => ({ seed, report: validateEconomy({ seasons: 15, seed }) }));
  });

  it('passes every economy benchmark on every seed', () => {
    const failures: string[] = [];
    for (const { seed, report } of reports) {
      for (const check of report.checks) {
        if (!check.pass) {
          failures.push(
            `${seed}: ${check.benchmark.label} = ${check.value.toFixed(2)} ` +
              `(want ${check.benchmark.target} +/- ${check.benchmark.tolerance})`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('holds league quality steady on every seed', () => {
    for (const { seed, report } of reports) {
      expect(report.metrics.talentDriftPct, seed).toBeGreaterThan(92);
      expect(report.metrics.talentDriftPct, seed).toBeLessThan(108);
    }
  });
});
