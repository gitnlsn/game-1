import { Rng, clamp } from '../rng/index.js';
import type { AttributeKey, Club, Player } from '../types.js';
import { expectedWage } from '../economy/valuation.js';
import { NAME_POOL_BY_CODE } from '../world/names.js';
import { calibrateAbility, currentAbility, developmentFactor, generatePlayer } from '../world/players.js';
import { abilityIn, SQUAD_SHAPE } from '../world/positions.js';
import { targetAbility } from '../transfers/needs.js';
import type { Position } from '../types.js';

export const AGING_TUNING = {
  /** How fast a player closes the gap to their age-curve target each season. */
  developmentRateMin: 0.45,
  developmentRateMax: 0.9,
  /** Random season-to-season noise in ability, in ability points. */
  developmentNoise: 1.2,
  /** Attributes that fade with age regardless of overall ability. */
  physicalDecayFrom: 29,
  physicalDecayPerYear: 1.6,
  /** Attributes that keep improving as a player reads the game better. */
  mentalGrowthPerYear: 0.8,
  mentalGrowthUntil: 34,
} as const;

const PHYSICAL_KEYS: readonly AttributeKey[] = ['pace', 'stamina', 'strength'];
const MENTAL_KEYS: readonly AttributeKey[] = ['composure', 'positioning', 'vision'];

/** Chance a player retires at the end of the season, by age. */
const RETIREMENT_CURVE: readonly (readonly [age: number, chance: number])[] = [
  [32, 0.02], [34, 0.12], [35, 0.25], [36, 0.42], [37, 0.62], [38, 0.85], [40, 1],
];

function retirementChance(age: number): number {
  const first = RETIREMENT_CURVE[0]!;
  const last = RETIREMENT_CURVE[RETIREMENT_CURVE.length - 1]!;
  if (age < first[0]) return 0;
  if (age >= last[0]) return 1;
  for (let i = 0; i < RETIREMENT_CURVE.length - 1; i++) {
    const [ageA, chanceA] = RETIREMENT_CURVE[i]!;
    const [ageB, chanceB] = RETIREMENT_CURVE[i + 1]!;
    if (age >= ageA && age <= ageB) {
      return chanceA + ((chanceB - chanceA) * (age - ageA)) / (ageB - ageA);
    }
  }
  return last[1];
}

/**
 * Ages a player one season. Ability moves toward what the age curve says they
 * should be, so a 20 year old with high potential climbs and a 33 year old
 * declines -- but only partway each season, and with noise, so players are not
 * all identical to their curve.
 *
 * Milestone 3 will drive this with training and playing time; for now age and
 * potential are the only inputs.
 */
export function developPlayer(rng: Rng, player: Player): void {
  const A = AGING_TUNING;
  player.age += 1;

  // Physical decline and mental growth happen regardless of overall level, so an
  // ageing playmaker keeps their vision while losing a yard of pace.
  if (player.age >= A.physicalDecayFrom) {
    const years = player.age - A.physicalDecayFrom + 1;
    for (const key of PHYSICAL_KEYS) {
      player.attributes[key] = clamp(
        Math.round(player.attributes[key] - A.physicalDecayPerYear * Math.min(years, 6) * 0.35),
        1, 99,
      );
    }
  }
  if (player.age <= A.mentalGrowthUntil) {
    for (const key of MENTAL_KEYS) {
      player.attributes[key] = clamp(Math.round(player.attributes[key] + A.mentalGrowthPerYear), 1, 99);
    }
  }

  // Then set the overall level from the age curve.
  const ability = abilityIn(player.attributes, player.position);
  const target = player.potential * developmentFactor(player.age);
  const rate = rng.float(A.developmentRateMin, A.developmentRateMax);
  const next = clamp(
    ability + (target - ability) * rate + rng.gaussian(0, A.developmentNoise),
    15,
    99,
  );

  calibrateAbility(player.attributes, player.position, next);
}

export function shouldRetire(rng: Rng, player: Player): boolean {
  // Fringe players give up earlier than stars.
  const ability = currentAbility(player);
  const abilityFactor = ability < 55 ? 1.5 : ability > 75 ? 0.7 : 1;
  return rng.chance(clamp(retirementChance(player.age) * abilityFactor, 0, 1));
}

/**
 * Brings a squad back to a full complement with academy graduates, respecting
 * the positions the club is actually short of. Youth quality follows club
 * reputation, so big clubs produce better prospects.
 */
export function promoteYouth(rng: Rng, club: Club, minSquadSize: number): Player[] {
  const domesticPool = NAME_POOL_BY_CODE.get(club.nationality) ?? NAME_POOL_BY_CODE.get('ENG')!;
  const takenNames = new Set(club.squad.map((p) => p.displayName));
  const promoted: Player[] = [];

  const counts = new Map<Position, number>();
  for (const player of club.squad) {
    counts.set(player.position, (counts.get(player.position) ?? 0) + 1);
  }

  let guard = 0;
  while (club.squad.length + promoted.length < minSquadSize && guard++ < 40) {
    // Fill the position the club is furthest below its target shape in.
    let neediest: Position = 'CM';
    let worstGap = -Infinity;
    for (const position of Object.keys(SQUAD_SHAPE) as Position[]) {
      const gap = SQUAD_SHAPE[position] - (counts.get(position) ?? 0);
      if (gap > worstGap) {
        worstGap = gap;
        neediest = position;
      }
    }

    const youth = generatePlayer(rng, {
      position: neediest,
      // Academy players must be generated at the standard the club plays to.
      // Pitch them below it and every intake is worse than the players it
      // replaces, so the whole league quietly decays over a career.
      potentialTarget: clamp(targetAbility(club.reputation) - 2, 25, 88),
      age: rng.int(16, 19),
      domesticPool,
      takenNames,
    });
    // Academy graduates sign cheap short deals.
    youth.contract = { wage: Math.round(expectedWage(youth) * 0.65), yearsRemaining: rng.int(2, 4) };

    promoted.push(youth);
    counts.set(neediest, (counts.get(neediest) ?? 0) + 1);
  }

  club.squad.push(...promoted);
  return promoted;
}
