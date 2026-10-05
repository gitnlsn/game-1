import React, { useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { expectedWage, formatMoney, type Player } from '@eleven-deep/engine';
import { Button, Card, Divider, KeyValue, Segmented } from './ui';
import { colors, spacing } from '../theme';

const YEARS = [
  { value: '1', label: '1 yr' },
  { value: '2', label: '2 yrs' },
  { value: '3', label: '3 yrs' },
  { value: '4', label: '4 yrs' },
  { value: '5', label: '5 yrs' },
] as const;

/** What a contract of this length means for a player of this age. */
function lengthNote(player: Player, years: number): string {
  const endsAt = player.age + years;
  if (player.age >= 30 && years >= 3) {
    return `He would be ${endsAt} when it ends, still on this wage however much he has declined.`;
  }
  if (player.age <= 23 && years <= 2) {
    return 'A short deal for a young player: if he comes good, he will want far more soon.';
  }
  if (years === 1) return 'One more season, then the same question again.';
  return `Ties him down until he is ${endsAt}. Nobody can take him for nothing before then.`;
}

/**
 * Agreeing new terms. A player will not sign for less than he expects and
 * nothing is gained by paying him more, so the wage is his asking; the
 * decision is how long to commit to him.
 */
export function RenewDialog({
  player,
  wageRoom,
  onPlan,
  onCancel,
}: {
  player: Player | undefined;
  /** Weekly room left once the rest of the plan is made, to warn before it is refused. */
  wageRoom?: number;
  onPlan: (wage: number, years: number) => void;
  onCancel: () => void;
}) {
  const [years, setYears] = useState<(typeof YEARS)[number]['value']>('3');
  if (!player) return null;

  const wage = Math.max(expectedWage(player), player.contract.wage);
  const change = wage - player.contract.wage;
  const count = Number(years);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop} accessibilityViewIsModal>
        <Card style={styles.card}>
          <Text style={styles.title} accessibilityRole="header">
            New contract for {player.displayName}
          </Text>
          <Text style={styles.message}>
            {player.age} years old, {player.contract.yearsRemaining === 0 ? 'out of contract' : 'in his last year'}.
          </Text>
          <Divider />
          <KeyValue label="He asks" value={`${formatMoney(wage)}/wk`} bold />
          <KeyValue
            label="Change to the wage bill"
            value={change === 0 ? 'None' : `+${formatMoney(change)}/wk`}
            tint={change > 0 ? colors.warn : colors.muted}
          />
          {wageRoom !== undefined && change > wageRoom ? (
            <Text style={styles.warning}>
              Your plan leaves {formatMoney(Math.max(0, wageRoom))}/wk of wage room. This renewal will be refused
              unless you free up {formatMoney(change - Math.max(0, wageRoom))}/wk first.
            </Text>
          ) : null}
          <Text style={styles.label}>Length</Text>
          <Segmented fill options={YEARS} value={years} onChange={setYears} />
          <Text style={styles.note}>{lengthNote(player, count)}</Text>
          <KeyValue label="Commitment" value={formatMoney(wage * 52 * count)} />
          <View style={styles.actions}>
            <Button label="Cancel" onPress={onCancel} variant="secondary" style={styles.action} />
            <Button label="Add to plan" onPress={() => onPlan(wage, count)} style={styles.action} />
          </View>
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  warning: { color: colors.warn, fontSize: 12, lineHeight: 17, marginTop: spacing.sm },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: { width: '100%', maxWidth: 380 },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  message: { color: colors.muted, fontSize: 13, marginTop: spacing.xs },
  label: {
    color: colors.faint, fontSize: 10, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.5, marginTop: spacing.md, marginBottom: spacing.xs,
  },
  note: { color: colors.faint, fontSize: 12, lineHeight: 17, marginTop: spacing.sm, marginBottom: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  action: { flex: 1 },
});
