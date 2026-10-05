import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  currentAbility,
  expectedWage,
  formatMoney,
  type DepartureImpact,
  type PlannedMove,
  type Player,
  type SquadRole,
} from '@eleven-deep/engine';
import { Badge, Button, Card, KeyValue } from './ui';
import { colors, positionColor, ratingColor, spacing } from '../theme';
import { departureLine } from '../game/compareText';
import { plannedLabel } from '../game/moveText';

export type ContractAdvice = 'renew' | 'decide' | 'release';

/**
 * How the advice shows: a tag by the name and the card's left edge. The card
 * and its buttons stay identical whatever the advice, so a list of them reads
 * evenly and the colour alone says which matter.
 */
const ADVICE_LOOK: Record<ContractAdvice, { label: string; color: string }> = {
  renew: { label: 'Renew', color: colors.accent },
  decide: { label: 'Your call', color: colors.muted },
  release: { label: 'Let go', color: colors.warn },
};

const ROLE_LABEL: Record<SquadRole, string> = {
  key: 'First choice',
  rotation: 'Rotation',
  prospect: 'Prospect',
  backup: 'Backup',
  surplus: 'Surplus',
};

/**
 * What to do about a contract that is running down, from where he stands and
 * how old he is. Advice, not a rule: every row still offers both.
 */
export function contractAdvice(role: SquadRole, age: number): ContractAdvice {
  if ((role === 'key' && age <= 31) || role === 'prospect') return 'renew';
  if (role === 'surplus' || (role === 'backup' && age >= 29)) return 'release';
  return 'decide';
}

/**
 * One expiring contract with what the decision turns on: what keeping him
 * costs and what losing him costs the side. The recommendation is a tag, not
 * a different button, so both choices always sit in the same place.
 */
export function ContractRow({
  player,
  role,
  advice,
  impact,
  move,
  onOpen,
  onRenew,
  onRelease,
  onUndo,
}: {
  player: Player;
  role: SquadRole;
  advice: ContractAdvice;
  impact: DepartureImpact;
  move: PlannedMove | undefined;
  onOpen: () => void;
  onRenew: () => void;
  onRelease: () => void;
  onUndo: (move: PlannedMove) => void;
}) {
  const ability = currentAbility(player);
  const asks = Math.max(expectedWage(player), player.contract.wage);
  const rise = asks - player.contract.wage;
  const side = departureLine(impact);
  const { appearances } = player.status;
  const look = ADVICE_LOOK[advice];

  return (
    <Card style={[styles.card, { borderLeftColor: look.color }]}>
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={player.displayName}>
        <View style={styles.rowTop}>
          <Text style={[styles.pos, { color: positionColor(player.position) }]}>{player.position}</Text>
          <Text style={styles.name} numberOfLines={1}>
            {player.displayName}
          </Text>
          <Badge label={look.label} color={look.color} />
          <Text style={[styles.rating, { color: ratingColor(ability) }]}>{ability.toFixed(0)}</Text>
        </View>
        <Text style={styles.meta}>
          {ROLE_LABEL[role]} · {player.age} · {appearances} app{appearances === 1 ? '' : 's'} ·{' '}
          {player.contract.yearsRemaining === 0 ? 'expiring' : '1 year left'}
        </Text>
      </Pressable>

      <Text style={[styles.side, { color: side.tint }]}>{side.text}</Text>
      <KeyValue
        label="To keep him"
        value={
          rise > 0
            ? `${formatMoney(asks)}/wk (+${formatMoney(rise)})`
            : `${formatMoney(asks)}/wk, no rise`
        }
        tint={rise > 0 ? colors.warn : colors.muted}
      />
      <KeyValue label="Released, you save" value={`${formatMoney(player.contract.wage)}/wk`} />

      {move ? (
        <View style={styles.planned}>
          <Badge label={plannedLabel(move)} color={colors.info} />
          <Pressable onPress={() => onUndo(move)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove from plan">
            <Text style={styles.link}>Undo</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.actions}>
          <Button label="Release" variant="secondary" style={styles.action} onPress={onRelease} />
          <Button label="Renew…" variant="secondary" style={styles.action} onPress={onRenew} />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.sm, borderLeftWidth: 3 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pos: { fontSize: 11, fontWeight: '800', width: 28 },
  name: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  rating: { fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  meta: { color: colors.faint, fontSize: 12, marginTop: 2 },
  side: { fontSize: 13, fontWeight: '600', marginTop: spacing.sm, marginBottom: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  action: { flex: 1 },
  link: { color: colors.info, fontSize: 13, fontWeight: '700' },
  planned: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
});
