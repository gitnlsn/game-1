import { Rng, clamp } from '../rng/index.js';
import type { Club, MatchEvent, MatchResult, Player } from '../types.js';
import { computeTeamRating, selectLineup, type Lineup, type TeamRating } from './ratings.js';

/**
 * Every magic number in the match engine lives here. These are calibrated
 * against real top-division benchmarks (see analysis/validate.ts):
 *   ~2.75 goals per match, ~44% home wins, ~25% draws, ~26 shots per match.
 * Change one number, re-run `pnpm sim validate`, and check the whole profile.
 */
export const MATCH_TUNING = {
  /** Probability a given minute contains a meaningful attacking sequence. */
  attackRate: 0.53,
  /** Multiplier applied to the home side's ratings. */
  homeAdvantage: 1.045,
  /** Extra share of possession for the home side. */
  homePossessionBias: 0.02,
  /** Exponent on the midfield ratio when deriving possession. Higher = more dominant. */
  possessionExponent: 1.35,
  /** Baseline chance an attacking sequence produces a shot, at even strength. */
  shotBase: 0.5,
  /**
   * Ceilings on how far quality can push a single sequence. Even a dominant side
   * faces a packed penalty area: without these the advantages stack
   * multiplicatively and produce far too many 5-0s.
   */
  shotChanceCeiling: 0.72,
  conversionCeiling: 0.55,
  /** Exponent on the attack-vs-defence ratio when creating a shot. */
  shotExponent: 1.2,
  /** Baseline chance a shot is on target. */
  onTargetBase: 0.35,
  /** Baseline chance an on-target shot beats the keeper. */
  conversionBase: 0.315,
  /** Exponent on shooter-vs-keeper quality when converting. */
  conversionExponent: 1.0,
  /** Share of goals that are credited an assist. */
  assistRate: 0.66,
  /** Hard bounds on the form multiplier, so no side turns up 35% better than itself. */
  formFloor: 0.84,
  formCeiling: 1.16,
  /**
   * Standard deviation of a team's per-match performance multiplier. Real sides
   * have good and bad days; without this the stronger squad wins too reliably
   * and the title race becomes a formality.
   */
  performanceVariance: 0.09,
  /**
   * Score-state effect: from the hour mark a trailing side commits more players
   * forward and a leading side sits deeper. Produces late comebacks and pushes
   * the draw rate toward the real-world figure.
   */
  chasingBoost: 0.12,
  chasingFrom: 50,
  /** Fatigue drag applied to a tiring side in the closing stages. */
  fatigueFrom: 70,
  fatigueMax: 0.06,
} as const;

export interface SimulateMatchOptions {
  /** Neutral venue: no home advantage or crowd possession bias. */
  neutral?: boolean;
  homeFormation?: string;
  awayFormation?: string;
}

interface TeamState {
  club: Club;
  lineup: Lineup;
  rating: TeamRating;
  goals: number;
  shots: number;
  shotsOnTarget: number;
  /** Average stamina of the XI, used for the late-game fatigue drag. */
  stamina: number;
}

export function simulateMatch(
  rng: Rng,
  homeClub: Club,
  awayClub: Club,
  options: SimulateMatchOptions = {},
): MatchResult {
  const T = MATCH_TUNING;
  const boost = options.neutral ? 1 : T.homeAdvantage;

  // Form on the day, rolled once per team per match.
  const homeForm = clamp(rng.gaussian(1, T.performanceVariance), T.formFloor, T.formCeiling);
  const awayForm = clamp(rng.gaussian(1, T.performanceVariance), T.formFloor, T.formCeiling);

  const home = createTeamState(homeClub, options.homeFormation, boost * homeForm);
  const away = createTeamState(awayClub, options.awayFormation, awayForm);

  // Possession follows midfield control, sharpened by an exponent so that a
  // clearly better midfield actually dominates the ball.
  const homeMid = Math.pow(home.rating.midfield, T.possessionExponent);
  const awayMid = Math.pow(away.rating.midfield, T.possessionExponent);
  const homePossession = clamp(
    homeMid / (homeMid + awayMid) + (options.neutral ? 0 : T.homePossessionBias),
    0.2,
    0.8,
  );

  const events: MatchEvent[] = [];
  const stoppage = rng.int(1, 5);
  const finalMinute = 90 + stoppage;

  for (let minute = 1; minute <= finalMinute; minute++) {
    if (!rng.chance(T.attackRate)) continue;

    const homeAttacking = rng.chance(homePossession);
    const attacker = homeAttacking ? home : away;
    const defender = homeAttacking ? away : home;

    resolveAttack(rng, attacker, defender, minute, events);
  }

  return {
    homeClubId: homeClub.id,
    awayClubId: awayClub.id,
    home: {
      clubId: homeClub.id,
      goals: home.goals,
      shots: home.shots,
      shotsOnTarget: home.shotsOnTarget,
      possession: Math.round(homePossession * 100),
    },
    away: {
      clubId: awayClub.id,
      goals: away.goals,
      shots: away.shots,
      shotsOnTarget: away.shotsOnTarget,
      possession: 100 - Math.round(homePossession * 100),
    },
    events,
  };
}

function createTeamState(club: Club, formation: string | undefined, boost: number): TeamState {
  const lineup = selectLineup(club, formation);
  const base = computeTeamRating(lineup);
  const stamina =
    lineup.slots.reduce((sum, slot) => sum + slot.player.attributes.stamina, 0) / lineup.slots.length;

  return {
    club,
    lineup,
    rating: {
      attack: base.attack * boost,
      midfield: base.midfield * boost,
      defence: base.defence * boost,
      goalkeeping: base.goalkeeping * boost,
    },
    goals: 0,
    shots: 0,
    shotsOnTarget: 0,
    stamina,
  };
}

/** Legs go late in the game, and the fitter side suffers less. */
function fatigueMultiplier(team: TeamState, minute: number): number {
  const T = MATCH_TUNING;
  if (minute <= T.fatigueFrom) return 1;
  const progress = (minute - T.fatigueFrom) / (95 - T.fatigueFrom);
  const staminaShortfall = clamp((70 - team.stamina) / 40, 0, 1);
  return 1 - T.fatigueMax * progress * staminaShortfall;
}

/** Teams chasing a game attack harder; teams protecting a lead attack less. */
function chasingMultiplier(attacker: TeamState, defender: TeamState, minute: number): number {
  const T = MATCH_TUNING;
  if (minute <= T.chasingFrom) return 1;
  const lead = clamp(attacker.goals - defender.goals, -3, 3);
  return 1 - lead * T.chasingBoost;
}

function resolveAttack(
  rng: Rng,
  attacker: TeamState,
  defender: TeamState,
  minute: number,
  events: MatchEvent[],
): void {
  const T = MATCH_TUNING;

  const chase = chasingMultiplier(attacker, defender, minute);
  const attackStrength = attacker.rating.attack * fatigueMultiplier(attacker, minute) * chase;
  const defenceStrength = defender.rating.defence * fatigueMultiplier(defender, minute);

  // Ratio sits at 0.5 when evenly matched; the exponent turns a small quality
  // edge into a meaningfully larger share of chances.
  const edge = attackStrength / (attackStrength + defenceStrength);
  const shotChance = clamp(T.shotBase * Math.pow(edge / 0.5, T.shotExponent), 0.05, T.shotChanceCeiling);
  if (!rng.chance(shotChance)) return;

  const shooter = pickShooter(rng, attacker);
  attacker.shots++;
  events.push({ minute, type: 'shot', clubId: attacker.club.id, playerId: shooter.id });

  const accuracy = clamp(
    T.onTargetBase * Math.pow(shooter.attributes.composure / 55, 0.5),
    0.15,
    0.65,
  );
  if (!rng.chance(accuracy)) {
    events.push({ minute, type: 'chance_missed', clubId: attacker.club.id, playerId: shooter.id });
    return;
  }

  attacker.shotsOnTarget++;
  events.push({ minute, type: 'shot_on_target', clubId: attacker.club.id, playerId: shooter.id });

  // Finishing quality against the keeper decides whether it goes in.
  const finishing = (shooter.attributes.finishing * 0.7 + shooter.attributes.composure * 0.3);
  const keeper = defender.rating.goalkeeping;
  const conversion = clamp(
    T.conversionBase * Math.pow(finishing / keeper, T.conversionExponent),
    0.08,
    T.conversionCeiling,
  );
  if (!rng.chance(conversion)) return;

  attacker.goals++;
  const assist = rng.chance(T.assistRate) ? pickAssister(rng, attacker, shooter) : undefined;
  events.push({
    minute,
    type: 'goal',
    clubId: attacker.club.id,
    playerId: shooter.id,
    ...(assist ? { assistPlayerId: assist.id } : {}),
  });
}

/** Attacking players shoot most, weighted by how dangerous they are. */
const SHOOTING_SHARE: Record<string, number> = {
  ST: 6, LW: 5.5, RW: 5.5, AM: 4.5, CM: 3.2, DM: 1.6, LB: 1.3, RB: 1.3, CB: 1.3, GK: 0.02,
};

function pickShooter(rng: Rng, team: TeamState): Player {
  return rng.pickWeighted(team.lineup.slots, (slot) => {
    const share = SHOOTING_SHARE[slot.position] ?? 1;
    const quality = (slot.player.attributes.finishing + slot.player.attributes.positioning) / 2;
    // Dampened so the best finisher shoots more, but does not monopolise the attack.
    return share * Math.pow(Math.max(quality, 10) / 60, 1.0);
  }).player;
}

/** Creators assist most, weighted by vision, passing and crossing. */
const ASSIST_SHARE: Record<string, number> = {
  AM: 8, LW: 7, RW: 7, CM: 6, ST: 4, DM: 2, LB: 2.5, RB: 2.5, CB: 0.5, GK: 0.1,
};

function pickAssister(rng: Rng, team: TeamState, scorer: Player): Player {
  const candidates = team.lineup.slots.filter((slot) => slot.player.id !== scorer.id);
  return rng.pickWeighted(candidates, (slot) => {
    const share = ASSIST_SHARE[slot.position] ?? 1;
    const attrs = slot.player.attributes;
    const quality = (attrs.vision + attrs.passing + attrs.crossing) / 3;
    return share * Math.max(quality, 5);
  }).player;
}
