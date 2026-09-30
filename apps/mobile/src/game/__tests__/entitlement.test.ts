import { describe, expect, it } from 'vitest';
import {
  cachedActive,
  ENTITLEMENT_KEY,
  isEntitled,
  membershipOf,
  OFFLINE_GRACE_MS,
  planOffers,
  savingsPercent,
  readEntitlement,
  writeEntitlement,
} from '../entitlement';
import type { SaveStorage } from '../saves';

function memoryStorage(initial: Record<string, string> = {}): SaveStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: async (key) => data[key] ?? null,
    setItem: async (key, value) => {
      data[key] = value;
    },
    removeItem: async (key) => {
      delete data[key];
    },
  };
}

describe('isEntitled', () => {
  it('counts only a paid purchase of this subscription', () => {
    expect(isEntitled([{ productId: 'pro', purchaseState: 'purchased' }], 'pro')).toBe(true);
    // Play lets people pay cash later; until then it is not paid for.
    expect(isEntitled([{ productId: 'pro', purchaseState: 'pending' }], 'pro')).toBe(false);
    expect(isEntitled([{ productId: 'other', purchaseState: 'purchased' }], 'pro')).toBe(false);
    expect(isEntitled([], 'pro')).toBe(false);
  });
});

describe('the offline cache', () => {
  const now = 1_000_000_000_000;

  it('keeps a subscriber subscribed for a week without Google', () => {
    expect(cachedActive({ active: true, checkedAt: now - 1000 }, now)).toBe(true);
    expect(cachedActive({ active: true, checkedAt: now - OFFLINE_GRACE_MS - 1 }, now)).toBe(false);
    expect(cachedActive({ active: false, checkedAt: now }, now)).toBe(false);
    expect(cachedActive(undefined, now)).toBe(false);
  });

  it('round-trips through storage and ignores anything malformed', async () => {
    const storage = memoryStorage();
    await writeEntitlement(storage, { active: true, checkedAt: now });
    expect(await readEntitlement(storage)).toEqual({ active: true, checkedAt: now });

    expect(await readEntitlement(memoryStorage({ [ENTITLEMENT_KEY]: 'not json' }))).toBeUndefined();
    expect(await readEntitlement(memoryStorage({ [ENTITLEMENT_KEY]: '{"active":"yes"}' }))).toBeUndefined();
  });
});

describe('planOffers', () => {
  const phase = (formattedPrice: string, micros = 0) => ({
    formattedPrice,
    priceAmountMicros: String(micros),
    priceCurrencyCode: 'BRL',
  });
  const monthly = {
    basePlanIdAndroid: 'monthly',
    offerTokenAndroid: 'tok-monthly',
    displayPrice: 'R$ 9,90',
    pricingPhasesAndroid: { pricingPhaseList: [phase('R$ 9,90', 9_900_000)] },
  };
  const monthlyTrial = {
    basePlanIdAndroid: 'monthly',
    offerTokenAndroid: 'tok-trial',
    displayPrice: 'Free',
    pricingPhasesAndroid: { pricingPhaseList: [phase('Free'), phase('R$ 9,90', 9_900_000)] },
  };
  const yearly = {
    basePlanIdAndroid: 'yearly',
    offerTokenAndroid: 'tok-yearly',
    displayPrice: 'R$ 89,90',
    pricingPhasesAndroid: { pricingPhaseList: [phase('R$ 89,90', 89_900_000)] },
  };

  it('gives one button per plan, in the configured order, at the recurring price', () => {
    expect(planOffers([yearly, monthlyTrial, monthly], ['monthly', 'yearly'])).toEqual([
      { planId: 'monthly', offerToken: 'tok-monthly', price: 'R$ 9,90', priceMicros: 9_900_000, currency: 'BRL' },
      { planId: 'yearly', offerToken: 'tok-yearly', price: 'R$ 89,90', priceMicros: 89_900_000, currency: 'BRL' },
    ]);
  });

  it('leaves out a plan that is not active in Play', () => {
    expect(planOffers([monthly], ['monthly', 'yearly']).map((p) => p.planId)).toEqual(['monthly']);
    expect(planOffers([], ['monthly', 'yearly'])).toEqual([]);
  });
});

describe('membershipOf', () => {
  it('names the plan and whether it will renew', () => {
    expect(
      membershipOf(
        [{ productId: 'pro', purchaseState: 'purchased', currentPlanId: 'yearly', autoRenewingAndroid: true }],
        'pro',
      ),
    ).toEqual({ planId: 'yearly', autoRenewing: true });
    // Cancelled but still inside the paid period: still a member, not renewing.
    expect(
      membershipOf(
        [{ productId: 'pro', purchaseState: 'purchased', currentPlanId: 'monthly', autoRenewingAndroid: false }],
        'pro',
      ),
    ).toEqual({ planId: 'monthly', autoRenewing: false });
    expect(membershipOf([{ productId: 'pro', purchaseState: 'pending' }], 'pro')).toBeUndefined();
  });
});

describe('savingsPercent', () => {
  const monthly = { priceMicros: 9_990_000, currency: 'BRL', months: 1 };
  const yearly = { priceMicros: 99_990_000, currency: 'BRL', months: 12 };

  it('compares per month against the dearest plan', () => {
    // 99.99 / 12 = 8.33 a month against 9.99: 16% off.
    expect(savingsPercent(yearly, [monthly, yearly])).toBe(16);
    expect(savingsPercent(monthly, [monthly, yearly])).toBe(0);
  });

  it('claims nothing it cannot back up', () => {
    expect(savingsPercent(yearly, [yearly])).toBe(0);
    expect(savingsPercent(yearly, [{ ...monthly, currency: 'USD' }, yearly])).toBe(0);
    expect(savingsPercent({ ...yearly, priceMicros: 0 }, [monthly, yearly])).toBe(0);
  });
});
