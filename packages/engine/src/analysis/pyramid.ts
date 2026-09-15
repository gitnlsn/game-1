import { Rng } from '../rng/index.js';
import type { Benchmark } from './validate.js';
import { closeSeason } from '../career/career.js';
import { createSeasonState, finaliseSeason, playRound } from '../league/season.js';
import { allClubs, createWorld } from '../world/index.js';
import { marketValue, wageBill } from '../economy/valuation.js';

/**
 * Benchmarks for a pyramid: whether promotion and relegation churn at a
 * believable rate, whether the divisions are recognisably different places, and
 * whether the lower one can pay its bills.
 *
 * Separate from `validateEconomy` on purpose. That harness measures one division
 * over a long career and is the calibration of record for the money; this one
 * measures what having more than one division does, and would only add noise to
 * the other if they were merged.
 */
export const PYRAMID_BENCHMARKS: readonly Benchmark[] = [
  /*
   * Clubs that change division and change straight back the next season. Too low
   * and the pyramid is two closed shops; too high and a division is a waiting
   * room.
   *
   * Target corrected from 33 to 40. 33 was taken from "roughly a third of
   * promoted clubs go straight back down", which is the promotion direction
   * ONLY -- this metric counts both, and a relegated club bouncing back up is if
   * anything more common, since it usually drops into a division weaker than it
   * is. The target was wrong for what is being measured, not the other way
   * round. Measured across five worlds over twenty seasons: 32.5 to 46.7,
   * mean 39.3.
   */
  { key: 'bounceBackPct', label: 'Change division again next season %', target: 40, tolerance: 14, decimals: 1 },
  /*
   * Horizon-dependent by nature -- more seasons, more clubs -- so it is only
   * meaningful read over the harness's default twenty. Measuring it short
   * produces failures that say nothing about the pyramid.
   */
  { key: 'topFlightTurnoverPct', label: 'Clubs to reach the top flight %', target: 80, tolerance: 18, decimals: 1 },
  /* The divisions have to be different places, or promotion is a formality. */
  { key: 'tierWageRatio', label: 'Wage bill, tier 1 vs tier 2', target: 2.8, tolerance: 1.4, decimals: 2 },
  { key: 'tierValueRatio', label: 'Squad value, tier 1 vs tier 2', target: 3.0, tolerance: 1.6, decimals: 2 },
  /* ...but the lower one still has to be able to run itself. */
  { key: 'tierDebtGapPct', label: 'Clubs in debt, tier 2 minus tier 1', target: 0, tolerance: 22, decimals: 1 },
  { key: 'lowerTierCashToRevenuePct', label: 'Tier 2 cash as % of revenue', target: 20, tolerance: 55, decimals: 1 },
  /* A knockout where the better side always wins is not worth playing. */
  { key: 'cupUpsetPct', label: 'Cup ties won by the smaller club %', target: 33, tolerance: 12, decimals: 1 },
  { key: 'cupWinnerFromLowerTierPct', label: 'Cups won from outside the top flight %', target: 12, tolerance: 12, decimals: 1 },
];

export interface PyramidOptions {
  seasons?: number;
  seed?: number | string;
  clubCount?: number;
  divisions?: number;
}

export interface PyramidReport {
  seasons: number;
  metrics: Record<string, number>;
  checks: { benchmark: Benchmark; value: number; pass: boolean }[];
  passed: boolean;
}

export function validatePyramid(options: PyramidOptions = {}): PyramidReport {
  const seasons = options.seasons ?? 20;
  const seed = options.seed ?? 'pyramid';
  const divisions = options.divisions ?? 2;

  const world = createWorld({
    seed,
    divisions,
    ...(options.clubCount !== undefined ? { clubCount: options.clubCount } : {}),
  });
  const rng = new Rng(`${seed}:career`);

  const everTopFlight = new Set(world.leagues[0]!.clubs.map((club) => club.id));
  const lastChangedIn = new Map<string, number>();
  let changes = 0;
  let bounces = 0;

  let cupTies = 0;
  let cupUpsets = 0;
  let cupsWonBelow = 0;
  let cupsPlayed = 0;

  // Sampled at the end of each season, so a one-off does not set the reading.
  const wageRatios: number[] = [];
  const valueRatios: number[] = [];
  const debtGaps: number[] = [];
  const lowerCashRatios: number[] = [];

  for (let season = 0; season < seasons; season++) {
    const state = createSeasonState(world, rng, { economy: true, playerState: true, cup: true });
    while (state.nextRound <= state.totalRounds) playRound(state);

    const reputations = new Map(allClubs(world).map((club) => [club.id, club.reputation]));
    const cup = state.cup;
    if (cup) {
      cupsPlayed++;
      for (const tie of cup.ties) {
        if (!tie.winnerClubId) continue;
        const home = reputations.get(tie.homeClubId) ?? 0;
        const away = reputations.get(tie.awayClubId) ?? 0;
        if (home === away) continue;
        cupTies++;
        const favourite = home > away ? tie.homeClubId : tie.awayClubId;
        if (tie.winnerClubId !== favourite) cupUpsets++;
      }
      const topFlight = new Set(world.leagues[0]!.clubs.map((club) => club.id));
      if (cup.winnerClubId && !topFlight.has(cup.winnerClubId)) cupsWonBelow++;
    }

    // Measured before the close season moves anybody, so a division's numbers
    // describe the clubs that actually played in it.
    const perTier = world.leagues.map((league) => ({
      wages: league.clubs.reduce((sum, club) => sum + wageBill(club.squad), 0) / league.clubs.length,
      value:
        league.clubs.reduce(
          (sum, club) => sum + club.squad.reduce((s, player) => s + marketValue(player), 0),
          0,
        ) / league.clubs.length,
      inDebtPct:
        (league.clubs.filter((club) => club.finances.balance < 0).length / league.clubs.length) * 100,
      cash: league.clubs.reduce((sum, club) => sum + club.finances.balance, 0) / league.clubs.length,
      revenue:
        league.clubs.reduce(
          (sum, club) =>
            sum +
            club.finances.season.gateReceipts +
            club.finances.season.sponsorship +
            club.finances.season.prizeMoney,
          0,
        ) / league.clubs.length,
    }));

    const [first, second] = perTier;
    if (first && second) {
      if (second.wages > 0) wageRatios.push(first.wages / second.wages);
      if (second.value > 0) valueRatios.push(first.value / second.value);
      debtGaps.push(second.inDebtPct - first.inDebtPct);
      if (second.revenue > 0) lowerCashRatios.push((second.cash / second.revenue) * 100);
    }

    const summary = closeSeason(world, rng, finaliseSeason(state));
    for (const change of summary.promotions) {
      changes++;
      if (lastChangedIn.get(change.clubId) === season - 1) bounces++;
      lastChangedIn.set(change.clubId, season);
    }
    for (const club of world.leagues[0]!.clubs) everTopFlight.add(club.id);
  }

  const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

  const metrics: Record<string, number> = {
    bounceBackPct: changes === 0 ? 0 : (bounces / changes) * 100,
    topFlightTurnoverPct: (everTopFlight.size / allClubs(world).length) * 100,
    tierWageRatio: mean(wageRatios),
    tierValueRatio: mean(valueRatios),
    tierDebtGapPct: mean(debtGaps),
    lowerTierCashToRevenuePct: mean(lowerCashRatios),
    cupUpsetPct: cupTies === 0 ? 0 : (cupUpsets / cupTies) * 100,
    cupWinnerFromLowerTierPct: cupsPlayed === 0 ? 0 : (cupsWonBelow / cupsPlayed) * 100,
  };

  const checks = PYRAMID_BENCHMARKS.map((benchmark) => {
    const value = metrics[benchmark.key] ?? 0;
    return { benchmark, value, pass: Math.abs(value - benchmark.target) <= benchmark.tolerance };
  });

  return { seasons, metrics, checks, passed: checks.every((check) => check.pass) };
}
