import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { formatMoney, isSacked, managedLeague } from '@prancheta/engine';
import { Button, Card, Divider, KeyValue, SectionTitle } from '../components/ui';
import { colors, spacing } from '../theme';
import { useGame } from '../game/GameContext';
import type { RootStackParamList } from '../nav/routes';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function SeasonSummaryScreen() {
  const navigation = useNavigation<Nav>();
  const { career, busy, beginNextSeason } = useGame();

  // Read the season just finished out of the career rather than carrying it as a
  // route param: the world mutates in place, so a captured object goes stale.
  const summary = career?.history[career.history.length - 1];
  if (!career || !summary) return null;

  /*
   * The manager's own division, not the top one. `summary.table` is tier 1, so
   * reading a position out of it puts every second-tier manager nowhere at all.
   */
  const table =
    summary.tables.find((rows) => rows.some((row) => row.clubId === career.managedClubId)) ??
    summary.table;
  const position = table.findIndex((row) => row.clubId === career.managedClubId) + 1;
  const own = table[position - 1];
  const won = position === 1;
  const verdict = summary.verdict;
  const moved = summary.promotions.find((p) => p.clubId === career.managedClubId);
  const sacked = isSacked(career);

  const spend = summary.transfers.reduce((sum, transfer) => sum + transfer.fee, 0);
  const incoming = summary.transfers.filter((t) => t.toClubId === career.managedClubId);
  const outgoing = summary.transfers.filter((t) => t.fromClubId === career.managedClubId);

  return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.heading}>Season {summary.season} review</Text>

          {moved ? (
            <Card
              style={[
                styles.moved,
                { borderColor: moved.to < moved.from ? colors.accent : colors.danger },
              ]}
            >
              <Text
                style={[
                  styles.movedText,
                  { color: moved.to < moved.from ? colors.accent : colors.danger },
                ]}
              >
                {moved.to < moved.from ? 'PROMOTED' : 'RELEGATED'}
              </Text>
              <Text style={styles.movedNote}>
                You will play next season in {managedLeague(career).name}.
              </Text>
            </Card>
          ) : null}

          {verdict ? (
            <Card
              style={[
                styles.verdict,
                { borderColor: verdict.sacked ? colors.danger : colors.border },
              ]}
            >
              <SectionTitle>The board</SectionTitle>
              <Text style={styles.verdictText}>{verdict.message}</Text>
              <Divider />
              <KeyValue
                label="Confidence"
                value={`${Math.round(verdict.confidenceBefore)} → ${Math.round(verdict.confidenceAfter)}`}
                bold
                tint={
                  verdict.confidenceAfter >= verdict.confidenceBefore ? colors.accent : colors.warn
                }
              />
            </Card>
          ) : null}

          <Card style={styles.headline}>
            <Text style={[styles.finish, won ? { color: colors.gold } : null]}>
              {won ? 'CHAMPIONS' : `Finished ${position}${position === 2 ? 'nd' : position === 3 ? 'rd' : 'th'}`}
            </Text>
            <Text style={styles.division}>{managedLeague(career).name}</Text>
            <Text style={styles.record}>
              {own ? `${own.won}W ${own.drawn}D ${own.lost}L · ${own.points} points` : ''}
            </Text>
            {!won ? <Text style={styles.champion}>Champions: {summary.championName}</Text> : null}
          </Card>

          <SectionTitle>Around the league</SectionTitle>
          <Card>
            <KeyValue
              label="Top scorer"
              value={
                summary.topScorer ? `${summary.topScorer.playerName} (${summary.topScorer.goals})` : '—'
              }
            />
            <KeyValue label="Transfers" value={`${summary.transfers.length}`} />
            <KeyValue label="Fees paid" value={formatMoney(spend)} />
            <Divider />
            <KeyValue label="Retirements" value={`${summary.retirements}`} />
            <KeyValue label="Academy graduates" value={`${summary.youthPromoted}`} />
            {summary.development.breakthrough ? (
              <KeyValue
                label="Breakthrough"
                value={`${summary.development.breakthrough.playerName} +${summary.development.breakthrough.gain.toFixed(0)}`}
                tint={colors.accent}
              />
            ) : null}
          </Card>

          <SectionTitle>Your transfer window</SectionTitle>
          <Card>
            {incoming.length === 0 && outgoing.length === 0 ? (
              <Text style={styles.empty}>No business done.</Text>
            ) : (
              <>
                {incoming.map((transfer) => (
                  <View key={`in-${transfer.playerId}`} style={styles.transferRow}>
                    <Text style={[styles.arrow, { color: colors.accent }]}>IN</Text>
                    <Text style={styles.transferName} numberOfLines={1}>
                      {transfer.playerName}
                    </Text>
                    <Text style={styles.transferFee}>
                      {transfer.free ? 'free' : formatMoney(transfer.fee)}
                    </Text>
                  </View>
                ))}
                {outgoing.map((transfer) => (
                  <View key={`out-${transfer.playerId}`} style={styles.transferRow}>
                    <Text style={[styles.arrow, { color: colors.danger }]}>OUT</Text>
                    <Text style={styles.transferName} numberOfLines={1}>
                      {transfer.playerName}
                    </Text>
                    <Text style={styles.transferFee}>{formatMoney(transfer.fee)}</Text>
                  </View>
                ))}
              </>
            )}
          </Card>
        </ScrollView>

        {sacked ? (
          <View style={styles.footer}>
            <Button
              label="See the board's decision"
              variant="danger"
              onPress={() => navigation.replace('sacked')}
            />
          </View>
        ) : (
          <View style={styles.footer}>
            <Button
              label="Transfer window"
              onPress={() => navigation.navigate('transfers')}
              style={styles.secondary}
            />
            <Button
              label={`Start season ${career.world.season + 1}`}
              loading={busy}
              onPress={async () => {
                await beginNextSeason();
                navigation.navigate('tabs');
              }}
            />
          </View>
        )}
      </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingTop: spacing.xl * 2, paddingBottom: spacing.lg },
  heading: { color: colors.muted, fontSize: 13, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  headline: { marginTop: spacing.sm, marginBottom: spacing.lg, alignItems: 'center', paddingVertical: spacing.lg },
  finish: { color: colors.text, fontSize: 26, fontWeight: '800' },
  record: { color: colors.muted, fontSize: 13, marginTop: 4, fontVariant: ['tabular-nums'] },
  champion: { color: colors.faint, fontSize: 12, marginTop: spacing.sm },
  division: { color: colors.faint, fontSize: 12, marginTop: 2 },
  moved: { marginTop: spacing.sm, alignItems: 'center', paddingVertical: spacing.md, borderWidth: 1 },
  movedText: { fontSize: 18, fontWeight: '800', letterSpacing: 1 },
  movedNote: { color: colors.muted, fontSize: 12, marginTop: 4 },
  verdict: { marginBottom: spacing.lg },
  verdictText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  transferRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  arrow: { fontSize: 10, fontWeight: '800', width: 30 },
  transferName: { color: colors.text, fontSize: 13, flex: 1 },
  transferFee: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  empty: { color: colors.faint, fontSize: 13, fontStyle: 'italic' },
  secondary: { marginBottom: spacing.sm },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
});
