import { clamp } from '../rng/index.js';

/**
 * How a side is set up, on four independent axes. Each runs -2 to +2 and every
 * one of them is an exact no-op at 0, so a side with no instructions plays
 * exactly as it did before tactics existed. That is not a convenience: it is
 * what makes "this change moved nothing" provable against the validator
 * digests, and it is why every effect below is a plain multiplier rather than
 * anything that draws from the generator.
 */
export interface Tactics {
  /** Defensive (-2) to attacking (+2). Commits players forward, or keeps them home. */
  mentality: number;
  /** Patient (-2) to direct (+2). Trades keeping the ball for getting at goal sooner. */
  tempo: number;
  /** Contain (-2) to press high (+2). Wins the ball further up, at the cost of legs and space behind. */
  pressing: number;
  /** Narrow (-2) to wide (+2). Works chances through the middle, or delivers them into the box. */
  width: number;
}

export const BALANCED: Tactics = { mentality: 0, tempo: 0, pressing: 0, width: 0 };

/**
 * There is no free win here, by construction. Every axis pays for what it buys,
 * and the sizes are set so that no setting beats Balanced by more than 8% of a
 * point per game -- see `analysis/tactics.ts`, which fails the build if one does.
 */
export const TACTICS_TUNING = {
  /** Attacking commits players forward: more threat, less cover. */
  mentalityAttack: 0.062,
  mentalityDefence: 0.072,
  /**
   * And a side that sits deep sees less of the ball. Without this, defending is
   * nearly free -- it costs you goals you might have scored and nothing else --
   * and "very defensive" comes out as simply the right answer. Conceding the
   * ball is what it actually costs.
   */
  mentalityControl: 0.018,
  /** Direct play gets at goal sooner, and gives the ball away sooner. */
  tempoShot: 0.07,
  tempoControl: 0.04,
  /** Pressing wins the ball higher up, and leaves room behind the line. */
  pressingControl: 0.02,
  pressingDefence: 0.085,
  /** Extra late-game fatigue load a pressing side carries, on top of its own fitness. */
  pressingFatigue: 0.3,
  /** Shift in the share of chances that arrive through the air, per step of width. */
  widthAerial: 0.06,
} as const;

/** One axis, with the words a UI puts at each end of it. */
export interface TacticAxis {
  key: keyof Tactics;
  label: string;
  low: string;
  high: string;
  /** What the setting costs you, so the trade is visible rather than implied. */
  note: string;
}

export const TACTIC_AXES: readonly TacticAxis[] = [
  {
    key: 'mentality',
    label: 'Mentality',
    low: 'Defensive',
    high: 'Attacking',
    note: 'Attacking pushes men forward and leaves less behind them.',
  },
  {
    key: 'tempo',
    label: 'Tempo',
    low: 'Patient',
    high: 'Direct',
    note: 'Direct gets at goal sooner but hands the ball back sooner.',
  },
  {
    key: 'pressing',
    label: 'Pressing',
    low: 'Contain',
    high: 'Press high',
    note: 'Pressing wins the ball higher up, and tires legs and leaves space behind.',
  },
  {
    key: 'width',
    label: 'Width',
    low: 'Narrow',
    high: 'Wide',
    note: 'Wide puts more balls into the box; narrow works them through the middle.',
  },
];

export const TACTIC_MIN = -2;
export const TACTIC_MAX = 2;

/** Fills in the axes a sheet leaves out and clamps the rest, so bad input cannot escape. */
export function resolveTactics(tactics?: Partial<Tactics>): Tactics {
  if (!tactics) return BALANCED;
  return {
    mentality: clamp(tactics.mentality ?? 0, TACTIC_MIN, TACTIC_MAX),
    tempo: clamp(tactics.tempo ?? 0, TACTIC_MIN, TACTIC_MAX),
    pressing: clamp(tactics.pressing ?? 0, TACTIC_MIN, TACTIC_MAX),
    width: clamp(tactics.width ?? 0, TACTIC_MIN, TACTIC_MAX),
  };
}

export function isBalanced(tactics: Tactics): boolean {
  return (
    tactics.mentality === 0 && tactics.tempo === 0 && tactics.pressing === 0 && tactics.width === 0
  );
}

/** A short phrase for a set of instructions, for a screen that has one line to spend. */
export function describeTactics(tactics: Tactics): string {
  const parts: string[] = [];
  for (const axis of TACTIC_AXES) {
    const value = tactics[axis.key];
    if (value === 0) continue;
    const word = value > 0 ? axis.high : axis.low;
    parts.push(Math.abs(value) === 2 ? `Very ${word.toLowerCase()}` : word);
  }
  return parts.length === 0 ? 'Balanced' : parts.join(', ');
}

/**
 * Everything a set of instructions does to a side, in one place.
 *
 * The engine reads these rather than the coefficients directly, so "Balanced is
 * an exact no-op" is a property of one small pure function that a test can pin,
 * instead of a claim about six multiplications scattered through the match loop.
 * Every multiplier here is exactly 1 at Balanced and every shift exactly 0.
 */
export interface TacticShapes {
  attack: number;
  defence: number;
  /** Multiplier on midfield control, before the possession exponent. */
  control: number;
  /** Multiplier on the chance a sequence becomes a shot. */
  shot: number;
  /** Added to the share of chances that arrive through the air. */
  aerialShift: number;
  /** Added to the late-game fatigue load, on top of the side's own fitness. */
  fatigueLoad: number;
}

export function tacticShapes(tactics: Tactics): TacticShapes {
  const X = TACTICS_TUNING;
  const { mentality, tempo, pressing, width } = tactics;
  return {
    attack: 1 + X.mentalityAttack * mentality,
    defence: (1 - X.mentalityDefence * mentality) * (1 - X.pressingDefence * pressing),
    control:
      (1 + X.mentalityControl * mentality) *
      (1 - X.tempoControl * tempo) *
      (1 + X.pressingControl * pressing),
    shot: 1 + X.tempoShot * tempo,
    aerialShift: X.widthAerial * width,
    fatigueLoad: X.pressingFatigue * pressing,
  };
}
