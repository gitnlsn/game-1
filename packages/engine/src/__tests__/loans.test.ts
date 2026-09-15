import { describe, expect, it } from 'vitest';
import { Rng } from '../rng/index.js';
import {
  effectiveWageBill,
  loanCandidates,
  loanOf,
  loanOut,
  loansFor,
  LOAN_TUNING,
  recallLoans,
  runLoanWindow,
} from '../transfers/loans.js';
import { allClubs, createWorld, findClub } from '../world/index.js';
import { squadsAreConsistent } from '../world/squads.js';
import { currentAbility } from '../world/players.js';
import { wageBill } from '../economy/valuation.js';
import { createSeasonState, finaliseSeason, playRound } from '../league/season.js';
import { closeSeason, simulateCareerSeason } from '../career/career.js';
import type { World } from '../types.js';

function twoDivisionWorld(seed: string): World {
  return createWorld({ seed, divisions: 2 });
}

/**
 * Lends out the first candidate anybody will actually take.
 *
 * Picking a borrower arbitrarily does not work: a club only takes a player who
 * improves on what it already has in that position, so a given pairing often
 * and correctly refuses.
 */
function firstAcceptedLoan(
  world: World,
  parentClubId: string,
): { playerId: string; borrowerId: string } | undefined {
  for (const player of loanCandidates(world, parentClubId)) {
    for (const borrower of allClubs(world)) {
      if (borrower.id === parentClubId) continue;
      if (loanOut(world, parentClubId, borrower.id, player.id).agreed) {
        return { playerId: player.id, borrowerId: borrower.id };
      }
    }
  }
  return undefined;
}

describe('where a player is', () => {
  it('is recorded on the player, not only in a squad array', () => {
    const world = twoDivisionWorld('clubid');
    for (const club of allClubs(world)) {
      for (const player of club.squad) expect(player.clubId).toBe(club.id);
    }
    expect(squadsAreConsistent(world)).toEqual([]);
  });

  it('stays true to the squads through a whole career', () => {
    /*
     * The two records can only drift apart through a squad mutation that skipped
     * the helpers, and a career exercises every one of them: transfers, releases,
     * retirements, the academy, promotion and relegation, and loans.
     */
    const world = twoDivisionWorld('clubid-career');
    const rng = new Rng('clubid-career');
    for (let i = 0; i < 4; i++) {
      simulateCareerSeason(world, rng);
      expect(squadsAreConsistent(world), `season ${i + 1}`).toEqual([]);
    }
  });
});

describe('sending a player out on loan', () => {
  it('moves where he plays without changing who owns him', () => {
    const world = twoDivisionWorld('loan-basic');
    const parent = world.leagues[0]!.clubs[0]!;
    const found = firstAcceptedLoan(world, parent.id)!;
    expect(found).toBeDefined();

    const player = world.players.get(found.playerId)!;
    const borrower = findClub(world, found.borrowerId)!;

    expect(borrower.squad).toContain(player);
    expect(parent.squad).not.toContain(player);
    expect(player.clubId).toBe(borrower.id);
    expect(loanOf(world, player.id)!.parentClubId).toBe(parent.id);
    expect(squadsAreConsistent(world)).toEqual([]);
  });

  it('splits his wage, so lending him out saves money and costs the borrower some', () => {
    const world = twoDivisionWorld('loan-wages');
    const parent = world.leagues[0]!.clubs[0]!;
    const candidate = loanCandidates(world, parent.id)[0]!;
    const borrower = allClubs(world).find(
      (c) => c.id !== parent.id && loanOut(world, parent.id, c.id, candidate.id).agreed,
    )!;
    expect(borrower).toBeDefined();

    // Put him back so the bills can be measured from before the move.
    recallLoans(world);
    const player = candidate;
    const parentBefore = effectiveWageBill(world, parent);
    const borrowerBefore = effectiveWageBill(world, borrower);
    loanOut(world, parent.id, borrower.id, player.id);

    const wage = player.contract.wage;
    expect(effectiveWageBill(world, parent)).toBeCloseTo(
      parentBefore - wage * LOAN_TUNING.wageShare,
      3,
    );
    expect(effectiveWageBill(world, borrower)).toBeCloseTo(
      borrowerBefore + wage * LOAN_TUNING.wageShare,
      3,
    );
    // Between them they still pay him in full, and nobody pays twice.
    expect(
      effectiveWageBill(world, parent) + effectiveWageBill(world, borrower),
    ).toBeCloseTo(parentBefore + borrowerBefore, 3);
  });

  it('refuses the deals it should', () => {
    const world = twoDivisionWorld('loan-refuse');
    const parent = world.leagues[0]!.clubs[0]!;
    const borrower = world.leagues[1]!.clubs[19]!;

    expect(loanOut(world, parent.id, 'nobody', 'p1').reason).toBe('unknown_club');
    expect(loanOut(world, parent.id, borrower.id, 'nobody').reason).toBe('not_owned');

    const found = firstAcceptedLoan(world, parent.id);
    expect(found).toBeDefined();
    // He is somewhere else now, so his own club can no longer send him anywhere.
    expect(loanOut(world, parent.id, found!.borrowerId, found!.playerId).reason).toBe('not_owned');
  });

  it('only offers up players who are young and would not be playing', () => {
    const world = twoDivisionWorld('loan-candidates');
    const club = world.leagues[0]!.clubs[0]!;

    for (const player of loanCandidates(world, club.id)) {
      expect(player.age).toBeLessThanOrEqual(LOAN_TUNING.maxAge);

      const samePosition = club.squad.filter((p) => p.position === player.position);
      const best = Math.max(...samePosition.map(currentAbility));
      expect(best - currentAbility(player)).toBeGreaterThanOrEqual(LOAN_TUNING.minGapToStarter);
    }
  });
});

describe('bringing them home', () => {
  it('returns everyone to the club that owns them', () => {
    const world = twoDivisionWorld('loan-recall');
    const parent = world.leagues[0]!.clubs[0]!;
    const found = firstAcceptedLoan(world, parent.id)!;
    const player = world.players.get(found.playerId)!;
    const borrower = findClub(world, found.borrowerId)!;

    const returned = recallLoans(world);

    expect(returned).toHaveLength(1);
    expect(world.loans).toEqual([]);
    expect(parent.squad).toContain(player);
    expect(borrower.squad).not.toContain(player);
    expect(player.clubId).toBe(parent.id);
    expect(squadsAreConsistent(world)).toEqual([]);
  });

  it('brings them home before anything else happens in the close season', () => {
    /*
     * Recall has to run first. Age, contracts and the transfer window all act on
     * squads, and a club must not be able to sell or renew a player it is not
     * currently holding.
     */
    const world = twoDivisionWorld('loan-close');
    const rng = new Rng('loan-close');
    const state = createSeasonState(world, rng, { economy: true, playerState: true });
    while (state.nextRound <= state.totalRounds) playRound(state);

    runLoanWindow(world);
    expect(world.loans.length).toBeGreaterThan(0);

    const summary = closeSeason(world, rng, finaliseSeason(state));
    expect(summary.returningFromLoan).toBeGreaterThan(0);
    expect(squadsAreConsistent(world)).toEqual([]);
  });
});

describe('the loan window', () => {
  it('sends prospects down the pyramid rather than across it', () => {
    const world = twoDivisionWorld('loan-window');
    const loans = runLoanWindow(world);
    expect(loans.length).toBeGreaterThan(0);

    let wentToSmallerClub = 0;
    for (const loan of loans) {
      const parent = findClub(world, loan.parentClubId)!;
      const borrower = findClub(world, loan.clubId)!;
      if (borrower.reputation < parent.reputation) wentToSmallerClub++;
    }
    // Not all of them -- a small club can lend too -- but overwhelmingly.
    expect(wentToSmallerClub / loans.length).toBeGreaterThan(0.8);
  });

  it('never lends the same player twice, or empties a squad', () => {
    const world = twoDivisionWorld('loan-safety');
    const loans = runLoanWindow(world);

    expect(new Set(loans.map((l) => l.playerId)).size).toBe(loans.length);
    for (const club of allClubs(world)) {
      expect(club.squad.length, club.name).toBeGreaterThanOrEqual(18);
    }
    expect(squadsAreConsistent(world)).toEqual([]);
  });

  it('leaves the managed club alone', () => {
    const world = twoDivisionWorld('loan-skip');
    const managed = world.leagues[0]!.clubs[0]!;
    const before = managed.squad.map((p) => p.id);

    runLoanWindow(world, new Set([managed.id]));

    expect(managed.squad.map((p) => p.id)).toEqual(before);
    expect(loansFor(world, managed.id)).toEqual([]);
    // And nobody has been lent TO them either.
    expect(world.loans.some((l) => l.clubId === managed.id)).toBe(false);
  });

  it('gets a prospect the football he would not have had', () => {
    /*
     * The whole reason loans exist. A player develops from minutes, and a good
     * young player at a good club does not get any.
     */
    const world = twoDivisionWorld('loan-minutes');
    const loans = runLoanWindow(world);
    const lentOut = new Set(loans.map((l) => l.playerId));
    expect(lentOut.size).toBeGreaterThan(0);

    const rng = new Rng('loan-minutes');
    const state = createSeasonState(world, rng, { playerState: true });
    while (state.nextRound <= state.totalRounds) playRound(state);

    const played = [...lentOut]
      .map((id) => world.players.get(id)!)
      .filter((p) => p.status.minutes > 0);
    expect(played.length / lentOut.size).toBeGreaterThan(0.6);
  });
});

describe('wages with loans in the world', () => {
  it('bills a squad exactly as before when nobody is on loan', () => {
    const world = twoDivisionWorld('loan-none');
    for (const club of allClubs(world)) {
      expect(effectiveWageBill(world, club)).toBe(wageBill(club.squad));
    }
  });
});
