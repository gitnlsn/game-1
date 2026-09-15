import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  effectiveWageBill,
  boardConfidence,
  cupRoundName,
  cupRun,
  findClub,
  describeTactics,
  formatMoney,
  isAvailable,
  isSeasonComplete,
  leagueTable,
  managedClub,
  managedPosition,
  managedResults,
  marketValue,
  managedLeague,
  nextFixture,
  tactics as currentTactics,
  wageBill,
  type Career,
  type MatchResult,
} from '@eleven-deep/engine';
import { Badge, Button, Card, Divider, KeyValue, SectionTitle, StatTile, textStyles } from '../components/ui';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { colors, spacing } from '../theme';
import { useGame } from '../game/GameContext';
import type { RootStackParamList } from '../nav/routes';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const ORDINAL_SUFFIX = ['th', 'st', 'nd', 'rd'];
function ordinal(n: number): string {
  const v = n % 100;
  return `${n}${ORDINAL_SUFFIX[(v - 20) % 10] ?? ORDINAL_SUFFIX[v] ?? ORDINAL_SUFFIX[0]}`;
}

/** W/D/L from the managed club's point of view. */
function outcomeFor(result: MatchResult, clubId: string): 'W' | 'D' | 'L' {
  const home = result.homeClubId === clubId;
  const own = home ? result.home.goals : result.away.goals;
  const other = home ? result.away.goals : result.home.goals;
  return own > other ? 'W' : own === other ? 'D' : 'L';
}

const OUTCOME_COLOR = { W: colors.accent, D: colors.muted, L: colors.danger } as const;

export function ClubScreen() {
  const navigation = useNavigation<Nav>();
  const {
    career, busy, playRound, finishSeason, beginNextSeason, windowOpen, sacked,
    settings, startLive,
  } = useGame();
  // Before the guard below: hooks cannot run conditionally.
  const [confirmingSeason, setConfirmingSeason] = useState(false);
  if (!career) return null;

  const club = managedClub(career);
  const board = boardConfidence(career);
  const run = cupRun(career);
  const cup = career.season.cup;
  const table = leagueTable(career);
  const row = table.find((r) => r.clubId === club.id);
  const position = managedPosition(career);
  const upcoming = nextFixture(career);
  const recent = managedResults(career).slice(0, 5);
  const complete = isSeasonComplete(career);

  // Before a ball is kicked every club is level, and the table is sorted
  // alphabetically. Showing a position then is meaningless.
  const seasonStarted = (row?.played ?? 0) > 0;
  const injured = club.squad.filter((p) => !isAvailable(p)).length;
  const squadValue = club.squad.reduce((sum, p) => sum + marketValue(p), 0);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={textStyles.title} numberOfLines={1}>
            {club.name}
          </Text>
          <Text style={textStyles.subtitle}>
            Season {career.world.season} · {club.city} · Reputation {club.reputation}
          </Text>
        </View>
        <Pressable
          onPress={() => navigation.navigate('settings')}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          style={styles.gear}
        >
          <Text style={styles.gearIcon}>⚙</Text>
        </Pressable>
        <View style={styles.positionBox}>
          <Text style={styles.positionValue}>{seasonStarted ? ordinal(position) : '—'}</Text>
          <Text style={styles.positionLabel}>
            {seasonStarted ? `${row?.points ?? 0} pts` : 'not started'}
          </Text>
        </View>
      </View>

      <View style={styles.tiles}>
        <StatTile label="Played" value={`${row?.played ?? 0}/38`} />
        <View style={styles.tileGap} />
        <StatTile
          label="Record"
          value={`${row?.won ?? 0}-${row?.drawn ?? 0}-${row?.lost ?? 0}`}
        />
        <View style={styles.tileGap} />
        <StatTile
          label="Goal diff"
          value={row ? (row.goalDifference > 0 ? `+${row.goalDifference}` : `${row.goalDifference}`) : '0'}
          tint={(row?.goalDifference ?? 0) >= 0 ? colors.accent : colors.danger}
        />
      </View>

      {/*
        * Reached on relaunch as much as on the day it happens: without this a
        * dismissed manager reopens the app to a perfectly normal club screen.
        */}
      {sacked ? (
        <Card style={styles.sackedCard}>
          <SectionTitle>Career over</SectionTitle>
          <Text style={styles.finishedText}>
            {career.board.sackReason ?? 'The board has decided to make a change.'}
          </Text>
          <Button
            label="See your record"
            variant="danger"
            onPress={() => navigation.navigate('sacked')}
            style={styles.playButton}
          />
        </Card>
      ) : windowOpen ? (
        <Card style={styles.matchCard}>
          <SectionTitle>Transfer window</SectionTitle>
          <Text style={styles.finishedText}>
            The window is open. Deal with any offers for your players, renew the contracts running
            down, and sign whoever you can afford.
          </Text>
          <Button
            label="Open the window"
            onPress={() => navigation.navigate('transfers')}
            style={styles.playButton}
          />
          {/*
            * Without this the window is a dead end: starting the next season
            * lived only on the season summary screen, which you cannot get back
            * to once you have navigated away from it, so a save with an open
            * window had no way forward at all.
            */}
          <Button
            label={`Start season ${career.world.season + 1}`}
            variant="secondary"
            loading={busy}
            onPress={() => setConfirmingSeason(true)}
            style={styles.quickButton}
          />
        </Card>
      ) : complete ? (
        <Card style={styles.matchCard}>
          <SectionTitle>Season over</SectionTitle>
          <Text style={styles.finishedText}>
            You finished {ordinal(position)} with {row?.points ?? 0} points. Contracts, retirements,
            the academy intake and the transfer window all happen next.
          </Text>
          <Button
            label="End season"
            onPress={async () => {
              const summary = await finishSeason();
              if (summary) navigation.navigate('seasonSummary');
            }}
            loading={busy}
            style={styles.playButton}
          />
        </Card>
      ) : upcoming ? (
        <Card style={styles.matchCard}>
          <SectionTitle
            right={<Text style={styles.roundLabel}>Round {career.season.nextRound}</Text>}
          >
            {upcoming.isCup ? cupRoundName(cup?.remaining.length ?? 0) : 'Next match'}
          </SectionTitle>
          {upcoming.isCup ? (
            <Badge label={upcoming.competition.toUpperCase()} color={colors.gold} style={styles.cupBadge} />
          ) : null}

          <View style={styles.fixtureRow}>
            <Badge
              label={upcoming.home ? 'HOME' : 'AWAY'}
              color={upcoming.home ? colors.accent : colors.info}
            />
            <Text style={styles.opponentName} numberOfLines={1}>
              {upcoming.opponent.name}
            </Text>
          </View>
          <Text style={styles.opponentMeta}>
            Reputation {upcoming.opponent.reputation}
            {seasonStarted
              ? ` · ${ordinal(table.findIndex((r) => r.clubId === upcoming.opponent.id) + 1)} in the table`
              : ''}
          </Text>

          {/*
            * Quick play skips team selection, which is also where instructions
            * are set -- so a manager who always quick-plays would never see how
            * his side is set up. Stating it here is what keeps it a decision he
            * is making rather than one being made for him.
            */}
          <Text style={styles.setup}>Set up: {describeTactics(currentTactics(career))}</Text>

          <Button
            label="Pick team"
            onPress={() => navigation.navigate('teamSelection')}
            style={styles.playButton}
          />
          {/* For the 38 rounds a season where you do not care to pick. */}
          <Button
            label={settings.matchMode === 'live' ? 'Watch it' : 'Quick play'}
            variant="secondary"
            loading={busy}
            onPress={async () => {
              if (settings.matchMode === 'live') {
                if (await startLive()) navigation.navigate('liveMatch');
                return;
              }
              const outcome = await playRound();
              if (outcome?.ownMatch && career) {
                navigation.navigate('matchResult', { round: career.season.nextRound - 1 });
              }
            }}
            style={styles.quickButton}
          />
        </Card>
      ) : (
        /*
         * No fixture this matchday. A club with a cup bye has one of these, and
         * without this card the screen offers nothing at all -- no next match,
         * no button, no way to move the season on.
         */
        <Card style={styles.matchCard}>
          <SectionTitle
            right={<Text style={styles.roundLabel}>Round {career.season.nextRound}</Text>}
          >
            No match this week
          </SectionTitle>
          <Text style={styles.finishedText}>
            {run?.stillIn && !run.won
              ? `You have a bye in the ${run.name}. The rest of the country plays on.`
              : 'You have no fixture this week. The rest of the country plays on.'}
          </Text>
          <Button
            label="Move on a week"
            loading={busy}
            onPress={async () => {
              await playRound();
            }}
            style={styles.playButton}
          />
        </Card>
      )}

      <SectionTitle>Form</SectionTitle>
      <Card>
        {recent.length === 0 ? (
          <Text style={styles.noForm}>No matches played yet this season.</Text>
        ) : (
          recent.map((result, index) => {
            const home = result.homeClubId === club.id;
            const opponentId = home ? result.awayClubId : result.homeClubId;
            const opponent = findClub(career.world, opponentId);
            const outcome = outcomeFor(result, club.id);
            return (
              <View key={`${result.homeClubId}-${result.awayClubId}-${index}`}>
                {index > 0 ? <Divider /> : null}
                <View style={styles.resultRow}>
                  <View style={[styles.outcomeDot, { backgroundColor: OUTCOME_COLOR[outcome] }]}>
                    <Text style={styles.outcomeText}>{outcome}</Text>
                  </View>
                  <Text style={styles.resultOpponent} numberOfLines={1}>
                    {home ? 'vs' : 'at'} {opponent?.name ?? 'Unknown'}
                  </Text>
                  <Text style={styles.resultScore}>
                    {home ? result.home.goals : result.away.goals}–
                    {home ? result.away.goals : result.home.goals}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </Card>

      <SectionTitle>Club</SectionTitle>
      <Card>
        <KeyValue label="Balance" value={formatMoney(club.finances.balance)} bold
          tint={club.finances.balance >= 0 ? colors.accent : colors.danger} />
        <KeyValue label="Squad value" value={formatMoney(squadValue)} />
        <KeyValue label="Wage bill" value={`${formatMoney(effectiveWageBill(career.world, club))}/wk`} />
        <Divider />
        <KeyValue label="Squad size" value={`${club.squad.length}`} />
        <KeyValue
          label="Unavailable"
          value={injured === 0 ? 'None' : `${injured}`}
          tint={injured > 3 ? colors.danger : injured > 0 ? colors.warn : colors.accent}
        />
        <KeyValue label="Stadium" value={club.finances.stadiumCapacity.toLocaleString()} />
      </Card>

      <SectionTitle>The board</SectionTitle>
      <Card>
        <KeyValue
          label="Confidence"
          value={`${board.mood} (${board.confidence})`}
          bold
          tint={
            board.confidence >= 60
              ? colors.accent
              : board.confidence >= 35
                ? colors.warn
                : colors.danger
          }
        />
        <KeyValue
          label="Expected finish"
          value={`${ordinal(board.expectation)} in the ${managedLeague(career).name}`}
        />
      </Card>

      {run ? (
        <>
          <SectionTitle>{run.name}</SectionTitle>
          <Card>
            <KeyValue
              label="Status"
              value={
                run.won
                  ? 'Winners'
                  : run.stillIn
                    ? cupRoundName(run.remaining)
                    : `Out — ${run.ties.length} tie${run.ties.length === 1 ? '' : 's'} played`
              }
              bold
              tint={run.won ? colors.gold : run.stillIn ? colors.accent : colors.muted}
            />
            <KeyValue label="Ties won" value={`${run.roundsSurvived}`} />
          </Card>
        </>
      ) : null}

      <HistoryCard career={career} />

      <ConfirmDialog
        visible={confirmingSeason}
        title={`Start season ${career.world.season + 1}?`}
        message={
          'The window shuts and the other clubs do their remaining business. ' +
          'Anything you were still weighing up goes with it.'
        }
        confirmLabel="Start the season"
        onConfirm={async () => {
          setConfirmingSeason(false);
          await beginNextSeason();
        }}
        onCancel={() => setConfirmingSeason(false)}
      />
    </ScrollView>
  );
}

function HistoryCard({ career }: { career: Career }) {
  if (career.history.length === 0) return null;

  return (
    <>
      <SectionTitle>Previous seasons</SectionTitle>
      <Card>
        {career.history
          .slice()
          .reverse()
          .map((summary, index) => {
            const own = summary.table.findIndex((r) => r.clubId === career.managedClubId) + 1;
            const won = summary.championName === managedClub(career).name;
            return (
              <View key={summary.season}>
                {index > 0 ? <Divider /> : null}
                <View style={styles.historyRow}>
                  <Text style={styles.historySeason}>S{summary.season}</Text>
                  <Text
                    style={[styles.historyPosition, won ? { color: colors.gold } : null]}
                  >
                    {own > 0 ? ordinal(own) : '—'}
                  </Text>
                  <Text style={styles.historyChampion} numberOfLines={1}>
                    {summary.championName}
                  </Text>
                </View>
              </View>
            );
          })}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.md },
  headerText: { flex: 1, marginRight: spacing.sm },
  positionBox: { alignItems: 'flex-end' },
  positionValue: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  positionLabel: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  tiles: { flexDirection: 'row', marginBottom: spacing.lg },
  tileGap: { width: spacing.sm },
  matchCard: { marginBottom: spacing.lg },
  roundLabel: { color: colors.faint, fontSize: 11, fontWeight: '600' },
  fixtureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  opponentName: { color: colors.text, fontSize: 18, fontWeight: '700', flex: 1 },
  opponentMeta: { color: colors.muted, fontSize: 12, marginTop: 4 },
  sackedCard: { marginTop: spacing.md, borderColor: colors.danger, borderWidth: 1 },
  cupBadge: { alignSelf: 'flex-start', marginTop: spacing.xs },
  setup: {
    color: colors.faint, fontSize: 12, marginTop: spacing.sm, fontStyle: 'italic',
  },
  playButton: { marginTop: spacing.md },
  quickButton: { marginTop: spacing.sm },
  gear: { padding: spacing.xs, marginRight: spacing.xs },
  gearIcon: { color: colors.muted, fontSize: 18 },
  finishedText: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  noForm: { color: colors.faint, fontSize: 13, fontStyle: 'italic' },
  resultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  outcomeDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  outcomeText: { color: '#0E1116', fontSize: 11, fontWeight: '800' },
  resultOpponent: { color: colors.text, fontSize: 13, flex: 1 },
  resultScore: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  historyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  historySeason: { color: colors.faint, fontSize: 12, fontWeight: '700', width: 34 },
  historyPosition: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    width: 44,
    fontVariant: ['tabular-nums'],
  },
  historyChampion: { color: colors.muted, fontSize: 12, flex: 1 },
});
