import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  allClubs,
  currentAbility,
  formatMoney,
  marketValue,
  loanStatus,
  scoutPlayer,
  scoutReport,
  scoutsAvailable,
  scoutValuation,
  type AttributeKey,
  type Player,
} from '@prancheta/engine';
import { Badge, Button, Card, Divider, KeyValue, SectionTitle, StatBar } from '../components/ui';
import { colors, conditionColor, formColor, positionColor, ratingColor, spacing } from '../theme';
import { useGame } from '../game/GameContext';
import type { RootStackParamList } from '../nav/routes';

type Props = NativeStackScreenProps<RootStackParamList, 'player'>;

const GROUPS: { title: string; keys: AttributeKey[] }[] = [
  { title: 'Technical', keys: ['finishing', 'passing', 'dribbling', 'crossing', 'tackling', 'heading'] },
  { title: 'Mental', keys: ['vision', 'composure', 'positioning', 'workRate'] },
  { title: 'Physical', keys: ['pace', 'strength', 'stamina'] },
  { title: 'Goalkeeping', keys: ['reflexes', 'handling', 'distribution'] },
];

const LABELS: Record<AttributeKey, string> = {
  finishing: 'Finishing', passing: 'Passing', dribbling: 'Dribbling', crossing: 'Crossing',
  tackling: 'Tackling', heading: 'Heading', vision: 'Vision', composure: 'Composure',
  positioning: 'Positioning', workRate: 'Work rate', pace: 'Pace', strength: 'Strength',
  stamina: 'Stamina', reflexes: 'Reflexes', handling: 'Handling', distribution: 'Distribution',
};

export function PlayerScreen({ route }: Props) {
  const { career, version, refresh } = useGame();
  const { playerId } = route.params;

  const player = career?.world.players.get(playerId);
  const club = useMemo(
    () => career ? allClubs(career.world).find((c) => c.squad.some((p) => p.id === playerId)) : undefined,
    [career, playerId, version],
  );

  if (!career || !player) {
    return (
      <View style={styles.container}>
        <Text style={styles.missing}>This player has left the game.</Text>
      </View>
    );
  }

  const ability = currentAbility(player);
  const report = scoutReport(career, player);
  const scouts = scoutsAvailable(career);
  const loan = loanStatus(career, player.id);
  const { status } = player;
  const isOwn = club?.id === career.managedClubId;
  // Goalkeeping numbers are noise for an outfielder; show them last and muted.
  const groups = player.position === 'GK' ? [GROUPS[3]!, ...GROUPS.slice(0, 3)] : GROUPS;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card>
        <View style={styles.header}>
          <View style={[styles.positionChip, { borderColor: positionColor(player.position) }]}>
            <Text style={[styles.positionText, { color: positionColor(player.position) }]}>
              {player.position}
            </Text>
          </View>
          <View style={styles.identity}>
            <Text style={styles.name} numberOfLines={1}>
              {player.displayName}
            </Text>
            <Text style={styles.meta}>
              {player.age} · {player.nationality} · {club?.name ?? 'Free agent'}
            </Text>
          </View>
          <Text style={[styles.ability, { color: ratingColor(ability) }]}>{ability.toFixed(0)}</Text>
        </View>
      </Card>

      {loan ? (
        <Card style={styles.loanCard}>
          <Text style={styles.loanText}>
            {loan.kind === 'out'
              ? `On loan at ${loan.otherClub?.name ?? 'another club'} until the end of the season.`
              : `On loan from ${loan.otherClub?.name ?? 'another club'}. He is not yours to sell.`}
          </Text>
        </Card>
      ) : null}

      <SectionTitle>Scouting report</SectionTitle>
      <Card>
        <View style={styles.reportHeader}>
          <Text style={styles.reportRange}>
            {report.low === report.high ? report.high : `${report.low}–${report.high}`}
          </Text>
          <Badge
            label={report.label}
            color={report.confidence > 0.6 ? colors.accent : report.confidence > 0.3 ? colors.gold : colors.muted}
          />
        </View>
        <Text style={styles.reportNote}>
          {report.high - report.low <= 6
            ? 'We know what he is.'
            : report.low > ability + 6
              ? 'There is clearly more to come.'
              : 'Hard to say how much further he goes.'}
        </Text>
        <Divider />
        <KeyValue label="Market price" value={formatMoney(marketValue(player))} />
        <KeyValue
          label="Worth on our reading"
          value={formatMoney(scoutValuation(career, player))}
          tint={scoutValuation(career, player) > marketValue(player) ? colors.accent : colors.muted}
        />
        {report.confidence < 0.85 ? (
          <Button
            label={scouts > 0 ? `Send a scout (${scouts} free)` : 'No scouts free this season'}
            variant="secondary"
            disabled={scouts === 0}
            style={styles.scout}
            onPress={() => {
              scoutPlayer(career, player.id);
              refresh();
            }}
          />
        ) : null}
      </Card>

      {isOwn ? (
        <>
          <SectionTitle>Condition</SectionTitle>
          <Card>
            <View style={styles.conditionRow}>
              <StatBar
                label="Fitness"
                value={status.condition}
                color={conditionColor(status.condition)}
                width={100}
              />
              <StatBar label="Morale" value={status.morale} color={colors.info} width={100} />
              <View style={styles.formBox}>
                <Text style={styles.formLabel}>FORM</Text>
                <Text style={[styles.formValue, { color: formColor(status.form) }]}>
                  {status.form > 0 ? `+${status.form.toFixed(1)}` : status.form.toFixed(1)}
                </Text>
              </View>
            </View>
            {status.injuryMatches > 0 || status.suspensionMatches > 0 ? (
              <>
                <Divider />
                <Badge
                  label={
                    status.injuryMatches > 0
                      ? `Injured — out ${status.injuryMatches} matches`
                      : `Suspended — out ${status.suspensionMatches} matches`
                  }
                  color={status.injuryMatches > 0 ? colors.danger : colors.warn}
                />
              </>
            ) : null}
          </Card>

          <SectionTitle>This season</SectionTitle>
          <Card>
            <KeyValue label="Appearances" value={`${status.appearances}`} />
            <KeyValue label="Minutes" value={`${status.minutes}`} />
            <KeyValue label="Goals" value={`${status.goals}`} />
            <KeyValue label="Assists" value={`${status.assists}`} />
            <KeyValue
              label="Cards"
              value={`${status.yellowCards} yellow${status.redCards ? `, ${status.redCards} red` : ''}`}
            />
          </Card>

          <SectionTitle>Contract</SectionTitle>
          <Card>
            <KeyValue label="Wage" value={`${formatMoney(player.contract.wage)}/wk`} />
            <KeyValue
              label="Years remaining"
              value={`${player.contract.yearsRemaining}`}
              tint={player.contract.yearsRemaining <= 1 ? colors.warn : undefined}
            />
          </Card>
        </>
      ) : null}

      <SectionTitle>Attributes</SectionTitle>
      {groups.map((group) => (
        <View key={group.title}>
          <Text style={styles.groupTitle}>{group.title}</Text>
          <Card style={styles.groupCard}>
            <View style={styles.attributeGrid}>
              {group.keys.map((key) => (
                <AttributeCell key={key} label={LABELS[key]} value={player.attributes[key]} />
              ))}
            </View>
          </Card>
        </View>
      ))}
    </ScrollView>
  );
}

function AttributeCell({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.attributeCell}>
      <StatBar label={label} value={value} color={ratingColor(value)} width={158} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  missing: { color: colors.muted, padding: spacing.lg, fontStyle: 'italic' },
  header: { flexDirection: 'row', alignItems: 'center' },
  positionChip: {
    borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3,
    minWidth: 38, alignItems: 'center',
  },
  positionText: { fontSize: 12, fontWeight: '800' },
  identity: { flex: 1, marginHorizontal: spacing.sm, minWidth: 0 },
  name: { color: colors.text, fontSize: 18, fontWeight: '700' },
  meta: { color: colors.faint, fontSize: 12, marginTop: 2 },
  ability: { fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] },
  reportHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reportRange: { color: colors.text, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] },
  scout: { marginTop: spacing.md },
  loanCard: { marginTop: spacing.sm, borderColor: colors.info },
  loanText: { color: colors.text, fontSize: 13 },
  reportNote: { color: colors.muted, fontSize: 12, marginTop: 4, fontStyle: 'italic' },
  conditionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, flexWrap: 'wrap' },
  formBox: { minWidth: 50 },
  formLabel: {
    color: colors.faint, fontSize: 9, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  formValue: { fontSize: 15, fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] },
  groupTitle: {
    color: colors.muted, fontSize: 11, fontWeight: '700',
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4, marginTop: spacing.sm,
  },
  groupCard: { marginBottom: spacing.xs },
  attributeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  attributeCell: { minWidth: 0 },
});
