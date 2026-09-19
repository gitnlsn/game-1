import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  currentAbility,
  formatMoney,
  isAvailable,
  managedClub,
  marketValue,
  scoutReport,
  type Career,
  type Player,
  type PotentialEstimate,
} from '@eleven-deep/engine';
import { Badge, Card, ScreenHeader } from '../components/ui';
import { colors, conditionColor, positionColor, radius, ratingColor, spacing } from '../theme';
import { useGame } from '../game/GameContext';
import type { RootStackParamList } from '../nav/routes';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type SortKey = 'ability' | 'age' | 'value' | 'minutes';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'ability', label: 'Ability' },
  { key: 'age', label: 'Age' },
  { key: 'value', label: 'Value' },
  { key: 'minutes', label: 'Minutes' },
];

export function SquadScreen() {
  const navigation = useNavigation<Nav>();
  const { career, version } = useGame();
  const [sort, setSort] = useState<SortKey>('ability');

  const club = career ? managedClub(career) : undefined;

  const players = useMemo(() => {
    if (!club) return [];
    const list = [...club.squad];
    list.sort((a, b) => {
      switch (sort) {
        case 'age':
          return a.age - b.age || currentAbility(b) - currentAbility(a);
        case 'value':
          return marketValue(b) - marketValue(a);
        case 'minutes':
          return b.status.minutes - a.status.minutes;
        default:
          return currentAbility(b) - currentAbility(a);
      }
    });
    return list;
    // version changes whenever the engine mutates the world in place.
  }, [club, sort, version]);

  if (!club) return null;

  // Cheap enough on a squad of ~25 to sit in the render, which is how the club
  // screen counts its injuries too.
  const unavailable = club.squad.filter((p) => !isAvailable(p)).length;
  const averageAge = club.squad.length
    ? club.squad.reduce((sum, p) => sum + p.age, 0) / club.squad.length
    : 0;

  return (
    <View style={styles.container}>
      <View style={styles.headerArea}>
        {/*
          * Pinned above the list rather than scrolling with it, so every row of
          * it is list height paid for on every scroll position. Hence one line
          * of subtitle, not two.
          */}
        <ScreenHeader
          title="Squad"
          subtitle="Every player at the club — tap one for the full report."
          metrics={[
            { label: 'Players', value: `${club.squad.length}` },
            { label: 'Avg age', value: averageAge.toFixed(1) },
            {
              label: 'Unavailable',
              value: unavailable === 0 ? 'None' : `${unavailable}`,
              // Same thresholds the club screen reads injuries on.
              tint:
                unavailable > 3 ? colors.danger : unavailable > 0 ? colors.warn : colors.accent,
            },
          ]}
        />
        <View style={styles.sortRow}>
          {SORTS.map((option) => (
            <Pressable
              key={option.key}
              onPress={() => setSort(option.key)}
              accessibilityRole="button"
              accessibilityLabel={`Sort by ${option.label}`}
              accessibilityState={{ selected: sort === option.key }}
              style={[styles.sortChip, sort === option.key ? styles.sortChipActive : null]}
            >
              <Text
                style={[styles.sortChipText, sort === option.key ? styles.sortChipTextActive : null]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <FlatList
        data={players}
        keyExtractor={(player) => player.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <PlayerRow
            player={item}
            report={scoutReport(career!, item)}
            onPress={() => navigation.navigate('player', { playerId: item.id })}
          />
        )}
      />
    </View>
  );
}

function PlayerRow({
  player,
  report,
  onPress,
}: {
  player: Player;
  report: PotentialEstimate;
  onPress: () => void;
}) {
  const ability = currentAbility(player);
  const { status } = player;

  const unavailable =
    status.injuryMatches > 0
      ? { label: `INJ ${status.injuryMatches}`, color: colors.danger }
      : status.suspensionMatches > 0
        ? { label: `BAN ${status.suspensionMatches}`, color: colors.warn }
        : undefined;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${player.displayName}, ${player.position}, ability ${currentAbility(player).toFixed(0)}`}
    >
      <Card style={styles.playerCard}>
      <View style={styles.playerTop}>
        <View style={[styles.positionChip, { borderColor: positionColor(player.position) }]}>
          <Text style={[styles.positionText, { color: positionColor(player.position) }]}>
            {player.position}
          </Text>
        </View>

        <View style={styles.playerIdentity}>
          <Text style={styles.playerName} numberOfLines={1}>
            {player.displayName}
          </Text>
          <Text style={styles.playerMeta}>
            {player.age} · {player.nationality} · {formatMoney(marketValue(player))} ·{' '}
            {formatMoney(player.contract.wage)}/wk
          </Text>
        </View>

        <View style={styles.abilityBox}>
          <Text style={[styles.abilityValue, { color: ratingColor(ability) }]}>
            {ability.toFixed(0)}
          </Text>
          {/*
            A range, never a number. How good a player might become is something
            you form a view on, not something you read off him.
          */}
          <Text
            style={[styles.potentialValue, { opacity: 0.45 + report.confidence * 0.55 }]}
            numberOfLines={1}
          >
            {report.low === report.high ? `${report.high}` : `${report.low}–${report.high}`}
          </Text>
        </View>
      </View>

      <View style={styles.playerBottom}>
        <View style={styles.conditionWrap}>
          <Text style={styles.smallLabel}>Fitness</Text>
          <View style={styles.conditionTrack}>
            <View
              style={[
                styles.conditionFill,
                {
                  width: `${Math.max(2, Math.min(100, status.condition))}%`,
                  backgroundColor: conditionColor(status.condition),
                },
              ]}
            />
          </View>
        </View>

        <View style={styles.playerStats}>
          <MiniStat label="Apps" value={`${status.appearances}`} />
          <MiniStat label="Gls" value={`${status.goals}`} />
          <MiniStat label="Ast" value={`${status.assists}`} />
          <MiniStat
            label="Cards"
            value={`${status.yellowCards}${status.redCards > 0 ? `/${status.redCards}` : ''}`}
          />
        </View>

        {unavailable ? <Badge label={unavailable.label} color={unavailable.color} /> : null}
      </View>
      </Card>
    </Pressable>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.smallLabel}>{label}</Text>
      <Text style={styles.miniStatValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  headerArea: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  sortRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm },
  sortChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sortChipActive: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  sortChipText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  sortChipTextActive: { color: '#EAFBEF' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl * 2 },
  playerCard: { marginBottom: spacing.sm, padding: spacing.sm },
  playerTop: { flexDirection: 'row', alignItems: 'center' },
  positionChip: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
    minWidth: 34,
    alignItems: 'center',
  },
  positionText: { fontSize: 11, fontWeight: '800' },
  playerIdentity: { flex: 1, marginHorizontal: spacing.sm, minWidth: 0 },
  playerName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  playerMeta: { color: colors.faint, fontSize: 11, marginTop: 1 },
  abilityBox: { alignItems: 'flex-end', minWidth: 44 },
  abilityValue: { fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  potentialValue: { color: colors.faint, fontSize: 10, fontVariant: ['tabular-nums'] },
  playerBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  conditionWrap: { width: 78 },
  conditionTrack: {
    height: 5,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 3,
  },
  conditionFill: { height: 5, borderRadius: 3 },
  playerStats: { flexDirection: 'row', flex: 1, gap: spacing.md },
  miniStat: { minWidth: 26 },
  miniStatValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  smallLabel: {
    color: colors.faint,
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
