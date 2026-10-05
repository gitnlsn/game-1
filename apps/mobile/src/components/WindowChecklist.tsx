import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import Info from 'lucide-react-native/icons/info';
import Wallet from 'lucide-react-native/icons/wallet';
import { formatMoney, type TransferWindowState } from '@eleven-deep/engine';
import { Card } from './ui';
import { colors, spacing } from '../theme';

/**
 * What is left to do in this window, in the order it is best done, each line a
 * way into the tab that does it. A first window is a screen of buttons with no
 * starting point; this is the starting point, and the deadline beside it.
 */
export function WindowChecklist({
  window,
  nextRound,
  bidsOpen,
  bidsTotal,
  contractsOpen,
  wageRoom,
  planned,
  onBids,
  onContracts,
  onMarket,
  onReview,
}: {
  window: TransferWindowState;
  nextRound: number;
  /** Players with bids nobody has answered yet. */
  bidsOpen: number;
  bidsTotal: number;
  /** Contracts ending with no decision planned. */
  contractsOpen: number;
  /** What the plan leaves. */
  wageRoom: number;
  planned: number;
  onBids: () => void;
  onContracts: () => void;
  onMarket: () => void;
  onReview: () => void;
}) {
  const [explained, setExplained] = useState(false);
  const left = (window.closesBeforeRound ?? 0) - nextRound;
  const deadline = window.midSeason
    ? left <= 1
      ? 'Mid-season window · last matchday'
      : `Mid-season window · ${left} matchdays left`
    : 'Summer window';

  return (
    <Card style={styles.card}>
      <Text style={[styles.deadline, window.midSeason && left <= 1 ? { color: colors.warn } : null]}>{deadline}</Text>

      <Step
        done={bidsOpen === 0}
        text={
          bidsTotal === 0
            ? 'No bids for your players'
            : bidsOpen === 0
              ? 'Every bid answered'
              : `${bidsOpen} ${bidsOpen === 1 ? 'player has' : 'players have'} bids to answer`
        }
        onPress={onBids}
      />
      <Step
        done={contractsOpen === 0}
        text={
          contractsOpen === 0
            ? 'Every ending contract decided'
            : `${contractsOpen} ${contractsOpen === 1 ? 'contract ends' : 'contracts end'} · last chance to renew`
        }
        onPress={onContracts}
      />

      <Pressable
        onPress={() => setExplained((on) => !on)}
        accessibilityRole="button"
        accessibilityLabel="What wage room means"
        style={styles.step}
      >
        <View style={styles.icon}>
          <Wallet color={wageRoom < 0 ? colors.warn : colors.muted} size={14} />
        </View>
        <Text style={styles.stepText}>
          Wage room after your plan:{' '}
          <Text style={{ color: wageRoom < 0 ? colors.warn : colors.text, fontWeight: '700' }}>
            {wageRoom < 0 ? '−' : ''}
            {formatMoney(Math.abs(wageRoom))}/wk
          </Text>
        </Text>
        <Info color={colors.info} size={16} />
      </Pressable>
      {explained ? (
        <Text style={styles.explain}>
          What you can add to the wage bill. Renewals with a rise and every signing need it; selling,
          loaning and releasing players free it. Sale fees go to the bank, not the transfer budget.
        </Text>
      ) : null}

      <Step
        done={false}
        text={planned > 0 ? `${planned} planned · review and confirm` : 'Then sign players, review and confirm'}
        onPress={planned > 0 ? onReview : onMarket}
      />
    </Card>
  );
}

function Step({ done, text, onPress }: { done: boolean; text: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={text}
      style={({ pressed }) => [styles.step, pressed ? styles.pressed : null]}
    >
      <Text style={[styles.mark, { color: done ? colors.accent : colors.warn }]}>{done ? '✓' : '•'}</Text>
      <Text style={[styles.stepText, done ? styles.doneText : null]}>{text}</Text>
      <ChevronRight color={colors.muted} size={16} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md, paddingVertical: spacing.sm },
  deadline: {
    color: colors.info,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 7 },
  pressed: { opacity: 0.6 },
  mark: { width: 16, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  stepText: { flex: 1, color: colors.text, fontSize: 13 },
  doneText: { color: colors.muted },
  icon: { width: 16, alignItems: 'center' },
  explain: { color: colors.muted, fontSize: 12, lineHeight: 17, marginLeft: 24, marginBottom: spacing.xs },
});
