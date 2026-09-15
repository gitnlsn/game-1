import { Rng, clamp } from '../rng/index.js';
import type { Club, MatchEvent, MatchResult, Player, Position, TeamSheet } from '../types.js';
import { STATUS_TUNING } from '../world/status.js';
import {
  computeTeamRating,
  effectiveness,
  resolveTeamSheet,
  toSlot,
  type Lineup,
  type LineupSlot,
  type TeamRating,
} from './ratings.js';
import { resolveTactics, tacticShapes, type Tactics, type TacticShapes } from './tactics.js';

/**
 * Every magic number in the match engine lives here. These are calibrated
 * against real top-division benchmarks (see analysis/validate.ts):
 *   ~2.75 goals per match, ~44% home wins, ~25% draws, ~26 shots per match,
 *   ~3.9 yellows and ~0.1 reds per match.
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
  shotExponent: 0.7,
  /** Baseline chance a shot is on target. */
  onTargetBase: 0.35,
  /** Baseline chance an on-target shot beats the keeper. */
  conversionBase: 0.288,
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
  performanceVariance: 0.05,
  /**
   * Score-state effect: from the hour mark a trailing side commits more players
   * forward and a leading side sits deeper. Produces late comebacks and pushes
   * the draw rate toward the real-world figure.
   */
  chasingBoost: 0.7,
  /**
   * The other half of the score-state effect. A side protecting a lead drops
   * deeper and defends it, which is what stops a two-goal win becoming a five.
   * Only the attacking half of this was modelled, despite the comment above
   * describing both.
   */
  shellBoost: 0.25,
  /**
   * Score effects ramp in from here rather than switching on at a threshold: a
   * lead changes how a side plays a little at the half hour and a great deal in
   * the last ten minutes, and the clock running down is the reason.
   */
  gameStateFrom: 10,
  /** Bounds on what the scoreline can do to a side's attack or defence. */
  gameStateFloor: 0.5,
  gameStateCeiling: 1.7,
  /**
   * How much the individual matchup swings chance creation, on top of the team
   * ratings. This is what stops two players of equal overall ability being
   * interchangeable: a quick, direct forward against a slow defender creates
   * chances a team rating cannot express.
   */
  duelExponent: 0.75,
  /**
   * How far an individual matchup is allowed to swing the chance of a shot. At 1
   * the raw contest applies in full; lower values pull it toward even.
   *
   * This is separate from whether attributes matter: who takes the chance, who
   * defends it, whether it comes through the air and who gets on the rebound are
   * all decided by attributes at full strength regardless. This constant only
   * sets how much a mismatch multiplies the *rate* of chances, which is what
   * drives the scoreline spread.
   */
  duelWeight: 0.8,
  /** Share of chances delivered into the box rather than worked on the ground. */
  aerialShare: 0.22,
  /** Chance a save is spilled, before the keeper's handling is applied. */
  reboundBase: 0.14,
  /** Conversion of a rebound: a scrappy chance, but from close range. */
  reboundConversion: 0.34,
  /** In-match tiring of an individual, for a player with no stamina to speak of. */
  inMatchConditionDrain: 0.1,
  /** Fatigue drag applied to a tiring side in the closing stages. */
  fatigueFrom: 70,
  fatigueMax: 0.06,

  // --- Discipline, injuries and substitutions ---
  /** Yellow and red cards per team-minute, tuned to ~3.9 and ~0.1 per match. */
  yellowRate: 0.0205,
  directRedRate: 0.00015,
  /** Injuries per team-minute. */
  injuryRate: 0.0032,
  /**
   * How much less likely an already-booked player is to be booked again. They
   * play carefully and the manager often takes them off. Without this, second
   * yellows alone produce several times the real rate of sendings-off.
   */
  bookedOffenceWeight: 0.22,
  /**
   * A substitution is worth making even if the replacement is slightly weaker:
   * managers rest starters and give squad players minutes, they do not only
   * substitute for an immediate upgrade.
   */
  substitutionGainThreshold: -5,
  /** Substitutions a side may make. Five has been the norm since 2022. */
  maxSubstitutions: 5,
  /** Window in which tactical substitutions are considered. */
  firstSubMinute: 46,
  lastSubMinute: 82,
  /** How much a full match drains a player with average stamina. */
  conditionCostPer90: 22,
  /** In-match drop-off used when deciding whether to take a player off. */
  inMatchFatigue: 0.14,
  /** Rating penalties per man short, applied to each phase. */
  shorthandedAttack: 0.85,
  shorthandedMidfield: 0.88,
  shorthandedDefence: 0.91,
} as const;

export interface SimulateMatchOptions {
  /** Neutral venue: no home advantage or crowd possession bias. */
  neutral?: boolean;
  /**
   * A manager's team sheet. Omitted for a club the engine picks for, which is
   * every AI club and any human club that has not set one.
   */
  homeSheet?: TeamSheet;
  awaySheet?: TeamSheet;
  /**
   * Treat this as a real fixture: record minutes and goals, drain condition, and
   * apply cards and injuries to the players involved. Off by default so a one-off
   * simulation can be run without mutating the world.
   */
  updatePlayerState?: boolean;
  /**
   * Length of the period in minutes. Defaults to ninety plus stoppage.
   *
   * Extra time is the same engine run for thirty more, so form, instructions and
   * a sending off all still apply rather than a knockout being decided by a coin
   * dressed up as football.
   */
  minutes?: number;
  /**
   * Clock reading at kick-off. Extra time passes 90, so the fatigue curve, the
   * score-state effect and the minute on every event all read the real time in
   * the tie rather than restarting -- run as its own little match from minute 1,
   * extra time would be played by fresh legs, which is precisely wrong.
   */
  startMinute?: number;
  /** Overrides the chance a minute contains an attacking sequence. */
  attackRate?: number;
  /**
   * The side a manager is running by hand. That side makes no substitutions of
   * its own, so the engine cannot undo his team while he watches it play.
   */
  manualSide?: 'home' | 'away';
}

interface TeamState {
  club: Club;
  lineup: Lineup;
  /** The manager's instructions. Balanced for every side that has not set any. */
  tactics: Tactics;
  /** What those instructions do, precomputed. All neutral for a Balanced side. */
  shapes: TacticShapes;
  /** Multiplier covering home advantage and today's form. */
  boost: number;
  rating: TeamRating;
  /** Keeper quality before home advantage and form, for the shooter-vs-keeper duel. */
  goalkeepingBase: number;
  /** Shot-stopping alone: reflexes and positioning, not ball-playing. */
  keeperShotStopping: number;
  /** How cleanly the keeper holds what he reaches. Low handling spills rebounds. */
  keeperHandling: number;
  /** Feeds possession retention. */
  keeperDistribution: number;
  goals: number;
  shots: number;
  shotsOnTarget: number;
  stamina: number;
  /** The eleven currently on the pitch; fewer after a sending off. */
  onPitch: LineupSlot[];
  bench: Player[];
  enteredAt: Map<string, number>;
  minutes: Map<string, number>;
  /** Yellows picked up in this match, for detecting a second booking. */
  bookings: Set<string>;
  /** Players who pulled up hurt; length of lay-off is rolled after the match. */
  injured: Set<string>;
  substitutionsUsed: number;
}

/**
 * A match being played a minute at a time.
 *
 * `simulateMatch` is built on exactly these functions, so the whole-match path
 * and the stepped one consume the generator identically and produce the same
 * football. That equivalence is the point: a live match must not be a second
 * implementation that drifts from the one every benchmark is calibrated against.
 */
export interface MatchInProgress {
  rng: Rng;
  home: TeamState;
  away: TeamState;
  events: MatchEvent[];
  /** Minutes played so far. The next `stepMatch` plays `minute + 1`. */
  minute: number;
  finalMinute: number;
  possessionSum: number;
  possessionMinutes: number;
  options: SimulateMatchOptions;
  attackRate: number;
  neutral: boolean;
}

export function startMatch(
  rng: Rng,
  homeClub: Club,
  awayClub: Club,
  options: SimulateMatchOptions = {},
): MatchInProgress {
  const T = MATCH_TUNING;
  const venueBoost = options.neutral ? 1 : T.homeAdvantage;

  // Form on the day, rolled once per team per match.
  const homeForm = clamp(rng.gaussian(1, T.performanceVariance), T.formFloor, T.formCeiling);
  const awayForm = clamp(rng.gaussian(1, T.performanceVariance), T.formFloor, T.formCeiling);

  const home = createTeamState(homeClub, options.homeSheet, venueBoost * homeForm);
  const away = createTeamState(awayClub, options.awaySheet, awayForm);

  const startMinute = options.startMinute ?? 0;
  const stoppage = rng.int(1, 5);

  return {
    rng,
    home,
    away,
    events: [],
    minute: startMinute,
    finalMinute: startMinute + (options.minutes ?? 90) + stoppage,
    possessionSum: 0,
    possessionMinutes: 0,
    options,
    attackRate: options.attackRate ?? T.attackRate,
    neutral: options.neutral === true,
  };
}

export function matchComplete(match: MatchInProgress): boolean {
  return match.minute >= match.finalMinute;
}

/** Plays the next minute. Returns whatever happened in it, which is often nothing. */
export function stepMatch(match: MatchInProgress): MatchEvent[] {
  if (matchComplete(match)) return [];

  const { rng, home, away, options } = match;
  const minute = match.minute + 1;
  const before = match.events.length;

  resolveDiscipline(rng, home, away, minute, match.events);
  resolveInjuries(rng, home, away, minute, match.events);
  /*
   * A side under manual control makes no substitutions of its own. Leaving the
   * automatic ones on would mean the engine quietly undoing a manager's team
   * while he was watching it play.
   */
  if (options.manualSide !== 'home') considerSubstitutions(rng, home, minute, match.events);
  if (options.manualSide !== 'away') considerSubstitutions(rng, away, minute, match.events);

  const homePossession = possessionShare(home, away, match.neutral);
  match.possessionSum += homePossession;
  match.possessionMinutes++;

  if (rng.chance(match.attackRate)) {
    const homeAttacking = rng.chance(homePossession);
    const attacker = homeAttacking ? home : away;
    const defender = homeAttacking ? away : home;
    resolveAttack(rng, attacker, defender, minute, match.events);
  }

  match.minute = minute;
  return match.events.slice(before);
}

/** Blows the whistle and writes the result. */
export function finishMatch(match: MatchInProgress): MatchResult {
  const { rng, home, away, options, events } = match;

  if (options.updatePlayerState) {
    applyPlayerState(rng, home, match.finalMinute, away.goals);
    applyPlayerState(rng, away, match.finalMinute, home.goals);
    applyEventOutcomes(rng, events, [home, away]);
  }

  const homeShare =
    match.possessionMinutes > 0 ? match.possessionSum / match.possessionMinutes : 0.5;

  return {
    homeClubId: home.club.id,
    awayClubId: away.club.id,
    home: {
      clubId: home.club.id,
      goals: home.goals,
      shots: home.shots,
      shotsOnTarget: home.shotsOnTarget,
      possession: Math.round(homeShare * 100),
    },
    away: {
      clubId: away.club.id,
      goals: away.goals,
      shots: away.shots,
      shotsOnTarget: away.shotsOnTarget,
      possession: 100 - Math.round(homeShare * 100),
    },
    events,
  };
}

// --- In-match control ------------------------------------------------------

export type SubstitutionRefusal =
  | 'not_on_pitch'
  | 'not_on_bench'
  | 'none_left'
  | 'wrong_side';

export interface MatchSideView {
  clubId: string;
  goals: number;
  /** Who is on the pitch, with the position each is filling. */
  onPitch: { player: Player; position: Position; minutesPlayed: number }[];
  bench: Player[];
  substitutionsUsed: number;
  substitutionsLeft: number;
  tactics: Tactics;
}

/** What a manager can see of his side right now, for a screen to render. */
export function matchSide(match: MatchInProgress, side: 'home' | 'away'): MatchSideView {
  const team = side === 'home' ? match.home : match.away;
  const T = MATCH_TUNING;

  return {
    clubId: team.club.id,
    goals: team.goals,
    onPitch: team.onPitch.map((slot) => ({
      player: slot.player,
      position: slot.position,
      minutesPlayed: match.minute - (team.enteredAt.get(slot.player.id) ?? 0),
    })),
    bench: [...team.bench],
    substitutionsUsed: team.substitutionsUsed,
    substitutionsLeft: Math.max(0, T.maxSubstitutions - team.substitutionsUsed),
    tactics: team.tactics,
  };
}

/**
 * Makes a substitution on the manager's instruction.
 *
 * Uses exactly the machinery the automatic ones use, so a manual change is worth
 * what an engine one would be -- no bonus for being made by hand, and none of
 * the engine's own judgement applied to it either.
 */
export function substitute(
  match: MatchInProgress,
  side: 'home' | 'away',
  offPlayerId: string,
  onPlayerId: string,
): { done: boolean; reason?: SubstitutionRefusal } {
  const T = MATCH_TUNING;
  if (match.options.manualSide !== side) return { done: false, reason: 'wrong_side' };

  const team = side === 'home' ? match.home : match.away;
  if (team.substitutionsUsed >= T.maxSubstitutions) return { done: false, reason: 'none_left' };

  const outSlot = team.onPitch.find((slot) => slot.player.id === offPlayerId);
  if (!outSlot) return { done: false, reason: 'not_on_pitch' };

  const inPlayer = team.bench.find((player) => player.id === onPlayerId);
  if (!inPlayer) return { done: false, reason: 'not_on_bench' };

  team.onPitch = team.onPitch.filter((slot) => slot.player.id !== offPlayerId);
  creditMinutes(team, offPlayerId, match.minute);
  bringOn(team, inPlayer, outSlot.position, match.minute, match.events, offPlayerId);
  refreshRating(team);

  return { done: true };
}

/**
 * Changes how a side is set up mid-match.
 *
 * The ratings are rebuilt straight away, so the change applies from the next
 * minute rather than at some later recalculation -- a manager who goes attacking
 * chasing a game at 80 minutes has ten minutes of it, not none.
 */
export function changeMatchTactics(
  match: MatchInProgress,
  side: 'home' | 'away',
  patch: Partial<Tactics>,
): Tactics {
  const team = side === 'home' ? match.home : match.away;
  team.tactics = resolveTactics({ ...team.tactics, ...patch });
  team.shapes = tacticShapes(team.tactics);
  refreshRating(team);
  return team.tactics;
}

export function simulateMatch(
  rng: Rng,
  homeClub: Club,
  awayClub: Club,
  options: SimulateMatchOptions = {},
): MatchResult {
  const match = startMatch(rng, homeClub, awayClub, options);
  while (!matchComplete(match)) stepMatch(match);
  return finishMatch(match);
}

function createTeamState(club: Club, sheet: TeamSheet | undefined, boost: number): TeamState {
  const { lineup } = resolveTeamSheet(club, sheet);
  const tactics = resolveTactics(sheet?.tactics);
  const stamina =
    lineup.slots.reduce((sum, slot) => sum + slot.player.attributes.stamina, 0) / lineup.slots.length;

  const state: TeamState = {
    club,
    lineup,
    tactics,
    shapes: tacticShapes(tactics),
    boost,
    rating: { attack: 1, midfield: 1, defence: 1, goalkeeping: 1 },
    goalkeepingBase: 1,
    keeperShotStopping: 1,
    keeperHandling: 50,
    keeperDistribution: 50,
    goals: 0,
    shots: 0,
    shotsOnTarget: 0,
    stamina,
    onPitch: [...lineup.slots],
    bench: [...lineup.bench],
    enteredAt: new Map(lineup.slots.map((slot) => [slot.player.id, 0])),
    minutes: new Map(),
    bookings: new Set(),
    injured: new Set(),
    substitutionsUsed: 0,
  };

  refreshRating(state);
  return state;
}

/** Recomputes team ratings from whoever is currently on the pitch. */
function refreshRating(team: TeamState): void {
  const T = MATCH_TUNING;
  const base = computeTeamRating({ ...team.lineup, slots: team.onPitch });
  const short = Math.max(0, 11 - team.onPitch.length);

  team.goalkeepingBase = base.goalkeeping;

  /*
   * A keeper is no longer one number. Shot-stopping decides the duel, handling
   * decides whether what he saves stays saved, and distribution helps his side
   * keep the ball -- so two keepers of equal overall rating now play differently.
   */
  const keeper = team.onPitch.find((slot) => slot.position === 'GK')?.player;
  const keeperEffect = keeper ? effectiveness(keeper) : 1;
  /*
   * Spread across five attributes rather than two or three. Averaging fewer
   * inputs makes keeper quality more variable across the league, and a wider
   * spread between the best and worst keeper shows up directly as more lopsided
   * scorelines. Reflexes still lead; handling and distribution earn their keep
   * through the rebound and possession instead of through this number.
   */
  team.keeperShotStopping = keeper
    ? (keeper.attributes.reflexes * 0.4 +
        keeper.attributes.positioning * 0.22 +
        keeper.attributes.composure * 0.16 +
        keeper.attributes.handling * 0.12 +
        keeper.attributes.strength * 0.1) *
      keeperEffect
    : base.goalkeeping;
  team.keeperHandling = keeper ? keeper.attributes.handling * keeperEffect : 50;
  team.keeperDistribution = keeper ? keeper.attributes.distribution : 50;

  // Recomputed here, not once at kickoff: bringing on fresh legs has to reduce
  // how tired the side is.
  team.stamina =
    team.onPitch.reduce((sum, slot) => sum + slot.player.attributes.stamina, 0) /
    Math.max(1, team.onPitch.length);
  /*
   * Instructions reshape the side rather than improving it. Attacking commits
   * men forward, which is worth exactly as much threat as it costs cover;
   * pressing buys the ball higher up the pitch with the space behind the line.
   * Both are no-ops at 0, so a side with no instructions is untouched.
   */
  team.rating = {
    attack: base.attack * team.boost * Math.pow(T.shorthandedAttack, short) * team.shapes.attack,
    midfield: base.midfield * team.boost * Math.pow(T.shorthandedMidfield, short),
    defence: base.defence * team.boost * Math.pow(T.shorthandedDefence, short) * team.shapes.defence,
    goalkeeping: base.goalkeeping * team.boost,
  };
}

/**
 * Share of the ball the home side has right now. Midfield control decides it,
 * sharpened by an exponent, with the keeper's distribution worth a little: a
 * keeper who can play keeps possession alive.
 */
function possessionShare(home: TeamState, away: TeamState, neutral: boolean): number {
  const T = MATCH_TUNING;
  /*
   * Pressing wins the ball back higher up, so a pressing side sees more of it;
   * playing direct gives it away sooner, and sitting deep concedes territory.
   * All folded in before the exponent, where they read as control rather than as
   * a thumb on the final share.
   */
  const control = (team: TeamState) =>
    Math.pow(
      team.rating.midfield * (1 + (team.keeperDistribution - 50) / 500) * team.shapes.control,
      T.possessionExponent,
    );

  const homeControl = control(home);
  return clamp(
    homeControl / (homeControl + control(away)) + (neutral ? 0 : T.homePossessionBias),
    0.2,
    0.8,
  );
}

/**
 * How much of their ability a player brings *right now*, including how long they
 * have been on the pitch. `effectiveness` alone reads the condition they started
 * with, which does not move until after the final whistle.
 */
function matchEffectiveness(team: TeamState, player: Player, minute: number): number {
  const T = MATCH_TUNING;
  const played = Math.max(0, minute - (team.enteredAt.get(player.id) ?? 0));
  const shortfall = clamp((75 - player.attributes.stamina) / 50, 0, 1);
  return effectiveness(player) * (1 - T.inMatchConditionDrain * clamp(played / 90, 0, 1.1) * shortfall);
}

/** Legs go late in the game, and the fitter side suffers less. */
function fatigueMultiplier(team: TeamState, minute: number): number {
  const T = MATCH_TUNING;
  if (minute <= T.fatigueFrom) return 1;
  const progress = (minute - T.fatigueFrom) / (95 - T.fatigueFrom);
  const staminaShortfall = clamp((70 - team.stamina) / 40, 0, 1);
  /*
   * Chasing the ball for an hour is what a press costs, and it comes due late.
   * It is ADDED to the stamina shortfall rather than multiplying it: as a
   * multiplier it was worth nothing, because any side with stamina over 70 has
   * no shortfall to multiply and so pressed for free. A pressing side runs more
   * than it otherwise would however fit it is.
   */
  const load = clamp(staminaShortfall + team.shapes.fatigueLoad, 0, 1.5);
  return 1 - T.fatigueMax * progress * load;
}

/** Teams chasing a game attack harder; teams protecting a lead attack less. */
/** How strongly the scoreline is shaping play, 0 early and 1 at the whistle. */
function gameStateWeight(minute: number): number {
  const T = MATCH_TUNING;
  return clamp((minute - T.gameStateFrom) / (90 - T.gameStateFrom), 0, 1);
}

/**
 * How far ahead or behind a side is, for the purpose of shaping play. Capped,
 * but deliberately NOT saturating: a square-root response was tried and made
 * things worse, because it weakens the brake at exactly the two- and three-goal
 * margins where a comfortable win turns into a rout.
 */
function leadResponse(lead: number): number {
  return clamp(lead, -3, 3);
}

function chasingMultiplier(attacker: TeamState, defender: TeamState, minute: number): number {
  const T = MATCH_TUNING;
  const raw = 1 - leadResponse(attacker.goals - defender.goals) * T.chasingBoost * gameStateWeight(minute);
  // Clamped: a comfortable lead makes a side cautious, never negative. Without a
  // floor a large chasingBoost drives attack strength below zero, which makes the
  // attack-versus-defence ratio meaningless.
  return clamp(raw, T.gameStateFloor, T.gameStateCeiling);
}

/** A side defending a lead sits deeper and is harder to break down. */
function shellMultiplier(defender: TeamState, attacker: TeamState, minute: number): number {
  const T = MATCH_TUNING;
  const raw =
    1 + leadResponse(Math.max(0, defender.goals - attacker.goals)) * T.shellBoost * gameStateWeight(minute);
  return clamp(raw, T.gameStateFloor, T.gameStateCeiling);
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
  const defenceStrength =
    defender.rating.defence *
    fatigueMultiplier(defender, minute) *
    shellMultiplier(defender, attacker, minute);

  // Ratio sits at 0.5 when evenly matched; the exponent turns a small quality
  // edge into a meaningfully larger share of chances.
  const edge = attackStrength / (attackStrength + defenceStrength);

  /*
   * Worked on the ground, or delivered into the box? Width moves the balance,
   * and this is the axis that is genuinely about your players rather than about
   * risk: whether crosses are the right idea depends on who is attacking them.
   */
  const aerialShare = clamp(T.aerialShare + attacker.shapes.aerialShift, 0.02, 0.6);
  const aerial = rng.chance(aerialShare);
  const shooter = aerial ? pickAerialTarget(rng, attacker) : pickShooter(rng, attacker);
  const marker = pickDefender(rng, defender);

  /*
   * The individual matchup, on top of the team ratings. This is what makes a
   * named defender do something, and what separates two forwards of equal
   * overall ability: one beats his man for pace, the other wins it in the air.
   */
  const rawDuel = aerial
    ? contest(
        aerialThreat(shooter) * matchEffectiveness(attacker, shooter, minute),
        aerialResistance(marker) * matchEffectiveness(defender, marker, minute),
      )
    : contest(
        groundThreat(shooter) * matchEffectiveness(attacker, shooter, minute),
        groundResistance(marker) * matchEffectiveness(defender, marker, minute),
      );
  const duel = 0.5 + (rawDuel - 0.5) * T.duelWeight;

  // Direct play turns a sequence into a shot more often -- the ball spends less
  // time being kept and more time being played forward.
  const shotChance = clamp(
    T.shotBase *
      Math.pow(edge / 0.5, T.shotExponent) *
      Math.pow(duel / 0.5, T.duelExponent) *
      attacker.shapes.shot,
    0.05,
    T.shotChanceCeiling,
  );
  if (!rng.chance(shotChance)) return;

  const shooterEffect = matchEffectiveness(attacker, shooter, minute);
  recordShot(attacker, shooter, minute, events);

  const accuracy = clamp(
    T.onTargetBase * Math.pow((shooter.attributes.composure * shooterEffect) / 55, 0.5),
    0.15,
    0.65,
  );
  if (!rng.chance(accuracy)) {
    events.push({ minute, type: 'chance_missed', clubId: attacker.club.id, playerId: shooter.id });
    return;
  }

  recordShotOnTarget(attacker, shooter, minute, events);

  /*
   * Finishing a chance is a duel between two players, so both sides of it carry
   * the same adjustments: each player's own condition, form and morale, and
   * nothing else. Home advantage and team form belong to chance creation, where
   * they are already applied to the ratings -- folding them in here as well
   * counts them twice and inflates home scoring.
   */
  const finishing =
    (aerial
      ? shooter.attributes.heading * 0.7 + shooter.attributes.composure * 0.3
      : shooter.attributes.finishing * 0.7 + shooter.attributes.composure * 0.3) * shooterEffect;

  const conversion = clamp(
    T.conversionBase * Math.pow(finishing / defender.keeperShotStopping, T.conversionExponent),
    0.08,
    T.conversionCeiling,
  );

  if (rng.chance(conversion)) {
    scoreGoal(rng, attacker, shooter, minute, events);
    return;
  }

  // Saved -- but not every save is held. A keeper with poor hands spills it.
  const spill = clamp(T.reboundBase * (1 - defender.keeperHandling / 100), 0, 0.4);
  if (!rng.chance(spill)) return;

  const follower = pickShooter(rng, attacker);
  recordShot(attacker, follower, minute, events);
  recordShotOnTarget(attacker, follower, minute, events);
  if (rng.chance(T.reboundConversion)) scoreGoal(rng, attacker, follower, minute, events);
}

function recordShot(team: TeamState, player: Player, minute: number, events: MatchEvent[]): void {
  team.shots++;
  events.push({ minute, type: 'shot', clubId: team.club.id, playerId: player.id });
}

function recordShotOnTarget(
  team: TeamState,
  player: Player,
  minute: number,
  events: MatchEvent[],
): void {
  team.shotsOnTarget++;
  events.push({ minute, type: 'shot_on_target', clubId: team.club.id, playerId: player.id });
}

function scoreGoal(
  rng: Rng,
  team: TeamState,
  scorer: Player,
  minute: number,
  events: MatchEvent[],
): void {
  const T = MATCH_TUNING;
  team.goals++;
  const assist = rng.chance(T.assistRate) ? pickAssister(rng, team, scorer) : undefined;
  events.push({
    minute,
    type: 'goal',
    clubId: team.club.id,
    playerId: scorer.id,
    ...(assist ? { assistPlayerId: assist.id } : {}),
  });
}

/** A contest between two qualities, returning the attacker's share, 0-1. */
function contest(threat: number, resistance: number): number {
  return threat / Math.max(1, threat + resistance);
}

function groundThreat(player: Player): number {
  const a = player.attributes;
  return a.dribbling * 0.5 + a.pace * 0.35 + a.strength * 0.15;
}

function groundResistance(player: Player): number {
  const a = player.attributes;
  return a.tackling * 0.4 + a.positioning * 0.25 + a.pace * 0.2 + a.workRate * 0.15;
}

function aerialThreat(player: Player): number {
  const a = player.attributes;
  return a.heading * 0.65 + a.strength * 0.35;
}

function aerialResistance(player: Player): number {
  const a = player.attributes;
  return a.heading * 0.6 + a.strength * 0.3 + a.positioning * 0.1;
}

/** Who is defending the move. Centre backs most, forwards least. */
const DEFENDING_SHARE: Record<string, number> = {
  CB: 8, LB: 5, RB: 5, DM: 5, CM: 3, AM: 1.2, LW: 1, RW: 1, ST: 0.6, GK: 0,
};

function pickDefender(rng: Rng, team: TeamState): Player {
  const outfield = team.onPitch.filter((slot) => slot.position !== 'GK');
  if (outfield.length === 0) return team.onPitch[0]!.player;

  /*
   * Weighted by quality as well as position. A defence is organised: the better
   * defender reads the danger and gets there first, so he is involved more often
   * than his weaker partner. Picking uniformly exposes a side's weakest link as
   * often as its best and turns an uneven defence into a rout.
   */
  return rng.pickWeighted(outfield, (slot) => {
    const share = DEFENDING_SHARE[slot.position] ?? 2;
    return share * Math.max(10, groundResistance(slot.player)) / 60;
  }).player;
}

/** Who attacks a ball into the box. Height and presence, not finishing. */
const AERIAL_SHARE: Record<string, number> = {
  ST: 8, CB: 3, AM: 2.5, CM: 2.2, LW: 2, RW: 2, DM: 1.8, LB: 1, RB: 1, GK: 0.02,
};

function pickAerialTarget(rng: Rng, team: TeamState): Player {
  return rng.pickWeighted(team.onPitch, (slot) => {
    const share = AERIAL_SHARE[slot.position] ?? 1;
    return share * Math.max(10, slot.player.attributes.heading) / 60;
  }).player;
}

/** Attacking players shoot most, weighted by how dangerous they are. */
const SHOOTING_SHARE: Record<string, number> = {
  ST: 6, LW: 5.5, RW: 5.5, AM: 4.5, CM: 3.2, DM: 1.6, LB: 1.3, RB: 1.3, CB: 1.3, GK: 0.02,
};

function pickShooter(rng: Rng, team: TeamState): Player {
  return rng.pickWeighted(team.onPitch, (slot) => {
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
  const candidates = team.onPitch.filter((slot) => slot.player.id !== scorer.id);
  if (candidates.length === 0) return scorer;
  return rng.pickWeighted(candidates, (slot) => {
    const share = ASSIST_SHARE[slot.position] ?? 1;
    const attrs = slot.player.attributes;
    const quality = (attrs.vision + attrs.passing + attrs.crossing) / 3;
    return share * Math.max(quality, 5);
  }).player;
}

/** Defenders and holding midfielders collect most of the cards. */
const CARD_SHARE: Record<string, number> = {
  CB: 5, DM: 5, LB: 4, RB: 4, CM: 4, ST: 3, AM: 2.5, LW: 2, RW: 2, GK: 0.5,
};

function resolveDiscipline(
  rng: Rng,
  home: TeamState,
  away: TeamState,
  minute: number,
  events: MatchEvent[],
): void {
  const T = MATCH_TUNING;

  for (const team of [home, away]) {
    if (team.onPitch.length === 0) continue;

    if (rng.chance(T.yellowRate)) {
      const slot = pickOffender(rng, team);
      if (team.bookings.has(slot.player.id)) {
        // Second yellow: off, and no replacement.
        events.push({ minute, type: 'yellow_card', clubId: team.club.id, playerId: slot.player.id });
        sendOff(team, slot, minute, events, 'red_card');
      } else {
        team.bookings.add(slot.player.id);
        events.push({ minute, type: 'yellow_card', clubId: team.club.id, playerId: slot.player.id });
      }
    }

    if (rng.chance(T.directRedRate) && team.onPitch.length > 7) {
      const slot = pickOffender(rng, team);
      sendOff(team, slot, minute, events, 'red_card');
    }
  }
}

function pickOffender(rng: Rng, team: TeamState): LineupSlot {
  const T = MATCH_TUNING;
  return rng.pickWeighted(team.onPitch, (slot) => {
    const share = CARD_SHARE[slot.position] ?? 3;
    // Aggressive, less composed players give away more fouls.
    const discipline = 1 + (60 - slot.player.attributes.composure) / 120;
    // Someone already on a yellow treads carefully.
    const booked = team.bookings.has(slot.player.id) ? T.bookedOffenceWeight : 1;
    return share * discipline * booked;
  });
}

function sendOff(
  team: TeamState,
  slot: LineupSlot,
  minute: number,
  events: MatchEvent[],
  type: 'red_card',
): void {
  events.push({ minute, type, clubId: team.club.id, playerId: slot.player.id });
  team.onPitch = team.onPitch.filter((s) => s.player.id !== slot.player.id);
  creditMinutes(team, slot.player.id, minute);
  refreshRating(team);
}

function resolveInjuries(
  rng: Rng,
  home: TeamState,
  away: TeamState,
  minute: number,
  events: MatchEvent[],
): void {
  const T = MATCH_TUNING;

  for (const team of [home, away]) {
    if (team.onPitch.length === 0) continue;
    if (!rng.chance(T.injuryRate)) continue;

    // A tired player is likelier to pull up.
    const slot = rng.pickWeighted(team.onPitch, (s) => 1 + (100 - s.player.status.condition) / 60);
    events.push({ minute, type: 'injury', clubId: team.club.id, playerId: slot.player.id });

    team.onPitch = team.onPitch.filter((s) => s.player.id !== slot.player.id);
    creditMinutes(team, slot.player.id, minute);

    // Forced change: a replacement comes on if one is available.
    const replacement = bestReplacement(team, slot.position);
    if (replacement && team.substitutionsUsed < T.maxSubstitutions) {
      bringOn(team, replacement, slot.position, minute, events, slot.player.id);
    }
    refreshRating(team);
    team.injured.add(slot.player.id);
  }
}

/**
 * Tactical substitutions. A side takes off whoever has faded most relative to
 * what the bench offers, which is what spreads minutes across a squad and makes
 * depth worth paying for.
 */
function considerSubstitutions(rng: Rng, team: TeamState, minute: number, events: MatchEvent[]): void {
  const T = MATCH_TUNING;
  if (minute < T.firstSubMinute || minute > T.lastSubMinute) return;
  if (team.substitutionsUsed >= T.maxSubstitutions) return;
  if (team.bench.length === 0) return;

  // Roughly one substitution decision per side across the window.
  const window = T.lastSubMinute - T.firstSubMinute + 1;
  if (!rng.chance(T.maxSubstitutions / window)) return;

  let bestGain: number = T.substitutionGainThreshold;
  let outSlot: LineupSlot | undefined;
  let inPlayer: Player | undefined;

  for (const slot of team.onPitch) {
    if (slot.position === 'GK') continue;
    const played = minute - (team.enteredAt.get(slot.player.id) ?? 0);
    const tiredness = 1 - T.inMatchFatigue * (played / 90);
    const current = slot.effectiveAbility * tiredness;

    for (const candidate of team.bench) {
      const fresh = toSlot(candidate, slot.position).effectiveAbility;
      const gain = fresh - current;
      if (gain > bestGain) {
        bestGain = gain;
        outSlot = slot;
        inPlayer = candidate;
      }
    }
  }

  if (!outSlot || !inPlayer) return;

  team.onPitch = team.onPitch.filter((s) => s.player.id !== outSlot!.player.id);
  creditMinutes(team, outSlot.player.id, minute);
  bringOn(team, inPlayer, outSlot.position, minute, events, outSlot.player.id);
  refreshRating(team);
}

function bestReplacement(team: TeamState, position: Position): Player | undefined {
  if (team.bench.length === 0) return undefined;
  return [...team.bench].sort(
    (a, b) => toSlot(b, position).effectiveAbility - toSlot(a, position).effectiveAbility,
  )[0];
}

function bringOn(
  team: TeamState,
  player: Player,
  position: Position,
  minute: number,
  events: MatchEvent[],
  replacedPlayerId: string,
): void {
  team.bench = team.bench.filter((p) => p.id !== player.id);
  team.onPitch.push(toSlot(player, position));
  team.enteredAt.set(player.id, minute);
  team.substitutionsUsed++;
  events.push({
    minute,
    type: 'substitution',
    clubId: team.club.id,
    playerId: replacedPlayerId,
    replacementPlayerId: player.id,
  });
}

function creditMinutes(team: TeamState, playerId: string, minute: number): void {
  const entered = team.enteredAt.get(playerId) ?? 0;
  team.minutes.set(playerId, (team.minutes.get(playerId) ?? 0) + Math.max(0, minute - entered));
}

/**
 * Writes the match back onto the players: minutes, goals, bookings, fitness and
 * morale. Only called for real fixtures.
 */
function applyPlayerState(
  rng: Rng,
  team: TeamState,
  finalMinute: number,
  goalsAgainst: number,
): void {
  const T = MATCH_TUNING;

  // Anyone still on the pitch played to the whistle.
  for (const slot of team.onPitch) creditMinutes(team, slot.player.id, finalMinute);

  const won = team.goals > goalsAgainst;
  const drew = team.goals === goalsAgainst;
  const squad = new Map(team.club.squad.map((player) => [player.id, player]));

  for (const [playerId, minutes] of team.minutes) {
    const player = squad.get(playerId);
    if (!player || minutes <= 0) continue;
    const status = player.status;

    status.appearances += 1;
    status.minutes += minutes;

    // Condition drains with minutes, less so for a fit player.
    const staminaFactor = 1.3 - player.attributes.stamina / 150;
    status.condition = clamp(
      status.condition - T.conditionCostPer90 * (minutes / 90) * staminaFactor,
      5,
      100,
    );

    // Form and morale follow the result, and playing at all helps morale.
    const resultSwing = won ? 1 : drew ? 0 : -1;
    status.form = clamp(status.form * 0.85 + resultSwing * 0.8, -10, 10);
    status.morale = clamp(status.morale + resultSwing * 3 + 1, 0, 100);
  }

  // Players who did not get on lose a little morale.
  for (const player of team.club.squad) {
    if (team.minutes.has(player.id)) continue;
    player.status.morale = clamp(player.status.morale - 0.5, 0, 100);
  }

  applyBookings(team);
  applyInjuries(rng, team);
}

function applyBookings(team: TeamState): void {
  const squad = new Map(team.club.squad.map((player) => [player.id, player]));

  for (const playerId of team.bookings) {
    const player = squad.get(playerId);
    if (!player) continue;
    player.status.yellowCards += 1;
    if (player.status.yellowCards % STATUS_TUNING.yellowsPerBan === 0) {
      player.status.suspensionMatches += 1;
    }
  }
}

/**
 * Lay-off lengths. Most knocks are minor; a small tail are season-wrecking, which
 * is what makes squad depth worth paying for.
 */
function rollInjuryLength(rng: Rng): number {
  const roll = rng.next();
  if (roll < 0.58) return rng.int(1, 3);
  if (roll < 0.88) return rng.int(4, 10);
  return rng.int(11, 30);
}

function applyInjuries(rng: Rng, team: TeamState): void {
  const squad = new Map(team.club.squad.map((player) => [player.id, player]));
  for (const playerId of team.injured) {
    const player = squad.get(playerId);
    if (!player) continue;
    player.status.injuryMatches += rollInjuryLength(rng);
    player.status.morale = clamp(player.status.morale - 4, 0, 100);
  }
}

/** Goals, assists and sendings-off, read back off the event log. */
function applyEventOutcomes(rng: Rng, events: readonly MatchEvent[], teams: TeamState[]): void {
  const players = new Map<string, Player>();
  for (const team of teams) {
    for (const player of team.club.squad) players.set(player.id, player);
  }

  for (const event of events) {
    if (event.type === 'goal') {
      const scorer = players.get(event.playerId);
      if (scorer) {
        scorer.status.goals += 1;
        scorer.status.form = clamp(scorer.status.form + 1.6, -10, 10);
        scorer.status.morale = clamp(scorer.status.morale + 2, 0, 100);
      }
      if (event.assistPlayerId) {
        const assister = players.get(event.assistPlayerId);
        if (assister) {
          assister.status.assists += 1;
          assister.status.form = clamp(assister.status.form + 0.8, -10, 10);
        }
      }
    } else if (event.type === 'red_card') {
      const player = players.get(event.playerId);
      if (player) {
        player.status.redCards += 1;
        player.status.suspensionMatches += rng.int(1, 3);
        player.status.morale = clamp(player.status.morale - 6, 0, 100);
      }
    }
  }
}
