import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  deepLinkToSubscriptions,
  endConnection,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  isUserCancelledError,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  type ProductSubscriptionAndroid,
  type Purchase,
} from 'expo-iap';
import config from '../../billing.json';
import appConfig from '../../app.json';
import {
  cachedActive,
  membershipOf,
  planOffers,
  readEntitlement,
  writeEntitlement,
  type Membership,
  type PlanOffer,
} from './entitlement';

/**
 * The Google Play subscription.
 *
 * Android only, and inert until `billing.json` names a subscription that exists
 * in the Play Console: with no id, nothing connects to Play and no screen shows
 * a thing. Like Play Games, a failure here never stops the game -- it only
 * means the player is treated as not subscribed.
 *
 * Failures are logged under `[Billing]` in development; `adb logcat -s
 * ReactNativeJS` shows them.
 */

const TAG = '[Billing]';
const SUBSCRIPTION_ID = config.subscriptionId;
const PACKAGE_NAME = appConfig.expo.android.package;
const PLANS = config.plans;

function noteFailure(what: string, error: unknown): void {
  if (!__DEV__) return;
  const detail = error as { code?: string; message?: string } | undefined;
  console.warn(TAG, what, detail?.code ? `[${detail.code}]` : '', detail?.message ?? error);
}

export function billingConfigured(): boolean {
  return Platform.OS === 'android' && SUBSCRIPTION_ID !== '';
}

export interface Plan extends PlanOffer {
  /** "Monthly", "Yearly": from `billing.json`. */
  label: string;
  /** Billing period length, for comparing plans per month. */
  months: number;
}

/** The label `billing.json` gives a base plan id, or the id itself. */
export function planLabel(planId: string | undefined): string | undefined {
  if (!planId) return undefined;
  return PLANS.find((p) => p.id === planId)?.label ?? planId;
}

export type SubscribeOutcome = 'subscribed' | 'pending' | 'declined' | 'failed';

export interface SubscriptionState {
  /** False on web, iOS, or before a subscription id is configured. */
  available: boolean;
  /** True while the first answer from Play is outstanding. */
  checking: boolean;
  active: boolean;
  /** What the subscriber holds; undefined when not subscribed. */
  membership?: Membership;
  /**
   * The plans on sale, in `billing.json` order. Only plans active in the Play
   * Console appear, so an unfinished yearly plan simply has no button.
   */
  plans: Plan[];
  subscribe(planId: string): Promise<SubscribeOutcome>;
  /** Asks Play again. For the "Restore purchase" button after a phone change. */
  restore(): Promise<boolean>;
  /** Asks Play again for both the plans and the status: pull-to-refresh. */
  reload(): Promise<void>;
  /** Opens Play's own page for managing or cancelling the subscription. */
  manage(): Promise<void>;
}

const INACTIVE: SubscriptionState = {
  available: false,
  checking: false,
  active: false,
  plans: [],
  subscribe: async () => 'failed',
  restore: async () => false,
  reload: async () => {},
  manage: async () => {},
};

const SubscriptionContext = createContext<SubscriptionState>(INACTIVE);

export function useSubscription(): SubscriptionState {
  return useContext(SubscriptionContext);
}

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const enabled = billingConfigured();
  const [checking, setChecking] = useState(enabled);
  const [membership, setMembership] = useState<Membership>();
  const [plans, setPlans] = useState<Plan[]>([]);
  const connected = useRef<Promise<boolean> | null>(null);
  /** The purchase flow waiting on the listener to say how it ended. */
  const pending = useRef<((outcome: SubscribeOutcome) => void) | null>(null);

  const record = useCallback(async (held: Membership | undefined) => {
    setMembership(held);
    await writeEntitlement(AsyncStorage, { active: !!held, checkedAt: Date.now(), ...held });
  }, []);

  const connect = useCallback((): Promise<boolean> => {
    connected.current ??= initConnection().then(
      (ok) => !!ok,
      (error) => {
        noteFailure('connect', error);
        connected.current = null;
        return false;
      },
    );
    return connected.current;
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!(await connect())) return false;
    try {
      const purchases = await getAvailablePurchases();
      // Play refunds a purchase nobody acknowledged within three days, so an
      // unfinished one from an interrupted flow is finished here.
      for (const purchase of purchases) {
        if (purchase.productId === SUBSCRIPTION_ID && purchase.purchaseState === 'purchased') {
          await acknowledge(purchase);
        }
      }
      const held = membershipOf(purchases, SUBSCRIPTION_ID);
      await record(held);
      return !!held;
    } catch (error) {
      noteFailure('refresh', error);
      return false;
    }
  }, [connect, record]);

  const loadPlans = useCallback(async (): Promise<void> => {
    if (!(await connect())) return;
    try {
      const products = await fetchProducts({ skus: [SUBSCRIPTION_ID], type: 'subs' });
      const found = (products ?? []).find(
        (p): p is ProductSubscriptionAndroid => p.id === SUBSCRIPTION_ID && p.platform === 'android',
      );
      const offers = planOffers(found?.subscriptionOffers ?? [], PLANS.map((p) => p.id));
      setPlans(
        offers.map((o) => {
          const plan = PLANS.find((p) => p.id === o.planId)!;
          return { ...o, label: plan.label, months: plan.months };
        }),
      );
    } catch (error) {
      noteFailure('fetchProducts', error);
    }
  }, [connect]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    void (async () => {
      // The cached answer first, so a subscriber offline is not locked out.
      const cache = await readEntitlement(AsyncStorage);
      if (!cancelled && cache && cachedActive(cache, Date.now())) {
        setMembership({
          ...(cache.planId ? { planId: cache.planId } : {}),
          autoRenewing: cache.autoRenewing !== false,
        });
      }
      if (!(await connect()) || cancelled) {
        setChecking(false);
        return;
      }
      await Promise.all([loadPlans(), refresh()]);
      if (!cancelled) setChecking(false);
    })();

    /*
     * Cancelling, resubscribing or switching plans all happen in the Play Store,
     * with this app in the background. Coming back to the foreground is the one
     * moment that is guaranteed to follow, so that is when Play is asked again --
     * otherwise the card would say "Active" until the next launch.
     */
    const foreground = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });

    const updated = purchaseUpdatedListener((purchase) => {
      if (purchase.productId !== SUBSCRIPTION_ID) return;
      void (async () => {
        if (purchase.purchaseState === 'purchased') {
          await acknowledge(purchase);
          await record(membershipOf([purchase], SUBSCRIPTION_ID));
          pending.current?.('subscribed');
        } else {
          pending.current?.('pending');
        }
        pending.current = null;
      })();
    });
    const failed = purchaseErrorListener((error) => {
      if (!isUserCancelledError(error)) noteFailure('purchase', error);
      pending.current?.(isUserCancelledError(error) ? 'declined' : 'failed');
      pending.current = null;
    });

    return () => {
      cancelled = true;
      foreground.remove();
      updated.remove();
      failed.remove();
      void endConnection().catch(() => {});
      connected.current = null;
    };
  }, [enabled, connect, loadPlans, refresh, record]);

  const reload = useCallback(async () => {
    await Promise.all([loadPlans(), refresh()]);
  }, [loadPlans, refresh]);

  const subscribe = useCallback(async (planId: string): Promise<SubscribeOutcome> => {
    // Each base plan is bought through its own offer token.
    const offerToken = plans.find((p) => p.planId === planId)?.offerToken;
    if (!offerToken || !(await connect())) return 'failed';
    const outcome = new Promise<SubscribeOutcome>((resolve) => {
      pending.current = resolve;
    });
    try {
      await requestPurchase({
        type: 'subs',
        request: {
          google: {
            skus: [SUBSCRIPTION_ID],
            subscriptionOffers: [{ sku: SUBSCRIPTION_ID, offerToken }],
          },
        },
      });
    } catch (error) {
      noteFailure('requestPurchase', error);
      pending.current = null;
      return isUserCancelledError(error) ? 'declined' : 'failed';
    }
    return outcome;
  }, [plans, connect]);

  const manage = useCallback(async () => {
    try {
      await deepLinkToSubscriptions({ skuAndroid: SUBSCRIPTION_ID, packageNameAndroid: PACKAGE_NAME });
    } catch (error) {
      noteFailure('manage', error);
    }
  }, []);

  const value = useMemo<SubscriptionState>(
    () =>
      enabled
        ? {
            available: true,
            checking,
            active: !!membership,
            ...(membership ? { membership } : {}),
            plans,
            subscribe,
            restore: refresh,
            reload,
            manage,
          }
        : INACTIVE,
    [enabled, checking, membership, plans, subscribe, refresh, reload, manage],
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

async function acknowledge(purchase: Purchase): Promise<void> {
  if ('isAcknowledgedAndroid' in purchase && purchase.isAcknowledgedAndroid) return;
  try {
    await finishTransaction({ purchase, isConsumable: false });
  } catch (error) {
    noteFailure('finishTransaction', error);
  }
}
