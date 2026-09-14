import { clamp } from '../rng/index.js';
import type { Player } from '../types.js';
import { abilityIn } from '../world/positions.js';

/**
 * Money is in neutral units -- the UI decides whether to render them as R$, EUR
 * or anything else. The scale is tuned so a league-average starter is worth a
 * few million and an elite player several tens of millions.
 */
export const VALUATION_TUNING = {
  /** Value of a player at the reference ability, before any modifier. */
  baseValue: 200_000,
  referenceAbility: 40,
  /** Every `abilityScale` points of ability multiplies value by e. */
  abilityScale: 8.5,
  /**
   * Wages are derived from ability-value rather than their own curve, so the two
   * can never drift apart. The exponent compresses them: a player worth twice as
   * much does not earn twice as much, which is how real wage structures work.
   */
  wageFactor: 0.135,
  wageCompression: 0.82,
  /** Extra value for unrealised potential, applied to players under 26. */
  potentialPremium: 0.9,
  /** A player in the last year of their deal is cheap; one with 4 years is not. */
  contractMultipliers: [0.35, 0.62, 0.85, 0.95, 1] as const,
} as const;

/**
 * Value by age. Peaks in the early-to-mid twenties -- a club buying a 24 year
 * old is buying prime years, a club buying a 33 year old is renting them.
 */
const AGE_VALUE_CURVE: readonly (readonly [age: number, multiplier: number])[] = [
  [16, 0.85], [19, 1.15], [22, 1.3], [25, 1.22], [27, 1.05],
  [29, 0.82], [31, 0.55], [33, 0.32], [35, 0.16], [40, 0.05],
];

function interpolate(curve: readonly (readonly [number, number])[], x: number): number {
  const first = curve[0]!;
  const last = curve[curve.length - 1]!;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];

  for (let i = 0; i < curve.length - 1; i++) {
    const [xa, ya] = curve[i]!;
    const [xb, yb] = curve[i + 1]!;
    if (x >= xa && x <= xb) return ya + ((yb - ya) * (x - xa)) / (xb - xa);
  }
  return last[1];
}

/** Ability priced on an exponential curve: the last few points cost the most. */
function abilityValue(ability: number): number {
  const V = VALUATION_TUNING;
  return V.baseValue * Math.exp((ability - V.referenceAbility) / V.abilityScale);
}

export function contractMultiplier(yearsRemaining: number): number {
  const multipliers = VALUATION_TUNING.contractMultipliers;
  const index = clamp(Math.floor(yearsRemaining), 0, multipliers.length - 1);
  return multipliers[index]!;
}

/**
 * What the market thinks a player is worth. Selling clubs ask more than this and
 * buying clubs bid less, so this is the anchor rather than the actual fee.
 */
export function marketValue(player: Player): number {
  const V = VALUATION_TUNING;
  const ability = abilityIn(player.attributes, player.position);

  let value = abilityValue(ability) * interpolate(AGE_VALUE_CURVE, player.age);

  // Young players are priced partly on what they might become.
  if (player.age < 26) {
    const headroom = Math.max(0, player.potential - ability);
    const youthWeight = (26 - player.age) / 10;
    value *= 1 + (headroom / 100) * V.potentialPremium * youthWeight * 4;
  }

  value *= contractMultiplier(player.contract.yearsRemaining);

  return Math.round(value / 1000) * 1000;
}

/**
 * The weekly wage a player expects. Wages compress relative to fees: the best
 * player is worth 50x the worst in fees, but earns more like 15x.
 *
 * Takes only the fields it needs so it can be called during player generation,
 * before a contract exists.
 */
export function expectedWage(player: Pick<Player, 'attributes' | 'position' | 'age'>): number {
  const V = VALUATION_TUNING;
  const ability = abilityIn(player.attributes, player.position);
  const base = V.wageFactor * Math.pow(abilityValue(ability), V.wageCompression);

  // Players entering their prime negotiate hardest; veterans take less.
  const ageFactor = player.age < 21 ? 0.7 : player.age > 32 ? 0.8 : 1;

  return Math.round((base * ageFactor) / 100) * 100;
}

/** Total weekly wage bill of a squad. */
export function wageBill(squad: readonly Player[]): number {
  return squad.reduce((sum, player) => sum + player.contract.wage, 0);
}

/** Renders 12_400_000 as "12.4M". The UI adds a currency symbol. */
export function formatMoney(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}K`;
  return `${sign}${Math.round(abs)}`;
}
