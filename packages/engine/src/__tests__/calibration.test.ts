import { describe, expect, it } from 'vitest';
import { validateEngine } from '../analysis/validate.js';

/**
 * Guards the match engine's calibration. These are wider than the tolerances in
 * BENCHMARKS because this runs few seasons and so is noisier -- the point is to
 * catch a tuning change that breaks the engine's shape, not to replace
 * `pnpm sim validate`, which is the real calibration tool.
 */
describe('engine calibration', () => {
  const report = validateEngine({ seasons: 10, seed: 'calibration-test' });

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

  it('keeps blowouts rare', () => {
    expect(report.metrics.blowoutPct).toBeLessThan(8);
  });

  it('rewards stronger squads without making the league deterministic', () => {
    expect(report.strengthPositionCorrelation).toBeGreaterThan(0.7);
    expect(report.strengthPositionCorrelation).toBeLessThan(0.93);
  });
});
