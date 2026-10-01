import { joinSquad } from '../world/squads.js';
import { Rng, clamp } from '../rng/index.js';
import type { AttributeKey, Club, Player, TrainingFocus } from '../types.js';
import { expectedWage } from '../economy/valuation.js';
import { academyBoost } from '../economy/levers.js';
import { NAME_POOL_BY_CODE } from '../world/names.js';
import { calibrateAbility, currentAbility, developmentFactor, generatePlayer } from '../world/players.js';
import { abilityIn, POSITION_WEIGHTS, SQUAD_SHAPE } from '../world/positions.js';
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
 * most of the gap to their hiddenPotential; the same player watching from the bench
 * barely moves.
 */
export function developPlayer(
  rng: Rng,
  player: Player,
  context: DevelopmentContext = DEFAULT_CONTEXT,
): void {
  const A = AGING_TUNING;
  player.age += 1;
  applyAgeShape(player);

  // Then move the overall level toward what the age curve says it should be.
  const ability = abilityIn(player.attributes, player.position);
  const target = player.hiddenPotential * developmentFactor(player.age);
  const gap = target - ability;

  const available = Math.max(1, context.seasonMatches * 90);
  const share = clamp(context.minutes / available, 0, 1);
  const playingFactor = Math.min(1, share / A.fullMinutesShare);

  let rate = rng.float(A.developmentRateMin, A.developmentRateMax);
  if (gap > 0) {
    // Improving: games and coaching are what turn hiddenPotential into ability.
    rate *= (A.benchDevelopmentFloor + (1 - A.benchDevelopmentFloor) * playingFactor) * context.coaching;
  } else {
    // Declining: it happens either way, but regular football keeps you sharper.
    rate *= 1 - A.declineReliefFromPlaying * playingFactor;
  }

  const next = clamp(ability + gap * rate + rng.gaussian(0, A.developmentNoise), 15, 99);
  calibrateAbility(player.attributes, player.position, next);
}

/**
 * Physical decline and mental growth happen regardless of overall level, so an
 * ageing playmaker keeps his vision while losing a yard of pace. Reads the age
 * he has just turned.
 */
function applyAgeShape(player: Player): void {
  const A = AGING_TUNING;
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
}

// --- Developing through the season ------------------------------------------

/*
 * A career develops players a little at a time through the season rather than
 * all at once at the end of it, so a manager can watch a prospect come on and
 * see what his training is doing. The harnesses keep `developPlayer`: the steps
 * are built to land, on average, exactly where it does, which is what keeps the
 * benchmarks it was tuned against meaningful.
 */

/** Which attributes each training focus works on. */
export const TRAINING_FOCUS_KEYS: Record<TrainingFocus, readonly AttributeKey[]> = {
  balanced: [],
  finishing: ['finishing', 'composure', 'dribbling'],
  passing: ['passing', 'vision', 'crossing'],
  defending: ['tackling', 'positioning', 'workRate'],
  physical: ['pace', 'strength', 'stamina'],
  aerial: ['heading', 'strength'],
  goalkeeping: ['reflexes', 'handling', 'distribution'],
};

export const TRAINING_TUNING = {
  /** How much faster a focused attribute grows than an unfocused one. */
  focusedMultiplier: 2.5,
  unfocusedMultiplier: 0.6,
  /**
   * Share of a step's growth spent on focused attributes his position does not
   * use -- finishing for a centre half. They make him a different player, not a
   * better one where he plays, and the cost is real: it comes out of his growth.
   */
  offPositionShare: 0.3,
  /** Ability-equivalent weight that off-position share is spread at. */
  offPositionWeight: 0.25,
} as const;

/**
 * His ability to the decimal: what the attributes say, plus whatever growth has
 * accumulated below a whole attribute point and not landed yet. Whole-number
 * attributes would otherwise swallow every small step.
 */
export function exactAbility(player: Player): number {
  const weights = POSITION_WEIGHTS[player.position];
  let total = abilityIn(player.attributes, player.position) + (player.abilityCarry ?? 0);
  for (const [key, amount] of Object.entries(player.progress ?? {})) {
    total += (weights[key as AttributeKey] ?? 0) * (amount ?? 0);
  }
  return total;
}

export interface DevelopmentStepContext extends DevelopmentContext {
  /** Share of the season this step covers, 0 to 1. Steps in a season sum to 1. */
  fraction: number;
  focus?: TrainingFocus;
}

/**
 * One step of a season's development. Uses the age he will turn at the end of
 * it, as `developPlayer` does, and converts its once-a-season rate so that steps
 * covering a whole season close the same share of the gap. Returns the change
 * in ability.
 */
export function developStep(rng: Rng, player: Player, context: DevelopmentStepContext): number {
  const A = AGING_TUNING;
  if (context.fraction <= 0) return 0;

  const ability = exactAbility(player);
  const target = player.hiddenPotential * developmentFactor(player.age + 1);
  const gap = target - ability;

  const available = Math.max(1, context.seasonMatches * 90);
  const share = clamp(context.minutes / available, 0, 1);
  const playingFactor = Math.min(1, share / A.fullMinutesShare);

  let rate = rng.float(A.developmentRateMin, A.developmentRateMax);
  if (gap > 0) {
    rate *= (A.benchDevelopmentFloor + (1 - A.benchDevelopmentFloor) * playingFactor) * context.coaching;
  } else {
    rate *= 1 - A.declineReliefFromPlaying * playingFactor;
  }
  // Closing r of the gap once is closing 1-(1-r)^f of it in each of 1/f steps.
  const stepRate = 1 - Math.pow(1 - Math.min(rate, 0.99), context.fraction);
  const noise = rng.gaussian(0, A.developmentNoise * Math.sqrt(context.fraction));
  const next = clamp(ability + gap * stepRate + noise, 15, 99);

  const focusKeys = TRAINING_FOCUS_KEYS[context.focus ?? 'balanced'];
  if (focusKeys.length === 0) applyUniform(player, next);
  else applyFocused(player, next - ability, focusKeys);
  return next - ability;
}

/** Lands a new ability evenly across the attributes his position uses. */
function applyUniform(player: Player, next: number): void {
  // Anything a focus left half-landed is already counted in `next`.
  delete player.progress;
  calibrateAbility(player.attributes, player.position, next);
  setCarry(player, next - abilityIn(player.attributes, player.position));
}

function setCarry(player: Player, carry: number): void {
  if (Math.abs(carry) < 0.001) delete player.abilityCarry;
  else player.abilityCarry = Math.round(carry * 1000) / 1000;
}

/**
 * Lands a change mostly on the focused attributes. Each attribute keeps its own
 * fraction of a point until it adds up to a whole one, so a focus shows up as
 * those numbers climbing while the rest hold still.
 */
function applyFocused(player: Player, change: number, focusKeys: readonly AttributeKey[]): void {
  const T = TRAINING_TUNING;
  const weights = POSITION_WEIGHTS[player.position];
  const relevant = (Object.keys(weights) as AttributeKey[]).filter((k) => weights[k] !== undefined);
  const offPosition = focusKeys.filter((k) => weights[k] === undefined);
  // Only growth is redirected; a decline falls where it falls.
  const onShare = change > 0 && offPosition.length > 0 ? 1 - T.offPositionShare : 1;

  const multiplier = (key: AttributeKey) =>
    change > 0 && focusKeys.includes(key) ? T.focusedMultiplier : change > 0 ? T.unfocusedMultiplier : 1;
  const denominator = relevant.reduce((sum, k) => sum + weights[k]! * multiplier(k), 0);

  const progress = { ...(player.progress ?? {}) };
  // The carry belongs to the uniform path; fold it in where it will land.
  const carry = player.abilityCarry ?? 0;
  delete player.abilityCarry;

  const add = (key: AttributeKey, amount: number) => {
    const total = (progress[key] ?? 0) + amount;
    const whole = Math.trunc(total);
    const before = player.attributes[key];
    player.attributes[key] = clamp(before + whole, 1, 99);
    const rest = total - whole;
    if (Math.abs(rest) < 0.001) delete progress[key];
    else progress[key] = Math.round(rest * 1000) / 1000;
  };

  for (const key of relevant) {
    add(key, ((change * onShare + carry) * multiplier(key)) / denominator);
  }
  if (onShare < 1) {
    const each = (change * (1 - onShare)) / (offPosition.length * T.offPositionWeight);
    for (const key of offPosition) add(key, each);
  }

  if (Object.keys(progress).length === 0) delete player.progress;
  else player.progress = progress;
}

/**
 * The once-a-season half of ageing, for a player who developed through the
 * season: he turns a year older and his attributes change shape -- pace going,
 * reading of the game coming.
 *
 * `developPlayer` changes the shape first and then closes a share of the gap
 * from there, so part of what the shape added survives the close: the share the
 * gap-closing does not take back. The same share survives here, which is what
 * keeps the two paths level for players who barely develop at all.
 */
export function agePlayerKeepingAbility(
  player: Player,
  context: DevelopmentContext = DEFAULT_CONTEXT,
): void {
  const A = AGING_TUNING;
  const before = exactAbility(player);
  const rawBefore = abilityIn(player.attributes, player.position);
  player.age += 1;
  applyAgeShape(player);
  const shapeChange = abilityIn(player.attributes, player.position) - rawBefore;

  const gap = player.hiddenPotential * developmentFactor(player.age) - before;
  const share = clamp(context.minutes / Math.max(1, context.seasonMatches * 90), 0, 1);
  const playingFactor = Math.min(1, share / A.fullMinutesShare);
  const meanRate = (A.developmentRateMin + A.developmentRateMax) / 2;
  const rate =
    gap > 0
      ? meanRate * (A.benchDevelopmentFloor + (1 - A.benchDevelopmentFloor) * playingFactor) * context.coaching
      : meanRate * (1 - A.declineReliefFromPlaying * playingFactor);

  const next = clamp(before + shapeChange * (1 - Math.min(rate, 1)), 15, 99);
  delete player.progress;
  calibrateAbility(player.attributes, player.position, next);
  setCarry(player, next - abilityIn(player.attributes, player.position));
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
      // An academy the club has spent more on turns out better players.
      potentialTarget: clamp(targetAbility(club.reputation) - 2 + academyBoost(club), 25, 88),
      age: rng.int(16, 19),
      domesticPool,
      takenNames,
    });
    // Academy graduates sign cheap short deals.
    youth.contract = { wage: Math.round(expectedWage(youth) * 0.65), yearsRemaining: rng.int(2, 4) };

    promoted.push(youth);
    counts.set(neediest, (counts.get(neediest) ?? 0) + 1);
  }

  for (const player of promoted) joinSquad(club, player);
  return promoted;
}
