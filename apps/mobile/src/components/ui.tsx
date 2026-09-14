import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { colors, radius, spacing } from '../theme';

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {right}
    </View>
  );
}

export function StatTile({
  label,
  value,
  tint,
}: {
  label: string;
  value: string;
  tint?: string;
}) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.statValue, tint ? { color: tint } : null]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export function Badge({
  label,
  color = colors.muted,
  style,
}: {
  label: string;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.badge, { borderColor: color }, style]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = {
    primary: { bg: colors.accentDim, border: colors.accent, text: '#EAFBEF' },
    secondary: { bg: colors.surfaceAlt, border: colors.border, text: colors.text },
    danger: { bg: '#4A1D1D', border: colors.danger, text: '#FFE2E0' },
  }[variant];

  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg, borderColor: palette.border },
        pressed && !isDisabled ? styles.buttonPressed : null,
        isDisabled ? styles.buttonDisabled : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.text} size="small" />
      ) : (
        <Text style={[styles.buttonText, { color: palette.text }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function KeyValue({
  label,
  value,
  tint,
  bold,
}: {
  label: string;
  value: string;
  tint?: string;
  bold?: boolean;
}) {
  return (
    <View style={styles.keyValue}>
      <Text style={styles.keyValueLabel}>{label}</Text>
      <Text
        style={[
          styles.keyValueValue,
          tint ? { color: tint } : null,
          bold ? { fontWeight: '700' } : null,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <Text style={styles.emptyNote}>{children}</Text>;
}

export const textStyles = StyleSheet.create({
  title: { color: colors.text, fontSize: 22, fontWeight: '700' },
  subtitle: { color: colors.muted, fontSize: 13 },
  body: { color: colors.text, fontSize: 14 },
  mono: {
    color: colors.text,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  } as TextStyle,
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  statTile: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    minWidth: 0,
  },
  statLabel: {
    color: colors.faint,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  statValue: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  badge: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  button: {
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: 13,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  buttonPressed: { opacity: 0.75 },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { fontSize: 15, fontWeight: '700' },
  keyValue: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  keyValueLabel: { color: colors.muted, fontSize: 13 },
  keyValueValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  emptyNote: {
    color: colors.faint,
    fontSize: 13,
    fontStyle: 'italic',
    paddingVertical: spacing.md,
    textAlign: 'center',
  },
});
