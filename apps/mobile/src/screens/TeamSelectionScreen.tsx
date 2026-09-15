import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  abilityIn,
  computeTeamRating,
  currentTeamSheet,
  isAvailable,
  managedClub,
  positionFamiliarity,
  resolveTeamSheet,
  setTeamSheet,
  suggestedTeamSheet,
  setTactics,
  tactics as currentTactics,
  BALANCED,
  describeTactics,
  tacticShapes,
  TACTIC_AXES,
  FORMATIONS,
  POSITION_GROUP,
  type Career,
  type Player,
  type Position,
  type TeamSheet,
  type Tactics,
} from '@prancheta/engine';
import { Badge, Button, Card, ChipRow, SectionTitle } from '../components/ui';
import { colors, conditionColor, positionColor, ratingColor, spacing } from '../theme';
import { useGame } from '../game/GameContext';
import type { RootStackParamList } from '../nav/routes';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const FORMATION_OPTIONS = Object.keys(FORMATIONS).map((key) => ({ value: key, label: key }));

/**
 * Three positions per axis, not five. The engine accepts anything from -2 to +2,
 * but these three are the ones the non-dominance harness actually measures --
 * offering settings nobody has checked for dominance would be offering a trap.
 */
const AXIS_OPTIONS = TACTIC_AXES.map((axis) => ({
  axis,
  options: [
    { value: '-2', label: axis.low },
    { value: '0', label: 'Balanced' },
    { value: '2', label: axis.high },
  ],
}));
const GROUP_ORDER: Record<string, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

/** Keeps the manager's players when the shape changes, re-slotting them by best fit. */
function reslot(career: Career, sheet: TeamSheet, formation: string): TeamSheet {
  const club = managedClub(career);
  const shape = FORMATIONS[formation]!;
  const squad = new Map(club.squad.map((p) => [p.id, p]));
  const keep = sheet.starters.filter((id): id is string => !!id && squad.has(id));

  const used = new Set<string>();
  const starters: (string | undefined)[] = shape.map((position) => {
    let best: string | undefined;
    let bestScore = -Infinity;
    for (const id of keep) {
      if (used.has(id)) continue;
      const player = squad.get(id)!;
      const score =
        abilityIn(player.attributes, position) * positionFamiliarity(player.position, position);
      if (score > bestScore) {
        bestScore = score;
        best = id;
      }
    }
    if (best) used.add(best);
    return best;
  });

  return { ...sheet, formation, starters };
}

export function TeamSelectionScreen() {
  const navigation = useNavigation<Nav>();
  const { career, busy, playRound, refresh, settings, startLive } = useGame();

  const [sheet, setSheet] = useState<TeamSheet | undefined>(() =>
    career ? currentTeamSheet(career) : undefined,
  );
  const [selected, setSelected] = useState<{ slot: number } | { bench: string } | undefined>();
  /*
   * Instructions commit as soon as they are changed, where the eleven commits at
   * kick-off. That difference is the point rather than an inconsistency: how the
   * side is set up is a standing decision that carries into next week, while the
   * team is picked for one match.
   */
  const [shape, setShape] = useState<Tactics | undefined>(() =>
    career ? currentTactics(career) : undefined,
  );

  const club = career ? managedClub(career) : undefined;

  const { lineup, issues } = useMemo(
    () => (club ? resolveTeamSheet(club, sheet) : { lineup: undefined, issues: [] }),
    [club, sheet],
  );

  /*
   * The readout has the instructions folded in, because otherwise they are
   * invisible: the engine applies them at kick-off, so picking "Attacking" moved
   * nothing on screen and the whole section read as decoration. These are the
   * same multipliers the match will use.
   */
  const rating = useMemo(() => {
    if (!lineup) return undefined;
    const base = computeTeamRating(lineup);
    const shapes = tacticShapes(shape ?? BALANCED);
    return {
      ...base,
      attack: base.attack * shapes.attack,
      midfield: base.midfield * shapes.control,
      defence: base.defence * shapes.defence,
    };
  }, [lineup, shape]);

  const benchAndRest = useMemo(() => {
    if (!club || !lineup) return [];
    const starting = new Set(lineup.slots.map((s) => s.player.id));
    return club.squad
      .filter((p) => !starting.has(p.id))
      .sort((a, b) => Number(isAvailable(b)) - Number(isAvailable(a)));
  }, [club, lineup]);

  const swapInto = useCallback(
    (slotIndex: number, playerId: string) => {
      setSheet((current) => {
        if (!current) return current;
        const starters = [...current.starters];
        const existingAt = starters.indexOf(playerId);
        const displaced = starters[slotIndex];
        starters[slotIndex] = playerId;
        // If he was already in the XI, the two simply trade places.
        if (existingAt >= 0 && existingAt !== slotIndex) starters[existingAt] = displaced;
        return { ...current, starters };
      });
      setSelected(undefined);
    },
    [],
  );

  const onSlotPress = useCallback(
    (index: number, playerId: string) => {
      if (!selected) return setSelected({ slot: index });
      if ('slot' in selected) {
        if (selected.slot === index) return setSelected(undefined);
        // Trade the two slots.
        setSheet((current) => {
          if (!current) return current;
          const starters = [...current.starters];
          const a = starters[selected.slot];
          starters[selected.slot] = starters[index];
          starters[index] = a;
          return { ...current, starters };
        });
        return setSelected(undefined);
      }
      swapInto(index, selected.bench);
      void playerId;
    },
    [selected, swapInto],
  );

  const onBenchPress = useCallback(
    (player: Player) => {
      if (!isAvailable(player)) return;
      if (selected && 'slot' in selected) return swapInto(selected.slot, player.id);
      setSelected((current) =>
        current && 'bench' in current && current.bench === player.id ? undefined : { bench: player.id },
      );
    },
    [selected, swapInto],
  );

  if (!career || !club || !lineup || !sheet) return null;

  const kickOff = async () => {
    setTeamSheet(career, sheet);

    if (settings.matchMode === 'live') {
      // Started AFTER the sheet is stored, or the eleven just picked is not the
      // eleven that takes the pitch.
      if (await startLive()) navigation.replace('liveMatch');
      return;
    }

    const outcome = await playRound();
    if (outcome?.ownMatch) {
      navigation.replace('matchResult', { round: career.season.nextRound - 1 });
    } else {
      navigation.goBack();
    }
  };

  // Group the eleven into pitch rows, keepers at the bottom of the screen.
  const rows = lineup.slots
    .map((slot, index) => ({ slot, index }))
    .reduce<{ group: string; entries: { slot: (typeof lineup.slots)[number]; index: number }[] }[]>(
      (acc, entry) => {
        const group = POSITION_GROUP[entry.slot.position];
        const row = acc.find((r) => r.group === group);
        if (row) row.entries.push(entry);
        else acc.push({ group, entries: [entry] });
        return acc;
      },
      [],
    )
    .sort((a, b) => (GROUP_ORDER[b.group] ?? 0) - (GROUP_ORDER[a.group] ?? 0));

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SectionTitle>Shape</SectionTitle>
        <ChipRow
          options={FORMATION_OPTIONS}
          value={sheet.formation}
          onChange={(formation) => {
            setSheet((current) => (current ? reslot(career, current, formation) : current));
            setSelected(undefined);
          }}
        />

        <SectionTitle>Instructions</SectionTitle>
        <Card style={styles.tacticsCard}>
          <Text style={styles.tacticsSummary}>{describeTactics(shape ?? currentTactics(career))}</Text>
          {AXIS_OPTIONS.map(({ axis, options }) => (
            <View key={axis.key} style={styles.axis}>
              <Text style={styles.axisLabel}>{axis.label}</Text>
              <ChipRow
                options={options}
                value={String((shape ?? currentTactics(career))[axis.key])}
                onChange={(value) => {
                  setShape(setTactics(career, { [axis.key]: Number(value) }));
                  // The engine mutates in place, so nothing is written to disk
                  // until something asks for it.
                  refresh();
                }}
              />
              <Text style={styles.axisNote}>{axis.note}</Text>
            </View>
          ))}
        </Card>

        {rating ? (
          <View style={styles.ratingRow}>
            <RatingPill label="Attack" value={rating.attack} />
            <RatingPill label="Midfield" value={rating.midfield} />
            <RatingPill label="Defence" value={rating.defence} />
            <RatingPill label="Keeper" value={rating.goalkeeping} />
          </View>
        ) : null}

        {issues.length > 0 ? (
          <Card style={styles.issues}>
            <Text style={styles.issuesText}>
              {issues.length} change{issues.length === 1 ? '' : 's'} forced — players unavailable or
              no longer here.
            </Text>
          </Card>
        ) : null}

        <SectionTitle>Starting eleven</SectionTitle>
        {rows.map((row) => (
          <View key={row.group} style={styles.pitchRow}>
            {row.entries.map(({ slot, index }) => (
              <SlotChip
                key={index}
                position={slot.position}
                player={slot.player}
                selected={!!selected && 'slot' in selected && selected.slot === index}
                onPress={() => onSlotPress(index, slot.player.id)}
              />
            ))}
          </View>
        ))}

        <SectionTitle>Rest of the squad</SectionTitle>
        {benchAndRest.map((player) => (
          <BenchRow
            key={player.id}
            player={player}
            selected={!!selected && 'bench' in selected && selected.bench === player.id}
            onPress={() => onBenchPress(player)}
          />
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.footerNote}>
          {selected
            ? 'Tap a player to swap'
            : `${lineup.slots.length} picked · avg ${(
                lineup.slots.reduce((s, x) => s + x.effectiveAbility, 0) / lineup.slots.length
              ).toFixed(0)}`}
        </Text>
        <View style={styles.footerActions}>
          <Button
            label="Auto pick"
            variant="secondary"
            onPress={() => {
              setSheet(suggestedTeamSheet(career, sheet.formation));
              setSelected(undefined);
            }}
            style={styles.footerButton}
          />
          <Button
            label={settings.matchMode === 'replay' ? 'Kick off' : 'Play match'}
            onPress={kickOff}
            loading={busy}
            style={styles.footerButton}
          />
        </View>
      </View>
    </View>
  );
}

function RatingPill({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.ratingPill}>
      <Text style={styles.ratingLabel}>{label}</Text>
      <Text style={[styles.ratingValue, { color: ratingColor(value) }]}>{value.toFixed(0)}</Text>
    </View>
  );
}

function SlotChip({
  position,
  player,
  selected,
  onPress,
}: {
  position: Position;
  player: Player;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${position} ${player.displayName}`}
      style={[styles.slot, selected ? styles.slotSelected : null]}
    >
      <Text style={[styles.slotPosition, { color: positionColor(position) }]}>{position}</Text>
      <Text style={styles.slotName} numberOfLines={1}>
        {player.lastName || player.displayName}
      </Text>
      <View style={styles.slotBar}>
        <View
          style={[
            styles.slotBarFill,
            {
              width: `${Math.max(4, player.status.condition)}%`,
              backgroundColor: conditionColor(player.status.condition),
            },
          ]}
        />
      </View>
    </Pressable>
  );
}

function BenchRow({
  player,
  selected,
  onPress,
}: {
  player: Player;
  selected: boolean;
  onPress: () => void;
}) {
  const available = isAvailable(player);
  return (
    <Pressable
      onPress={onPress}
      disabled={!available}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !available }}
      accessibilityLabel={`${player.position} ${player.displayName}`}
      style={[styles.benchRow, selected ? styles.benchRowSelected : null, !available ? styles.benchRowOut : null]}
    >
      <Text style={[styles.benchPosition, { color: positionColor(player.position) }]}>
        {player.position}
      </Text>
      <Text style={styles.benchName} numberOfLines={1}>
        {player.displayName}
      </Text>
      {!available ? (
        <Badge
          label={player.status.injuryMatches > 0 ? `INJ ${player.status.injuryMatches}` : `BAN ${player.status.suspensionMatches}`}
          color={player.status.injuryMatches > 0 ? colors.danger : colors.warn}
        />
      ) : (
        <Text style={styles.benchCondition}>{player.status.condition.toFixed(0)}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.lg },
  ratingRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.md },
  ratingPill: {
    flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: 6,
    paddingVertical: 6, alignItems: 'center', minWidth: 0,
  },
  ratingLabel: {
    color: colors.faint, fontSize: 9, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  ratingValue: { fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  issues: { marginTop: spacing.md, borderColor: colors.warn },
  tacticsCard: { marginTop: spacing.sm, gap: spacing.md },
  tacticsSummary: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  axis: { gap: spacing.xs },
  axisLabel: {
    color: colors.faint, fontSize: 9, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  axisNote: { color: colors.faint, fontSize: 11, fontStyle: 'italic' },
  issuesText: { color: colors.warn, fontSize: 12 },
  pitchRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.xs },
  slot: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1,
    borderColor: colors.border, paddingVertical: 6, paddingHorizontal: 4,
    alignItems: 'center', minWidth: 0,
  },
  slotSelected: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  slotPosition: { fontSize: 10, fontWeight: '800' },
  slotName: { color: colors.text, fontSize: 11, fontWeight: '600', marginTop: 1 },
  slotBar: {
    height: 3, backgroundColor: colors.surfaceAlt, borderRadius: 2,
    overflow: 'hidden', alignSelf: 'stretch', marginTop: 4,
  },
  slotBarFill: { height: 3, borderRadius: 2 },
  benchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 7, paddingHorizontal: spacing.sm, borderRadius: 6,
    borderWidth: 1, borderColor: 'transparent', backgroundColor: colors.surface,
    marginBottom: 3,
  },
  benchRowSelected: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  benchRowOut: { opacity: 0.45 },
  benchPosition: { fontSize: 10, fontWeight: '800', width: 28 },
  benchName: { color: colors.text, fontSize: 13, flex: 1 },
  benchCondition: {
    color: colors.muted, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'],
  },
  footer: {
    borderTopWidth: 1, borderTopColor: colors.border,
    backgroundColor: colors.surface, padding: spacing.md,
  },
  footerNote: { color: colors.muted, fontSize: 12, marginBottom: spacing.sm, textAlign: 'center' },
  footerActions: { flexDirection: 'row', gap: spacing.sm },
  footerButton: { flex: 1 },
});
