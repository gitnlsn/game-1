import { Rng } from '../rng/index.js';
import type { MatchResult } from '../types.js';
import { simulateSeason } from '../league/season.js';
import { clubStrength } from '../match/ratings.js';
import { createWorld } from '../world/index.js';

/**
 * Benchmarks drawn from recent top-five-European-league seasons. The engine is
 * considered calibrated when every metric sits inside its tolerance. This is
 * the whole point of a headless core: you can check a rules change against
 * hundreds of simulated seasons in seconds.
 */
export interface Benchmark {
  key: string;
  label: string;
  target: number;
  tolerance: number;
  decimals?: number;
}

export const BENCHMARKS: readonly Benchmark[] = [
  { key: 'goalsPerMatch', label: 'Goals per match', target: 2.75, tolerance: 0.25, decimals: 2 },
  { key: 'homeGoalsPerMatch', label: 'Home goals per match', target: 1.52, tolerance: 0.2, decimals: 2 },
  { key: 'awayGoalsPerMatch', label: 'Away goals per match', target: 1.23, tolerance: 0.2, decimals: 2 },
  { key: 'homeWinPct', label: 'Home wins %', target: 44, tolerance: 4, decimals: 1 },
  { key: 'drawPct', label: 'Draws %', target: 25, tolerance: 4, decimals: 1 },
  { key: 'awayWinPct', label: 'Away wins %', target: 31, tolerance: 4, decimals: 1 },
  { key: 'shotsPerMatch', label: 'Shots per match', target: 25, tolerance: 5, decimals: 1 },
  { key: 'shotsOnTargetPerMatch', label: 'Shots on target per match', target: 8.7, tolerance: 2, decimals: 1 },
  { key: 'goallessPct', label: 'Goalless matches %', target: 7.5, tolerance: 3.5, decimals: 1 },
  { key: 'blowoutPct', label: 'Matches won by 4+ goals %', target: 3.5, tolerance: 2, decimals: 1 },
  { key: 'championPoints', label: 'Champion points', target: 86, tolerance: 9, decimals: 1 },
  { key: 'bottomPoints', label: 'Last place points', target: 26, tolerance: 8, decimals: 1 },
  { key: 'topScorerGoals', label: 'Top scorer goals', target: 24, tolerance: 7, decimals: 1 },
  // Discipline, injuries and rotation.
  { key: 'yellowsPerMatch', label: 'Yellow cards per match', target: 3.9, tolerance: 1.2, decimals: 2 },
  { key: 'redsPerMatch', label: 'Red cards per match', target: 0.1, tolerance: 0.07, decimals: 3 },
  { key: 'subsPerMatch', label: 'Substitutions per match', target: 8.5, tolerance: 2, decimals: 2 },
  { key: 'injuriesPerClubSeason', label: 'Injuries per club per season', target: 12, tolerance: 6, decimals: 1 },
  { key: 'playersUsedPerClub', label: 'Players used per club', target: 24, tolerance: 5, decimals: 1 },
  /*
   * Real clubs spread minutes more widely than this, but they also play cups and
   * continental football on top of the league. These clubs play 38 matches and
   * nothing else, so a settled side concentrates minutes more than a real one
   * would. Revisit once there are cup competitions.
   */
  { key: 'topElevenMinuteShare', label: 'Minutes share of top 11 %', target: 72, tolerance: 8, decimals: 1 },
];

export interface ValidationReport {
  seasons: number;
  matches: number;
  metrics: Record<string, number>;
  /** Scorelines by frequency, most common first. */
  scorelines: { score: string; pct: number }[];
  /**
   * Spearman-style rank correlation between pre-season squad strength and final
   * league position. Real leagues sit around 0.75-0.85: strong clubs usually win,
   * but not always. A value near 1.0 means the sim has no upsets and is boring.
   */
  strengthPositionCorrelation: number;
  checks: { benchmark: Benchmark; value: number; pass: boolean }[];
  passed: boolean;
}

export interface ValidateOptions {
  seasons?: number;
  clubCount?: number;
  seed?: number | string;
}

export function validateEngine(options: ValidateOptions = {}): ValidationReport {
  const seasons = options.seasons ?? 50;
  const clubCount = options.clubCount ?? 20;
  const baseSeed = options.seed ?? 'validate';

  let matches = 0;
  let goals = 0, homeGoals = 0, awayGoals = 0;
  let homeWins = 0, draws = 0, awayWins = 0;
  let shots = 0, shotsOnTarget = 0, goalless = 0;
  let championPoints = 0, bottomPoints = 0, topScorerGoals = 0, blowouts = 0;
  let correlationTotal = 0;
  let yellows = 0, reds = 0, injuries = 0, substitutions = 0;
  let playersUsed = 0, clubSeasons = 0, topElevenMinutes = 0, totalMinutes = 0;

  const scorelineCounts = new Map<string, number>();

  for (let s = 0; s < seasons; s++) {
    const world = createWorld({ seed: `${baseSeed}:${s}`, clubCount });
    const rng = new Rng(`${baseSeed}:season:${s}`);

    const strengthByClub = new Map(world.league.clubs.map((c) => [c.id, clubStrength(c)]));
    const season = simulateSeason(world, rng, { playerState: true });

    for (const result of season.results) {
      matches++;
      tallyMatch(result, scorelineCounts);
      goals += result.home.goals + result.away.goals;
      homeGoals += result.home.goals;
      awayGoals += result.away.goals;
      shots += result.home.shots + result.away.shots;
      shotsOnTarget += result.home.shotsOnTarget + result.away.shotsOnTarget;
      if (result.home.goals + result.away.goals === 0) goalless++;
      if (Math.abs(result.home.goals - result.away.goals) >= 4) blowouts++;
      if (result.home.goals > result.away.goals) homeWins++;
      else if (result.home.goals < result.away.goals) awayWins++;
      else draws++;
    }

    for (const result of season.results) {
      for (const event of result.events) {
        if (event.type === 'yellow_card') yellows++;
        else if (event.type === 'red_card') reds++;
        else if (event.type === 'injury') injuries++;
        else if (event.type === 'substitution') substitutions++;
      }
    }

    // Rotation: how many players a club actually used, and how concentrated
    // minutes were in its most-used eleven.
    for (const club of world.league.clubs) {
      clubSeasons++;
      const minutes = club.squad
        .map((player) => player.status.minutes)
        .filter((m) => m > 0)
        .sort((a, b) => b - a);
      playersUsed += minutes.length;
      const total = minutes.reduce((sum, m) => sum + m, 0);
      totalMinutes += total;
      topElevenMinutes += minutes.slice(0, 11).reduce((sum, m) => sum + m, 0);
    }

    championPoints += season.table[0]?.points ?? 0;
    bottomPoints += season.table[season.table.length - 1]?.points ?? 0;
    topScorerGoals += season.scorers[0]?.goals ?? 0;
    correlationTotal += rankCorrelation(season.table.map((row) => strengthByClub.get(row.clubId) ?? 0));
  }

  const metrics: Record<string, number> = {
    goalsPerMatch: goals / matches,
    homeGoalsPerMatch: homeGoals / matches,
    awayGoalsPerMatch: awayGoals / matches,
    homeWinPct: (homeWins / matches) * 100,
    drawPct: (draws / matches) * 100,
    awayWinPct: (awayWins / matches) * 100,
    shotsPerMatch: shots / matches,
    shotsOnTargetPerMatch: shotsOnTarget / matches,
    goallessPct: (goalless / matches) * 100,
    blowoutPct: (blowouts / matches) * 100,
    championPoints: championPoints / seasons,
    bottomPoints: bottomPoints / seasons,
    topScorerGoals: topScorerGoals / seasons,
    yellowsPerMatch: yellows / matches,
    redsPerMatch: reds / matches,
    subsPerMatch: substitutions / matches,
    injuriesPerClubSeason: clubSeasons > 0 ? injuries / clubSeasons : 0,
    playersUsedPerClub: clubSeasons > 0 ? playersUsed / clubSeasons : 0,
    topElevenMinuteShare: totalMinutes > 0 ? (topElevenMinutes / totalMinutes) * 100 : 0,
  };

  const checks = BENCHMARKS.map((benchmark) => {
    const value = metrics[benchmark.key] ?? Number.NaN;
    return { benchmark, value, pass: Math.abs(value - benchmark.target) <= benchmark.tolerance };
  });

  const scorelines = [...scorelineCounts.entries()]
    .map(([score, count]) => ({ score, pct: (count / matches) * 100 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 10);

  return {
    seasons,
    matches,
    metrics,
    scorelines,
    strengthPositionCorrelation: correlationTotal / seasons,
    checks,
    passed: checks.every((c) => c.pass),
  };
}

function tallyMatch(result: MatchResult, counts: Map<string, number>): void {
  const score = `${result.home.goals}-${result.away.goals}`;
  counts.set(score, (counts.get(score) ?? 0) + 1);
}

/**
 * Pearson correlation between finishing position (1..n) and pre-season strength.
 * Returns a positive number when stronger squads finish higher.
 */
function rankCorrelation(strengthsInFinishOrder: readonly number[]): number {
  const n = strengthsInFinishOrder.length;
  if (n < 2) return 0;

  const positions = strengthsInFinishOrder.map((_, i) => i + 1);
  const meanPos = (n + 1) / 2;
  const meanStrength = strengthsInFinishOrder.reduce((a, b) => a + b, 0) / n;

  let covariance = 0, posVariance = 0, strengthVariance = 0;
  for (let i = 0; i < n; i++) {
    const dPos = positions[i]! - meanPos;
    const dStrength = strengthsInFinishOrder[i]! - meanStrength;
    covariance += dPos * dStrength;
    posVariance += dPos * dPos;
    strengthVariance += dStrength * dStrength;
  }

  const denominator = Math.sqrt(posVariance * strengthVariance);
  // Negate: position 1 is best, so a negative raw correlation means "good = high".
  return denominator === 0 ? 0 : -(covariance / denominator);
}
