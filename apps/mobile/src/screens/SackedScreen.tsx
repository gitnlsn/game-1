import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { managedClub } from '@eleven-deep/engine';
import { Button, Card, Divider, KeyValue, SectionTitle } from '../components/ui';
import { colors, spacing } from '../theme';
import { useGame } from '../game/GameContext';
import type { RootStackParamList } from '../nav/routes';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * The end of a career.
 *
 * It shows the whole record rather than only the dismissal: several seasons of
 * work went into this, and closing it with nothing but a verdict would throw all
 * of it away at the moment it is most worth reading.
 */
export function SackedScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { career, abandonCareer } = useGame();

  const record = useMemo(() => {
    if (!career) return undefined;
    const seasons = career.history.length;
    const finishes = career.history.map((summary) => {
      const table =
        summary.tables.find((rows) => rows.some((r) => r.clubId === career.managedClubId)) ??
        summary.table;
      return table.findIndex((row) => row.clubId === career.managedClubId) + 1;
    });
    const best = finishes.filter((f) => f > 0);
    return {
      seasons,
      titles: finishes.filter((f) => f === 1).length,
      best: best.length > 0 ? Math.min(...best) : 0,
      promotions: career.history.flatMap((s) => s.promotions)
        .filter((p) => p.clubId === career.managedClubId && p.to < p.from).length,
      relegations: career.history.flatMap((s) => s.promotions)
        .filter((p) => p.clubId === career.managedClubId && p.to > p.from).length,
    };
  }, [career]);

  if (!career || !record) return null;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Card style={styles.headline}>
          <Text style={styles.heading}>DISMISSED</Text>
          <Text style={styles.club}>{managedClub(career).name}</Text>
          <Text style={styles.reason}>
            {career.board.sackReason ?? 'The board has decided to make a change.'}
          </Text>
        </Card>

        <SectionTitle>Your record</SectionTitle>
        <Card>
          <KeyValue label="Seasons in charge" value={`${record.seasons}`} bold />
          <Divider />
          <KeyValue
            label="Best finish"
            value={record.best === 0 ? '—' : ordinal(record.best)}
            tint={record.best === 1 ? colors.gold : colors.text}
          />
          <KeyValue label="Titles" value={`${record.titles}`} />
          <KeyValue label="Promotions" value={`${record.promotions}`} />
          <KeyValue
            label="Relegations"
            value={`${record.relegations}`}
            tint={record.relegations > 0 ? colors.danger : colors.muted}
          />
        </Card>

        <SectionTitle>Season by season</SectionTitle>
        <Card>
          {career.history.map((summary) => {
            const table =
              summary.tables.find((rows) => rows.some((r) => r.clubId === career.managedClubId)) ??
              summary.table;
            const place = table.findIndex((row) => row.clubId === career.managedClubId) + 1;
            return (
              <View key={summary.season} style={styles.historyRow}>
                <Text style={styles.historySeason}>S{summary.season}</Text>
                <Text style={[styles.historyPlace, place === 1 ? { color: colors.gold } : null]}>
                  {place === 0 ? '—' : ordinal(place)}
                </Text>
                <Text style={styles.historyNote} numberOfLines={1}>
                  {summary.verdict?.message ?? ''}
                </Text>
              </View>
            );
          })}
        </Card>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: spacing.lg + insets.bottom }]}>
        <Button
          label="Start a new career"
          onPress={() => {
            abandonCareer();
            navigation.replace('tabs');
          }}
        />
      </View>
    </View>
  );
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingTop: spacing.xl * 2, paddingBottom: spacing.lg },
  headline: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    marginBottom: spacing.lg,
    borderColor: colors.danger,
    borderWidth: 1,
  },
  heading: { color: colors.danger, fontSize: 24, fontWeight: '800', letterSpacing: 2 },
  club: { color: colors.text, fontSize: 15, fontWeight: '700', marginTop: spacing.sm },
  reason: {
    color: colors.muted, fontSize: 13, marginTop: spacing.xs,
    textAlign: 'center', fontStyle: 'italic',
  },
  historyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, gap: spacing.sm },
  historySeason: { color: colors.faint, fontSize: 11, fontWeight: '700', width: 30 },
  historyPlace: {
    color: colors.text, fontSize: 13, fontWeight: '700', width: 40,
    fontVariant: ['tabular-nums'],
  },
  historyNote: { color: colors.faint, fontSize: 11, flex: 1 },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
});
