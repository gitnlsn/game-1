import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  changeMatchTactics,
  currentAbility,
  describeTactics,
  matchComplete,
  matchSide,
  stepMatch,
  substitute,
  TACTIC_AXES,
  type MatchEvent,
} from '@eleven-deep/engine';
import { Badge, Button, Card, ChipRow, Divider, SectionTitle } from '../components/ui';
import { colors, conditionColor, positionColor, ratingColor, spacing } from '../theme';
import { useGame } from '../game/GameContext';
import type { RootStackParamList } from '../nav/routes';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Real milliseconds per minute of football when the clock is running. */
const MS_PER_MINUTE = 70;

/**
 * A match played as you watch it, with the substitutions and instructions a
 * manager actually has.
 *
 * The match itself lives on the context, not here: starting one plays the rest
 * of its round, so a screen that owned it could strand the season by being
 * navigated away from.
 */
export function LiveMatchScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { career, live, endLive } = useGame();

  const [minute, setMinute] = useState(0);
  const [paused, setPaused] = useState(false);
  const [panel, setPanel] = useState<'none' | 'subs' | 'tactics'>('none');
  const [pickedOff, setPickedOff] = useState<string | undefined>();
  const [, forceRender] = useState(0);
  const finished = useRef(false);

  /*
   * Driven by elapsed wall-clock time rather than by counting ticks, for the
   * same reason the replay is: a browser clamps timers in an unfocused tab, and
   * counting ticks stretched a six-second match into a minute-long one.
   */
  useEffect(() => {
    if (!live || paused || panel !== 'none') return;

    let frame = 0;
    let stopped = false;
    const startedAt = Date.now();
    const startedMinute = live.match.minute;

    const tick = () => {
      if (stopped || !live) return;

      const target = startedMinute + Math.floor((Date.now() - startedAt) / MS_PER_MINUTE);
      let stepped = false;
      while (live.match.minute < target && !matchComplete(live.match)) {
        stepMatch(live.match);
        stepped = true;
      }
      if (stepped) setMinute(live.match.minute);

      if (matchComplete(live.match)) {
        finished.current = true;
        forceRender((n) => n + 1);
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    // A timer as well as frames: a backgrounded tab suspends animation, and a
    // match that never reaches full time cannot be continued from.
    const backstop = setInterval(tick, 250);
    frame = requestAnimationFrame(tick);

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      clearInterval(backstop);
    };
  }, [live, paused, panel]);

  const finish = useCallback(() => {
    const result = endLive();
    if (result && career) {
      navigation.replace('matchResult', { round: career.season.nextRound - 1 });
    } else {
      navigation.goBack();
    }
  }, [career, endLive, navigation]);

  if (!career || !live) return null;

  const side = matchSide(live.match, live.side);
  const otherSide = matchSide(live.match, live.side === 'home' ? 'away' : 'home');
  const done = matchComplete(live.match);

  const homeGoals = live.match.home.goals;
  const awayGoals = live.match.away.goals;
  const recent = live.match.events
    .filter((e) => e.type === 'goal' || e.type === 'red_card' || e.type === 'substitution')
    .slice(-8)
    .reverse();

  const onSwap = (benchId: string) => {
    if (!pickedOff) return;
    substitute(live.match, live.side, pickedOff, benchId);
    setPickedOff(undefined);
    setPanel('none');
    forceRender((n) => n + 1);
  };

  return (
    <View style={styles.container}>
      <View style={styles.scoreboard}>
        <Text style={styles.clock}>{done ? 'FT' : `${Math.min(minute, 90)}'`}</Text>
        <Text style={styles.score}>
          {homeGoals}–{awayGoals}
        </Text>
        <Text style={styles.teams} numberOfLines={1}>
          {live.match.home.club.shortName} v {live.match.away.club.shortName}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {panel === 'subs' ? (
          <>
            <SectionTitle>
              {pickedOff ? 'Who comes on?' : `Who comes off? (${side.substitutionsLeft} left)`}
            </SectionTitle>
            <Card>
              {(pickedOff ? side.bench : side.onPitch.map((p) => p.player)).map((player) => (
                <Pressable
                  key={player.id}
                  accessibilityRole="button"
                  accessibilityLabel={player.displayName}
                  onPress={() => (pickedOff ? onSwap(player.id) : setPickedOff(player.id))}
                  style={styles.playerRow}
                >
                  <Text style={[styles.pos, { color: positionColor(player.position) }]}>
                    {player.position}
                  </Text>
                  <Text style={styles.playerName} numberOfLines={1}>
                    {player.displayName}
                  </Text>
                  <Text style={[styles.condition, { color: conditionColor(player.status.condition) }]}>
                    {player.status.condition.toFixed(0)}
                  </Text>
                  <Text style={[styles.rating, { color: ratingColor(currentAbility(player)) }]}>
                    {currentAbility(player).toFixed(0)}
                  </Text>
                </Pressable>
              ))}
            </Card>
            <Button
              label="Never mind"
              variant="secondary"
              style={styles.action}
              onPress={() => {
                setPickedOff(undefined);
                setPanel('none');
              }}
            />
          </>
        ) : panel === 'tactics' ? (
          <>
            <SectionTitle>Instructions</SectionTitle>
            <Card style={styles.tactics}>
              <Text style={styles.tacticsSummary}>{describeTactics(side.tactics)}</Text>
              {TACTIC_AXES.map((axis) => (
                <View key={axis.key} style={styles.axis}>
                  <Text style={styles.axisLabel}>{axis.label}</Text>
                  <ChipRow
                    options={[
                      { value: '-2', label: axis.low },
                      { value: '0', label: 'Balanced' },
                      { value: '2', label: axis.high },
                    ]}
                    value={String(side.tactics[axis.key])}
                    onChange={(value) => {
                      changeMatchTactics(live.match, live.side, { [axis.key]: Number(value) });
                      forceRender((n) => n + 1);
                    }}
                  />
                </View>
              ))}
            </Card>
            <Button
              label="Back to the match"
              variant="secondary"
              style={styles.action}
              onPress={() => setPanel('none')}
            />
          </>
        ) : (
          <>
            <View style={styles.statRow}>
              <Stat label="Shots" mine={sideShots(live, live.side)} theirs={sideShots(live, live.side === 'home' ? 'away' : 'home')} />
              <Stat label="On target" mine={sideOnTarget(live, live.side)} theirs={sideOnTarget(live, live.side === 'home' ? 'away' : 'home')} />
              <Stat label="Subs left" mine={side.substitutionsLeft} theirs={otherSide.substitutionsLeft} />
            </View>

            <SectionTitle>What has happened</SectionTitle>
            <Card>
              {recent.length === 0 ? (
                <Text style={styles.quiet}>Nothing yet.</Text>
              ) : (
                recent.map((event, index) => <EventRow key={index} event={event} live={live} />)
              )}
            </Card>
          </>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: spacing.lg + insets.bottom }]}>
        {done ? (
          <Button label="Full time" onPress={finish} />
        ) : panel === 'none' ? (
          <View style={styles.footerRow}>
            <Button
              label={paused ? 'Play on' : 'Pause'}
              variant="secondary"
              style={styles.action}
              onPress={() => setPaused((p) => !p)}
            />
            <Button
              label="Change it"
              variant="secondary"
              style={styles.action}
              onPress={() => setPanel('tactics')}
            />
            <Button
              label="Sub"
              style={styles.action}
              disabled={side.substitutionsLeft === 0 || side.bench.length === 0}
              onPress={() => setPanel('subs')}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function sideShots(live: { match: { home: { shots: number }; away: { shots: number } } }, side: 'home' | 'away') {
  return side === 'home' ? live.match.home.shots : live.match.away.shots;
}

function sideOnTarget(
  live: { match: { home: { shotsOnTarget: number }; away: { shotsOnTarget: number } } },
  side: 'home' | 'away',
) {
  return side === 'home' ? live.match.home.shotsOnTarget : live.match.away.shotsOnTarget;
}

function Stat({ label, mine, theirs }: { label: string; mine: number; theirs: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>
        {mine} – {theirs}
      </Text>
    </View>
  );
}

function EventRow({
  event,
  live,
}: {
  event: MatchEvent;
  live: { match: { home: { club: { id: string; shortName: string } }; away: { club: { id: string; shortName: string } } } };
}) {
  const club =
    event.clubId === live.match.home.club.id ? live.match.home.club : live.match.away.club;
  const icon = event.type === 'goal' ? '⚽' : event.type === 'red_card' ? '🟥' : '↔';

  return (
    <View style={styles.eventRow}>
      <Text style={styles.eventMinute}>{event.minute}'</Text>
      <Text style={styles.eventIcon}>{icon}</Text>
      <Text style={styles.eventText} numberOfLines={1}>
        {event.type === 'goal' ? 'Goal' : event.type === 'red_card' ? 'Sent off' : 'Substitution'}
      </Text>
      <Badge label={club.shortName} color={colors.muted} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scoreboard: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  clock: {
    color: colors.accent, fontSize: 13, fontWeight: '800',
    fontVariant: ['tabular-nums'], letterSpacing: 1,
  },
  score: {
    color: colors.text, fontSize: 40, fontWeight: '800',
    fontVariant: ['tabular-nums'], marginVertical: 2,
  },
  teams: { color: colors.faint, fontSize: 12 },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  statRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  stat: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 8,
    padding: spacing.sm, alignItems: 'center',
  },
  statLabel: {
    color: colors.faint, fontSize: 9, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  statValue: {
    color: colors.text, fontSize: 15, fontWeight: '700',
    fontVariant: ['tabular-nums'], marginTop: 2,
  },
  quiet: { color: colors.faint, fontSize: 13, fontStyle: 'italic' },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4 },
  eventMinute: {
    color: colors.faint, fontSize: 11, width: 30, fontVariant: ['tabular-nums'],
  },
  eventIcon: { fontSize: 12, width: 18 },
  eventText: { color: colors.text, fontSize: 13, flex: 1 },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  pos: { fontSize: 11, fontWeight: '800', width: 28 },
  playerName: { color: colors.text, fontSize: 14, flex: 1 },
  condition: { fontSize: 12, fontVariant: ['tabular-nums'], width: 30, textAlign: 'right' },
  rating: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'], width: 30, textAlign: 'right' },
  tactics: { gap: spacing.md },
  tacticsSummary: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  axis: { gap: spacing.xs },
  axisLabel: {
    color: colors.faint, fontSize: 9, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  action: { flex: 1 },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  footerRow: { flexDirection: 'row', gap: spacing.sm },
});
