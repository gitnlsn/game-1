import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  confirmPlan,
  formatMoney,
  planPreview,
  transferWindow,
  unplanMove,
  type MoveResult,
  type PlannedLine,
  type PositionGroup,
} from '@eleven-deep/engine';
import { Button, Card, Divider, EmptyNote, SectionTitle } from '../components/ui';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { colors, positionColor, spacing } from '../theme';
import { useGame } from '../game/GameContext';
import { MOVE_FAILURE } from '../game/moveText';
import type { RootStackParamList } from '../nav/routes';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const GROUPS: { key: PlannedLine['direction']; title: string }[] = [
  { key: 'out', title: 'Leaving' },
  { key: 'in', title: 'Arriving' },
  { key: 'contract', title: 'Contracts and bids turned down' },
];

const DEPTH: PositionGroup[] = ['GK', 'DEF', 'MID', 'FWD'];

/**
 * The whole window on one screen: every planned move, where they leave the
 * club, and what to worry about -- then one button to make them all.
 */
export function WindowPlanScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { career, version, refresh } = useGame();
  const [confirming, setConfirming] = useState(false);
  const [results, setResults] = useState<MoveResult[] | undefined>();

  const preview = useMemo(
    () => (career && transferWindow(career) ? planPreview(career) : undefined),
    [career, version],
  );

  if (!career || !preview) {
    return (
      <View style={styles.container}>
        <Card style={styles.closed}>
          <EmptyNote>The window is shut.</EmptyNote>
        </Card>
      </View>
    );
  }

  const { before, after, lines, warnings, salesIncome } = preview;
  const staleIds = new Set(warnings.flatMap((w) => (w.moveId ? [w.moveId] : [])));

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xl * 5 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {results ? (
          <Card style={styles.results}>
            <SectionTitle>Done</SectionTitle>
            <Text style={styles.resultsSummary}>
              {results.filter((r) => r.ok).length} of {results.length} moves went through.
              {results.some((r) => !r.ok) ? ' The rest are still in your plan to change or drop.' : ''}
            </Text>
            {results.map((r) => (
              <View key={r.move.id} style={styles.resultRow}>
                <Text style={[styles.resultMark, { color: r.ok ? colors.accent : colors.danger }]}>
                  {r.ok ? '✓' : '✗'}
                </Text>
                <View style={styles.resultBody}>
                  <Text style={styles.resultName}>{r.playerName}</Text>
                  <Text style={styles.resultReason}>
                    {r.ok ? describeDone(r) : MOVE_FAILURE[r.reason ?? 'unknown_player']}
                  </Text>
                </View>
              </View>
            ))}
            <Button
              label="Back to the window"
              variant="secondary"
              style={styles.back}
              onPress={() => navigation.goBack()}
            />
          </Card>
        ) : null}

        <SectionTitle>Where it leaves you</SectionTitle>
        <Card>
          <Compare label="Transfer budget" before={formatMoney(before.transferBudget)} after={formatMoney(after.transferBudget)} bad={after.transferBudget < 0} />
          <Compare label="Wage room" before={`${formatMoney(before.wageRoom)}/wk`} after={`${formatMoney(after.wageRoom)}/wk`} bad={after.wageRoom < 0} />
          <Compare label="Squad size" before={`${before.squadSize}`} after={`${after.squadSize}`} bad={after.squadSize < 20 || after.squadSize > 30} />
          <Divider />
          <View style={styles.depthRow}>
            {DEPTH.map((group) => {
              const change = after.depth[group] - before.depth[group];
              return (
                <View key={group} style={styles.depthCell}>
                  <Text style={[styles.depthLabel, { color: positionColor(group === 'DEF' ? 'CB' : group === 'MID' ? 'CM' : group === 'FWD' ? 'ST' : 'GK') }]}>
                    {group}
                  </Text>
                  <Text style={styles.depthValue}>{after.depth[group]}</Text>
                  <Text style={[styles.depthChange, { color: change > 0 ? colors.accent : change < 0 ? colors.warn : colors.faint }]}>
                    {change > 0 ? `+${change}` : change < 0 ? `${change}` : '·'}
                  </Text>
                </View>
              );
            })}
          </View>
          {salesIncome > 0 ? (
            <Text style={styles.note}>
              Sales bring in {formatMoney(salesIncome)}. That goes to the club's bank balance; the
              board sets the transfer budget.
            </Text>
          ) : null}
        </Card>

        {warnings.filter((w) => w.kind !== 'stale_move').length > 0 ? (
          <Card style={styles.warnings}>
            {warnings
              .filter((w) => w.kind !== 'stale_move')
              .map((w) => (
                <Text key={w.kind} style={styles.warningText}>⚠ {w.message}</Text>
              ))}
          </Card>
        ) : null}

        {lines.length === 0 ? (
          <Card style={styles.emptyCard}>
            <EmptyNote>Nothing planned. Add moves from the window's tabs.</EmptyNote>
          </Card>
        ) : (
          GROUPS.map(({ key, title }) => {
            const group = lines.filter((line) => line.direction === key);
            if (group.length === 0) return null;
            return (
              <View key={key}>
                <SectionTitle>{title}</SectionTitle>
                {group.map((line) => (
                  <Card key={line.move.id} style={styles.line}>
                    <View style={styles.lineTop}>
                      <Text style={styles.lineName} numberOfLines={1}>
                        {line.player?.displayName ?? 'Unknown player'}
                      </Text>
                      <Pressable
                        onPress={() => {
                          unplanMove(career, line.move.id);
                          refresh();
                        }}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Remove from plan"
                      >
                        <Text style={styles.remove}>Remove</Text>
                      </Pressable>
                    </View>
                    <Text style={styles.lineTitle}>{line.title}</Text>
                    {line.fee !== 0 || line.wageChange !== 0 ? (
                      <Text style={styles.lineMoney}>
                        {[
                          line.fee !== 0 ? `${line.fee > 0 ? '+' : '−'}${formatMoney(Math.abs(line.fee))}` : '',
                          line.wageChange !== 0
                            ? `wages ${line.wageChange > 0 ? '+' : '−'}${formatMoney(Math.abs(line.wageChange))}/wk`
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    ) : null}
                    {staleIds.has(line.move.id) ? (
                      <Text style={styles.stale}>
                        {warnings.find((w) => w.moveId === line.move.id)?.message}
                      </Text>
                    ) : null}
                  </Card>
                ))}
              </View>
            );
          })
        )}
      </ScrollView>

      {lines.length > 0 ? (
        <View style={[styles.footer, { paddingBottom: spacing.md + insets.bottom }]}>
          <Button
            label={`Confirm all ${lines.length} move${lines.length === 1 ? '' : 's'}`}
            onPress={() => setConfirming(true)}
          />
        </View>
      ) : null}

      <ConfirmDialog
        visible={confirming}
        title="Make every move?"
        message={
          'Each deal is made in turn — departures first, then signings — and checked again as it ' +
          'is made. Any that no longer work stay in your plan.' +
          (warnings.length > 0 ? ` There ${warnings.length === 1 ? 'is a warning' : `are ${warnings.length} warnings`} above.` : '')
        }
        confirmLabel="Confirm all"
        onConfirm={() => {
          setConfirming(false);
          setResults(confirmPlan(career));
          refresh();
        }}
        onCancel={() => setConfirming(false)}
      />
    </View>
  );
}

function describeDone(result: MoveResult): string {
  switch (result.move.kind) {
    case 'sell':
      return 'Sold.';
    case 'reject':
      return 'Bid turned down.';
    case 'release':
      return 'Released.';
    case 'loanOut':
      return 'Out on loan.';
    case 'renew':
      return `Signed for ${result.move.years} more years.`;
    case 'buy':
      return 'Signed.';
  }
}

function Compare({ label, before, after, bad }: { label: string; before: string; after: string; bad?: boolean }) {
  return (
    <View style={styles.compare}>
      <Text style={styles.compareLabel}>{label}</Text>
      <Text style={styles.compareBefore}>{before}</Text>
      <Text style={styles.arrow}>→</Text>
      <Text style={[styles.compareAfter, bad ? { color: colors.danger } : null]}>{after}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },
  closed: { margin: spacing.lg },
  results: { marginBottom: spacing.md, borderColor: colors.accent },
  resultsSummary: { color: colors.muted, fontSize: 12, marginBottom: spacing.sm },
  resultRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 4 },
  resultMark: { fontSize: 15, fontWeight: '800', width: 16 },
  resultBody: { flex: 1 },
  resultName: { color: colors.text, fontSize: 13, fontWeight: '700' },
  resultReason: { color: colors.faint, fontSize: 12 },
  back: { marginTop: spacing.md },
  compare: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  compareLabel: { color: colors.muted, fontSize: 12, flex: 1 },
  compareBefore: { color: colors.faint, fontSize: 12, fontVariant: ['tabular-nums'] },
  arrow: { color: colors.faint, fontSize: 12, marginHorizontal: spacing.xs },
  compareAfter: { color: colors.text, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  depthRow: { flexDirection: 'row', justifyContent: 'space-between' },
  depthCell: { alignItems: 'center', flex: 1 },
  depthLabel: { fontSize: 10, fontWeight: '800' },
  depthValue: { color: colors.text, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  depthChange: { fontSize: 11, fontWeight: '700' },
  note: { color: colors.faint, fontSize: 11, marginTop: spacing.sm, lineHeight: 16 },
  warnings: { marginTop: spacing.md, marginBottom: spacing.sm, borderColor: colors.warn },
  warningText: { color: colors.warn, fontSize: 12, lineHeight: 18 },
  emptyCard: { marginTop: spacing.md },
  line: { marginBottom: spacing.sm },
  lineTop: { flexDirection: 'row', alignItems: 'center' },
  lineName: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  remove: { color: colors.danger, fontSize: 12, fontWeight: '700' },
  lineTitle: { color: colors.muted, fontSize: 12, marginTop: 2 },
  lineMoney: { color: colors.faint, fontSize: 12, marginTop: 2, fontVariant: ['tabular-nums'] },
  stale: { color: colors.danger, fontSize: 12, marginTop: spacing.xs },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
