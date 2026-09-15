import type { Club, League, TableRow, World } from '../types.js';
import { clamp } from '../rng/index.js';
import { allClubs, leagueOf } from '../world/index.js';

/**
 * What the board wants, and how far its patience has run.
 *
 * The expectation is set from where the club stands among everyone it plays --
 * squad value against its own division. That matters more than it looks: judge
 * a manager against the whole pyramid and a promoted side is asked to survive,
 * which is right, while a relegated giant is asked to walk the second tier,
 * which is also right. A fixed target per club could do neither.
 */
export const BOARD_TUNING = {
  /** Confidence a new manager starts with. */
  startingConfidence: 65,
  /** Confidence at which the board acts. */
  sackBelow: 20,
  /** How far off the expected finish moves confidence, per place. */
  perPlace: 3.2,
  /** The most a single season can move it, either way. */
  seasonSwing: 45,
  /** Relegation and promotion are judged on their own, not just by places. */
  relegationPenalty: 22,
  promotionBonus: 25,
  /** Winning something buys patience that league position alone does not. */
  cupWinBonus: 18,
  cupFinalBonus: 7,
  /** A first season is given the benefit of the doubt. */
  gracePeriodSeasons: 1,
  /** Confidence drifts back toward calm, so one bad year is survivable. */
  recovery: 0.12,
} as const;

export interface BoardState {
  /** 0-100. The board acts below `sackBelow`. */
  confidence: number;
  /** League place the board expects this season, 1-based within its division. */
  expectation: number;
  /** Seasons this manager has been in the job. */
  seasonsInCharge: number;
  /** Set when the manager has been dismissed. */
  sacked?: boolean;
  /** Why, for a screen to show. */
  sackReason?: string;
}

export interface BoardVerdict {
  /** Where they actually finished. */
  finished: number;
  expected: number;
  confidenceBefore: number;
  confidenceAfter: number;
  relegated: boolean;
  promoted: boolean;
  wonCup: boolean;
  sacked: boolean;
  /** A sentence a screen can show without composing one. */
  message: string;
}

export function createBoardState(world: World, clubId: string): BoardState {
  return {
    confidence: BOARD_TUNING.startingConfidence,
    expectation: expectedFinish(world, clubId),
    seasonsInCharge: 0,
  };
}

/**
 * Where a club of this standing ought to finish in its division, from squad
 * value rather than reputation: reputation moves slowly and describes history,
 * where what a board judges you on is the squad it paid for.
 */
export function expectedFinish(world: World, clubId: string): number {
  const league = leagueOf(world, clubId);
  if (!league) return 1;

  const ranked = [...league.clubs].sort((a, b) => squadCost(b) - squadCost(a));
  const index = ranked.findIndex((club) => club.id === clubId);
  return index < 0 ? Math.ceil(league.clubs.length / 2) : index + 1;
}

/** What a club is paying its players, as a proxy for what it has invested. */
function squadCost(club: Club): number {
  return club.squad.reduce((sum, player) => sum + player.contract.wage, 0);
}

/**
 * Judges a season and moves the board's confidence.
 *
 * Called before promotion and relegation are applied, so `table` is the division
 * the club actually played in and the finish means what it says.
 */
export function judgeSeason(
  board: BoardState,
  options: {
    table: readonly TableRow[];
    clubId: string;
    league: League;
    relegated: boolean;
    promoted: boolean;
    cupResult?: 'won' | 'final' | undefined;
  },
): BoardVerdict {
  const B = BOARD_TUNING;
  const before = board.confidence;

  const index = options.table.findIndex((row) => row.clubId === options.clubId);
  const finished = index < 0 ? options.table.length : index + 1;
  const expected = board.expectation;

  // Beating the expectation is worth as much as missing it costs.
  let swing = clamp((expected - finished) * B.perPlace, -B.seasonSwing, B.seasonSwing);
  if (options.relegated) swing -= B.relegationPenalty;
  if (options.promoted) swing += B.promotionBonus;
  if (options.cupResult === 'won') swing += B.cupWinBonus;
  if (options.cupResult === 'final') swing += B.cupFinalBonus;

  // Pulled back toward calm, so one bad season is survivable and two are not.
  const drift = (B.startingConfidence - before) * B.recovery;
  board.confidence = clamp(before + swing + drift, 0, 100);
  board.seasonsInCharge += 1;

  const protectedByGrace = board.seasonsInCharge <= B.gracePeriodSeasons;
  const sacked = board.confidence < B.sackBelow && !protectedByGrace;
  if (sacked) {
    board.sacked = true;
    board.sackReason = options.relegated
      ? `Relegated from the ${options.league.name}.`
      : `Finished ${ordinal(finished)} when ${ordinal(expected)} was expected.`;
  }

  return {
    finished,
    expected,
    confidenceBefore: before,
    confidenceAfter: board.confidence,
    relegated: options.relegated,
    promoted: options.promoted,
    wonCup: options.cupResult === 'won',
    sacked,
    message: verdictMessage({
      finished,
      expected,
      relegated: options.relegated,
      promoted: options.promoted,
      cupResult: options.cupResult,
      sacked,
      confidence: board.confidence,
    }),
  };
}

/** Resets the expectation for the season about to start. */
export function refreshExpectation(board: BoardState, world: World, clubId: string): void {
  board.expectation = expectedFinish(world, clubId);
}

export function boardMood(confidence: number): string {
  if (confidence >= 80) return 'Delighted';
  if (confidence >= 60) return 'Happy';
  if (confidence >= 40) return 'Satisfied';
  if (confidence >= BOARD_TUNING.sackBelow) return 'Concerned';
  return 'Out of patience';
}

function verdictMessage(v: {
  finished: number;
  expected: number;
  relegated: boolean;
  promoted: boolean;
  cupResult?: 'won' | 'final' | undefined;
  sacked: boolean;
  confidence: number;
}): string {
  if (v.sacked) return 'The board has decided to make a change.';
  if (v.cupResult === 'won' && v.finished > v.expected) {
    return 'The cup has bought you some goodwill after a disappointing league campaign.';
  }
  if (v.promoted) return 'Promotion. The board could hardly have asked for more.';
  if (v.relegated) return 'Relegation. You are being given a chance to put it right.';
  if (v.finished < v.expected) return `Above expectations — ${ordinal(v.expected)} was the target.`;
  if (v.finished === v.expected) return 'Exactly where the board expected you to finish.';
  return `Below expectations — ${ordinal(v.expected)} was the target.`;
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** Every club's expected finish, for a harness that wants the whole picture. */
export function expectationsAcross(world: World): Map<string, number> {
  const out = new Map<string, number>();
  for (const club of allClubs(world)) out.set(club.id, expectedFinish(world, club.id));
  return out;
}
