import type { Rng } from '../rng/index.js';
import type { Club, Fixture, MatchResult, Player } from '../types.js';
import {
  extendMatch,
  finishMatch,
  matchComplete,
  startMatch,
  stepMatch,
  type MatchInProgress,
  type SimulateMatchOptions,
} from '../match/engine.js';
import { effectiveness } from '../match/ratings.js';

/**
 * A straight knockout, drawn as it goes.
 *
 * A cup cannot be scheduled up front the way a league can -- who plays in round
 * two depends on who survives round one -- so the bracket is generated a round
 * at a time when its matchday comes around. That is the whole reason cup state
 * exists rather than the fixtures simply living in the season's list.
 */

export const CUP_TUNING = {
  /**
   * Matchdays the cup rounds are played on, in the combined calendar.
   *
   * League fixtures are pushed around these rather than sharing them: a cup day
   * that doubled as a league day meant a club in the cup played twice on the
   * same matchday, and a screen showing "the next match" could only show one of
   * them. A season with a cup is 44 matchdays, not 38.
   */
  rounds: [5, 12, 20, 28, 36, 42] as readonly number[],
  /**
   * Extra time is played at reduced intensity: tired legs, and sides that have
   * already decided they would rather take their chances from the spot.
   */
  extraTimeAttackRate: 0.42,
  /** Penalties: how far composure moves the odds of scoring one. */
  penaltyBase: 0.76,
  penaltyComposureScale: 0.5,
  shootoutRounds: 5,
} as const;

export interface CupTie {
  round: number;
  homeClubId: string;
  awayClubId: string;
  /**
   * Score after ninety minutes, once played.
   *
   * The score, not the MatchResult: the full result is already in the season's
   * own list, and keeping a second copy of all 39 of them added 184KB to every
   * save -- 14% of it -- for something nothing ever read.
   */
  score?: { home: number; away: number };
  /** Goals after extra time, when the ninety ended level. */
  extraTime?: { home: number; away: number };
  /** Shootout score, when extra time ended level too. */
  shootout?: { home: number; away: number };
  winnerClubId?: string;
}

export interface CupState {
  competitionId: string;
  name: string;
  /** Clubs still in it, in draw order. */
  remaining: string[];
  /** Index into CUP_TUNING.rounds. */
  roundIndex: number;
  ties: CupTie[];
  winnerClubId?: string;
}

/**
 * Sets up the draw.
 *
 * `clubIds` comes in weakest first, because the byes go to the other end. A
 * field that is not a power of two has to shed the difference somewhere, and a
 * real cup sheds it in the first round by making the smaller clubs play their
 * way in -- the alternative, pairing off blindly, leaves a bye sitting in a
 * quarter-final, where it is both unfair and absurd.
 */
export function createCupState(
  rng: Rng,
  clubIds: readonly string[],
  competitionId = 'cup',
  name = 'Copa Nacional',
): CupState {
  const entering = firstRoundClubs(clubIds.length);
  return {
    competitionId,
    name,
    // Shuffled within each group, so who plays whom is still a draw.
    remaining: [
      ...rng.shuffle(clubIds.slice(0, entering)),
      ...rng.shuffle(clubIds.slice(entering)),
    ],
    roundIndex: 0,
    ties: [],
  };
}

/**
 * How many clubs must play a first-round tie for the rest of the bracket to
 * halve cleanly. Zero when the field is already a power of two.
 */
export function firstRoundClubs(fieldSize: number): number {
  if (fieldSize < 2) return 0;
  let power = 1;
  while (power * 2 <= fieldSize) power *= 2;
  return (fieldSize - power) * 2;
}

/** The matchday a cup round is played on, or undefined once the cup is over. */
export function cupRoundMatchday(state: CupState): number | undefined {
  return CUP_TUNING.rounds[state.roundIndex];
}

export function cupComplete(state: CupState): boolean {
  return state.winnerClubId !== undefined || state.remaining.length <= 1;
}

/**
 * Draws the next round.
 *
 * Byes go to whoever is left over, which only happens when the field is not a
 * power of two -- and it is sized so that happens once, in the first round, the
 * way a real cup lets its bigger clubs in later.
 */
export function drawCupRound(state: CupState): Fixture[] {
  if (cupComplete(state)) return [];

  const matchday = cupRoundMatchday(state);
  if (matchday === undefined) return [];

  const field = state.remaining;
  /*
   * Only as many ties as it takes to reach the next power of two. After the
   * first round that is the whole field, so every later round is a clean half.
   */
  const entering = firstRoundClubs(field.length);
  const playing = field.slice(0, entering > 0 ? entering : field.length);

  const fixtures: Fixture[] = [];
  for (let i = 0; i < playing.length; i += 2) {
    const home = playing[i]!;
    const away = playing[i + 1]!;
    state.ties.push({ round: state.roundIndex + 1, homeClubId: home, awayClubId: away });
    fixtures.push({ round: matchday, competitionId: state.competitionId, homeClubId: home, awayClubId: away });
  }
  return fixtures;
}

/** The ties drawn for the round currently being played. */
export function currentTies(state: CupState): CupTie[] {
  return state.ties.filter((tie) => tie.round === state.roundIndex + 1);
}

/**
 * Plays a cup tie to a winner: ninety minutes, then extra time, then penalties.
 *
 * Extra time is the same match carried on, so form, fatigue, tactics,
 * substitutions and sendings off all carry -- and its goals are the match's
 * goals, credited like any other.
 */
export function resolveCupTie(
  rng: Rng,
  tie: CupTie,
  home: Club,
  away: Club,
  options: SimulateMatchOptions = {},
): MatchResult {
  return settleCupTie(tie, startMatch(rng, home, away, options));
}

/**
 * Finishes a cup tie from wherever its match has got to -- kick-off, or the
 * final whistle of a match the manager has been watching -- and settles who
 * goes through. Both a simulated tie and a live one end here, so neither can
 * leave a tie without a winner.
 */
export function settleCupTie(tie: CupTie, match: MatchInProgress): MatchResult {
  while (!matchComplete(match)) stepMatch(match);
  const ninety = { home: match.home.goals, away: match.away.goals };
  tie.score = ninety;

  if (ninety.home === ninety.away) {
    // Thirty minutes more, at the pace of a side that has already played ninety.
    extendMatch(match, 30, CUP_TUNING.extraTimeAttackRate);
    while (!matchComplete(match)) stepMatch(match);
    tie.extraTime = { home: match.home.goals - ninety.home, away: match.away.goals - ninety.away };
  }

  const result = finishMatch(match);
  if (result.home.goals !== result.away.goals) {
    tie.winnerClubId = result.home.goals > result.away.goals ? result.homeClubId : result.awayClubId;
    return result;
  }

  const shootout = resolveShootout(match.rng, match.home.club, match.away.club);
  tie.shootout = shootout;
  tie.winnerClubId = shootout.home > shootout.away ? result.homeClubId : result.awayClubId;
  return result;
}

/**
 * A shootout, decided on composure.
 *
 * Sudden death runs until it breaks, so this cannot return a draw -- the one
 * thing a knockout may never do.
 */
export function resolveShootout(
  rng: Rng,
  home: Club,
  away: Club,
): { home: number; away: number } {
  const T = CUP_TUNING;
  const takersFor = (club: Club) =>
    [...club.squad]
      .sort((a, b) => penaltyQuality(b) - penaltyQuality(a))
      .slice(0, 11);

  const homeTakers = takersFor(home);
  const awayTakers = takersFor(away);
  const score = { home: 0, away: 0 };

  const take = (takers: Player[], index: number): boolean => {
    const taker = takers[index % takers.length]!;
    const odds = T.penaltyBase + ((penaltyQuality(taker) - 55) / 100) * T.penaltyComposureScale;
    return rng.chance(Math.min(0.95, Math.max(0.5, odds)));
  };

  for (let i = 0; i < T.shootoutRounds; i++) {
    if (take(homeTakers, i)) score.home++;
    if (take(awayTakers, i)) score.away++;
  }

  // Sudden death, a pair at a time, until somebody misses and the other does not.
  for (let i = T.shootoutRounds; score.home === score.away; i++) {
    const homeScored = take(homeTakers, i);
    const awayScored = take(awayTakers, i);
    if (homeScored) score.home++;
    if (awayScored) score.away++;
  }
  return score;
}

function penaltyQuality(player: Player): number {
  const a = player.attributes;
  return (a.composure * 0.6 + a.finishing * 0.4) * effectiveness(player);
}

/** Records who went through and moves the cup on a round. */
export function advanceCupRound(state: CupState): void {
  const played = currentTies(state);
  const byes = state.remaining.slice(played.length * 2);
  const winners = played
    .map((tie) => tie.winnerClubId)
    .filter((id): id is string => id !== undefined);

  state.remaining = [...winners, ...byes];
  state.roundIndex += 1;

  if (state.remaining.length === 1) state.winnerClubId = state.remaining[0]!;
}
