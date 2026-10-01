import { Rng } from '../rng/index.js';
import type { TrainingFocus, World } from '../types.js';
import { coachingFactor } from '../economy/levers.js';
import { isMidweek, type SeasonState } from '../league/season.js';
import { allClubs } from '../world/index.js';
import { AGING_TUNING, coachingQuality, developStep, exactAbility } from './aging.js';

/*
 * Development through the season, for the world as a whole. Lives below the
 * controller so the harness can run exactly what a career runs: the benchmarks
 * are only worth anything if they measure the game people actually play.
 */

export const DEVELOPMENT_TUNING = {
  /** League weeks between development steps: roughly a month. */
  weeksPerStep: 4,
  /** Seasons back that keep every point on a curve; older ones keep one each. */
  detailedSeasons: 2,
} as const;

/** League weeks in the season, and how many have been played. Cup midweeks are not weeks. */
export function leagueWeeks(state: SeasonState): { played: number; total: number } {
  let played = 0;
  let total = 0;
  for (let round = 1; round <= state.totalRounds; round++) {
    if (isMidweek(state, round)) continue;
    total++;
    if (round < state.nextRound) played++;
  }
  return { played, total };
}

/**
 * How quickly a player develops this season. Drawn once per player per season,
 * as the end-of-season step draws it, not once per step: ten draws averaged
 * would even everyone out, and the seasons where a prospect suddenly clicks --
 * or does not -- would quietly disappear.
 */
export function seasonDevelopmentRate(world: World, playerId: string): number {
  const A = AGING_TUNING;
  return new Rng(`devrate:${world.seed}:${world.season}:${playerId}`).float(
    A.developmentRateMin,
    A.developmentRateMax,
  );
}

/**
 * Develops every player in the world from week `from` to week `to`. Everyone,
 * not just one squad: development is how talent moves around a league.
 *
 * Draws from generators of its own, so when a step falls cannot change a result.
 */
export function developWorld(
  world: World,
  state: SeasonState,
  from: number,
  to: number,
  focusOf?: (playerId: string) => TrainingFocus | undefined,
): void {
  const { total } = leagueWeeks(state);
  const weeks = to - from;
  if (weeks <= 0 || total === 0) return;

  const fraction = weeks / total;
  const rng = new Rng(`dev:${world.seed}:${world.season}:${to}`);
  const seasonMatches = Math.max(1, to);

  for (const club of allClubs(world)) {
    const coaching = coachingQuality(club.reputation) * coachingFactor(club);
    for (const player of club.squad) {
      const focus = focusOf?.(player.id);
      developStep(rng, player, {
        minutes: player.status.minutes,
        seasonMatches,
        coaching,
        fraction,
        rate: seasonDevelopmentRate(world, player.id),
        ...(focus ? { focus } : {}),
      });
    }
  }
  for (const player of world.freeAgents) {
    developStep(rng, player, {
      minutes: 0,
      seasonMatches,
      coaching: 0.85,
      fraction,
      rate: seasonDevelopmentRate(world, player.id),
    });
  }
}

/** Every player's ability as a season begins, to measure the season against. */
export function abilitySnapshot(world: World): Record<string, number> {
  const snapshot: Record<string, number> = {};
  for (const player of world.players.values()) {
    snapshot[player.id] = Math.round(exactAbility(player) * 10) / 10;
  }
  return snapshot;
}
