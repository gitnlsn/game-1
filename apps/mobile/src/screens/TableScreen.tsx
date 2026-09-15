import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { divisionTables, finaliseSeason, managedLeague } from '@eleven-deep/engine';
import { Card, ChipRow, SectionTitle } from '../components/ui';
import { colors, spacing } from '../theme';
import { useGame } from '../game/GameContext';
import type { RootStackParamList } from '../nav/routes';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function TableScreen() {
  const navigation = useNavigation<Nav>();
  const { career, version } = useGame();

  const divisions = useMemo(() => (career ? divisionTables(career) : []), [career, version]);
  const [tier, setTier] = useState<string | undefined>();

  // finaliseSeason rebuilds the scorer map from every result in the season, so
  // it must not run on every render.
  const shown =
    divisions.find((d) => d.league.id === tier) ??
    divisions.find((d) => career && d.league.id === managedLeague(career).id) ??
    divisions[0];
  const table = shown?.table ?? [];
  const scorers = useMemo(
    () => (career ? finaliseSeason(career.season).scorers.slice(0, 10) : []),
    [career, version],
  );

  if (!career) return null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {divisions.length > 1 ? (
        <ChipRow
          style={styles.divisions}
          options={divisions.map((d) => ({ value: d.league.id, label: `Tier ${d.league.tier}` }))}
          value={shown?.league.id ?? ''}
          onChange={setTier}
        />
      ) : null}
      <SectionTitle>{shown?.league.name ?? ''}</SectionTitle>
      <Card style={styles.tableCard}>
        <View style={[styles.row, styles.headerRow]}>
          <Text style={[styles.pos, styles.headerText]}>#</Text>
          <Text style={[styles.club, styles.headerText]}>Club</Text>
          <Text style={[styles.num, styles.headerText]}>P</Text>
          <Text style={[styles.num, styles.headerText]}>W</Text>
          <Text style={[styles.num, styles.headerText]}>D</Text>
          <Text style={[styles.num, styles.headerText]}>L</Text>
          <Text style={[styles.numWide, styles.headerText]}>GD</Text>
          <Text style={[styles.numWide, styles.headerText]}>Pts</Text>
        </View>

        {table.map((row, index) => {
          const own = row.clubId === career.managedClubId;
          const tierNumber = shown?.league.tier ?? 1;
          const lastTier = tierNumber >= divisions.length;
          /*
           * Which end of the table matters depends on where you are. There is
           * nothing below the bottom division to go down to, and nothing above
           * the top one to go up to, so neither gets a zone it cannot enter.
           */
          const promotion = tierNumber > 1 && index < 3;
          const relegation = !lastTier && index >= table.length - 3;
          const zone = index === 0
            ? colors.gold
            : promotion
              ? colors.accent
              : relegation
                ? colors.danger
                : 'transparent';

          return (
            <View
              key={row.clubId}
              accessibilityLabel={`${index + 1}. ${row.clubName}, played ${row.played}, ${row.points} points${
                index === 0 ? ', league leaders' : promotion ? ', promotion place' : relegation ? ', relegation zone' : ''
              }`}
              style={[styles.row, own ? styles.ownRow : null, { borderLeftColor: zone }]}
            >
              <Text style={[styles.pos, styles.cell]}>{index + 1}</Text>
              <Text
                style={[styles.club, styles.cell, own ? styles.ownText : null]}
                numberOfLines={1}
              >
                {row.clubName}
              </Text>
              <Text style={[styles.num, styles.cell]}>{row.played}</Text>
              <Text style={[styles.num, styles.cell]}>{row.won}</Text>
              <Text style={[styles.num, styles.cell]}>{row.drawn}</Text>
              <Text style={[styles.num, styles.cell]}>{row.lost}</Text>
              <Text style={[styles.numWide, styles.cell]}>
                {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
              </Text>
              <Text style={[styles.numWide, styles.cell, styles.points]}>{row.points}</Text>
            </View>
          );
        })}
      </Card>

      <SectionTitle>Top scorers</SectionTitle>
      <Card>
        {scorers.length === 0 ? (
          <Text style={styles.empty}>No goals scored yet this season.</Text>
        ) : (
          scorers.map((scorer, index) => (
            <Pressable
              key={scorer.playerId}
              onPress={() => navigation.navigate('player', { playerId: scorer.playerId })}
              accessibilityRole="button"
              accessibilityLabel={`${scorer.playerName}, ${scorer.clubName}, ${scorer.goals} goals`}
              style={styles.scorerRow}
            >
              <Text style={styles.scorerRank}>{index + 1}</Text>
              <Text style={styles.scorerName} numberOfLines={1}>
                {scorer.playerName}
              </Text>
              <Text style={styles.scorerClub} numberOfLines={1}>
                {scorer.clubName}
              </Text>
              <Text style={styles.scorerGoals}>{scorer.goals}</Text>
            </Pressable>
          ))
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  divisions: { marginBottom: spacing.sm },
  tableCard: { padding: 0, overflow: 'hidden', marginBottom: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  headerRow: { backgroundColor: colors.surfaceAlt, paddingVertical: 6 },
  ownRow: { backgroundColor: 'rgba(63,185,80,0.10)' },
  ownText: { color: colors.accent, fontWeight: '800' },
  headerText: {
    color: colors.faint,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  cell: { color: colors.text, fontSize: 12, fontVariant: ['tabular-nums'] },
  pos: { width: 22 },
  club: { flex: 1, marginRight: spacing.xs },
  num: { width: 20, textAlign: 'right' },
  numWide: { width: 32, textAlign: 'right' },
  points: { fontWeight: '800' },
  scorerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
  scorerRank: { color: colors.faint, fontSize: 11, width: 18, fontVariant: ['tabular-nums'] },
  scorerName: { color: colors.text, fontSize: 13, fontWeight: '600', flex: 1 },
  scorerClub: { color: colors.faint, fontSize: 11, flex: 1, textAlign: 'right', marginRight: spacing.sm },
  scorerGoals: {
    color: colors.gold,
    fontSize: 14,
    fontWeight: '800',
    width: 24,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  empty: { color: colors.faint, fontSize: 13, fontStyle: 'italic' },
});
