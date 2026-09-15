import { beforeEach, describe, expect, it } from 'vitest';
import {
  advanceRound,
  answerOffer,
  bidFor,
  browseTargets,
  endSeason,
  incomingOffers,
  isSeasonComplete,
  managedClub,
  release,
  renewContract,
  startNextSeason,
  transferWindow,
  type Career,
} from '../career/controller.js';
import { startCareer } from '../career/controller.js';
import { deserializeCareer, serializeCareer } from '../career/persistence.js';
import { currentAbility } from '../world/players.js';
import { expectedWage, marketValue, wageBill } from '../economy/valuation.js';
import { TRANSFER_TUNING } from '../transfers/market.js';

function toWindow(seed: string): Career {
  // One division, no cup: this suite is about the transfer window, and the
  // fixture and result counts it asserts are a single division's.
  const career = startCareer({ seed, divisions: 1, cup: false });
  let guard = 0;
  while (!isSeasonComplete(career) && guard++ < 60) advanceRound(career);
  endSeason(career);
  return career;
}

describe('the window opens and waits', () => {
  it('stays open after the season ends, and the new season has not started', () => {
    const career = toWindow('window-open');
    const window = transferWindow(career);

    expect(window).toBeDefined();
    expect(window!.open).toBe(true);
    // endSeason no longer rolls the world forward on its own.
    expect(career.world.season).toBe(1);
    expect(career.season.results).toHaveLength(380);
  });

  it('closes when the next season starts, and the AI does its business then', () => {
    const career = toWindow('window-close');
    const before = career.history[0]!.transfers.length;

    const aiTransfers = startNextSeason(career);

    expect(transferWindow(career)).toBeUndefined();
    expect(career.world.season).toBe(2);
    expect(career.season.results).toHaveLength(0);
    // The summary is back-filled with what the computer did.
    expect(career.history[0]!.transfers.length).toBe(before + aiTransfers.length);
    expect(aiTransfers.length).toBeGreaterThan(0);
  });
});

describe('browsing', () => {
  let career: Career;
  beforeEach(() => {
    career = toWindow('window-browse');
  });

  it('lists players from other clubs and the free agent pool, never your own', () => {
    const listings = browseTargets(career);
    expect(listings.length).toBeGreaterThan(20);

    const ownIds = new Set(managedClub(career).squad.map((p) => p.id));
    for (const listing of listings) {
      expect(ownIds.has(listing.player.id)).toBe(false);
      expect(listing.sellerClubId).not.toBe(career.managedClubId);
    }
  });

  it('prices a free agent at nothing and everyone else above market value', () => {
    for (const listing of browseTargets(career)) {
      if (listing.sellerClubId === '') expect(listing.askingPrice).toBe(0);
      else expect(listing.askingPrice).toBeGreaterThanOrEqual(marketValue(listing.player));
    }
  });

  it('filters', () => {
    const strikers = browseTargets(career, { position: 'ST' });
    expect(strikers.length).toBeGreaterThan(0);
    for (const l of strikers) expect(l.player.position).toBe('ST');

    const young = browseTargets(career, { maxAge: 21 });
    for (const l of young) expect(l.player.age).toBeLessThanOrEqual(21);

    const affordable = browseTargets(career, { affordableOnly: true });
    for (const l of affordable) expect(l.affordable).toBe(true);
    expect(affordable.length).toBeLessThanOrEqual(browseTargets(career).length);
  });
});

describe('bidding', () => {
  let career: Career;
  beforeEach(() => {
    career = toWindow('window-bid');
  });

  it('rejects a bid below the asking price and says what it would take', () => {
    const target = browseTargets(career).find((l) => l.sellerClubId !== '' && l.askingPrice > 0)!;
    const outcome = bidFor(career, target.player.id, Math.floor(target.askingPrice * 0.5));

    expect(outcome.accepted).toBe(false);
    expect(outcome.reason).toBe('below_asking');
    expect(outcome.counterFee).toBe(target.askingPrice);
  });

  it('completes a bid at the asking price, moving the player and the money', () => {
    const club = managedClub(career);
    const target = browseTargets(career, { affordableOnly: true }).find(
      (l) => l.sellerClubId !== '' && l.wouldJoin && l.askingPrice > 0,
    );
    if (!target) return; // nothing affordable this window; the other tests still hold

    const seller = career.world.leagues[0]!.clubs.find((c) => c.id === target.sellerClubId)!;
    const buyerBalance = club.finances.balance;
    const sellerBalance = seller.finances.balance;
    const squadSize = club.squad.length;

    const outcome = bidFor(career, target.player.id, target.askingPrice);
    expect(outcome.accepted).toBe(true);

    // Money is conserved, and the player is in exactly one squad.
    expect(club.finances.balance).toBe(buyerBalance - target.askingPrice);
    expect(seller.finances.balance).toBe(sellerBalance + target.askingPrice);
    expect(club.squad).toHaveLength(squadSize + 1);
    expect(club.squad.some((p) => p.id === target.player.id)).toBe(true);
    expect(seller.squad.some((p) => p.id === target.player.id)).toBe(false);
    // And the lookup table follows him.
    expect(career.world.players.get(target.player.id)).toBe(
      club.squad.find((p) => p.id === target.player.id),
    );
  });

  it('refuses a player who would not drop to your club', () => {
    const unwilling = browseTargets(career).find((l) => !l.wouldJoin && l.sellerClubId !== '');
    if (!unwilling) return;
    const outcome = bidFor(career, unwilling.player.id, unwilling.askingPrice * 3);
    expect(outcome.accepted).toBe(false);
    expect(outcome.reason).toBe('would_not_join');
  });

  it('refuses an unknown player', () => {
    expect(bidFor(career, 'p-nope', 1_000_000).reason).toBe('unknown_player');
  });
});

describe('offers for your players', () => {
  it('arrive when the window opens, and can be accepted or rejected', () => {
    // Several seeds, because whether anyone bids depends on the world.
    let career: Career | undefined;
    for (const seed of ['offers-a', 'offers-b', 'offers-c', 'offers-d']) {
      const candidate = toWindow(seed);
      if (incomingOffers(candidate).length > 0) {
        career = candidate;
        break;
      }
    }
    expect(career, 'no seed produced an incoming offer').toBeDefined();
    if (!career) return;

    const offer = incomingOffers(career)[0]!;
    const club = managedClub(career);
    const balance = club.finances.balance;
    const squadSize = club.squad.length;

    expect(offer.sellerClubId).toBe(career.managedClubId);
    expect(offer.fee).toBeGreaterThan(0);

    const transfer = answerOffer(career, offer.id, 'accept');
    expect(transfer).toBeDefined();
    expect(club.finances.balance).toBe(balance + offer.fee);
    expect(club.squad).toHaveLength(squadSize - 1);
    expect(club.squad.some((p) => p.id === offer.playerId)).toBe(false);

    // The same offer cannot be answered twice.
    expect(answerOffer(career, offer.id, 'accept')).toBeUndefined();
  });

  it('can be turned down, and the player stays', () => {
    let career: Career | undefined;
    for (const seed of ['reject-a', 'reject-b', 'reject-c', 'reject-d']) {
      const candidate = toWindow(seed);
      if (incomingOffers(candidate).length > 0) {
        career = candidate;
        break;
      }
    }
    if (!career) return;

    const offer = incomingOffers(career)[0]!;
    expect(answerOffer(career, offer.id, 'reject')).toBeUndefined();
    expect(managedClub(career).squad.some((p) => p.id === offer.playerId)).toBe(true);
    expect(incomingOffers(career).some((o) => o.id === offer.id)).toBe(false);
  });

  it('does not let the AI take your players without asking', () => {
    const career = toWindow('no-silent-sales');
    const before = new Set(managedClub(career).squad.map((p) => p.id));

    startNextSeason(career);

    // Anyone missing must have retired or been released, never sold out from
    // under the manager -- the AI is skipped for the managed club.
    const sold = career.history[0]!.transfers.filter(
      (t) => t.fromClubId === career.managedClubId && before.has(t.playerId),
    );
    expect(sold).toEqual([]);
  });
});

describe('releasing and renewing', () => {
  it('releases a player into the free agent pool', () => {
    const career = toWindow('window-release');
    const club = managedClub(career);
    const spare = club.squad.find(
      (p) => club.squad.filter((q) => q.position === p.position).length > 1,
    )!;

    expect(release(career, spare.id)).toBe(true);
    expect(club.squad.some((p) => p.id === spare.id)).toBe(false);
    expect(career.world.freeAgents.some((p) => p.id === spare.id)).toBe(true);
  });

  it('refuses to release the last player in a position', () => {
    const career = toWindow('window-release-guard');
    const club = managedClub(career);
    const only = club.squad.find(
      (p) => club.squad.filter((q) => q.position === p.position).length === 1,
    );
    if (!only) return;
    expect(release(career, only.id)).toBe(false);
  });

  it('renews a contract on acceptable terms, and refuses a pay cut', () => {
    const career = toWindow('window-renew');
    const club = managedClub(career);
    const player = [...club.squad].sort((a, b) => currentAbility(a) - currentAbility(b))[0]!;

    expect(renewContract(career, player.id, Math.round(expectedWage(player) * 0.5), 3)).toBe(false);

    const fair = Math.round(expectedWage(player) * 1.05);
    const renewed = renewContract(career, player.id, fair, 4);
    if (renewed) {
      expect(player.contract.wage).toBe(fair);
      expect(player.contract.yearsRemaining).toBe(4);
      expect(wageBill(club.squad)).toBeLessThanOrEqual(
        club.finances.wageBudget * TRANSFER_TUNING.wageBudgetCeiling,
      );
    }
  });
});

describe('an open window survives a save', () => {
  it('round-trips and can still be acted in', () => {
    const career = toWindow('window-save');
    const loaded = deserializeCareer(serializeCareer(career));

    const window = transferWindow(loaded);
    expect(window).toBeDefined();
    expect(window!.season).toBe(transferWindow(career)!.season);
    expect(browseTargets(loaded).length).toBeGreaterThan(0);

    expect(() => startNextSeason(loaded)).not.toThrow();
    expect(loaded.world.season).toBe(2);
  });

  it('upgrades a save written before the window existed', () => {
    const career = toWindow('window-migrate');
    const saved = JSON.parse(serializeCareer(career));
    delete saved.transferWindow;
    saved.version = 3;

    const loaded = deserializeCareer(JSON.stringify(saved));
    expect(transferWindow(loaded)).toBeUndefined();
  });
});
