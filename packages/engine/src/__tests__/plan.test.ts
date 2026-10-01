import { describe, expect, it } from 'vitest';
import {
  advanceRound,
  bidFor,
  browseTargets,
  endSeason,
  incomingOffers,
  isSeasonComplete,
  loanSuitors,
  managedClub,
  sendOnLoan,
  startCareer,
  startNextSeason,
  transferWindow,
  type Career,
} from '../career/controller.js';
import {
  clearPlan,
  confirmPlan,
  plannedMoves,
  planMove,
  planPreview,
  unplanMove,
} from '../career/plan.js';
import { setListing } from '../career/manager.js';
import { deserializeCareer, serializeCareer } from '../career/persistence.js';
import { effectiveWageBill } from '../transfers/loans.js';
import { allClubs } from '../world/index.js';
import { currentAbility } from '../world/players.js';
import { depthAt } from '../transfers/needs.js';

function playSeason(career: Career): void {
  let guard = 0;
  while (!isSeasonComplete(career) && guard++ < 80) advanceRound(career);
}

function toWindow(seed: string, rich = true): Career {
  const career = startCareer({ seed, divisions: 1, cup: false });
  playSeason(career);
  endSeason(career);
  // Most clubs go into a window with little to spend. These tests are about the
  // plan, not the budget, so give the club room to act.
  if (rich) {
    const finances = managedClub(career).finances;
    finances.transferBudget += 50_000_000;
    finances.wageBudget += 500_000;
  }
  return career;
}

/** A squad player whose departure the club can stand: not the only one in his position. */
function spare(career: Career, skip: readonly string[] = []) {
  const club = managedClub(career);
  return [...club.squad]
    .sort((a, b) => currentAbility(a) - currentAbility(b))
    .find((p) => depthAt(club, p.position) > 1 && !skip.includes(p.id) && p.age > 23)!;
}

function affordableTarget(career: Career) {
  return browseTargets(career, { affordableOnly: true }).find((l) => l.wouldJoin && l.askingPrice > 0)!;
}

function squadIds(career: Career): Set<string> {
  return new Set(managedClub(career).squad.map((p) => p.id));
}

describe('drafting a plan', () => {
  it('changes nothing until it is confirmed', () => {
    const c = toWindow('plan-draft');
    const before = serializeCareer(c);
    const target = affordableTarget(c);
    const out = spare(c);

    planMove(c, { kind: 'buy', playerId: target.player.id, fee: target.askingPrice });
    planMove(c, { kind: 'release', playerId: out.id });

    expect(plannedMoves(c)).toHaveLength(2);
    expect(squadIds(c).has(target.player.id)).toBe(false);
    expect(squadIds(c).has(out.id)).toBe(true);

    clearPlan(c);
    // An emptied plan is the only trace a plan leaves.
    delete transferWindow(c)!.planned;
    expect(serializeCareer(c) === before).toBe(true);
  });

  it('keeps one way out per player', () => {
    const c = toWindow('plan-exclusive');
    const player = spare(c);
    planMove(c, { kind: 'release', playerId: player.id });
    planMove(c, { kind: 'renew', playerId: player.id, wage: player.contract.wage * 2, years: 3 });
    expect(plannedMoves(c).map((m) => m.kind)).toEqual(['renew']);

    const suitor = loanSuitors(c, player.id)[0];
    if (suitor) {
      planMove(c, { kind: 'loanOut', playerId: player.id, toClubId: suitor.id });
      planMove(c, { kind: 'release', playerId: player.id });
      expect(plannedMoves(c).map((m) => m.kind)).toEqual(['release']);
    }
  });

  it('can be undone a move at a time', () => {
    const c = toWindow('plan-undo');
    const moves = planMove(c, { kind: 'release', playerId: spare(c).id })!;
    unplanMove(c, moves[0]!.id);
    expect(plannedMoves(c)).toHaveLength(0);
  });

  it('survives a save', () => {
    const c = toWindow('plan-save');
    const target = affordableTarget(c);
    planMove(c, { kind: 'buy', playerId: target.player.id, fee: target.askingPrice });

    const loaded = deserializeCareer(serializeCareer(c));
    expect(plannedMoves(loaded)).toEqual(plannedMoves(c));
  });

  it('cannot be drafted with the window shut', () => {
    const c = startCareer({ seed: 'plan-shut', divisions: 1, cup: false });
    expect(planMove(c, { kind: 'release', playerId: managedClub(c).squad[0]!.id })).toBeUndefined();
  });
});

describe('confirming a plan', () => {
  it('lands exactly where the preview said when every move goes through', () => {
    const c = toWindow('plan-exact');
    const target = affordableTarget(c);
    const out = spare(c);
    const renew = spare(c, [out.id]);

    planMove(c, { kind: 'release', playerId: out.id });
    planMove(c, { kind: 'renew', playerId: renew.id, wage: Math.round(renew.contract.wage * 1.5), years: 3 });
    planMove(c, { kind: 'buy', playerId: target.player.id, fee: target.askingPrice });

    const preview = planPreview(c);
    const results = confirmPlan(c);
    expect(results.every((r) => r.ok)).toBe(true);

    const club = managedClub(c);
    expect(club.finances.transferBudget).toBe(preview.after.transferBudget);
    expect(club.squad.length).toBe(preview.after.squadSize);
    expect(club.finances.wageBudget - effectiveWageBill(c.world, club)).toBeCloseTo(preview.after.wageRoom, 6);
    expect(plannedMoves(c)).toHaveLength(0);
  });

  it('makes departures before arrivals', () => {
    const c = toWindow('plan-order');
    const target = affordableTarget(c);
    const out = spare(c);
    planMove(c, { kind: 'buy', playerId: target.player.id, fee: target.askingPrice });
    planMove(c, { kind: 'release', playerId: out.id });

    expect(confirmPlan(c).map((r) => r.move.kind)).toEqual(['release', 'buy']);
  });

  it('reports a move that fails and keeps it in the plan', () => {
    const c = toWindow('plan-fail');
    const target = affordableTarget(c);
    planMove(c, { kind: 'buy', playerId: target.player.id, fee: Math.max(1, target.askingPrice - 1) });

    const [result] = confirmPlan(c);
    expect(result!.ok).toBe(false);
    expect(result!.reason).toBe('below_asking');
    expect(plannedMoves(c)).toHaveLength(1);
  });

  it('conserves players and money across the world', () => {
    const c = toWindow('plan-conserve');
    const count = () => allClubs(c.world).reduce((n, club) => n + club.squad.length, 0) + c.world.freeAgents.length;
    const money = () => allClubs(c.world).reduce((n, club) => n + club.finances.balance, 0);
    const players = count();
    const balance = money();

    const target = affordableTarget(c);
    planMove(c, { kind: 'buy', playerId: target.player.id, fee: target.askingPrice });
    planMove(c, { kind: 'release', playerId: spare(c).id });
    const offer = incomingOffers(c)[0];
    if (offer) planMove(c, { kind: 'sell', offerId: offer.id });
    confirmPlan(c);

    expect(count()).toBe(players);
    expect(money()).toBe(balance);
  });

  it('accepting one bid for a player lets the others lapse', () => {
    for (const seed of ['lapse-a', 'lapse-b', 'lapse-c', 'lapse-d']) {
      const c = toWindow(seed);
      const player = spare(c);
      setListing(c, player.id, 'transfer');
      const offers = incomingOffers(c).filter((o) => o.playerId === player.id);
      if (offers.length < 2) continue;

      planMove(c, { kind: 'sell', offerId: offers[0]!.id });
      confirmPlan(c);
      expect(incomingOffers(c).some((o) => o.playerId === player.id)).toBe(false);
      return;
    }
  });
});

describe('the window is the only time to trade', () => {
  it('refuses bids and loans mid-season', () => {
    const c = toWindow('gate');
    const target = affordableTarget(c);
    const player = spare(c);
    startNextSeason(c);

    expect(bidFor(c, target.player.id, target.askingPrice).reason).toBe('window_closed');
    expect(sendOnLoan(c, player.id, allClubs(c.world)[1]!.id).reason).toBe('window_closed');
  });
});

describe('listing players', () => {
  it('brings in bids at once when the window is open', () => {
    let drew = 0;
    for (const seed of ['list-a', 'list-b', 'list-c', 'list-d', 'list-e']) {
      const c = toWindow(seed);
      const player = spare(c);
      const before = incomingOffers(c).filter((o) => o.playerId === player.id).length;
      setListing(c, player.id, 'transfer');
      const after = incomingOffers(c).filter((o) => o.playerId === player.id).length;
      expect(after).toBeGreaterThanOrEqual(before);
      if (after > before) drew += 1;
    }
    expect(drew).toBeGreaterThan(0);
  });

  it('never hands out an offer id twice, across a save', () => {
    const c = toWindow('list-ids');
    const loaded = deserializeCareer(serializeCareer(c));
    const club = managedClub(loaded);
    for (const player of club.squad.slice(0, 8)) setListing(loaded, player.id, 'transfer');

    const ids = transferWindow(loaded)!.incoming.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('listing does not touch the career generator', () => {
    const c = toWindow('list-rng');
    const state = c.rng.getState();
    setListing(c, spare(c).id, 'transfer');
    expect(c.rng.getState()).toBe(state);
  });

  it('sends loan-listed players out when the season starts', () => {
    for (const seed of ['loanlist-a', 'loanlist-b', 'loanlist-c']) {
      const c = toWindow(seed);
      const club = managedClub(c);
      const player = club.squad.find((p) => loanSuitors(c, p.id).length > 0 && depthAt(club, p.position) > 1);
      if (!player) continue;

      setListing(c, player.id, 'loan');
      startNextSeason(c);
      expect(c.world.loans.some((l) => l.playerId === player.id)).toBe(true);
      expect(c.listings[player.id]).toBeUndefined();
      return;
    }
  });
});
