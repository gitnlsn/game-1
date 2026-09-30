import type { SaveStorage } from './saves';

/**
 * Whether this player is a subscriber, kept apart from the store so it can be
 * tested without React Native.
 *
 * There is no server. Google Play is the only authority, and it is asked on
 * every launch; what is stored here is only the last answer, so a subscriber
 * who opens the game on a plane is still a subscriber. That cache can be edited
 * on a rooted phone -- the accepted cost of not running a backend.
 */

export const ENTITLEMENT_KEY = 'game1:subscription';

/** How long a cached "yes" survives without Google confirming it again. */
export const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedEntitlement {
  active: boolean;
  /** The base plan subscribed to, e.g. "yearly". */
  planId?: string;
  /** False once the subscriber has cancelled; access lasts to the period's end. */
  autoRenewing?: boolean;
  /** When Google last answered, ms since epoch. */
  checkedAt: number;
}

/** The part of a Play purchase this decision needs. */
export interface OwnedPurchase {
  productId: string;
  purchaseState: 'pending' | 'purchased' | 'unknown';
  /** On Android, the base plan id. */
  currentPlanId?: string | null;
  autoRenewingAndroid?: boolean | null;
}

export interface Membership {
  planId?: string;
  autoRenewing: boolean;
}

/**
 * The subscription this account holds, if any. A pending purchase is not paid
 * for yet -- Play lets people pay cash at a shop later -- so only `purchased`
 * counts.
 */
export function membershipOf(
  purchases: readonly OwnedPurchase[],
  subscriptionId: string,
): Membership | undefined {
  const owned = purchases.find((p) => p.productId === subscriptionId && p.purchaseState === 'purchased');
  if (!owned) return undefined;
  return {
    ...(owned.currentPlanId ? { planId: owned.currentPlanId } : {}),
    autoRenewing: owned.autoRenewingAndroid !== false,
  };
}

export function isEntitled(purchases: readonly OwnedPurchase[], subscriptionId: string): boolean {
  return membershipOf(purchases, subscriptionId) !== undefined;
}

/** The cached answer, if it is recent enough to trust while Google cannot be asked. */
export function cachedActive(cache: CachedEntitlement | undefined, now: number): boolean {
  return !!cache && cache.active && now - cache.checkedAt < OFFLINE_GRACE_MS;
}

export async function readEntitlement(storage: SaveStorage): Promise<CachedEntitlement | undefined> {
  try {
    const raw = await storage.getItem(ENTITLEMENT_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<CachedEntitlement>;
    if (typeof parsed.active !== 'boolean' || typeof parsed.checkedAt !== 'number') return undefined;
    return {
      active: parsed.active,
      checkedAt: parsed.checkedAt,
      ...(typeof parsed.planId === 'string' ? { planId: parsed.planId } : {}),
      ...(typeof parsed.autoRenewing === 'boolean' ? { autoRenewing: parsed.autoRenewing } : {}),
    };
  } catch {
    return undefined;
  }
}

export async function writeEntitlement(storage: SaveStorage, cache: CachedEntitlement): Promise<void> {
  try {
    await storage.setItem(ENTITLEMENT_KEY, JSON.stringify(cache));
  } catch {
    // A cache that cannot be written only costs an offline launch its answer.
  }
}

/** A base plan as the subscribe buttons need it. */
export interface PlanOffer {
  planId: string;
  offerToken: string;
  /** The recurring price as Play formats it, e.g. "R$ 9,90". */
  price: string;
  /** The same price in millionths of the currency, for comparing plans. */
  priceMicros: number;
  currency: string;
}

/** The part of a Play subscription offer this needs. */
export interface StoreOffer {
  basePlanIdAndroid?: string | null;
  offerTokenAndroid?: string | null;
  displayPrice: string;
  pricingPhasesAndroid?: { pricingPhaseList: StorePhase[] } | null;
}

interface StorePhase {
  formattedPrice: string;
  priceAmountMicros: string;
  priceCurrencyCode: string;
}

/**
 * One offer per configured base plan, in the configured order.
 *
 * Play returns every offer of every base plan, so a plan with a free trial
 * shows up twice: once plain, once with the trial phase in front. The plain one
 * has the fewest pricing phases, and its last phase is what the player keeps
 * paying -- the price to put on the button. Plans that are not active in Play
 * are simply absent, so their button never appears.
 */
export function planOffers(offers: readonly StoreOffer[], planIds: readonly string[]): PlanOffer[] {
  const plans: PlanOffer[] = [];
  for (const planId of planIds) {
    const candidates = offers
      .filter((o) => o.basePlanIdAndroid === planId && o.offerTokenAndroid)
      .sort((a, b) => phases(a).length - phases(b).length);
    const offer = candidates[0];
    if (!offer) continue;
    const recurring = phases(offer).at(-1);
    plans.push({
      planId,
      offerToken: offer.offerTokenAndroid!,
      price: recurring?.formattedPrice ?? offer.displayPrice,
      priceMicros: Number(recurring?.priceAmountMicros ?? 0),
      currency: recurring?.priceCurrencyCode ?? '',
    });
  }
  return plans;
}

function phases(offer: StoreOffer): StorePhase[] {
  return offer.pricingPhasesAndroid?.pricingPhaseList ?? [];
}

/**
 * How much a longer plan saves against the dearest per-month one, as a whole
 * percentage -- "Save 16%" on the yearly row. Zero for the dearest plan itself,
 * and for anything whose price Play did not give in the same currency.
 */
export function savingsPercent(
  plan: { priceMicros: number; currency: string; months: number },
  all: readonly { priceMicros: number; currency: string; months: number }[],
): number {
  const perMonth = (p: typeof plan) => p.priceMicros / p.months;
  const comparable = all.filter((p) => p.currency === plan.currency && p.priceMicros > 0);
  if (plan.priceMicros <= 0 || comparable.length < 2) return 0;
  const dearest = Math.max(...comparable.map(perMonth));
  return Math.max(0, Math.floor((1 - perMonth(plan) / dearest) * 100));
}
