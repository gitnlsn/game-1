import { Rng, clamp } from '../rng/index.js';
import type { AttributeKey, Attributes, Player, Position } from '../types.js';
import { generateName, NAME_POOLS, type NamePool } from './names.js';
import { abilityIn, POSITION_WEIGHTS } from './positions.js';
import { expectedWage } from '../economy/valuation.js';
import { createPlayerStatus } from './status.js';

const ATTRIBUTE_KEYS: readonly AttributeKey[] = [
  'finishing', 'passing', 'dribbling', 'crossing', 'tackling', 'heading',
  'vision', 'composure', 'positioning', 'workRate',
  'pace', 'strength', 'stamina',
  'reflexes', 'handling', 'distribution',
];

const GK_KEYS: readonly AttributeKey[] = ['reflexes', 'handling', 'distribution'];

/**
 * Fraction of a player's potential that is realised at a given age. Players
 * develop fast through their early twenties, peak around 27-29, then decline.
 * This is the single curve that makes squad-building a real decision: a 19 year
 * old at 0.68 of a high potential is worth more than a 33 year old at 0.91 of
 * a mediocre one.
 */
const DEVELOPMENT_CURVE: readonly (readonly [age: number, factor: number])[] = [
  [16, 0.50], [18, 0.62], [20, 0.74], [22, 0.85], [24, 0.94],
  [26, 0.99], [28, 1.00], [30, 0.98], [32, 0.94], [34, 0.88],
  [36, 0.80], [40, 0.66],
];

export function developmentFactor(age: number): number {
  const first = DEVELOPMENT_CURVE[0]!;
  const last = DEVELOPMENT_CURVE[DEVELOPMENT_CURVE.length - 1]!;
  if (age <= first[0]) return first[1];
  if (age >= last[0]) return last[1];

  for (let i = 0; i < DEVELOPMENT_CURVE.length - 1; i++) {
    const [ageA, factorA] = DEVELOPMENT_CURVE[i]!;
    const [ageB, factorB] = DEVELOPMENT_CURVE[i + 1]!;
    if (age >= ageA && age <= ageB) {
      const t = (age - ageA) / (ageB - ageA);
      return factorA + (factorB - factorA) * t;
    }
  }
  return last[1];
}

/** How prominent an attribute is for a position, before calibration. */
function profileFactor(position: Position, key: AttributeKey): number {
  const isGkKey = GK_KEYS.includes(key);

  if (position === 'GK') {
    if (isGkKey) return 1;
    if (key === 'positioning') return 0.95;
    if (key === 'composure') return 0.9;
    if (key === 'strength' || key === 'heading') return 0.75;
    if (key === 'passing' || key === 'workRate' || key === 'stamina') return 0.7;
    if (key === 'vision') return 0.6;
    if (key === 'pace') return 0.5;
    return 0.25; // finishing, crossing, dribbling, tackling
  }

  if (isGkKey) return 0.15;
  return POSITION_WEIGHTS[position][key] !== undefined ? 1 : 0.75;
}

/**
 * Builds an attribute set whose weighted ability in `position` lands on
 * `targetAbility`. Shape comes from the position profile plus noise, then the
 * whole set is shifted until the weighted ability matches.
 */
export function generateAttributes(rng: Rng, position: Position, targetAbility: number): Attributes {
  const attributes = {} as Attributes;
  for (const key of ATTRIBUTE_KEYS) {
    const mean = targetAbility * profileFactor(position, key);
    attributes[key] = clamp(Math.round(rng.gaussian(mean, 7)), 1, 99);
  }

  calibrateAbility(attributes, position, targetAbility);
  return attributes;
}

/**
 * Shifts the position-relevant attributes until the player's weighted ability in
 * `position` equals `targetAbility`, leaving the shape of the attribute set
 * intact. Used both when generating a player and when they develop or decline.
 */
export function calibrateAbility(
  attributes: Attributes,
  position: Position,
  targetAbility: number,
): Attributes {
  const relevant = ATTRIBUTE_KEYS.filter((key) => POSITION_WEIGHTS[position][key] !== undefined);
  for (let pass = 0; pass < 8; pass++) {
    const delta = targetAbility - abilityIn(attributes, position);
    if (Math.abs(delta) < 0.25) break;
    for (const key of relevant) {
      attributes[key] = clamp(Math.round(attributes[key] + delta), 1, 99);
    }
  }
  return attributes;
}

export interface GeneratePlayerOptions {
  position: Position;
  /** Mean potential for this player, 1-100. Noise is applied on top. */
  potentialTarget: number;
  age?: number;
  nationality?: NamePool;
  /** Bias toward domestic players; foreigners are drawn from all pools. */
  domesticPool?: NamePool;
  /**
   * Display names already taken in this squad. Two players called "Juninho" in
   * the same XI reads as a bug, so names are redrawn until one is free.
   */
  takenNames?: Set<string>;
}

let playerCounter = 0;
export function resetPlayerIds(): void {
  playerCounter = 0;
}

export function generatePlayer(rng: Rng, options: GeneratePlayerOptions): Player {
  const pool =
    options.nationality ??
    (options.domesticPool && rng.chance(0.62) ? options.domesticPool : rng.pick(NAME_POOLS));

  const age = options.age ?? generateAge(rng);
  const potential = clamp(Math.round(rng.gaussian(options.potentialTarget, 6)), 20, 99);

  // Current ability is a share of potential set by age, with a little noise so
  // that not every 24 year old is exactly on curve.
  const ability = clamp(potential * developmentFactor(age) * rng.float(0.95, 1.03), 15, 99);

  const name = generateUniqueName(rng, pool, options.takenNames);
  options.takenNames?.add(name.displayName);

  const attributes = generateAttributes(rng, options.position, ability);

  return {
    id: `p${++playerCounter}`,
    firstName: name.firstName,
    lastName: name.lastName,
    displayName: name.displayName,
    nationality: pool.code,
    age,
    position: options.position,
    attributes,
    potential,
    // Contract terms follow from ability, so they are set after attributes.
    contract: {
      wage: expectedWage({ attributes, position: options.position, age }),
      yearsRemaining: rng.int(1, 4),
    },
    status: createPlayerStatus(),
  };
}

/**
 * Draws a name nobody in the league is already using. Redrawing alone is not
 * enough once a whole division is sharing one pool, so the display format
 * escalates instead -- which is what real football does when two players share a
 * name: first the full forename, then a second surname.
 */
function generateUniqueName(rng: Rng, pool: NamePool, taken: Set<string> | undefined) {
  let name = generateName(rng, pool);
  if (!taken) return name;

  for (let attempt = 0; attempt < 25 && taken.has(name.displayName); attempt++) {
    name = generateName(rng, pool);
  }
  if (!taken.has(name.displayName)) return name;

  const full = { ...name, displayName: `${name.firstName} ${name.lastName}` };
  if (!taken.has(full.displayName)) return full;

  for (let attempt = 0; attempt < 30; attempt++) {
    const second = rng.pick(pool.last);
    if (second === name.lastName) continue;
    const compound = {
      ...name,
      displayName: `${name.firstName.charAt(0)}. ${name.lastName} ${second}`,
    };
    if (!taken.has(compound.displayName)) return compound;
  }

  return name;
}

/** Squad ages: bulk in the 22-30 prime, with youth and veteran tails. */
function generateAge(rng: Rng): number {
  const roll = rng.next();
  if (roll < 0.14) return rng.int(16, 20);
  if (roll < 0.72) return rng.int(21, 28);
  if (roll < 0.93) return rng.int(29, 33);
  return rng.int(34, 38);
}

/** Current ability of a player in their natural position, 1-100. */
export function currentAbility(player: Player): number {
  return abilityIn(player.attributes, player.position);
}
