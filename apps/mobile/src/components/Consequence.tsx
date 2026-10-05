import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme';

/**
 * What an action would do, said before it is taken, and why it would be refused
 * if it would be. Shown beside buttons that stay enabled and identical: a move
 * that cannot go through yet can still be planned, and the manager frees the
 * room afterwards.
 */
export function Consequence({ text, problem }: { text?: string; problem?: string }) {
  if (!text && !problem) return null;
  return (
    <View style={styles.wrap}>
      {text ? <Text style={styles.text}>{text}</Text> : null}
      {problem ? <Text style={styles.problem}>⚠ {problem}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.sm, gap: 2 },
  text: { color: colors.muted, fontSize: 12, lineHeight: 17, fontVariant: ['tabular-nums'] },
  problem: { color: colors.warn, fontSize: 12, lineHeight: 17, fontWeight: '600' },
});
