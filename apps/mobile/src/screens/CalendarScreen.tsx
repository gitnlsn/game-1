import React, { useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Badge, Card, Divider, OutcomeDot } from '../components/ui';
import { colors, spacing } from '../theme';
import { useGame } from '../game/GameContext';
import {
  seasonCalendar,
  type CalendarEntry,
  type CalendarScore,
  type WindowBand,
} from '../game/calendar';

/*
 * The season, club and matchday this view used to head itself with are in the
 * `SeasonScreen` header now, one row above. Repeating them here would have cost
 * a row of fixtures to say the same thing twice.
 */

/**
 * Every row is the same height, which is what lets `getItemLayout` place the
 * list on the current matchday without measuring anything. Change the row and
 * change this.
 */
const ROW_HEIGHT = 30;

/** Rows of lead-in above the current matchday, so it does not sit flush. */
const LEAD_IN = 2;

export function CalendarScreen() {
  const { career, version } = useGame();
  const calendar = useMemo(
    () => (career ? seasonCalendar(career) : undefined),
    [career, version],
  );

  if (!calendar) return null;

  /*
   * Opening on matchday 1 in the run-in would be useless, so the list starts
   * where the season is. Tab screens are mounted and unmounted by the ternary in
   * TabsScreen, so this re-applies every time the tab is opened, which is what
   * it is for.
   */
  const initialIndex =
    calendar.currentMatchday === undefined
      ? Math.max(0, calendar.entries.length - 1)
      : Math.max(0, calendar.currentMatchday - 1 - LEAD_IN);

  return (
    <View style={styles.container}>
      <Card style={styles.listCard}>
        <FlatList
          data={calendar.entries}
          keyExtractor={(entry) => String(entry.matchday)}
          renderItem={({ item }) => (
            <Row entry={item} current={item.matchday === calendar.currentMatchday} />
          )}
          getItemLayout={(_, index) => ({
            length: ROW_HEIGHT,
            offset: ROW_HEIGHT * index,
            index,
          })}
          initialScrollIndex={initialIndex}
          ListFooterComponent={<WindowBandView band={calendar.window} />}
          showsVerticalScrollIndicator={false}
        />
      </Card>
    </View>
  );
}

function Row({ entry, current }: { entry: CalendarEntry; current: boolean }) {
  const cup = entry.kind === 'cupTie' || entry.kind === 'cupRound';
  const playing = entry.kind === 'league' || entry.kind === 'cupTie';

  return (
    <View
      accessibilityLabel={describe(entry, current)}
      style={[
        styles.row,
        // The cup bands down the list by background; the left border is kept for
        // the current matchday alone, so the two markers never fight.
        cup ? styles.cupRow : null,
        current ? styles.currentRow : null,
      ]}
    >
      <Text style={[styles.matchday, current ? styles.matchdayCurrent : null]}>
        {entry.matchday}
      </Text>

      <Text
        style={[
          styles.venue,
          playing ? (entry.home ? styles.venueHome : styles.venueAway) : styles.venueNone,
        ]}
      >
        {playing ? (entry.home ? 'H' : 'A') : '·'}
      </Text>

      {playing ? (
        <Text style={styles.opponent} numberOfLines={1}>
          {entry.opponentName}
        </Text>
      ) : (
        <Text style={styles.state} numberOfLines={1}>
          {stateText(entry)}
        </Text>
      )}

      <Text style={styles.tag}>{cup ? entry.roundShort : ''}</Text>

      <View style={styles.scoreCell}>
        <Score entry={entry} />
      </View>

      <View style={styles.dotCell}>
        {playing && entry.outcome ? <OutcomeDot outcome={entry.outcome} size={18} /> : null}
      </View>
    </View>
  );
}

function Score({ entry }: { entry: CalendarEntry }) {
  if (entry.kind !== 'league' && entry.kind !== 'cupTie') return null;
  if (!entry.score) return <Text style={styles.scoreBlank}>—</Text>;

  if (entry.kind === 'cupTie') {
    // Penalties: the ninety is what anyone remembers, and the shootout goes in
    // the accessibility label rather than squeezing onto the line.
    if (entry.shootout) {
      return (
        <Text style={styles.score}>
          {format(entry.score)}
          <Text style={styles.suffix}> pen</Text>
        </Text>
      );
    }
    // Extra time: the engine keeps the thirty minutes on its own, so the final
    // score is the two added together.
    if (entry.extraTime) {
      return (
        <Text style={styles.score}>
          {format(aggregate(entry.score, entry.extraTime))}
          <Text style={styles.suffix}> aet</Text>
        </Text>
      );
    }
  }

  return <Text style={styles.score}>{format(entry.score)}</Text>;
}

function WindowBandView({ band }: { band: WindowBand }) {
  return (
    <View>
      <Divider style={styles.bandDivider} />
      <View style={[styles.band, band.open ? styles.bandOpen : null]}>
        <View style={styles.bandHeader}>
          <Text style={styles.bandTitle}>Transfer window</Text>
          {band.open ? <Badge label="OPEN" color={colors.gold} /> : null}
        </View>
        <Text style={styles.bandBody}>
          {band.open
            ? `Season ${band.season} is over. The window sits between this season and the next, and shuts when you start season ${band.season + 1}.`
            : `Opens after matchday ${band.afterMatchday}, once the season is done. There is no window mid-season.`}
        </Text>
      </View>
    </View>
  );
}

function stateText(entry: CalendarEntry): string {
  if (entry.kind === 'free') return 'No fixture';
  if (entry.kind !== 'cupRound') return '';
  const state =
    entry.state === 'eliminated'
      ? 'you are out'
      : entry.state === 'bye'
        ? 'a bye this round'
        : 'draw to come';
  return `${entry.competition} — ${state}`;
}

function format(score: CalendarScore): string {
  return `${score.for}–${score.against}`;
}

function aggregate(ninety: CalendarScore, extra: CalendarScore): CalendarScore {
  return { for: ninety.for + extra.for, against: ninety.against + extra.against };
}

/** The full story the row itself has to compress. */
function describe(entry: CalendarEntry, current: boolean): string {
  const parts = [`Matchday ${entry.matchday}.`];

  if (entry.kind === 'free') {
    parts.push('No fixture.');
  } else if (entry.kind === 'cupRound') {
    parts.push(`${entry.competition}, ${entry.roundName}.`);
    parts.push(
      entry.state === 'eliminated'
        ? 'You are out of the cup.'
        : entry.state === 'bye'
          ? 'You had a bye.'
          : 'Not drawn yet.',
    );
  } else {
    if (entry.kind === 'cupTie') parts.push(`${entry.competition}, ${entry.roundName}.`);
    parts.push(`${entry.home ? 'Home to' : 'Away to'} ${entry.opponentName}.`);
    parts.push(scoreSentence(entry));
  }

  if (current) parts.push('Next up.');
  return parts.join(' ');
}

function scoreSentence(entry: CalendarEntry): string {
  if (entry.kind !== 'league' && entry.kind !== 'cupTie') return '';
  if (!entry.score) return 'Not played yet.';

  const verb = (score: CalendarScore) =>
    score.for > score.against ? 'Won' : score.for === score.against ? 'Drew' : 'Lost';

  if (entry.kind === 'cupTie' && entry.shootout) {
    const went = entry.outcome === 'W' ? 'won' : 'lost';
    return `Drew ${format(entry.score)}, ${went} ${format(entry.shootout)} on penalties.`;
  }
  if (entry.kind === 'cupTie' && entry.extraTime) {
    const full = aggregate(entry.score, entry.extraTime);
    return `${verb(full)} ${format(full)} after extra time.`;
  }
  return `${verb(entry.score)} ${format(entry.score)}.`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  listCard: {
    flex: 1,
    padding: 0,
    overflow: 'hidden',
    marginHorizontal: spacing.lg,
    // The header this view used to own supplied this gap; the view switcher
    // above it does not.
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  cupRow: { backgroundColor: colors.surfaceAlt },
  currentRow: { borderLeftColor: colors.accent, backgroundColor: 'rgba(63,185,80,0.10)' },
  matchday: {
    width: 26,
    textAlign: 'right',
    color: colors.faint,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  matchdayCurrent: { color: colors.text, fontWeight: '700' },
  venue: { width: 14, textAlign: 'center', fontSize: 11, fontWeight: '800' },
  venueHome: { color: colors.accent },
  venueAway: { color: colors.info },
  venueNone: { color: colors.faint },
  opponent: { flex: 1, color: colors.text, fontSize: 13, marginLeft: spacing.xs },
  state: {
    flex: 1,
    color: colors.muted,
    fontSize: 12,
    fontStyle: 'italic',
    marginLeft: spacing.xs,
  },
  tag: {
    width: 30,
    textAlign: 'right',
    color: colors.gold,
    fontSize: 10,
    fontWeight: '800',
  },
  scoreCell: { width: 58, alignItems: 'flex-end' },
  score: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  scoreBlank: { color: colors.faint, fontSize: 13 },
  suffix: { color: colors.gold, fontSize: 9, fontWeight: '700' },
  dotCell: { width: 18, marginLeft: spacing.sm, alignItems: 'center' },
  bandDivider: { marginVertical: 0 },
  band: {
    padding: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  bandOpen: { borderLeftColor: colors.gold, backgroundColor: 'rgba(227,179,65,0.10)' },
  bandHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  bandTitle: {
    flex: 1,
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  bandBody: { color: colors.faint, fontSize: 12, lineHeight: 17 },
});
