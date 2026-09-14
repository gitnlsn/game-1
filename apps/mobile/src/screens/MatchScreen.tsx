import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { managedClub, type Career, type MatchEvent, type MatchResult } from '@game1/engine';
import { Badge, Button, Card, Divider, SectionTitle } from '../components/ui';
import { colors, spacing } from '../theme';

const NOTABLE: MatchEvent['type'][] = ['goal', 'red_card', 'injury'];

export function MatchScreen({
  career,
  result,
  onDismiss,
}: {
  career: Career;
  result: MatchResult;
  onDismiss: () => void;
}) {
  const club = managedClub(career);
  const home = result.homeClubId === club.id;
  const opponentId = home ? result.awayClubId : result.homeClubId;
  const opponent = career.world.league.clubs.find((c) => c.id === opponentId);

  const ownGoals = home ? result.home.goals : result.away.goals;
  const theirGoals = home ? result.away.goals : result.home.goals;
  const outcome = ownGoals > theirGoals ? 'Won' : ownGoals === theirGoals ? 'Drew' : 'Lost';
  const outcomeColor =
    ownGoals > theirGoals ? colors.accent : ownGoals === theirGoals ? colors.muted : colors.danger;

  const notable = result.events.filter((event) => NOTABLE.includes(event.type));

  return (
    <Modal visible animationType="slide" transparent={false} onRequestClose={onDismiss}>
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Badge label={outcome.toUpperCase()} color={outcomeColor} style={styles.outcomeBadge} />

          <View style={styles.scoreline}>
            <Text style={styles.teamName} numberOfLines={2}>
              {home ? club.name : opponent?.name}
            </Text>
            <Text style={styles.score}>
              {result.home.goals}–{result.away.goals}
            </Text>
            <Text style={styles.teamName} numberOfLines={2}>
              {home ? opponent?.name : club.name}
            </Text>
          </View>

          <Card style={styles.statsCard}>
            <StatRow
              label="Possession"
              home={`${result.home.possession}%`}
              away={`${result.away.possession}%`}
            />
            <StatRow label="Shots" home={result.home.shots} away={result.away.shots} />
            <StatRow
              label="On target"
              home={result.home.shotsOnTarget}
              away={result.away.shotsOnTarget}
            />
          </Card>

          <SectionTitle>Match events</SectionTitle>
          <Card>
            {notable.length === 0 ? (
              <Text style={styles.empty}>A goalless, incident-free afternoon.</Text>
            ) : (
              notable.map((event, index) => {
                const scorer = career.world.players.get(event.playerId);
                const assist = event.assistPlayerId
                  ? career.world.players.get(event.assistPlayerId)
                  : undefined;
                const forUs = event.clubId === club.id;

                return (
                  <View key={`${event.minute}-${event.playerId}-${index}`}>
                    {index > 0 ? <Divider /> : null}
                    <View style={styles.eventRow}>
                      <Text style={styles.minute}>{event.minute}'</Text>
                      <Text style={styles.eventIcon}>{iconFor(event.type)}</Text>
                      <View style={styles.eventBody}>
                        <Text
                          style={[styles.eventPlayer, forUs ? styles.eventOurs : null]}
                          numberOfLines={1}
                        >
                          {scorer?.displayName ?? 'Unknown'}
                        </Text>
                        {assist ? (
                          <Text style={styles.eventAssist}>assist: {assist.displayName}</Text>
                        ) : null}
                      </View>
                      <Text style={styles.eventClub}>
                        {forUs ? club.shortName : (opponent?.shortName ?? '')}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </Card>
        </ScrollView>

        <View style={styles.footer}>
          <Button label="Continue" onPress={onDismiss} />
        </View>
      </View>
    </Modal>
  );
}

function iconFor(type: MatchEvent['type']): string {
  if (type === 'goal') return '⚽';
  if (type === 'red_card') return '🟥';
  if (type === 'injury') return '🩹';
  return '•';
}

function StatRow({
  label,
  home,
  away,
}: {
  label: string;
  home: string | number;
  away: string | number;
}) {
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
  content: { padding: spacing.lg, paddingTop: spacing.xl * 2, paddingBottom: spacing.lg },
  outcomeBadge: { alignSelf: 'center', marginBottom: spacing.md },
  scoreline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  teamName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
  },
  score: {
    color: colors.text,
    fontSize: 40,
    fontWeight: '800',
    paddingHorizontal: spacing.md,
    fontVariant: ['tabular-nums'],
  },
  statsCard: { marginBottom: spacing.lg },
  statRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
  statValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    width: 52,
    fontVariant: ['tabular-nums'],
  },
  statValueRight: { textAlign: 'right' },
  statLabel: { color: colors.muted, fontSize: 12, flex: 1, textAlign: 'center' },
  eventRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  minute: {
    color: colors.faint,
    fontSize: 12,
    width: 34,
    fontVariant: ['tabular-nums'],
  },
  eventIcon: { fontSize: 13, width: 24 },
  eventBody: { flex: 1, minWidth: 0 },
  eventPlayer: { color: colors.text, fontSize: 13, fontWeight: '600' },
  eventOurs: { color: colors.accent },
  eventAssist: { color: colors.faint, fontSize: 11 },
  eventClub: { color: colors.muted, fontSize: 11, fontWeight: '700', width: 36, textAlign: 'right' },
  empty: { color: colors.faint, fontSize: 13, fontStyle: 'italic' },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
});
