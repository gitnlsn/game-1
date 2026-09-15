import { describe, expect, it } from 'vitest';
import {
  BOARD_TUNING,
  boardMood,
  createBoardState,
  expectedFinish,
  judgeSeason,
  refreshExpectation,
  type BoardState,
} from '../career/board.js';
import { createWorld, leagueOf } from '../world/index.js';
import {
  advanceRound,
  boardConfidence,
  endSeason,
  isSacked,
  isSeasonComplete,
  startCareer,
  startNextSeason,
} from '../career/controller.js';
import { deserializeCareer, serializeCareer } from '../career/persistence.js';
import type { League, TableRow } from '../types.js';

const world = createWorld({ seed: 'board', divisions: 2 });
const league = world.leagues[0]!;

function tableOf(clubIds: string[]): TableRow[] {
  return clubIds.map((clubId, i) => ({
    clubId, clubName: clubId, played: 38, won: 0, drawn: 0, lost: 0,
    goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 100 - i,
  }));
}

const ids = league.clubs.map((c) => c.id);

function judge(
  board: BoardState,
  finished: number,
  extra: Partial<Parameters<typeof judgeSeason>[1]> = {},
) {
  // Put the managed club at the given position.
  const others = ids.filter((id) => id !== ids[0]);
  const order = [...others];
  order.splice(finished - 1, 0, ids[0]!);
  return judgeSeason(board, {
    table: tableOf(order),
    clubId: ids[0]!,
    league: league as League,
    relegated: false,
    promoted: false,
    ...extra,
  });
}

describe('what the board expects', () => {
  it('asks more of a club that has spent more', () => {
    const byCost = [...league.clubs].sort(
      (a, b) =>
        b.squad.reduce((s, p) => s + p.contract.wage, 0) -
        a.squad.reduce((s, p) => s + p.contract.wage, 0),
    );
    expect(expectedFinish(world, byCost[0]!.id)).toBe(1);
    expect(expectedFinish(world, byCost[byCost.length - 1]!.id)).toBe(league.clubs.length);
  });

  it('judges a club against its own division, not the whole pyramid', () => {
    // The best club in the second tier is expected to win it, even though it
    // would be nowhere near the top of the first.
    const second = world.leagues[1]!;
    const byCost = [...second.clubs].sort(
      (a, b) =>
        b.squad.reduce((s, p) => s + p.contract.wage, 0) -
        a.squad.reduce((s, p) => s + p.contract.wage, 0),
    );
    expect(expectedFinish(world, byCost[0]!.id)).toBe(1);
    expect(leagueOf(world, byCost[0]!.id)!.tier).toBe(2);
  });
});

describe('how the board judges a season', () => {
  it('cannot sack you in your first season', () => {
    const board = createBoardState(world, ids[0]!);
    board.confidence = 1;
    const verdict = judge(board, league.clubs.length);
    expect(verdict.sacked).toBe(false);
    expect(board.seasonsInCharge).toBe(1);
  });

  it('sacks you once patience runs out', () => {
    const board = createBoardState(world, ids[0]!);
    board.expectation = 1;

    let seasons = 0;
    while (!board.sacked && seasons++ < 20) judge(board, league.clubs.length);

    expect(board.sacked).toBe(true);
    // Not instantly, and not never: two or three bad seasons.
    expect(seasons).toBeGreaterThan(BOARD_TUNING.gracePeriodSeasons);
    expect(seasons).toBeLessThan(6);
  });

  it('never sacks a manager who keeps meeting the target', () => {
    const board = createBoardState(world, ids[0]!);
    board.expectation = 8;
    for (let i = 0; i < 30; i++) judge(board, 8);
    expect(board.sacked).toBeUndefined();
    expect(board.confidence).toBeGreaterThan(BOARD_TUNING.sackBelow);
  });

  it('lets one bad season be survived and recovered from', () => {
    const board = createBoardState(world, ids[0]!);
    board.expectation = 6;
    const after = judge(board, 18).confidenceAfter;
    expect(board.sacked).toBeUndefined();

    // Meeting the target again pulls you back toward calm.
    judge(board, 6);
    judge(board, 6);
    expect(board.confidence).toBeGreaterThan(after);
  });

  it('counts a cup run when the league campaign was poor', () => {
    const withCup = createBoardState(world, ids[0]!);
    const without = createBoardState(world, ids[0]!);
    withCup.expectation = 4;
    without.expectation = 4;

    const a = judge(withCup, 12, { cupResult: 'won' });
    const b = judge(without, 12);

    expect(a.confidenceAfter).toBeGreaterThan(b.confidenceAfter);
    expect(a.wonCup).toBe(true);
    expect(a.message).toMatch(/cup/i);
  });

  it('treats going down as worse than the places alone say', () => {
    const down = createBoardState(world, ids[0]!);
    const stayed = createBoardState(world, ids[0]!);
    down.expectation = 10;
    stayed.expectation = 10;

    const a = judge(down, 18, { relegated: true });
    const b = judge(stayed, 18);
    expect(a.confidenceAfter).toBeLessThan(b.confidenceAfter);
    expect(a.message).toMatch(/relegation/i);
  });

  it('treats going up as better', () => {
    const up = createBoardState(world, ids[0]!);
    up.expectation = 4;
    const verdict = judge(up, 2, { promoted: true });
    expect(verdict.confidenceAfter).toBeGreaterThan(BOARD_TUNING.startingConfidence);
    expect(verdict.message).toMatch(/promotion/i);
  });

  it('describes its mood in words', () => {
    expect(boardMood(95)).toBe('Delighted');
    expect(boardMood(10)).toBe('Out of patience');
  });
});

describe('the board across a career', () => {
  it('re-reads what it expects when the division changes', () => {
    const board = createBoardState(world, world.leagues[1]!.clubs[0]!.id);
    const before = board.expectation;
    // Move that club up a division, and the target becomes survival.
    const club = world.leagues[1]!.clubs.shift()!;
    world.leagues[0]!.clubs.push(club);
    refreshExpectation(board, world, club.id);
    expect(board.expectation).toBeGreaterThan(before);
    // Put the world back.
    world.leagues[0]!.clubs.pop();
    world.leagues[1]!.clubs.unshift(club);
  });

  it('records a verdict on every season and survives a save', () => {
    const career = startCareer({ seed: 'board-career', managedClubId: 'c1' });
    let guard = 0;
    while (!isSeasonComplete(career) && guard++ < 60) advanceRound(career);
    const summary = endSeason(career);

    expect(summary.verdict).toBeDefined();
    expect(summary.verdict!.finished).toBeGreaterThan(0);
    expect(boardConfidence(career).mood).toBeTruthy();
    expect(isSacked(career)).toBe(false);

    startNextSeason(career);
    const restored = deserializeCareer(serializeCareer(career));
    expect(restored.board.confidence).toBe(career.board.confidence);
    expect(restored.board.seasonsInCharge).toBe(career.board.seasonsInCharge);
    expect(restored.board.expectation).toBe(career.board.expectation);
  });

  it('gives an old save a board without inventing a history for it', () => {
    const career = startCareer({ seed: 'board-migrate', managedClubId: 'c1' });
    let guard = 0;
    while (!isSeasonComplete(career) && guard++ < 60) advanceRound(career);
    endSeason(career);
    startNextSeason(career);

    const saved = JSON.parse(serializeCareer(career)) as Record<string, unknown>;
    saved.version = 6;
    delete saved.board;

    const loaded = deserializeCareer(JSON.stringify(saved));
    expect(loaded.board.confidence).toBe(BOARD_TUNING.startingConfidence);
    expect(loaded.board.seasonsInCharge).toBe(1);
    // The expectation has to be real, not the migration's placeholder: a pure
    // data migration cannot see the world to work it out.
    expect(loaded.board.expectation).toBeGreaterThan(0);
    expect(loaded.board.sacked).toBeUndefined();
  });
});
