import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import X from 'lucide-react-native/icons/x';
import { Badge, Button, Card } from './ui';
import { colors, radius, spacing } from '../theme';
import { savingsPercent } from '../game/entitlement';
import { useSubscription, type Plan, type SubscribeOutcome } from '../game/subscription';

/**
 * Choosing a plan, as its own step.
 *
 * Settings only says whether you are subscribed; prices live here, behind a
 * button, so buying is something the player walks into rather than past. Like
 * ConfirmDialog it renders nothing while hidden, which keeps react-native-web
 * (where the app is developed) honest.
 */

const PROBLEMS: Partial<Record<SubscribeOutcome, string>> = {
  pending: 'Your payment is being processed. Pro starts as soon as Google Play confirms it.',
  failed: 'Google Play could not start the purchase. Check your connection and try again.',
};

function period(months: number): string {
  if (months === 1) return 'month';
  if (months === 12) return 'year';
  return `${months} months`;
}

/** "R$ 8,33" a month, in the player's currency, or nothing if it cannot be said. */
function perMonth(plan: Plan): string | undefined {
  if (plan.months <= 1 || plan.priceMicros <= 0 || !plan.currency) return undefined;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: plan.currency }).format(
      plan.priceMicros / 1_000_000 / plan.months,
    );
  } catch {
    return undefined;
  }
}

/** The plan to preselect: the best value, which is what most people want. */
function bestValue(plans: readonly Plan[]): string | undefined {
  let best: Plan | undefined;
  for (const plan of plans) {
    if (!best || savingsPercent(plan, plans) > savingsPercent(best, plans)) best = plan;
  }
  return best?.planId;
}

export function SubscriptionPlans({
  visible,
  onClose,
  onSubscribed,
}: {
  visible: boolean;
  onClose: () => void;
  onSubscribed: () => void;
}) {
  const { plans, checking, subscribe, restore } = useSubscription();
  const [selected, setSelected] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  // Fresh each time it opens: last visit's error is not news any more.
  useEffect(() => {
    if (!visible) return;
    setMessage(undefined);
    setSelected((current) => current ?? bestValue(plans));
  }, [visible, plans]);

  if (!visible) return null;

  const chosen = plans.find((p) => p.planId === selected);

  const buy = async () => {
    if (!chosen) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const outcome = await subscribe(chosen.planId);
      if (outcome === 'subscribed') onSubscribed();
      else setMessage(PROBLEMS[outcome]);
    } finally {
      setBusy(false);
    }
  };

  const restoreNow = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      if (await restore()) onSubscribed();
      else setMessage('No subscription found on this Google account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop} accessibilityViewIsModal>
        <Card style={styles.card}>
          <ScrollView bounces={false}>
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text style={styles.title} accessibilityRole="header">
                  Eleven Deep Pro
                </Text>
                <Text style={styles.subtitle}>Choose how you would like to pay.</Text>
              </View>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={12}
                style={styles.close}
              >
                <X color={colors.muted} size={20} />
              </Pressable>
            </View>

            {plans.length === 0 ? (
              <Text style={styles.note}>
                {checking ? 'Checking Google Play…' : 'Subscriptions are not available right now.'}
              </Text>
            ) : (
              <View style={styles.plans} accessibilityRole="radiogroup">
                {plans.map((plan) => {
                  const isSelected = plan.planId === selected;
                  const saving = savingsPercent(plan, plans);
                  const monthly = perMonth(plan);
                  return (
                    <Pressable
                      key={plan.planId}
                      onPress={() => setSelected(plan.planId)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: isSelected }}
                      accessibilityLabel={`${plan.label}, ${plan.price} per ${period(plan.months)}`}
                      style={[styles.plan, isSelected ? styles.planSelected : null]}
                    >
                      <View style={[styles.radio, isSelected ? styles.radioSelected : null]}>
                        {isSelected ? <View style={styles.radioDot} /> : null}
                      </View>
                      <View style={styles.planText}>
                        <View style={styles.planTitleRow}>
                          <Text style={styles.planLabel}>{plan.label}</Text>
                          {saving > 0 ? <Badge label={`Save ${saving}%`} color={colors.gold} /> : null}
                        </View>
                        {monthly ? <Text style={styles.planDetail}>{monthly} a month</Text> : null}
                      </View>
                      <View style={styles.priceBlock}>
                        <Text style={styles.price}>{plan.price}</Text>
                        <Text style={styles.planDetail}>per {period(plan.months)}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}

            <Button
              label={chosen ? `Subscribe ${chosen.label.toLowerCase()}` : 'Subscribe'}
              onPress={() => void buy()}
              disabled={!chosen}
              loading={busy}
              style={styles.action}
            />
            {message ? <Text style={styles.problem}>{message}</Text> : null}

            <Text style={styles.legal}>
              Renews automatically until cancelled. Cancel any time in Google Play, and Pro lasts to
              the end of the period you have paid for.
            </Text>

            <Pressable
              onPress={() => void restoreNow()}
              disabled={busy}
              accessibilityRole="button"
              style={styles.restore}
            >
              <Text style={styles.restoreText}>Restore purchase</Text>
            </Pressable>
          </ScrollView>
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: { width: '100%', maxWidth: 380, maxHeight: '90%' },
  header: { flexDirection: 'row', alignItems: 'flex-start' },
  headerText: { flex: 1 },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: spacing.xs },
  close: { padding: spacing.xs },
  plans: { gap: spacing.sm, marginTop: spacing.lg },
  plan: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  planSelected: { borderColor: colors.accent, backgroundColor: '#15261B' },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.borderBright,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: colors.accent },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  planText: { flex: 1 },
  planTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  planLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  planDetail: { color: colors.muted, fontSize: 12, marginTop: 2 },
  priceBlock: { alignItems: 'flex-end' },
  price: { color: colors.text, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  action: { marginTop: spacing.lg },
  note: { color: colors.muted, fontSize: 13, marginTop: spacing.lg, lineHeight: 19 },
  problem: { color: colors.warn, fontSize: 12, marginTop: spacing.sm, lineHeight: 17 },
  legal: { color: colors.faint, fontSize: 11, marginTop: spacing.md, lineHeight: 16, textAlign: 'center' },
  restore: { alignSelf: 'center', paddingVertical: spacing.sm, marginTop: spacing.xs },
  restoreText: { color: colors.info, fontSize: 13, fontWeight: '600' },
});
