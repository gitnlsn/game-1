import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  allTimeAtClub,
  honoursOf,
  managedClub,
  managedResults,
  type ClubSeasonLine,
  type MatchRecord,
} from '@eleven-deep/engine';
import { Badge, Card, Divider, EmptyNote, KeyValue, SectionTitle, StatTile } from '../components/ui';
import { colors, spacing } from '../theme';
import { ordinal } from '../format';
import { useGame } from '../game/GameContext';

/**
 * The club's history under this manager: honours, every season, the players
 * who have played the most and scored the most, and the scorelines either side
 * of the ledger. Pro, reached from the Club tab.
 */
export function RecordsScreen() {
  const { career } = useGame();
  const insets = useSafeAreaInsets();
  if (!career) return null;

  const club = managedClub(career);
  const records = career.records;
  const honours = honoursOf(records);
  const allTime = allTimeAtClub(records, club.id);
  const scorers = [...allTime].filter((l) => l.goals > 0).sort((a, b) => b.goals - a.goals).slice(0, 10);
  const servants = allTime.slice(0, 10);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + insets.bottom }]}
    >
      <View style={styles.tiles}>
        <StatTile label="Titles" value={`${honours.titles + honours.divisionTitles}`} tint={honours.titles + honours.divisionTitles > 0 ? colors.gold : undefined} />
        <StatTile label="Cups" value={`${honours.cups}`} tint={honours.cups > 0 ? colors.gold : undefined} />
        <StatTile label="Promotions" value={`${honours.promotions}`} />
      </View>

      <ThisSeason />

      <SectionTitle>Season by season</SectionTitle>
      <Card>
        {records.seasons.length === 0 ? (
          <EmptyNote>Your first season is still being played.</EmptyNote>
        ) : (
          [...records.seasons].reverse().map((line, index) => (
            <View key={line.season}>
              {index > 0 ? <Divider /> : null}
              <SeasonRow line={line} />
            </View>
          ))
        )}
        {honours.bestFinish ? (
          <Text style={styles.note}>
            Best finish: {ordinal(honours.bestFinish.position)} in the {honours.bestFinish.leagueName}, season{' '}
            {honours.bestFinish.season}.
          </Text>
        ) : null}
      </Card>

      <SectionTitle>Most appearances</SectionTitle>
      <Card>
        {servants.length === 0 ? (
          <EmptyNote>Appearances are added up when a season ends.</EmptyNote>
        ) : (
          servants.map((line, index) => (
            <PlayerRow
              key={line.playerId}
              rank={index + 1}
              name={line.playerName}
              detail={`${line.seasons} ${line.seasons === 1 ? 'season' : 'seasons'}`}
              value={`${line.appearances}`}
            />
          ))
        )}
      </Card>

      <SectionTitle>Top scorers</SectionTitle>
      <Card>
        {scorers.length === 0 ? (
          <EmptyNote>Goals are added up when a season ends.</EmptyNote>
        ) : (
          scorers.map((line, index) => (
            <PlayerRow
              key={line.playerId}
              rank={index + 1}
              name={line.playerName}
              detail={`${line.appearances} apps · ${line.assists} assists`}
              value={`${line.goals}`}
            />
          ))
        )}
      </Card>

      <SectionTitle>Scorelines</SectionTitle>
      <Card>
        <MatchLine label="Biggest win" match={records.biggestWin} />
        <Divider />
        <MatchLine label="Heaviest defeat" match={records.heaviestDefeat} />
      </Card>
      <Text style={styles.footnote}>
        Records are written at the end of each season. Careers saved before records were kept start
        with how each season ended; players&apos; numbers count from the season after.
      </Text>
    </ScrollView>
  );
}

/** The season in progress, from the numbers that are wiped when it ends. */
function ThisSeason() {
  const { career } = useGame();
  if (!career) return null;
  const club = managedClub(career);
  const matches = managedResults(career);
  /*
   * Once the season has been written down it is in the list below, and the
   * players' numbers this would read have already been reset for the next.
   */
  const recorded = career.records.seasons[career.records.seasons.length - 1]?.season === career.world.season;
  if (matches.length === 0 || recorded) return null;

  let shots = 0;
  let onTarget = 0;
  let possession = 0;
  let goals = 0;
  for (const match of matches) {
    const ours = match.homeClubId === club.id ? match.home : match.away;
    shots += ours.shots;
    onTarget += ours.shotsOnTarget;
    possession += ours.possession;
    goals += ours.goals;
  }
  const n = matches.length;
  const top = (key: 'goals' | 'assists') =>
    [...club.squad].filter((p) => p.status[key] > 0).sort((a, b) => b.status[key] - a.status[key])[0];
  const scorer = top('goals');
  const creator = top('assists');

  return (
    <>
      <SectionTitle>This season</SectionTitle>
      <Card>
        <KeyValue label="Matches, league and cup" value={`${n}`} />
        <KeyValue label="Possession" value={`${Math.round(possession / n)}%`} />
        <KeyValue label="Shots a match" value={(shots / n).toFixed(1)} />
        <KeyValue label="On target" value={shots > 0 ? `${Math.round((onTarget / shots) * 100)}%` : '—'} />
        <KeyValue label="Shots per goal" value={goals > 0 ? (shots / goals).toFixed(1) : '—'} />
        <Divider />
        <KeyValue label="Top scorer" value={scorer ? `${scorer.displayName} (${scorer.status.goals})` : '—'} />
        <KeyValue label="Most assists" value={creator ? `${creator.displayName} (${creator.status.assists})` : '—'} />
      </Card>
    </>
  );
}

function SeasonRow({ line }: { line: ClubSeasonLine }) {
  const champion = line.position === 1;
  return (
    <View style={styles.seasonRow}>
      <Text style={styles.seasonNumber}>S{line.season}</Text>
      <View style={styles.seasonText}>
        <Text style={styles.seasonLeague} numberOfLines={1}>
          <Text style={champion ? styles.gold : styles.strong}>{ordinal(line.position)}</Text> of {line.clubs} ·{' '}
          {line.leagueName}
        </Text>
        <Text style={styles.seasonMeta} numberOfLines={1}>
          W{line.won} D{line.drawn} L{line.lost} · {line.goalsFor}–{line.goalsAgainst} · {line.points} pts
          {line.topScorer ? ` · ${line.topScorer.playerName} ${line.topScorer.goals}` : ''}
        </Text>
      </View>
      <View style={styles.badges}>
        {line.cupFinish === 'won' ? <Badge label="Cup" color={colors.gold} /> : null}
        {line.cupFinish === 'final' ? <Badge label="Final" color={colors.muted} /> : null}
        {line.movement === 'promoted' ? <Badge label="Up" color={colors.accent} /> : null}
        {line.movement === 'relegated' ? <Badge label="Down" color={colors.danger} /> : null}
      </View>
    </View>
  );
}

function PlayerRow({ rank, name, detail, value }: { rank: number; name: string; detail: string; value: string }) {
  return (
    <View style={styles.playerRow}>
      <Text style={styles.rank}>{rank}</Text>
      <View style={styles.seasonText}>
        <Text style={styles.playerName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.seasonMeta}>{detail}</Text>
      </View>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function MatchLine({ label, match }: { label: string; match: MatchRecord | undefined }) {
  return (
    <View style={styles.matchLine}>
      <Text style={styles.matchLabel}>{label}</Text>
      {match ? (
        <Text style={styles.matchText}>
          {match.goalsFor}–{match.goalsAgainst} {match.home ? 'vs' : 'at'} {match.opponentName}
          <Text style={styles.seasonMeta}>
            {'  '}S{match.season}
            {match.cup ? ' · cup' : ''}
          </Text>
        </Text>
      ) : (
        <Text style={styles.seasonMeta}>None yet</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },
  tiles: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  note: { color: colors.muted, fontSize: 12, marginTop: spacing.md, lineHeight: 17 },
  footnote: { color: colors.faint, fontSize: 11, marginTop: spacing.lg, lineHeight: 16, textAlign: 'center' },
  seasonRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  seasonNumber: { color: colors.faint, fontSize: 12, fontWeight: '700', width: 30, fontVariant: ['tabular-nums'] },
  seasonText: { flex: 1 },
  seasonLeague: { color: colors.text, fontSize: 14 },
  seasonMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  strong: { fontWeight: '700' },
  gold: { fontWeight: '700', color: colors.gold },
  badges: { flexDirection: 'row', gap: spacing.xs },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  rank: { color: colors.faint, fontSize: 12, width: 18, textAlign: 'right', fontVariant: ['tabular-nums'] },
  playerName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  value: { color: colors.text, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  matchLine: { paddingVertical: spacing.xs },
  matchLabel: { color: colors.faint, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  matchText: { color: colors.text, fontSize: 14, marginTop: 2 },
});
