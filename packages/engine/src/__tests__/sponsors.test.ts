import { describe, expect, it } from 'vitest';
import { Rng } from '../rng/index.js';
import { allClubs, createWorld } from '../world/index.js';
import type { Club } from '../types.js';
import { applyCloseSeasonSpending, sponsorshipIncome } from '../economy/finances.js';
import {
  acceptSponsorOffer,
  draftSponsorOffer,
  settleSponsorDeals,
  sponsorOfferChance,
  SPONSOR_TUNING,
  type SponsorContext,
} from '../economy/sponsors.js';
import {
  advanceRound,
  answerSponsorOffer,
  endSeason,
  isSeasonComplete,
  managedClub,
  pendingSponsorOffers,
  startCareer,
} from '../career/controller.js';
import { deserializeCareer, serializeCareer } from '../career/persistence.js';

function aClub(seed = 'sponsors'): Club {
  return allClubs(createWorld({ seed, divisions: 1 }))[3]!;
}

function context(patch: Partial<SponsorContext> = {}): SponsorContext {
  return {
    season: 0,
    round: 12,
    totalRounds: 38,
    pointsPerGame: 1.3,
    stillInCup: false,
    beatBiggerClub: false,
    position: 8,
    divisionSize: 20,
    tier: 1,
    pending: false,
    ...patch,
  };
}

describe('sponsor offer chance', () => {
  const club = aClub();

  it('rises with form, a cup run and a giant-killing', () => {
    const quiet = sponsorOfferChance(club, context());
    expect(sponsorOfferChance(club, context({ pointsPerGame: 2.2 }))).toBeGreaterThan(quiet);
    expect(sponsorOfferChance(club, context({ stillInCup: true }))).toBeGreaterThan(quiet);
    expect(sponsorOfferChance(club, context({ beatBiggerClub: true }))).toBeGreaterThan(quiet);
    expect(
      sponsorOfferChance(club, context({ pointsPerGame: 3, stillInCup: true, beatBiggerClub: true })),
    ).toBeLessThanOrEqual(SPONSOR_TUNING.maxChance);
  });

  it('is zero early on, in the run-in, while one is pending and during the cooldown', () => {
    expect(sponsorOfferChance(club, context({ round: 2 }))).toBe(0);
    expect(sponsorOfferChance(club, context({ round: 36 }))).toBe(0);
    expect(sponsorOfferChance(club, context({ pending: true }))).toBe(0);

    const recent = { ...club, finances: { ...club.finances, lastSponsorOfferRound: 10 } };
    expect(sponsorOfferChance(recent, context({ round: 12 }))).toBe(0);
    expect(sponsorOfferChance(recent, context({ round: 16 }))).toBeGreaterThan(0);
  });

  it('drafts the same offer from the same seed', () => {
    const a = draftSponsorOffer(new Rng('same'), club, context());
    const b = draftSponsorOffer(new Rng('same'), club, context());
    expect(a).toEqual(b);
  });
});

describe('sponsor deals', () => {
  it('pays an advance now and takes it off next season', () => {
    const club = aClub('advance');
    const before = club.finances.balance;
    const offer = draftSponsorOffer(new Rng('a'), club, context(), 'advance');
    acceptSponsorOffer(club, offer);

    expect(club.finances.balance).toBe(before + offer.upfront);
    expect(offer.upfront).toBeGreaterThan(offer.nextSeasonCut!);

    applyCloseSeasonSpending(club, 20);
    expect(club.finances.sponsorshipPerSeason).toBe(
      sponsorshipIncome(club.reputation) - offer.nextSeasonCut!,
    );
    // Paid back once, not every season after.
    expect(club.finances.sponsorDeals).toEqual([]);
    applyCloseSeasonSpending(club, 20);
    expect(club.finances.sponsorshipPerSeason).toBe(sponsorshipIncome(club.reputation));
  });

  it('pays a performance bonus only when the target is reached', () => {
    const hit = aClub('bonus');
    const offer = draftSponsorOffer(new Rng('p'), hit, context({ position: 8 }), 'performance');
    expect(offer.targetPosition).toBeLessThan(8);

    const miss = aClub('bonus');
    acceptSponsorOffer(hit, offer);
    acceptSponsorOffer(miss, offer);

    expect(settleSponsorDeals(hit, offer.targetPosition!)).toBe(offer.bonus);
    expect(settleSponsorDeals(miss, offer.targetPosition! + 1)).toBe(0);
    expect(hit.finances.balance - miss.finances.balance).toBe(offer.bonus);
    expect(hit.finances.sponsorDeals).toEqual([]);
  });

  it('tires the squad out on tour', () => {
    const club = aClub('tour');
    for (const player of club.squad) player.status.condition = 95;
    const offer = draftSponsorOffer(new Rng('t'), club, context(), 'tour');
    acceptSponsorOffer(club, offer);

    for (const player of club.squad) {
      expect(player.status.condition).toBe(95 - SPONSOR_TUNING.tourConditionCost);
    }
  });
});

describe('sponsor offers in a career', () => {
  it('offers the manager deals that can be answered once, and saved in between', () => {
    const career = startCareer({ seed: 'sponsor-career', managedClubId: 'c4' });
    let guard = 0;
    while (pendingSponsorOffers(career).length === 0 && !isSeasonComplete(career) && guard++ < 60) {
      advanceRound(career);
    }
    const [offer] = pendingSponsorOffers(career);
    expect(offer).toBeDefined();

    const restored = deserializeCareer(serializeCareer(career));
    expect(pendingSponsorOffers(restored)).toEqual([offer]);

    const before = managedClub(restored).finances.balance;
    expect(answerSponsorOffer(restored, offer!.id, 'accept')).toBe(true);
    expect(managedClub(restored).finances.balance).toBe(before + offer!.upfront);
    expect(answerSponsorOffer(restored, offer!.id, 'accept')).toBe(false);
  });

  it('lets an unanswered offer run out', () => {
    const career = startCareer({ seed: 'sponsor-career', managedClubId: 'c4' });
    let guard = 0;
    while (pendingSponsorOffers(career).length === 0 && !isSeasonComplete(career) && guard++ < 60) {
      advanceRound(career);
    }
    const [offer] = pendingSponsorOffers(career);
    while (career.season.nextRound <= offer!.expiresRound) advanceRound(career);

    expect(pendingSponsorOffers(career).find((o) => o.id === offer!.id)).toBeUndefined();
    expect(answerSponsorOffer(career, offer!.id, 'accept')).toBe(false);
  });

  it('clears offers at the end of the season', () => {
    const career = startCareer({ seed: 'sponsor-end', managedClubId: 'c4' });
    let guard = 0;
    while (!isSeasonComplete(career) && guard++ < 100) advanceRound(career);
    endSeason(career);
    expect(pendingSponsorOffers(career)).toEqual([]);
  });

  it('gives an old save an empty list of offers', () => {
    const career = startCareer({ seed: 'sponsor-migrate', managedClubId: 'c4' });
    advanceRound(career);

    const saved = JSON.parse(serializeCareer(career)) as Record<string, unknown>;
    saved.version = 8;
    delete saved.sponsorOffers;

    expect(deserializeCareer(JSON.stringify(saved)).sponsorOffers).toEqual([]);
  });
});
