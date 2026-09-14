import { Rng, clamp } from '../rng/index.js';
import type { Player, PotentialEstimate, ScoutingState } from '../types.js';
import { marketValue } from '../economy/valuation.js';
import { currentAbility } from './players.js';

export const SCOUTING_TUNING = {
  /** Uncertainty about a player nobody has watched, in ability points. */
  sigmaMax: 14,
  /** Uncertainty that never goes away, however well you know someone. */
  sigmaFloor: 1.5,
  /** Knowledge at which uncertainty has fallen by a factor of e. */
  knowledgeScale: 6,
  /**
   * What you know about your own squad on day one. A manager walking in has a
   * coaching staff who have watched these players every day -- starting at zero
   * would mean not knowing your own centre half, which is not the uncertainty
   * worth modelling. The interesting doubt is about other clubs' players, and
   * about your own youngsters who have not played.
   */
  initialOwnSquad: 8,
  /** Knowledge gained per season from a player in your own squad, before minutes. */
  ownSquadBase: 0.5,
  /** Minutes of football worth one full point of knowledge. */
  minutesPerKnowledge: 900,
  /** Knowledge gained about an opponent's squad member from facing them. */
  facedSquad: 0.1,
  /** Extra for an opponent who actually did something in the match. */
  facedActive: 0.25,
} as const;

export function createScoutingState(): ScoutingState {
  return { reports: {} };
}

export function knowledgeOf(state: ScoutingState, playerId: string): number {
  return state.reports[playerId]?.knowledge ?? 0;
}

/**
 * A scout's blind spot on a given player: drawn once, fixed for the life of the
 * world, and taken from a *throwaway* generator seeded from the world and the
 * player id.
 *
 * This matters more than it looks. Reports are read every time a screen renders,
 * so if this drew from the career's own generator, opening the squad list would
 * change next week's results.
 */
function scoutBias(seed: number | string, playerId: string): number {
  return new Rng(`${seed}:scout:${playerId}`).gaussian(0, 1);
}

function describe(confidence: number): string {
  if (confidence >= 0.85) return 'Thoroughly scouted';
  if (confidence >= 0.6) return 'Well scouted';
  if (confidence >= 0.35) return 'Seen a few times';
  if (confidence >= 0.15) return 'Barely known';
  return 'Unknown quantity';
}

/**
 * What your scouts think a player might become.
 *
 * The bias is fixed per player and only the *width* of the band shrinks as you
 * learn more, so the estimate closes in on the truth rather than jumping about:
 * "we had him at 70-84, now we have him at 74-79, he turned out 76" reads as
 * learning. Redrawing the midpoint each time would read as dice.
 */
export function scoutedPotential(
  seed: number | string,
  state: ScoutingState,
  player: Player,
): PotentialEstimate {
  const S = SCOUTING_TUNING;
  const knowledge = knowledgeOf(state, player.id);
  const sigma = S.sigmaFloor + S.sigmaMax * Math.exp(-knowledge / S.knowledgeScale);

  // You can always see what a player already does; the question is the ceiling.
  const floor = currentAbility(player);
  const mid = clamp(player.hiddenPotential + scoutBias(seed, player.id) * sigma, floor, 99);
  const confidence = clamp(1 - sigma / (S.sigmaFloor + S.sigmaMax), 0, 1);

  return {
    estimate: Math.round(mid),
    low: Math.round(clamp(mid - sigma, floor, 99)),
    high: Math.round(clamp(mid + sigma, floor, 99)),
    confidence,
    label: describe(confidence),
  };
}

/**
 * What a player looks worth on your reading of them, as opposed to what the
 * market will actually charge. The gap between this and `marketValue` is where a
 * bargain or a mistake lives.
 */
export function scoutedValue(
  seed: number | string,
  state: ScoutingState,
  player: Player,
): number {
  const estimate = scoutedPotential(seed, state, player).estimate;
  return marketValue({ ...player, hiddenPotential: estimate });
}

function credit(state: ScoutingState, player: Player, amount: number, season: number): void {
  const existing = state.reports[player.id];
  if (existing) {
    existing.knowledge += amount;
    existing.updatedSeason = season;
  } else {
    state.reports[player.id] = { playerId: player.id, knowledge: amount, updatedSeason: season };
  }
}

/**
 * A season with your own players teaches you about them -- and the ones you
 * never pick stay a mystery, which is a second reason to give a prospect games.
 */
export function creditOwnSquad(
  state: ScoutingState,
  squad: readonly Player[],
  season: number,
): void {
  const S = SCOUTING_TUNING;
  for (const player of squad) {
    credit(state, player, S.ownSquadBase + player.status.minutes / S.minutesPerKnowledge, season);
  }
}

/**
 * The squad you inherit. Known well, but a teenager who has never played is
 * still a question mark -- which is the doubt worth having.
 */
export function creditInheritedSquad(
  state: ScoutingState,
  squad: readonly Player[],
  season: number,
): void {
  const S = SCOUTING_TUNING;
  for (const player of squad) {
    const unproven = player.age <= 19 ? 0.45 : player.age <= 21 ? 0.7 : 1;
    credit(state, player, S.initialOwnSquad * unproven, season);
  }
}

/** Facing a side tells you a little about everyone in it, and more about whoever hurt you. */
export function creditOpponent(
  state: ScoutingState,
  squad: readonly Player[],
  activePlayerIds: ReadonlySet<string>,
  season: number,
): void {
  const S = SCOUTING_TUNING;
  for (const player of squad) {
    credit(state, player, activePlayerIds.has(player.id) ? S.facedActive : S.facedSquad, season);
  }
}

/** Drops reports for players who have left the game, so a save cannot grow forever. */
export function pruneScouting(state: ScoutingState, livingPlayerIds: ReadonlySet<string>): void {
  for (const id of Object.keys(state.reports)) {
    if (!livingPlayerIds.has(id)) delete state.reports[id];
  }
}
