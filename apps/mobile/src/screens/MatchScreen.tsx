import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { allClubs, managedClub, type MatchEvent } from '@game1/engine';
import { Badge, Button, Card, Divider, SectionTitle } from '../components/ui';
import { colors, spacing } from '../theme';
import { useGame } from '../game/GameContext';
import type { RootStackParamList } from '../nav/routes';

type Props = NativeStackScreenProps<RootStackParamList, 'matchResult'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

const NOTABLE: MatchEvent['type'][] = ['goal', 'red_card', 'yellow_card', 'injury', 'substitution'];

const FULL_TIME = 96;
/** Real seconds a replayed match takes end to end. */
const REPLAY_DURATION_MS = 6000;

export function MatchScreen({ route }: Props) {
  const navigation = useNavigation<Nav>();
  const { career, settings } = useGame();
  const { round } = route.params;

  const result = useMemo(() => {
    if (!career) return undefined;
    const fixtures = career.season.fixtures.filter((f) => f.round === round);
    const ids = new Set(fixtures.map((f) => `${f.homeClubId}:${f.awayClubId}`));
    return career.season.results.find(
      (r) =>
        ids.has(`${r.homeClubId}:${r.awayClubId}`) &&
        (r.homeClubId === career.managedClubId || r.awayClubId === career.managedClubId),
    );
  }, [career, round]);

  const replaying = settings.matchMode === 'replay';
  const [clock, setClock] = useState(replaying ? 0 : FULL_TIME);
  const skipped = useRef(false);

  /*
   * Driven by elapsed wall-clock time through requestAnimationFrame, not by
   * counting timer ticks. Browsers clamp timers in a tab that is not focused --
   * measured at ~1s against a requested 110ms -- which turned a six-second replay
   * into a minute-long one. Reading the clock from elapsed time means throttling
   * costs frames rather than stretching the match.
   */
  useEffect(() => {
    if (!replaying) return;
    const started = Date.now();
    let frame = 0;
    let done = false;

    const tick = () => {
      if (skipped.current || done) return;
      const progress = (Date.now() - started) / REPLAY_DURATION_MS;
      const minute = Math.min(FULL_TIME, Math.round(progress * FULL_TIME));
      // Only re-render when the displayed minute actually changes.
      setClock((current) => (current === minute ? current : minute));
      if (minute >= FULL_TIME) done = true;
      else frame = requestAnimationFrame(tick);
    };

    // A timer as well as frames: a backgrounded tab suspends animation, and a
    // match that never reaches full time cannot be continued from.
    const backstop = setInterval(tick, 250);

    frame = requestAnimationFrame(tick);
    return () => {
      done = true;
      cancelAnimationFrame(frame);
      clearInterval(backstop);
    };
  }, [replaying]);

  if (!career || !result) {
    return (
      <View style={styles.container}>
        <Text style={styles.missing}>That match is no longer available.</Text>
      </View>
    );
  }

  const club = managedClub(career);
  const home = result.homeClubId === club.id;
  const opponent = allClubs(career.world).find(
    (c) => c.id === (home ? result.awayClubId : result.homeClubId),
  );

  // The scoreline builds as the clock runs, which is where the drama lives.
  const shown = result.events.filter((e) => e.minute <= clock);
  const homeGoals = shown.filter((e) => e.type === 'goal' && e.clubId === result.homeClubId).length;
  const awayGoals = shown.filter((e) => e.type === 'goal' && e.clubId === result.awayClubId).length;
  const finished = clock >= FULL_TIME;

  const ownGoals = home ? homeGoals : awayGoals;
  const theirGoals = home ? awayGoals : homeGoals;
  const outcome = ownGoals > theirGoals ? 'Winning' : ownGoals === theirGoals ? 'Level' : 'Losing';
  const finalOutcome = ownGoals > theirGoals ? 'Won' : ownGoals === theirGoals ? 'Drew' : 'Lost';
  const outcomeColor =
    ownGoals > theirGoals ? colors.accent : ownGoals === theirGoals ? colors.muted : colors.danger;

  const notable = shown.filter((e) => NOTABLE.includes(e.type)).reverse();

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.clockRow}>
          <Badge label={finished ? finalOutcome.toUpperCase() : outcome.toUpperCase()} color={outcomeColor} />
          <Text style={styles.clock}>{finished ? 'FT' : `${Math.min(clock, 90)}'`}</Text>
        </View>

        <View style={styles.scoreline}>
          <Text style={styles.teamName} numberOfLines={2}>
            {home ? club.name : opponent?.name}
          </Text>
          <Text style={styles.score}>
            {homeGoals}–{awayGoals}
          </Text>
          <Text style={styles.teamName} numberOfLines={2}>
            {home ? opponent?.name : club.name}
          </Text>
        </View>

        {finished ? (
          <Card style={styles.statsCard}>
            <StatRow label="Possession" home={`${result.home.possession}%`} away={`${result.away.possession}%`} />
            <StatRow label="Shots" home={result.home.shots} away={result.away.shots} />
            <StatRow label="On target" home={result.home.shotsOnTarget} away={result.away.shotsOnTarget} />
          </Card>
        ) : null}

        <SectionTitle>{finished ? 'Match events' : 'As it happens'}</SectionTitle>
        <Card>
          {notable.length === 0 ? (
            <Text style={styles.empty}>
              {finished ? 'A goalless, incident-free afternoon.' : 'Nothing doing yet.'}
            </Text>
          ) : (
            notable.map((event, index) => {
              const player = career.world.players.get(event.playerId);
              const replacement = event.replacementPlayerId
                ? career.world.players.get(event.replacementPlayerId)
                : undefined;
              const assist = event.assistPlayerId
                ? career.world.players.get(event.assistPlayerId)
                : undefined;
              const ours = event.clubId === club.id;

              return (
                <View key={`${event.minute}-${event.playerId}-${event.type}-${index}`}>
                  {index > 0 ? <Divider /> : null}
                  <View style={styles.eventRow}>
                    <Text style={styles.minute}>{event.minute}'</Text>
                    <Text style={styles.eventIcon}>{iconFor(event.type)}</Text>
                    <View style={styles.eventBody}>
                      <Text style={[styles.eventPlayer, ours ? styles.eventOurs : null]} numberOfLines={1}>
                        {player?.displayName ?? 'Unknown'}
                      </Text>
                      {assist ? <Text style={styles.eventSub}>assist: {assist.displayName}</Text> : null}
                      {replacement ? (
                        <Text style={styles.eventSub}>on: {replacement.displayName}</Text>
                      ) : null}
                    </View>
                    <Text style={styles.eventClub}>
                      {ours ? club.shortName : (opponent?.shortName ?? '')}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </Card>
      </ScrollView>

      <View style={styles.footer}>
        {finished ? (
          <Button label="Continue" onPress={() => navigation.navigate('tabs')} />
        ) : (
          <Button
            label="Skip to full time"
            variant="secondary"
            onPress={() => {
              skipped.current = true;
              setClock(FULL_TIME);
            }}
          />
        )}
      </View>
    </View>
  );
}

function iconFor(type: MatchEvent['type']): string {
  if (type === 'goal') return '⚽';
  if (type === 'red_card') return '🟥';
  if (type === 'yellow_card') return '🟨';
  if (type === 'injury') return '🩹';
  if (type === 'substitution') return '🔁';
  return '•';
}

function StatRow({ label, home, away }: { label: string; home: string | number; away: string | number }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statValue}>{home}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, styles.statValueRight]}>{away}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.lg },
  missing: { color: colors.muted, padding: spacing.lg, fontStyle: 'italic' },
  clockRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  clock: {
    color: colors.muted, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'],
  },
  scoreline: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginVertical: spacing.xl,
  },
  teamName: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1, textAlign: 'center' },
  score: {
    color: colors.text, fontSize: 40, fontWeight: '800',
    paddingHorizontal: spacing.md, fontVariant: ['tabular-nums'],
  },
  statsCard: { marginBottom: spacing.lg },
  statRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
  statValue: {
    color: colors.text, fontSize: 14, fontWeight: '700', width: 52, fontVariant: ['tabular-nums'],
  },
  statValueRight: { textAlign: 'right' },
  statLabel: { color: colors.muted, fontSize: 12, flex: 1, textAlign: 'center' },
  eventRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  minute: { color: colors.faint, fontSize: 12, width: 34, fontVariant: ['tabular-nums'] },
  eventIcon: { fontSize: 13, width: 24 },
  eventBody: { flex: 1, minWidth: 0 },
  eventPlayer: { color: colors.text, fontSize: 13, fontWeight: '600' },
  eventOurs: { color: colors.accent },
  eventSub: { color: colors.faint, fontSize: 11 },
  eventClub: { color: colors.muted, fontSize: 11, fontWeight: '700', width: 36, textAlign: 'right' },
  empty: { color: colors.faint, fontSize: 13, fontStyle: 'italic' },
  footer: {
    padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
});
