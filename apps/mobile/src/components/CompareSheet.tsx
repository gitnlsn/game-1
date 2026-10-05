import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  formatMoney,
  POSITION_WEIGHTS,
  scoutReport,
  type AttributeKey,
  type Player,
  type SideComparison,
} from '@eleven-deep/engine';
import { Button, Card, Divider } from './ui';
import { CompareRow } from './CompareRow';
import { ATTRIBUTE_GROUPS, ATTRIBUTE_LABELS } from '../attributes';
import { colors, spacing } from '../theme';
import { useGame } from '../game/GameContext';

export interface CompareTarget {
  player: Player;
  comparison: SideComparison;
  /** What signing him would cost a week. */
  wage: number;
}

/**
 * A player you might sign beside the starter he would have to displace. Leads
 * with what decides the slot -- the attributes his position is rated on, most
 * important first -- and keeps the rest a tap away, so the answer is the first
 * thing you read rather than the sixteenth.
 */
export function CompareSheet({ target, onClose }: { target: CompareTarget | undefined; onClose: () => void }) {
  const { career } = useGame();
  const [showAll, setShowAll] = useState(false);
  if (!target || !career) return null;

  const { player, comparison, wage } = target;
  const rival = comparison.rival;
  const position = player.position;
  const close = () => {
    setShowAll(false);
    onClose();
  };

  const couldBecome = (p: Player) => {
    if (p.age >= 30) return 'Past peak';
    const band = scoutReport(career, p);
    return `${band.low}–${band.high}`;
  };
  const weights = POSITION_WEIGHTS[position];
  const decisive = (Object.keys(weights) as AttributeKey[]).sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0));
  const attributeRow = (key: AttributeKey) => (
    <CompareRow
      key={key}
      label={ATTRIBUTE_LABELS[key]}
      values={[`${player.attributes[key]}`, rival ? `${rival.attributes[key]}` : '—']}
      numbers={[player.attributes[key], rival ? rival.attributes[key] : -Infinity]}
    />
  );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop} accessibilityViewIsModal>
        <Card style={styles.card}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.title} accessibilityRole="header">
              {rival ? `${player.displayName} or ${rival.displayName}?` : player.displayName}
            </Text>
            <Text style={styles.subtitle}>
              {comparison.verdict === 'no_slot'
                ? `Your formation has no ${position}. Against the best ${position} you have.`
                : `Against the starter at ${position} whose shirt he would take.`}
            </Text>
            <Divider />
            <CompareRow label="" values={[player.displayName, rival?.displayName ?? 'Nobody']} header />
            <CompareRow
              label={`Rating at ${position}`}
              values={[comparison.rating.toFixed(0), rival ? comparison.rivalRating.toFixed(0) : '—']}
              numbers={[comparison.rating, rival ? comparison.rivalRating : -Infinity]}
            />
            <CompareRow
              label="Age"
              values={[`${player.age}`, rival ? `${rival.age}` : '—']}
              numbers={[-player.age, rival ? -rival.age : -Infinity]}
            />
            <CompareRow label="Could become" values={[couldBecome(player), rival ? couldBecome(rival) : '—']} />
            <CompareRow
              label="Wages"
              values={[`${formatMoney(wage)}/wk`, rival ? `${formatMoney(rival.contract.wage)}/wk` : '—']}
              numbers={[-wage, rival ? -rival.contract.wage : -Infinity]}
            />

            <Text style={styles.group}>What a {position} is rated on</Text>
            {decisive.map(attributeRow)}

            {showAll ? (
              ATTRIBUTE_GROUPS.filter((group) => position === 'GK' || group.title !== 'Goalkeeping').map((group) => (
                <View key={group.title}>
                  <Text style={styles.group}>{group.title}</Text>
                  {group.keys.filter((key) => !(key in weights)).map(attributeRow)}
                </View>
              ))
            ) : (
              <Pressable onPress={() => setShowAll(true)} hitSlop={8} accessibilityRole="button" style={styles.more}>
                <Text style={styles.moreText}>Show all attributes ›</Text>
              </Pressable>
            )}
            <Text style={styles.note}>The better of each row is in green. Potential is your scouts’ range.</Text>
          </ScrollView>
          <Button label="Close" variant="secondary" onPress={close} style={styles.close} />
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
  card: { width: '100%', maxWidth: 400, maxHeight: '88%' },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  subtitle: { color: colors.muted, fontSize: 12, marginTop: 2, lineHeight: 17 },
  group: {
    color: colors.faint,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.md,
    marginBottom: 2,
  },
  more: { marginTop: spacing.md, alignSelf: 'flex-start' },
  moreText: { color: colors.info, fontSize: 13, fontWeight: '700' },
  note: { color: colors.faint, fontSize: 11, marginTop: spacing.md, lineHeight: 16 },
  close: { marginTop: spacing.md },
});
