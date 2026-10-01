import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CAREER_DEFAULTS,
  COUNTRIES,
  allClubs,
  clubStrength,
  createWorld,
  formatMoney,
  marketValue,
  type Club,
} from '@eleven-deep/engine';
import { Badge, Card, ChipRow, SectionTitle, Segmented, textStyles } from '../components/ui';
import { usePaywall } from '../components/ProGate';
import { usePro } from '../game/pro';
import { colors, ratingColor, spacing } from '../theme';
import { useGame } from '../game/GameContext';
import { useRoute, type RouteProp } from '@react-navigation/native';
import type { MenuStackParamList } from '../nav/routes';

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
  const slot = useRoute<RouteProp<MenuStackParamList, 'newCareer'>>().params?.slot;
  const [seed, setSeed] = useState(randomSeed);
  const [nationality, setNationality] = useState<string>('BRA');
  const [mode, setMode] = useState<'career' | 'sandbox'>('career');
  const pro = usePro();
  const paywall = usePaywall();

  /*
   * Built with the same seed AND the same shape the career will use. The seed
   * alone is not enough: generating one division draws a different set of clubs
   * from the generator than generating two, so a preview that skipped the
   * divisions gave you a different club from the one you picked.
   */
  const world = useMemo(
    () => createWorld({ seed, divisions: CAREER_DEFAULTS.divisions, nationality }),
    [seed, nationality],
  );
  const clubs = useMemo(
    () =>
      world.leagues.flatMap((league) =>
        [...league.clubs]
          .sort((a, b) => b.reputation - a.reputation)
          .map((club) => ({ club, league })),
      ),
    [world],
  );

  // Pushed from the title screen, so the navigator supplies the header and the
  // top inset with it. The bottom is still ours: the app draws edge to edge.
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: spacing.xl * 2 + insets.bottom },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={textStyles.title}>Take charge</Text>
      <Text style={[textStyles.subtitle, styles.intro]}>
        {world.leagues.map((l) => l.name).join(' and ')} — {clubs.length} clubs, all fictional. Pick a job: a big club expects
        trophies, a small one expects you to survive.
      </Text>

      {pro.offered ? (
        <>
          <SectionTitle>Country</SectionTitle>
          <ChipRow
            options={COUNTRY_OPTIONS}
            value={nationality}
            onChange={(code) => {
              if (code === 'BRA' || pro.active) setNationality(code);
              else paywall.show('Manage in eight more countries, each with its own clubs, towns and players.', () => setNationality(code));
            }}
          />
          <View style={styles.gap} />
          <SectionTitle>Mode</SectionTitle>
          <Segmented
            fill
            options={MODES}
            value={mode}
            onChange={(next) => {
              if (next === 'career' || pro.active) setMode(next);
              else paywall.show('A sandbox career: add money whenever you like, and the board never sacks you.', () => setMode(next));
            }}
          />
          <Text style={styles.modeNote}>
            {mode === 'sandbox'
              ? 'Add money whenever you like, and the board never sacks you. Sandbox careers do not count towards the leaderboards.'
              : pro.active
                ? 'The board judges you, and every match counts towards the leaderboards.'
                : 'Other countries and sandbox careers are part of Pro.'}
          </Text>
        </>
      ) : null}

      <SectionTitle
        right={
          <Pressable onPress={() => setSeed(randomSeed())} accessibilityRole="button">
            <Text style={styles.reroll}>New world ({seed})</Text>
          </Pressable>
        }
      >
        Choose a club
      </SectionTitle>

      {clubs.map(({ club, league }) => (
        <ClubOption
          key={club.id}
          club={club}
          {...(world.leagues.length > 1 ? { division: league.name } : {})}
          onPick={() => newCareer(seed, club.id, slot, { nationality, sandbox: mode === 'sandbox' })}
        />
      ))}
      {paywall.element}
    </ScrollView>
  );
}

const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({ value: c.code as string, label: c.label }));
const MODES = [
  { value: 'career' as const, label: 'Career' },
  { value: 'sandbox' as const, label: 'Sandbox' },
];

function ClubOption({
  club,
  division,
  onPick,
}: {
  club: Club;
  division?: string;
  onPick: () => void;
}) {
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
              <Text style={styles.clubCity}>
                {club.city}
                {division ? ` · ${division}` : ''}
              </Text>
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
  gap: { height: spacing.sm },
  modeNote: { color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: spacing.md, lineHeight: 17 },
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
