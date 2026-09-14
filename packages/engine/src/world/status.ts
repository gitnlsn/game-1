import type { Player, PlayerStatus } from '../types.js';

export const STATUS_TUNING = {
  startingCondition: 96,
  startingMorale: 65,
  /** Yellow cards that trigger a one-match ban. */
  yellowsPerBan: 5,
  /**
   * Fitness recovered between matches: a flat amount plus a share of whatever is
   * missing. Together with the cost of playing this settles an ever-present
   * around 70 condition and a rotated player near full fitness -- which is what
   * makes squad depth worth having.
   */
  recoveryBase: 5,
  recoveryRate: 0.35,
} as const;

export function createPlayerStatus(): PlayerStatus {
  return {
    condition: STATUS_TUNING.startingCondition,
    form: 0,
    morale: STATUS_TUNING.startingMorale,
    injuryMatches: 0,
    suspensionMatches: 0,
    yellowCards: 0,
    redCards: 0,
    appearances: 0,
    minutes: 0,
    goals: 0,
    assists: 0,
  };
}

/** A player can only be picked if they are neither injured nor suspended. */
export function isAvailable(player: Player): boolean {
  return player.status.injuryMatches === 0 && player.status.suspensionMatches === 0;
}

/**
 * One week on: fitness comes back, and a player sitting out an injury or a ban
 * ticks one match closer to being available.
 */
export function advancePlayerWeek(player: Player): void {
  const S = STATUS_TUNING;
  const status = player.status;

  // Fitter players recover faster.
  const rate = S.recoveryRate * (0.7 + player.attributes.stamina / 200);
  status.condition = Math.min(100, status.condition + S.recoveryBase + (100 - status.condition) * rate);

  if (status.injuryMatches > 0) status.injuryMatches -= 1;
  if (status.suspensionMatches > 0) status.suspensionMatches -= 1;

  // Form decays toward neutral when nothing is happening.
  status.form *= 0.95;
}

/** Clears the per-season counters but carries fitness and bans into next year. */
export function resetSeasonStatus(player: Player): void {
  const status = player.status;
  status.yellowCards = 0;
  status.redCards = 0;
  status.appearances = 0;
  status.minutes = 0;
  status.goals = 0;
  status.assists = 0;
  // A summer off puts everyone back near full fitness.
  status.condition = Math.max(status.condition, 90);
  status.form = 0;
}
