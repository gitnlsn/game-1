import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  clubStrength,
  createWorld,
  formatMoney,
  marketValue,
  type Club,
} from '@game1/engine';
import { Badge, Card, SectionTitle, textStyles } from '../components/ui';
import { colors, ratingColor, spacing } from '../theme';
import { useGame } from '../game/GameContext';

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 9);
}

/** A club's standing expressed the way a manager would read it. */
function ambitionLabel(reputation: number): { label: string; color: string } {
  if (reputation >= 78) return { label: 'Title favourites', color: colors.gold };
  if (reputation >= 70) return { label: 'Challengers', color: colors.accent };
  if (reputation >= 62) return { label: 'Mid-table', color: colors.info };
  if (reputation >= 55) return { label: 'Lower half', color: colors.warn };
  return { label: 'Relegation fight', color: colors.danger };
}

export function NewCareerScreen() {
  const { newCareer } = useGame();
  const [seed, setSeed] = useState(randomSeed);

  // Built from the same seed the career will use, so what you pick is what you get.
  const world = useMemo(() => createWorld({ seed }), [seed]);
  const clubs = useMemo(
    () => [...world.league.clubs].sort((a, b) => b.reputation - a.reputation),
    [world],
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={textStyles.title}>Take charge</Text>
      <Text style={[textStyles.subtitle, styles.intro]}>
        {world.league.name} — {clubs.length} clubs, all fictional. Pick a job: a big club expects
        trophies, a small one expects you to survive.
      </Text>

      <SectionTitle
        right={
          <Pressable onPress={() => setSeed(randomSeed())} accessibilityRole="button">
            <Text style={styles.reroll}>New world ({seed})</Text>
          </Pressable>
        }
      >
        Choose a club
      </SectionTitle>

      {clubs.map((club) => (
        <ClubOption key={club.id} club={club} onPick={() => newCareer(seed, club.id)} />
      ))}
    </ScrollView>
  );
}

function ClubOption({ club, onPick }: { club: Club; onPick: () => void }) {
  const ambition = ambitionLabel(club.reputation);
  const squadValue = club.squad.reduce((sum, player) => sum + marketValue(player), 0);
  const strength = clubStrength(club);

  return (
    <Pressable onPress={onPick} accessibilityRole="button" accessibilityLabel={`Manage ${club.name}`}>
      {({ pressed }) => (
        <Card style={[styles.clubCard, pressed ? styles.clubCardPressed : null]}>
          <View style={styles.clubHeader}>
            <View style={styles.clubIdentity}>
              <Text style={styles.clubName} numberOfLines={1}>
                {club.name}
              </Text>
              <Text style={styles.clubCity}>{club.city}</Text>
            </View>
            <Badge label={ambition.label} color={ambition.color} />
          </View>

          <View style={styles.clubStats}>
            <Stat label="Squad" value={strength.toFixed(0)} tint={ratingColor(strength)} />
            <Stat label="Value" value={formatMoney(squadValue)} />
            <Stat label="Stadium" value={club.finances.stadiumCapacity.toLocaleString()} />
            <Stat label="Balance" value={formatMoney(club.finances.balance)} />
          </View>
        </Card>
      )}
    </Pressable>
  );
}

function Stat({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, tint ? { color: tint } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  intro: { marginTop: spacing.xs, marginBottom: spacing.lg, lineHeight: 19 },
  reroll: { color: colors.info, fontSize: 12, fontWeight: '600' },
  clubCard: { marginBottom: spacing.sm },
  clubCardPressed: { borderColor: colors.accent, backgroundColor: colors.surfaceAlt },
  clubHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  clubIdentity: { flex: 1, marginRight: spacing.sm },
  clubName: { color: colors.text, fontSize: 16, fontWeight: '700' },
  clubCity: { color: colors.faint, fontSize: 12, marginTop: 1 },
  clubStats: {
    flexDirection: 'row',
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  stat: { flex: 1, minWidth: 0 },
  statLabel: {
    color: colors.faint,
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
});
