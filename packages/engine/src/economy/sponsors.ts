import { Rng, clamp } from '../rng/index.js';
import type { Club, SponsorOffer, SponsorOfferKind } from '../types.js';
import { ECONOMY_TUNING, expectedAnnualRevenue } from './finances.js';

/**
 * Sponsor offers made during the season. None of them is free money: an advance
 * is paid back out of next season, a performance deal has to be earned, and a
 * tour costs the squad its legs. That is what makes them a decision rather than
 * a button to press.
 *
 * Every club gets them, not only the manager's. The AI signs by simple rules, so
 * the league's money supply moves the same way whoever is in charge -- and
 * `pnpm sim economy` measures it, because it all happens in the season loop.
 */
export const SPONSOR_TUNING = {
  /** Weekly chance of an offer for a club doing nothing special. */
  baseChance: 0.03,
  /** Added per point per game above `formPivot`. */
  formWeight: 0.06,
  formPivot: 1.3,
  /** Added while the club is still in the cup. */
  cupBonus: 0.02,
  /** Added in the week a club beats one this much bigger by reputation. */
  giantKillingBonus: 0.05,
  giantKillingGap: 10,
  maxChance: 0.2,
  /** No offers until a club has shown what it is, nor in the run-in. */
  firstRound: 5,
  quietFinalRounds: 4,
  /** Rounds between one offer and the next. */
  cooldownRounds: 6,
  /** Rounds an offer stays on the table. */
  expiryRounds: 3,

  /** Share of next season's sponsorship paid now by an advance... */
  advanceShare: 0.3,
  /** ...plus this much on top, which is the only reason to take it. */
  advancePremium: 0.1,
  /** Performance deal: a small fee now and a bonus for reaching a target. */
  performanceFeeShare: 0.03,
  performanceBonusShare: 0.12,
  /** Tour: money now, condition lost by every player in the squad. */
  tourFeeShare: 0.06,
  tourConditionCost: 12,
  /** Condition a tour never takes a player below. */
  tourConditionFloor: 45,
} as const;

/** What a club's season looks like the week an offer might arrive. */
export interface SponsorContext {
  /** Seasons played in the world, for the offer's id. */
  season: number;
  /** The round just played. */
  round: number;
  totalRounds: number;
  pointsPerGame: number;
  stillInCup: boolean;
  beatBiggerClub: boolean;
  /** Current league position, 1-based. */
  position: number;
  divisionSize: number;
  tier: number;
  /** An offer is already waiting for an answer. */
  pending: boolean;
}

/** The weekly chance of an offer. Success pays: form and cup runs draw sponsors. */
export function sponsorOfferChance(club: Club, ctx: SponsorContext): number {
  const S = SPONSOR_TUNING;
  if (ctx.pending) return 0;
  if (ctx.round < S.firstRound) return 0;
  if (ctx.round > ctx.totalRounds - S.quietFinalRounds) return 0;

  const last = club.finances.lastSponsorOfferRound;
  if (last !== undefined && ctx.round - last < S.cooldownRounds) return 0;

  let chance = S.baseChance;
  chance += Math.max(0, ctx.pointsPerGame - S.formPivot) * S.formWeight;
  if (ctx.stillInCup) chance += S.cupBonus;
  if (ctx.beatBiggerClub) chance += S.giantKillingBonus;
  return clamp(chance, 0, S.maxChance);
}

const SPONSOR_FIRST = [
  'Northgate', 'Bluewater', 'Ironbridge', 'Crestline', 'Harbourside', 'Summit',
  'Redwood', 'Silverline', 'Oakfield', 'Meridian', 'Kestrel', 'Lighthouse',
];
const SPONSOR_SECOND = [
  'Insurance', 'Motors', 'Bank', 'Telecom', 'Breweries', 'Airways',
  'Energy', 'Logistics', 'Foods', 'Mobile', 'Builders', 'Travel',
];

/**
 * Rolls for an offer and, if one comes, drafts it. Returns undefined most weeks.
 *
 * Sized off the club's own sponsorship, so a small club is offered small money:
 * the deal has to matter to the club receiving it, and must not flood a second
 * division with top-flight sums.
 */
export function rollSponsorOffer(
  rng: Rng,
  club: Club,
  ctx: SponsorContext,
): SponsorOffer | undefined {
  if (!rng.chance(sponsorOfferChance(club, ctx))) return undefined;
  return draftSponsorOffer(rng, club, ctx);
}

export function draftSponsorOffer(
  rng: Rng,
  club: Club,
  ctx: SponsorContext,
  kind?: SponsorOfferKind,
): SponsorOffer {
  const S = SPONSOR_TUNING;
  const base = club.finances.sponsorshipPerSeason;

  // A club in the red is the one lenders find: advances come to the desperate.
  const chosen =
    kind ??
    (['advance', 'performance', 'tour'] as const)[
      rng.weightedIndex([club.finances.balance < 0 ? 3 : 1, 2, 1.5])
    ]!;

  const offer: SponsorOffer = {
    id: `s${ctx.season}-r${ctx.round}-${club.id}`,
    kind: chosen,
    clubId: club.id,
    sponsorName: `${rng.pick(SPONSOR_FIRST)} ${rng.pick(SPONSOR_SECOND)}`,
    upfront: 0,
    season: ctx.season,
    offeredRound: ctx.round,
    expiresRound: ctx.round + S.expiryRounds,
  };

  if (chosen === 'advance') {
    const cut = roundMoney(base * S.advanceShare);
    offer.nextSeasonCut = cut;
    offer.upfront = roundMoney(cut * (1 + S.advancePremium));
  } else if (chosen === 'performance') {
    offer.upfront = roundMoney(base * S.performanceFeeShare);
    offer.bonus = roundMoney(base * S.performanceBonusShare);
    // A place or two better than where they stand: a stretch, not a gift.
    offer.targetPosition = Math.max(1, ctx.position - rng.int(1, 2));
  } else {
    offer.upfront = roundMoney(base * S.tourFeeShare);
    offer.conditionCost = S.tourConditionCost;
  }

  return offer;
}

/**
 * How the AI answers. Deliberately plain: take an advance only when cash is
 * short, chase a target only when it is close, and tour only when the season
 * has nothing riding on it.
 */
export function aiAcceptsSponsor(club: Club, offer: SponsorOffer, ctx: SponsorContext): boolean {
  switch (offer.kind) {
    case 'advance': {
      const revenue = expectedAnnualRevenue(club.reputation, ctx.divisionSize, ctx.tier);
      return club.finances.balance < revenue * ECONOMY_TUNING.cashReserveShare;
    }
    case 'performance':
      return offer.targetPosition !== undefined && ctx.position <= offer.targetPosition + 1;
    case 'tour': {
      const third = ctx.divisionSize / 3;
      return ctx.position > third && ctx.position <= ctx.divisionSize - third;
    }
  }
}

/** Signs an offer: the money arrives now and the catch is booked. */
export function acceptSponsorOffer(club: Club, offer: SponsorOffer): void {
  const finances = club.finances;
  finances.balance += offer.upfront;
  finances.season.sponsorDeals = (finances.season.sponsorDeals ?? 0) + offer.upfront;

  const deals = (finances.sponsorDeals ??= []);
  if (offer.kind === 'advance' && offer.nextSeasonCut) {
    deals.push({ kind: 'advance', sponsorName: offer.sponsorName, nextSeasonCut: offer.nextSeasonCut });
  } else if (offer.kind === 'performance' && offer.bonus && offer.targetPosition) {
    deals.push({
      kind: 'performance',
      sponsorName: offer.sponsorName,
      bonus: offer.bonus,
      targetPosition: offer.targetPosition,
    });
  } else if (offer.kind === 'tour' && offer.conditionCost) {
    for (const player of club.squad) {
      const status = player.status;
      if (status.condition <= SPONSOR_TUNING.tourConditionFloor) continue;
      status.condition = Math.max(
        SPONSOR_TUNING.tourConditionFloor,
        status.condition - offer.conditionCost,
      );
    }
  }
}

/**
 * Pays performance bonuses once the table is final. Advances stay booked: they
 * are taken off next season's deal when it is set.
 */
export function settleSponsorDeals(club: Club, finishPosition: number): number {
  const deals = club.finances.sponsorDeals;
  if (!deals || deals.length === 0) return 0;

  let paid = 0;
  for (const deal of deals) {
    if (deal.kind !== 'performance' || !deal.bonus || !deal.targetPosition) continue;
    if (finishPosition <= deal.targetPosition) paid += deal.bonus;
  }

  if (paid > 0) {
    club.finances.balance += paid;
    club.finances.season.sponsorDeals = (club.finances.season.sponsorDeals ?? 0) + paid;
  }
  club.finances.sponsorDeals = deals.filter((deal) => deal.kind !== 'performance');
  return paid;
}

function roundMoney(value: number): number {
  return Math.round(value / 1000) * 1000;
}
