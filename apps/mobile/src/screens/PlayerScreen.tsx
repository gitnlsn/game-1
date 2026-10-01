import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  scoutCapacity,
  appraiseTarget,
  plannedFor,
  plannedMoves,
  planMove,
  setListing,
  transferWindow,
  unplanMove,
  type Career,
  type TrainingFocus,
  POSITION_WEIGHTS,
  TRAINING_FOCUS_KEYS,
  progressionOf,
  seasonChange,
  setTrainingFocus,
  trainingFocus,
  managedClub,
  ownsPlayer,
  isShortlisted,
  toggleShortlist,
  type AttributeKey,
  type Player,
} from '@eleven-deep/engine';
import { Badge, Button, Card, ChipRow, Divider, KeyValue, SectionTitle, Segmented, StatBar } from '../components/ui';
import { ProgressionChart } from '../components/ProgressionChart';
import { RenewDialog } from '../components/RenewDialog';
import { plannedLabel } from '../game/moveText';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
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
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
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
  // Out on loan he is not at the club, but he is still yours.
  const owned = ownsPlayer(career, player);
  const shortlisted = isShortlisted(career, player.id);
  const curve = progressionOf(career, player.id);
  const change = owned ? seasonChange(career, player) : undefined;
  const focus = trainingFocus(career, player.id);
  // Goalkeeping numbers are noise for an outfielder; show them last and muted.
  const groups = player.position === 'GK' ? [GROUPS[3]!, ...GROUPS.slice(0, 3)] : GROUPS;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: spacing.xl * 2 + insets.bottom }]}
    >
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
          {!owned ? (
            <Pressable
              onPress={() => {
                toggleShortlist(career, player.id);
                refresh();
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={shortlisted ? 'Remove from shortlist' : 'Add to shortlist'}
              accessibilityState={{ selected: shortlisted }}
              style={styles.star}
            >
              <Text style={[styles.starText, shortlisted ? styles.starOn : null]}>
                {shortlisted ? '★' : '☆'}
              </Text>
            </Pressable>
          ) : null}
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

      <PlayerActions
        career={career}
        player={player}
        isOwn={isOwn && !loan}
        owned={owned}
        onChange={refresh}
        onReview={() => navigation.navigate('windowPlan')}
      />

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
        <Text style={styles.reportExplain}>
          The range is your staff's estimate of how good he could become. A scouting trip narrows
          it; you have {scouts} of {scoutCapacity(managedClub(career).reputation)} left this season.
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

      <SectionTitle>Progression</SectionTitle>
      <Card>
        {curve.length >= 2 ? (
          <>
            <ProgressionChart points={curve} />
            {change !== undefined ? (
              <Text style={styles.reportExplain}>
                {Math.abs(change) < 0.05
                  ? 'No change in ability this season yet.'
                  : `${change > 0 ? '+' : ''}${change.toFixed(1)} ability this season.`}
              </Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.reportExplain}>
            {owned || shortlisted
              ? 'Players develop a little every month. Come back after a few matches to see his curve.'
              : 'Shortlist him to follow how he develops.'}
          </Text>
        )}
      </Card>

      {owned ? (
        <>
          <SectionTitle>Training</SectionTitle>
          <Card>
            <ChipRow
              options={FOCUS_OPTIONS.filter((o) =>
                player.position === 'GK' ? o.value !== 'finishing' : o.value !== 'goalkeeping',
              )}
              value={focus}
              onChange={(value) => {
                setTrainingFocus(career, player.id, value);
                refresh();
              }}
            />
            <Text style={styles.actionNote}>{focusNote(player, focus)}</Text>
          </Card>
        </>
      ) : null}

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

const FOCUS_OPTIONS: readonly { value: TrainingFocus; label: string }[] = [
  { value: 'balanced', label: 'Balanced' },
  { value: 'finishing', label: 'Finishing' },
  { value: 'passing', label: 'Passing' },
  { value: 'defending', label: 'Defending' },
  { value: 'physical', label: 'Physical' },
  { value: 'aerial', label: 'Aerial' },
  { value: 'goalkeeping', label: 'Goalkeeping' },
];

/** What a focus does for this player, including when it costs him. */
function focusNote(player: Player, focus: TrainingFocus): string {
  if (focus === 'balanced') {
    return 'He works on everything his position needs. Growth is spread evenly.';
  }
  const keys = TRAINING_FOCUS_KEYS[focus];
  const names = keys.map((k) => LABELS[k].toLowerCase()).join(', ');
  const weights = POSITION_WEIGHTS[player.position];
  const off = keys.filter((k) => weights[k] === undefined);
  const base = `His ${names} grow faster; the rest of his game more slowly.`;
  if (off.length === 0) return `${base} How much he grows overall does not change.`;
  return (
    `${base} ${off.map((k) => LABELS[k]).join(' and ')} ${off.length === 1 ? 'is' : 'are'} not part of ` +
    `a ${player.position}'s game, so some of his growth goes where it will not show in his rating.`
  );
}

const LISTING_OPTIONS = [
  { value: 'none', label: 'Not listed' },
  { value: 'transfer', label: 'For sale' },
  { value: 'loan', label: 'For loan' },
] as const;

/**
 * What you can do about a player from his own page. For your players: put him on
 * the market, and in the window plan his release or a new contract. For anyone
 * else in the window: plan to sign him.
 */
function PlayerActions({
  career,
  player,
  isOwn,
  owned,
  onChange,
  onReview,
}: {
  career: Career;
  player: Player;
  isOwn: boolean;
  owned: boolean;
  onChange: () => void;
  onReview: () => void;
}) {
  const [renewing, setRenewing] = useState(false);
  const windowOpen = transferWindow(career) !== undefined;
  const moves = windowOpen ? plannedFor(career, { playerId: player.id }) : [];

  if (!isOwn) {
    if (owned || !windowOpen) return null;
    const listing = appraiseTarget(career.world, career.managedClubId, player.id);
    if (!listing) return null;
    const reachable = listing.forSale && listing.wouldJoin && listing.affordable;
    return (
      <>
        <SectionTitle>Transfer window</SectionTitle>
        <Card>
          <KeyValue
            label="Asking price"
            value={listing.askingPrice === 0 ? 'Free' : formatMoney(listing.askingPrice)}
            bold
          />
          <KeyValue label="Wages" value={`${formatMoney(listing.expectedWage)}/wk`} />
          {moves.length > 0 ? (
            <View style={styles.plannedRow}>
              <Badge label={plannedLabel(moves[0]!)} color={colors.info} />
              <Button label="Review plan" variant="secondary" onPress={onReview} />
            </View>
          ) : (
            <Button
              label={
                !listing.forSale
                  ? 'His club will not sell'
                  : !listing.wouldJoin
                    ? 'He would not join you'
                    : !listing.affordable
                      ? 'Beyond your budget'
                      : 'Add to plan'
              }
              disabled={!reachable}
              style={styles.scout}
              onPress={() => {
                planMove(career, { kind: 'buy', playerId: player.id, fee: listing.askingPrice });
                onChange();
              }}
            />
          )}
        </Card>
      </>
    );
  }

  const listingKind = career.listings[player.id];

  return (
    <>
      <SectionTitle>Actions</SectionTitle>
      <Card>
        <Text style={styles.actionLabel}>On the market</Text>
        <Segmented
          fill
          options={LISTING_OPTIONS}
          value={listingKind ?? 'none'}
          onChange={(value) => {
            setListing(career, player.id, value === 'none' ? undefined : value);
            onChange();
          }}
        />
        <Text style={styles.actionNote}>
          {listingKind === 'transfer'
            ? windowOpen
              ? 'Listed: more clubs bid, at a little under the usual price. Their bids are on the Offers tab.'
              : 'Listed: when the window opens, more clubs will bid for him, at a little under the usual price.'
            : listingKind === 'loan'
              ? 'Listed for loan: when the season starts he goes to the smallest club that will play him, unless you loan him yourself.'
              : 'List him for sale to bring in buyers, or for loan to get him games.'}
        </Text>

        {windowOpen ? (
          <>
            <Divider />
            <Text style={styles.actionLabel}>This window</Text>
            {moves.length > 0 ? (
              moves.map((move) => (
                <View key={move.id} style={styles.plannedRow}>
                  <Badge label={plannedLabel(move)} color={colors.info} />
                  <Pressable
                    onPress={() => {
                      unplanMove(career, move.id);
                      onChange();
                    }}
                    hitSlop={8}
                    accessibilityRole="button"
                  >
                    <Text style={styles.undo}>Undo</Text>
                  </Pressable>
                </View>
              ))
            ) : (
              <View style={styles.actionButtons}>
                <Button
                  label="Plan release"
                  variant="danger"
                  style={styles.actionButton}
                  onPress={() => {
                    planMove(career, { kind: 'release', playerId: player.id });
                    onChange();
                  }}
                />
                <Button
                  label="Renew…"
                  variant="secondary"
                  style={styles.actionButton}
                  onPress={() => setRenewing(true)}
                />
              </View>
            )}
            {plannedMoves(career).length > 0 ? (
              <Button label="Review your plan" variant="secondary" style={styles.scout} onPress={onReview} />
            ) : null}
          </>
        ) : null}
      </Card>
      {renewing ? (
        <RenewDialog
          player={player}
          onCancel={() => setRenewing(false)}
          onPlan={(wage, years) => {
            planMove(career, { kind: 'renew', playerId: player.id, wage, years });
            setRenewing(false);
            onChange();
          }}
        />
      ) : null}
    </>
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
  actionLabel: {
    color: colors.faint, fontSize: 10, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.5, marginBottom: spacing.xs,
  },
  actionNote: { color: colors.faint, fontSize: 11, marginTop: spacing.sm, lineHeight: 16 },
  actionButtons: { flexDirection: 'row', gap: spacing.sm },
  actionButton: { flex: 1 },
  plannedRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.sm, gap: spacing.sm,
  },
  undo: { color: colors.info, fontSize: 13, fontWeight: '700' },
  star: { paddingHorizontal: spacing.sm },
  starText: { color: colors.faint, fontSize: 22 },
  starOn: { color: colors.gold },
  reportExplain: { color: colors.faint, fontSize: 11, marginTop: spacing.xs, lineHeight: 16 },
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
