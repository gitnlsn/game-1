import { describe, expect, it } from 'vitest';
import { validateEngine } from '../analysis/validate.js';
import { validateEconomy } from '../analysis/economy.js';

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

/**
 * Guards the economy against the failures that actually happened while building
 * it: a frozen transfer market, clubs printing money, and youth intake pitched
 * too low so the whole league quietly decayed over a career.
 */
describe('economy calibration', () => {
  const report = validateEconomy({ seasons: 15, seed: 'calibration-economy' });

  it('keeps wages a realistic share of revenue', () => {
    expect(report.metrics.wageToRevenuePct).toBeGreaterThan(45);
    expect(report.metrics.wageToRevenuePct).toBeLessThan(75);
  });

  it('keeps the transfer market moving', () => {
    expect(report.metrics.transfersPerWindow).toBeGreaterThan(8);
  });

  it('does not let the league print money', () => {
    expect(report.metrics.cashToRevenuePct).toBeLessThan(120);
  });

  it('does not let one club hoard the talent', () => {
    expect(report.metrics.topTalentShare).toBeLessThan(35);
    expect(report.metrics.titleDominancePct).toBeLessThan(65);
  });

  it('holds league quality steady across a career', () => {
    // The decay bug this catches was invisible in a single season: youth were
    // generated below the standard of the players they replaced.
    expect(report.metrics.talentDriftPct).toBeGreaterThan(92);
    expect(report.metrics.talentDriftPct).toBeLessThan(108);
  });

  it('keeps squads full and sensibly aged', () => {
    expect(report.metrics.avgSquadSize).toBeGreaterThan(21);
    expect(report.metrics.avgSquadAge).toBeGreaterThan(23);
    expect(report.metrics.avgSquadAge).toBeLessThan(28);
  });
});
