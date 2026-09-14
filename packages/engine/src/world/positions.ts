import type { AttributeKey, Attributes, Position, PositionGroup } from '../types.js';

export const POSITIONS: readonly Position[] = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'];

export const POSITION_GROUP: Record<Position, PositionGroup> = {
  GK: 'GK',
  CB: 'DEF',
  LB: 'DEF',
  RB: 'DEF',
  DM: 'MID',
  CM: 'MID',
  AM: 'MID',
  LW: 'FWD',
  RW: 'FWD',
  ST: 'FWD',
};

/**
 * How much each attribute contributes to a player's ability in a position.
 * Weights per position sum to 1, so ability lands back on the 1-100 scale.
 * These are the main tuning knob for "what kind of player is good where".
 */
export const POSITION_WEIGHTS: Record<Position, Partial<Record<AttributeKey, number>>> = {
  GK: { reflexes: 0.3, handling: 0.22, positioning: 0.18, distribution: 0.12, composure: 0.1, strength: 0.08 },
  CB: { tackling: 0.24, heading: 0.18, positioning: 0.18, strength: 0.16, composure: 0.1, pace: 0.1, passing: 0.04 },
  LB: { tackling: 0.18, pace: 0.18, crossing: 0.16, stamina: 0.14, passing: 0.12, workRate: 0.12, positioning: 0.1 },
  RB: { tackling: 0.18, pace: 0.18, crossing: 0.16, stamina: 0.14, passing: 0.12, workRate: 0.12, positioning: 0.1 },
  DM: { tackling: 0.22, positioning: 0.18, passing: 0.18, workRate: 0.14, strength: 0.12, vision: 0.1, composure: 0.06 },
  CM: { passing: 0.24, vision: 0.18, workRate: 0.14, composure: 0.12, stamina: 0.12, dribbling: 0.1, tackling: 0.1 },
  AM: { vision: 0.22, passing: 0.2, dribbling: 0.18, composure: 0.14, finishing: 0.14, pace: 0.12 },
  LW: { dribbling: 0.24, pace: 0.22, crossing: 0.16, finishing: 0.14, passing: 0.12, stamina: 0.12 },
  RW: { dribbling: 0.24, pace: 0.22, crossing: 0.16, finishing: 0.14, passing: 0.12, stamina: 0.12 },
  ST: { finishing: 0.32, composure: 0.18, positioning: 0.16, pace: 0.12, heading: 0.12, strength: 0.1 },
};

/** Weighted ability of a player's attributes for a given position, 1-100. */
export function abilityIn(attributes: Attributes, position: Position): number {
  const weights = POSITION_WEIGHTS[position];
  let total = 0;
  for (const key in weights) {
    const weight = weights[key as AttributeKey];
    if (weight !== undefined) total += attributes[key as AttributeKey] * weight;
  }
  return total;
}

/**
 * Penalty multiplier for playing out of position. A CB at RB is fine; a striker
 * in goal is not. Used when picking a lineup from an incomplete squad.
 */
export function positionFamiliarity(natural: Position, playing: Position): number {
  if (natural === playing) return 1;
  if (natural === 'GK' || playing === 'GK') return 0.35;

  const adjacency: Partial<Record<Position, readonly Position[]>> = {
    CB: ['LB', 'RB', 'DM'],
    LB: ['RB', 'CB', 'LW'],
    RB: ['LB', 'CB', 'RW'],
    DM: ['CM', 'CB'],
    CM: ['DM', 'AM'],
    AM: ['CM', 'LW', 'RW', 'ST'],
    LW: ['RW', 'AM', 'ST', 'LB'],
    RW: ['LW', 'AM', 'ST', 'RB'],
    ST: ['AM', 'LW', 'RW'],
  };

  if (adjacency[natural]?.includes(playing)) return 0.9;
  return POSITION_GROUP[natural] === POSITION_GROUP[playing] ? 0.8 : 0.65;
}

export const FORMATIONS: Record<string, readonly Position[]> = {
  '4-3-3': ['GK', 'LB', 'CB', 'CB', 'RB', 'DM', 'CM', 'CM', 'LW', 'ST', 'RW'],
  '4-4-2': ['GK', 'LB', 'CB', 'CB', 'RB', 'LW', 'CM', 'CM', 'RW', 'ST', 'ST'],
  '4-2-3-1': ['GK', 'LB', 'CB', 'CB', 'RB', 'DM', 'DM', 'AM', 'LW', 'RW', 'ST'],
};

export const DEFAULT_FORMATION = '4-3-3';

/** Target squad shape: how many players of each position a club is generated with. */
export const SQUAD_SHAPE: Record<Position, number> = {
  GK: 3,
  CB: 4,
  LB: 2,
  RB: 2,
  DM: 2,
  CM: 3,
  AM: 2,
  LW: 2,
  RW: 2,
  ST: 3,
};
