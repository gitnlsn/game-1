import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
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

/**
 * A selectable pill. Extracted from the sort chips, which were missing the
 * accessibility state a screen-reader user needs to tell which one is active.
 */
export function Chip({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled: !!disabled }}
      style={[styles.chip, selected ? styles.chipSelected : null, disabled ? styles.chipDisabled : null]}
    >
      <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Segments of one control, joined inside a single border.
 *
 * Same shape as `ChipRow`, and deliberately not the same thing to look at: a row
 * of chips is a set of filters, where any of them might be on. Segments are one
 * question with one answer. Where both appear together, that difference is what
 * says which choice contains the other.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.segmented, style]}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            style={[
              styles.segment,
              index > 0 ? styles.segmentDivided : null,
              selected ? styles.segmentSelected : null,
            ]}
          >
            <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ChipRow<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.chipRow, style]}>
      {options.map((option) => (
        <Chip
          key={option.value}
          label={option.label}
          selected={option.value === value}
          onPress={() => onChange(option.value)}
        />
      ))}
    </View>
  );
}

/** A labelled 0-100 bar. Always paired with the number, never colour alone. */
export function StatBar({
  label,
  value,
  color,
  width = 78,
}: {
  label: string;
  value: number;
  color: string;
  width?: number;
}) {
  return (
    <View style={{ width }} accessibilityLabel={`${label} ${Math.round(value)}`}>
      <View style={styles.statBarHeader}>
        <Text style={styles.statBarLabel}>{label}</Text>
        <Text style={styles.statBarValue}>{Math.round(value)}</Text>
      </View>
      <View style={styles.statBarTrack}>
        <View
          style={[
            styles.statBarFill,
            { width: `${Math.max(2, Math.min(100, value))}%`, backgroundColor: color },
          ]}
        />
      </View>
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

export const OUTCOME_COLOR = { W: colors.accent, D: colors.muted, L: colors.danger } as const;

/**
 * A win, a draw or a defeat, as a filled disc. The glyph is the page background
 * rather than a text colour, so the disc reads as a token at any size.
 */
export function OutcomeDot({
  outcome,
  size = 22,
}: {
  outcome: 'W' | 'D' | 'L';
  size?: number;
}) {
  return (
    <View
      style={[
        styles.outcomeDot,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: OUTCOME_COLOR[outcome],
        },
      ]}
    >
      <Text style={[styles.outcomeText, { fontSize: Math.round(size * 0.5) }]}>{outcome}</Text>
    </View>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <Text style={styles.emptyNote}>{children}</Text>;
}

export const textStyles = StyleSheet.create({
  title: { color: colors.text, fontSize: 22, fontWeight: '700' },
  subtitle: { color: colors.muted, fontSize: 13 },
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
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  chipDisabled: { opacity: 0.4 },
  chipText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  chipTextSelected: { color: '#EAFBEF' },
  chipRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  segmented: {
    flexDirection: 'row',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  segment: { paddingHorizontal: spacing.md, paddingVertical: 5 },
  segmentDivided: { borderLeftWidth: 1, borderLeftColor: colors.border },
  segmentSelected: { backgroundColor: colors.accentDim },
  statBarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  statBarLabel: {
    color: colors.faint,
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statBarValue: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  statBarTrack: {
    height: 5,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 3,
  },
  statBarFill: { height: 5, borderRadius: 3 },
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
  outcomeDot: { alignItems: 'center', justifyContent: 'center' },
  outcomeText: { color: colors.bg, fontWeight: '800' },
  emptyNote: {
    color: colors.faint,
    fontSize: 13,
    fontStyle: 'italic',
    paddingVertical: spacing.md,
    textAlign: 'center',
  },
});
