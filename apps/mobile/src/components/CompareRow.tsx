import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme';

/**
 * One line of a side-by-side comparison. With `numbers`, the best is picked out
 * -- higher is better, so a row where less is better passes its values negated.
 */
export function CompareRow({
  label,
  values,
  numbers,
  header,
}: {
  label: string;
  values: string[];
  numbers?: number[];
  header?: boolean;
}) {
  const best = numbers ? Math.max(...numbers) : undefined;
  const clear = numbers ? numbers.filter((n) => n === best).length === 1 : false;
  return (
    <View style={styles.row}>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      {values.map((value, index) => (
        <Text
          key={index}
          numberOfLines={header ? 2 : 1}
          style={[
            styles.value,
            header ? styles.header : null,
            clear && numbers![index] === best ? styles.best : null,
          ]}
        >
          {value}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, gap: spacing.xs },
  label: { width: 92, color: colors.muted, fontSize: 12 },
  value: { flex: 1, color: colors.text, fontSize: 13, textAlign: 'right', fontVariant: ['tabular-nums'] },
  header: { fontWeight: '700', fontSize: 12 },
  best: { color: colors.accent, fontWeight: '700' },
});
