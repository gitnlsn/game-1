import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, textStyles } from '../components/ui';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { colors, spacing } from '../theme';
import { ordinal } from '../format';
import { useGame } from '../game/GameContext';
import { careerSummary, type CareerSummary, type NextUp } from '../game/summary';
import type { MenuStackParamList } from '../nav/routes';

type Nav = NativeStackNavigationProp<MenuStackParamList>;

export function TitleScreen() {
  const { career, continueCareer } = useGame();
  const navigation = useNavigation<Nav>();
  const [confirming, setConfirming] = useState(false);
  // No navigator header here: this screen owns its own edge-to-edge insets.
  const insets = useSafeAreaInsets();

  const summary = career ? careerSummary(career) : undefined;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: spacing.xl * 2 + insets.top, paddingBottom: spacing.xl + insets.bottom },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.wordmark}>ELEVEN DEEP</Text>
      <View style={styles.rule} />
      <Text style={[textStyles.subtitle, styles.tagline]}>
        A club, a squad and a season at a time.
      </Text>

      {summary ? <ContinueCard summary={summary} onPress={continueCareer} /> : null}

      <Button
        label={summary ? 'New career' : 'Start a career'}
        variant={summary ? 'secondary' : 'primary'}
        onPress={() => (summary ? setConfirming(true) : navigation.navigate('newCareer'))}
        style={styles.action}
      />
      <Button
        label="Settings"
        variant="secondary"
        onPress={() => navigation.navigate('menuSettings')}
        style={styles.action}
      />

      {/*
        * Nothing is deleted here. Starting a career is what overwrites the one
        * save, so backing out of the club picker costs you nothing -- and the
        * copy has to say so, or cancelling looks like the safe option when it
        * is simply the same option.
        */}
      <ConfirmDialog
        visible={confirming}
        title="Start a new career?"
        message={
          summary
            ? `${summary.clubName}, and every season you have played with them, will be deleted the moment you pick a new club. Until then nothing changes.`
            : ''
        }
        confirmLabel="Choose a club"
        destructive
        onConfirm={() => {
          setConfirming(false);
          navigation.navigate('newCareer');
        }}
        onCancel={() => setConfirming(false)}
      />
    </ScrollView>
  );
}

function ContinueCard({ summary, onPress }: { summary: CareerSummary; onPress: () => void }) {
  const over = summary.next.kind === 'sacked';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${over ? 'See out' : 'Continue'} with ${summary.clubName}. ${spokenStanding(summary)} ${nextLine(summary.next)}`}
      style={styles.continueWrap}
    >
      {({ pressed }) => (
        <Card style={[styles.continueCard, pressed ? styles.continuePressed : null]}>
          <View style={styles.continueHead}>
            <View style={styles.continueText}>
              <Text style={styles.continueLabel}>{over ? 'SEE IT OUT' : 'CONTINUE'}</Text>
              <Text style={styles.clubName} numberOfLines={1}>
                {summary.clubName}
              </Text>
              <Text style={styles.clubMeta} numberOfLines={1}>
                {summary.city} · {summary.leagueName}
              </Text>
            </View>
            <View style={styles.positionBox}>
              <Text style={styles.positionValue}>
                {summary.position === undefined ? '—' : ordinal(summary.position)}
              </Text>
              <Text style={styles.positionLabel}>
                {summary.position === undefined ? 'not started' : `${summary.points} pts`}
              </Text>
            </View>
          </View>

          <Text style={styles.seasonLine}>
            Season {summary.season} · {summary.played} of {summary.leagueGames} played
            {summary.seasonsInCharge > 0
              ? ` · ${summary.seasonsInCharge} full ${summary.seasonsInCharge === 1 ? 'season' : 'seasons'} in charge`
              : ''}
          </Text>
          <Text style={[styles.nextLine, over ? styles.nextOver : null]} numberOfLines={2}>
            {nextLine(summary.next)}
          </Text>
        </Card>
      )}
    </Pressable>
  );
}

function spokenStanding(summary: CareerSummary): string {
  if (summary.position === undefined) return `Season ${summary.season}, not yet started.`;
  return `${ordinal(summary.position)} on ${summary.points} points.`;
}

function nextLine(next: NextUp): string {
  switch (next.kind) {
    case 'sacked':
      return next.reason;
    case 'window':
      return 'The transfer window is open.';
    case 'seasonOver':
      return 'The season is over — there is a season to wrap up.';
    case 'bye':
      return 'No match this week.';
    case 'fixture':
      return next.isCup
        ? `${next.competition} — ${next.home ? 'home to' : 'away to'} ${next.opponent}`
        : `Round ${next.round} — ${next.home ? 'home to' : 'away to'} ${next.opponent}`;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },
  wordmark: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 4,
  },
  rule: {
    height: 3,
    width: 56,
    backgroundColor: colors.accent,
    borderRadius: 2,
    marginTop: spacing.sm,
  },
  tagline: { marginTop: spacing.md, marginBottom: spacing.xl },
  continueWrap: { marginBottom: spacing.lg },
  continueCard: { borderColor: colors.accent },
  continuePressed: { backgroundColor: colors.surfaceAlt, borderColor: colors.borderBright },
  continueHead: { flexDirection: 'row', alignItems: 'flex-start' },
  continueText: { flex: 1, paddingRight: spacing.md },
  continueLabel: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: spacing.xs,
  },
  clubName: { color: colors.text, fontSize: 20, fontWeight: '700' },
  clubMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  positionBox: { alignItems: 'flex-end' },
  positionValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  positionLabel: { color: colors.faint, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6 },
  seasonLine: { color: colors.muted, fontSize: 12, marginTop: spacing.md },
  nextLine: { color: colors.text, fontSize: 13, marginTop: spacing.xs, lineHeight: 18 },
  nextOver: { color: colors.danger },
  action: { marginTop: spacing.sm },
});
