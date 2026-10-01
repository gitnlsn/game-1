import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import Lock from 'lucide-react-native/icons/lock';
import { Badge, Button } from './ui';
import { SubscriptionPlans } from './SubscriptionPlans';
import { colors, radius, spacing } from '../theme';
import { usePro } from '../game/pro';

/**
 * The paywall as a screen uses it: `show` it with what was tapped, and
 * optionally what to do once the player has subscribed, and render `element`
 * once anywhere in the screen.
 */
export function usePaywall() {
  const [reason, setReason] = useState<string>();
  const [after, setAfter] = useState<(() => void) | undefined>();

  const show = useCallback((why: string, then?: () => void) => {
    setReason(why);
    setAfter(() => then);
  }, []);

  const element = (
    <SubscriptionPlans
      visible={reason !== undefined}
      reason={reason}
      onClose={() => setReason(undefined)}
      onSubscribed={() => {
        setReason(undefined);
        after?.();
        setAfter(undefined);
      }}
    />
  );

  return { show, element };
}

/**
 * A button for a Pro feature. For a subscriber it is an ordinary button; for
 * anyone else it carries a lock and a Pro badge, so it reads as something to
 * unlock rather than something broken, and tapping it opens the paywall. Where
 * Pro is not on sale it is not drawn at all.
 */
export function ProButton({
  label,
  reason,
  onPress,
  onLocked,
  variant = 'secondary',
  loading,
  disabled,
  style,
}: {
  label: string;
  /** The paywall's opening line when a free player taps it. */
  reason: string;
  onPress: () => void;
  /** Usually `paywall.show`. */
  onLocked: (reason: string, then?: () => void) => void;
  variant?: 'primary' | 'secondary';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const pro = usePro();
  if (!pro.offered) return null;
  if (pro.active) {
    return (
      <Button label={label} variant={variant} onPress={onPress} loading={loading} disabled={disabled} style={style} />
    );
  }
  return (
    <Pressable
      onPress={() => onLocked(reason)}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Pro`}
      style={({ pressed }) => [styles.locked, pressed ? styles.pressed : null, style]}
    >
      <Lock color={colors.gold} size={14} />
      <Text style={styles.label}>{label}</Text>
      <Badge label="Pro" color={colors.gold} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  locked: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 13,
    paddingHorizontal: spacing.lg,
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  pressed: { opacity: 0.8 },
  label: { color: colors.text, fontSize: 15, fontWeight: '700' },
});
