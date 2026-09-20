import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, SectionTitle } from './ui';
import { colors, spacing } from '../theme';
import { ordinal } from '../format';
import {
  BOARDS,
  boardConfigured,
  loadRanks,
  playGamesAvailable,
  showLeaderboards,
  type Board,
  type Ranks,
} from '../game/playGames';
import type { LifetimeRecord } from '../game/lifetime';

/**
 * The three Play Games boards, each with what you have and where it puts you.
 *
 * The split is the point: **the number is ours and the rank is Google's.** We
 * hold the totals ourselves, so every row renders complete on the first frame,
 * offline, and signed out -- only the rank arrives late, and only the rank can
 * fail to arrive. A screen that waited on the network to show a number it
 * already knew would be slower and worse for no reason.
 *
 * Tapping a row hands off to Google's own leaderboard UI for that board, which
 * is where the actual standings live.
 */

const LABELS: Record<Board, string> = {
  matches: 'Matches played',
  seasons: 'Seasons played',
  longestRun: 'Longest run at one club',
};

export function LeaderboardsCard({ lifetime }: { lifetime: LifetimeRecord }) {
  const [ranks, setRanks] = useState<Ranks>({});
  /*
   * Read once, during render: this cannot change for the life of the process,
   * and a hook would only invite a re-render that can never happen.
   */
  const available = playGamesAvailable();

  useEffect(() => {
    if (!available) return;

    let cancelled = false;
    void loadRanks().then((loaded) => {
      if (!cancelled) setRanks(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [available]);

  // Android, configured, with at least one board that exists. Otherwise the
  // section is not "empty", it is absent -- there is nothing to tell anyone.
  if (!available) return null;
  const boards = BOARDS.filter(boardConfigured);
  if (boards.length === 0) return null;

  return (
    <>
      <SectionTitle>Leaderboards</SectionTitle>
      <Card style={styles.card}>
        {boards.map((board, index) => (
          <BoardRow
            key={board}
            board={board}
            value={lifetime[board]}
            rank={ranks[board]}
            first={index === 0}
          />
        ))}
        <Text style={styles.note}>
          Your record across every career, not just this one. Getting sacked ends a run.
        </Text>
      </Card>
    </>
  );
}

function BoardRow({
  board,
  value,
  rank,
  first,
}: {
  board: Board;
  value: number;
  rank: number | undefined;
  first: boolean;
}) {
  return (
    <Pressable
      onPress={() => void showLeaderboards(board)}
      accessibilityRole="button"
      accessibilityLabel={
        `${LABELS[board]}: ${value}.` +
        (rank === undefined ? '' : ` Ranked ${ordinal(rank)}.`) +
        ' Opens the leaderboard.'
      }
    >
      {({ pressed }) => (
        <View
          style={[
            styles.row,
            first ? null : styles.divided,
            pressed ? styles.pressed : null,
          ]}
        >
          <View style={styles.text}>
            <Text style={styles.label}>{LABELS[board]}</Text>
            <Text style={styles.value}>{value}</Text>
          </View>
          {/*
            * Blank until Google answers, and blank for good if it never does.
            * A spinner here would draw the eye to the least important number
            * on the row, and "unranked" and "could not ask" are the same thing
            * to a player.
            */}
          <Text style={styles.rank}>{rank === undefined ? '' : ordinal(rank)}</Text>
          <Text style={styles.chevron}>›</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  divided: { borderTopWidth: 1, borderTopColor: colors.border },
  pressed: { opacity: 0.6 },
  text: { flex: 1 },
  label: { color: colors.muted, fontSize: 12 },
  value: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  rank: {
    color: colors.gold,
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  chevron: { color: colors.faint, fontSize: 20, marginLeft: spacing.xs },
  note: {
    color: colors.faint,
    fontSize: 11,
    lineHeight: 16,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
