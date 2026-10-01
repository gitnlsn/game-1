import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  currentAbility,
  formatMoney,
  isAvailable,
  managedClub,
  marketValue,
  POSITION_GROUP,
  POSITIONS,
  scoutReport,
  squadAlerts,
  squadDepth,
  squadMembers,
  seasonChange,
  trainingFocus,
  type Career,
  type ListingKind,
  type Player,
  type TrainingFocus,
  type PositionGroup,
  type PotentialEstimate,
  type SquadMember,
  type SquadRole,
} from '@eleven-deep/engine';
import { Badge, Card, ScreenHeader, SectionTitle, Segmented } from '../components/ui';
import { colors, conditionColor, positionColor, radius, ratingColor, spacing } from '../theme';
import { useGame } from '../game/GameContext';
import type { RootStackParamList } from '../nav/routes';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type ViewKey = 'position' | 'roles' | 'contracts' | 'development';

const VIEWS: { value: ViewKey; label: string }[] = [
  { value: 'position', label: 'Position' },
  { value: 'roles', label: 'Roles' },
  { value: 'contracts', label: 'Contracts' },
  { value: 'development', label: 'Growth' },
];

const GROUP_NAMES: Record<PositionGroup, string> = {
  GK: 'Goalkeepers',
  DEF: 'Defenders',
  MID: 'Midfielders',
  FWD: 'Forwards',
};

export const ROLE_INFO: Record<SquadRole, { label: string; color: string; blurb: string }> = {
  key: { label: 'Key', color: colors.accent, blurb: 'Your strongest eleven.' },
  rotation: { label: 'Rotation', color: colors.info, blurb: 'Next in: the bench of that eleven.' },
  prospect: { label: 'Prospect', color: colors.gold, blurb: 'Young, with clearly more to come.' },
  backup: { label: 'Backup', color: colors.muted, blurb: 'Cover the squad needs, rarely in the matchday squad.' },
  surplus: { label: 'Surplus', color: colors.warn, blurb: 'More of him than you need. Sell, loan or release.' },
};

const ROLE_ORDER: SquadRole[] = ['key', 'rotation', 'prospect', 'backup', 'surplus'];

interface Section {
  title: string;
  note?: string;
  members: SquadMember[];
}

function buildSections(career: Career, view: ViewKey, members: SquadMember[]): Section[] {
  const byAbility = (a: SquadMember, b: SquadMember) =>
    currentAbility(b.player) - currentAbility(a.player);

  switch (view) {
    case 'position': {
      const depth = squadDepth(career);
      return depth.map((d) => ({
        title: GROUP_NAMES[d.group],
        note: `${d.have} for ${d.starting} starting place${d.starting === 1 ? '' : 's'} · a full squad carries ${d.need}`,
        members: members
          .filter((m) => POSITION_GROUP[m.player.position] === d.group)
          .sort(
            (a, b) =>
              POSITIONS.indexOf(a.player.position) - POSITIONS.indexOf(b.player.position) ||
              byAbility(a, b),
          ),
      }));
    }
    case 'roles':
      return ROLE_ORDER.map((role) => ({
        title: ROLE_INFO[role].label,
        note: ROLE_INFO[role].blurb,
        members: members.filter((m) => m.role === role).sort(byAbility),
      })).filter((section) => section.members.length > 0);
    case 'contracts':
      return [
        {
          title: 'By contract',
          note: 'Shortest first. In his last year, a player can walk away for nothing.',
          members: [...members].sort(
            (a, b) =>
              a.player.contract.yearsRemaining - b.player.contract.yearsRemaining ||
              b.player.contract.wage - a.player.contract.wage,
          ),
        },
      ];
    case 'development': {
      const room = (m: SquadMember) => scoutReport(career, m.player).high - currentAbility(m.player);
      return [
        {
          title: 'Room to grow',
          note: 'Players 23 and under, most to come first. Minutes and coaching are what bring it out.',
          members: members.filter((m) => m.player.age <= 23).sort((a, b) => room(b) - room(a)),
        },
      ];
    }
  }
}

const FOCUS_NAMES: Record<TrainingFocus, string> = {
  balanced: 'Balanced',
  finishing: 'Finishing',
  passing: 'Passing',
  defending: 'Defending',
  physical: 'Physical',
  aerial: 'Aerial',
  goalkeeping: 'Goalkeeping',
};

function growthLine(career: Career, player: Player): string {
  const change = seasonChange(career, player);
  const moved =
    change === undefined || Math.abs(change) < 0.05
      ? 'No change yet this season'
      : `${change > 0 ? '+' : ''}${change.toFixed(1)} this season`;
  return `${moved} · Training: ${FOCUS_NAMES[trainingFocus(career, player.id)]}`;
}

export function SquadScreen() {
  const navigation = useNavigation<Nav>();
  const { career, version } = useGame();
  const [view, setView] = useState<ViewKey>('position');

  const club = career ? managedClub(career) : undefined;

  const members = useMemo(
    () => (career ? squadMembers(career) : []),
    // version changes whenever the engine mutates the world in place.
    [career, version],
  );
  const alerts = useMemo(() => (career ? squadAlerts(career) : []), [career, version]);
  const sections = useMemo(
    () => (career ? buildSections(career, view, members) : []),
    [career, view, members],
  );

  if (!club || !career) return null;

  // Cheap enough on a squad of ~25 to sit in the render, which is how the club
  // screen counts its injuries too.
  const unavailable = club.squad.filter((p) => !isAvailable(p)).length;
  const averageAge = club.squad.length
    ? club.squad.reduce((sum, p) => sum + p.age, 0) / club.squad.length
    : 0;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          title="Squad"
          subtitle="Who you have, where they stand, and what needs doing."
          metrics={[
            { label: 'Players', value: `${club.squad.length}` },
            { label: 'Avg age', value: averageAge.toFixed(1) },
            {
              label: 'Unavailable',
              value: unavailable === 0 ? 'None' : `${unavailable}`,
              // Same thresholds the club screen reads injuries on.
              tint:
                unavailable > 3 ? colors.danger : unavailable > 0 ? colors.warn : colors.accent,
            },
          ]}
        />

        {alerts.length > 0 ? (
          <Card style={styles.alerts}>
            <Text style={styles.alertsTitle}>Needs your attention</Text>
            {alerts.map((alert, index) => (
              <Pressable
                key={`${alert.kind}-${alert.playerId ?? index}`}
                disabled={!alert.playerId}
                onPress={() => alert.playerId && navigation.navigate('player', { playerId: alert.playerId })}
                accessibilityRole={alert.playerId ? 'button' : 'text'}
              >
                <Text style={styles.alertText}>• {alert.message}</Text>
              </Pressable>
            ))}
          </Card>
        ) : null}

        <View style={styles.viewRow}>
          <Segmented fill options={VIEWS} value={view} onChange={setView} style={styles.segmented} />
        </View>
        <Pressable
          onPress={() => navigation.navigate('scouting')}
          accessibilityRole="button"
          style={styles.scoutLink}
        >
          <Text style={styles.scoutLinkText}>
            Scouting and shortlist · {career.shortlist.length} watched ›
          </Text>
        </Pressable>

        {sections.map((section) => (
          <View key={section.title} style={styles.section}>
            <SectionTitle>{section.title}</SectionTitle>
            {section.note ? <Text style={styles.sectionNote}>{section.note}</Text> : null}
            {section.members.map((member) => (
              <PlayerRow
                key={member.player.id}
                member={member}
                report={scoutReport(career, member.player)}
                listing={career.listings[member.player.id]}
                {...(view === 'development' ? { growth: growthLine(career, member.player) } : {})}
                onPress={() => navigation.navigate('player', { playerId: member.player.id })}
              />
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function PlayerRow({
  member,
  report,
  listing,
  growth,
  onPress,
}: {
  member: SquadMember;
  report: PotentialEstimate;
  listing: ListingKind | undefined;
  /** This season's change and training, for the growth view. */
  growth?: string;
  onPress: () => void;
}) {
  const { player, role, expiring, loanedTo } = member;
  const ability = currentAbility(player);
  const { status } = player;

  const unavailable =
    status.injuryMatches > 0
      ? { label: `INJ ${status.injuryMatches}`, color: colors.danger }
      : status.suspensionMatches > 0
        ? { label: `BAN ${status.suspensionMatches}`, color: colors.warn }
        : undefined;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${player.displayName}, ${player.position}, ability ${currentAbility(player).toFixed(0)}`}
    >
      <Card style={styles.playerCard}>
      <View style={styles.playerTop}>
        <View style={[styles.positionChip, { borderColor: positionColor(player.position) }]}>
          <Text style={[styles.positionText, { color: positionColor(player.position) }]}>
            {player.position}
          </Text>
        </View>

        <View style={styles.playerIdentity}>
          <Text style={styles.playerName} numberOfLines={1}>
            {player.displayName}
          </Text>
          <Text style={styles.playerMeta}>
            {player.age} · {player.nationality} · {formatMoney(marketValue(player))} ·{' '}
            {formatMoney(player.contract.wage)}/wk
          </Text>
        </View>

        <View style={styles.abilityBox}>
          <Text style={[styles.abilityValue, { color: ratingColor(ability) }]}>
            {ability.toFixed(0)}
          </Text>
          {/*
            A range, never a number. How good a player might become is something
            you form a view on, not something you read off him.
          */}
          <Text
            style={[styles.potentialValue, { opacity: 0.45 + report.confidence * 0.55 }]}
            numberOfLines={1}
          >
            {report.low === report.high ? `${report.high}` : `${report.low}–${report.high}`}
          </Text>
        </View>
      </View>

      <View style={styles.playerBottom}>
        <View style={styles.conditionWrap}>
          <Text style={styles.smallLabel}>Fitness</Text>
          <View style={styles.conditionTrack}>
            <View
              style={[
                styles.conditionFill,
                {
                  width: `${Math.max(2, Math.min(100, status.condition))}%`,
                  backgroundColor: conditionColor(status.condition),
                },
              ]}
            />
          </View>
        </View>

        <View style={styles.playerStats}>
          <MiniStat label="Apps" value={`${status.appearances}`} />
          <MiniStat label="Gls" value={`${status.goals}`} />
          <MiniStat label="Ast" value={`${status.assists}`} />
          <MiniStat
            label="Cards"
            value={`${status.yellowCards}${status.redCards > 0 ? `/${status.redCards}` : ''}`}
          />
        </View>

        {unavailable ? <Badge label={unavailable.label} color={unavailable.color} /> : null}
      </View>

      <View style={styles.tags}>
        <Badge label={ROLE_INFO[role].label} color={ROLE_INFO[role].color} />
        {expiring ? (
          <Badge
            label={player.contract.yearsRemaining === 0 ? 'Out of contract' : 'Last year'}
            color={colors.danger}
          />
        ) : null}
        {loanedTo ? <Badge label={`On loan · ${loanedTo}`} color={colors.info} /> : null}
        {listing ? (
          <Badge label={listing === 'transfer' ? 'Transfer listed' : 'Loan listed'} color={colors.warn} />
        ) : null}
      </View>
      {growth ? <Text style={styles.growth}>{growth}</Text> : null}
      </Card>
    </Pressable>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.smallLabel}>{label}</Text>
      <Text style={styles.miniStatValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  alerts: { marginBottom: spacing.md, borderColor: colors.warn },
  alertsTitle: { color: colors.warn, fontSize: 12, fontWeight: '800', marginBottom: spacing.xs },
  alertText: { color: colors.text, fontSize: 12, lineHeight: 18 },
  viewRow: { marginBottom: spacing.xs },
  segmented: {},
  scoutLink: { paddingVertical: spacing.sm, alignSelf: 'flex-end' },
  scoutLinkText: { color: colors.info, fontSize: 12, fontWeight: '600' },
  section: { marginTop: spacing.sm },
  sectionNote: { color: colors.faint, fontSize: 11, marginBottom: spacing.sm, marginTop: -2 },
  growth: { color: colors.muted, fontSize: 11, marginTop: spacing.xs, fontVariant: ['tabular-nums'] },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  playerCard: { marginBottom: spacing.sm, padding: spacing.sm },
  playerTop: { flexDirection: 'row', alignItems: 'center' },
  positionChip: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
    minWidth: 34,
    alignItems: 'center',
  },
  positionText: { fontSize: 11, fontWeight: '800' },
  playerIdentity: { flex: 1, marginHorizontal: spacing.sm, minWidth: 0 },
  playerName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  playerMeta: { color: colors.faint, fontSize: 11, marginTop: 1 },
  abilityBox: { alignItems: 'flex-end', minWidth: 44 },
  abilityValue: { fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  potentialValue: { color: colors.faint, fontSize: 10, fontVariant: ['tabular-nums'] },
  playerBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  conditionWrap: { width: 78 },
  conditionTrack: {
    height: 5,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 3,
  },
  conditionFill: { height: 5, borderRadius: 3 },
  playerStats: { flexDirection: 'row', flex: 1, gap: spacing.md },
  miniStat: { minWidth: 26 },
  miniStatValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  smallLabel: {
    color: colors.faint,
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
