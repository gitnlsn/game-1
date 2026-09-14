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
  /**
   * Share of a season's minutes at which a player gets the full benefit of
   * playing. Below this they develop more slowly; a young player who never gets
   * on the pitch barely improves at all, which is what makes giving a prospect
   * games an actual decision rather than a free choice.
   */
  fullMinutesShare: 0.6,
  /** Development rate for a player who never plays, as a share of the full rate. */
  benchDevelopmentFloor: 0.3,
  /** Playing regularly slows decline a little: match sharpness. */
  declineReliefFromPlaying: 0.15,
  /**
   * Coaching quality by club reputation. Kept deliberately narrow: a big club
   * developing players faster feeds straight back into winning, reputation and
   * revenue, and in a closed single-division league nothing damps that loop.
   * Real football has relegation, cups and foreign buyers pulling against it.
   */
  coachingFloor: 0.88,
  coachingScale: 0.26,
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

/** Coaching quality a club offers, derived from its standing. */
export function coachingQuality(reputation: number): number {
  const A = AGING_TUNING;
  return A.coachingFloor + (reputation / 100) * A.coachingScale;
}

export interface DevelopmentContext {
  /** Minutes the player got this season. */
  minutes: number;
  /** Matches in the season, for working out the share of minutes available. */
  seasonMatches: number;
  /** Coaching quality at their club. */
  coaching: number;
}

const DEFAULT_CONTEXT: DevelopmentContext = { minutes: 0, seasonMatches: 38, coaching: 0.9 };

/**
 * Ages a player one season. Ability moves toward what the age curve says they
 * should be, but how fast depends on how much football they played and how good
 * their coaching is. A 19 year old who starts every week at a big club closes
 * most of the gap to their potential; the same player watching from the bench
 * barely moves.
 */
export function developPlayer(
  rng: Rng,
  player: Player,
  context: DevelopmentContext = DEFAULT_CONTEXT,
): void {
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

  // Then move the overall level toward what the age curve says it should be.
  const ability = abilityIn(player.attributes, player.position);
  const target = player.potential * developmentFactor(player.age);
  const gap = target - ability;

  const available = Math.max(1, context.seasonMatches * 90);
  const share = clamp(context.minutes / available, 0, 1);
  const playingFactor = Math.min(1, share / A.fullMinutesShare);

  let rate = rng.float(A.developmentRateMin, A.developmentRateMax);
  if (gap > 0) {
    // Improving: games and coaching are what turn potential into ability.
    rate *= (A.benchDevelopmentFloor + (1 - A.benchDevelopmentFloor) * playingFactor) * context.coaching;
  } else {
    // Declining: it happens either way, but regular football keeps you sharper.
    rate *= 1 - A.declineReliefFromPlaying * playingFactor;
  }

  const next = clamp(ability + gap * rate + rng.gaussian(0, A.developmentNoise), 15, 99);
  calibrateAbility(player.attributes, player.position, next);
}

export function shouldRetire(rng: Rng, player: Player, minutes = 0): boolean {
  // Fringe players give up earlier than stars.
  const ability = currentAbility(player);
  const abilityFactor = ability < 55 ? 1.5 : ability > 75 ? 0.7 : 1;
  // A veteran who has stopped playing is likelier to call it a day.
  const playedFactor = player.age >= 31 && minutes < 900 ? 1.4 : 1;
  return rng.chance(clamp(retirementChance(player.age) * abilityFactor * playedFactor, 0, 1));
}

/**
 * Brings a squad back to a full complement with academy graduates, respecting
 * the positions the club is actually short of. Youth quality follows club
 * reputation, so big clubs produce better prospects.
 */
export function promoteYouth(
  rng: Rng,
  club: Club,
  minSquadSize: number,
  leagueNames?: Set<string>,
): Player[] {
  const domesticPool = NAME_POOL_BY_CODE.get(club.nationality) ?? NAME_POOL_BY_CODE.get('ENG')!;
  const takenNames = leagueNames ?? new Set(club.squad.map((p) => p.displayName));
  const promoted: Player[] = [];

  const counts = new Map<Position, number>();
  for (const player of club.squad) {
    counts.set(player.position, (counts.get(player.position) ?? 0) + 1);
  }

  /*
   * Positions with nobody left come first, and are filled even if the squad is
   * already at its target size. Retirement has no positional guard -- a club's
   * last right winger can simply retire -- and the size-based top-up below would
   * never notice, so a full squad could carry a hole in it for good.
   */
  const uncovered = (Object.keys(SQUAD_SHAPE) as Position[]).filter(
    (position) => (counts.get(position) ?? 0) === 0,
  );

  let guard = 0;
  while (
    (uncovered.length > 0 || club.squad.length + promoted.length < minSquadSize) &&
    guard++ < 40
  ) {
    // An uncovered position outranks any shortfall against the target shape.
    let neediest: Position = uncovered[0] ?? 'CM';
    if (uncovered.length === 0) {
      let worstGap = -Infinity;
      for (const position of Object.keys(SQUAD_SHAPE) as Position[]) {
        const gap = SQUAD_SHAPE[position] - (counts.get(position) ?? 0);
        if (gap > worstGap) {
          worstGap = gap;
          neediest = position;
        }
      }
    } else {
      uncovered.shift();
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
