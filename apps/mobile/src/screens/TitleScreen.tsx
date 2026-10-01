import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import Lock from 'lucide-react-native/icons/lock';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Badge, Button, Card, SectionTitle, textStyles } from '../components/ui';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { usePaywall } from '../components/ProGate';
import { colors, radius, spacing } from '../theme';
import { ordinal } from '../format';
import { useGame } from '../game/GameContext';
import { careerSummary, type CareerSummary, type NextUp } from '../game/summary';
import { leaderboardProblem, playGamesAvailable, showLeaderboards } from '../game/playGames';
import type { LifetimeRecord } from '../game/lifetime';
import { usePro } from '../game/pro';
import { FREE_SLOTS, SLOT_COUNT, firstEmptySlot, type SlotIndex } from '../game/saves';
import type { MenuStackParamList } from '../nav/routes';

type Nav = NativeStackNavigationProp<MenuStackParamList>;

interface Kept {
  slot: number;
  summary: CareerSummary;
  savedAt: number;
  /** In a Pro slot, without Pro: kept, but not playable until resubscribing. */
  locked: boolean;
}

/**
 * Every career on the device, Continue first. The loaded one is described from
 * the career itself rather than its index entry, which is a save behind at
 * worst and absent altogether on a save from before slots.
 */
function keptCareers(
  slots: SlotIndex,
  loaded: { slot: number; summary: CareerSummary } | undefined,
  pro: boolean,
): Kept[] {
  const kept: Kept[] = [];
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const entry = slots.slots[slot];
    const summary = loaded?.slot === slot ? loaded.summary : entry?.summary;
    if (!summary) continue;
    kept.push({
      slot,
      summary,
      savedAt: loaded?.slot === slot ? Infinity : (entry?.savedAt ?? 0),
      locked: slot >= FREE_SLOTS && !pro,
    });
  }
  return kept.sort((a, b) => b.savedAt - a.savedAt);
}

export function TitleScreen() {
  const { career, continueCareer, lifetime, slots, activeSlot, openSlot, busy } = useGame();
  const pro = usePro();
  const navigation = useNavigation<Nav>();
  /** The slot a new career would replace, while that is being confirmed. */
  const [replacing, setReplacing] = useState<number | undefined>();
  const [picking, setPicking] = useState(false);
  const paywall = usePaywall();
  // Set only when a tap came to nothing, so the button is never silent.
  const [problem, setProblem] = useState<string | undefined>();
  // No navigator header here: this screen owns its own edge-to-edge insets.
  const insets = useSafeAreaInsets();

  const kept = keptCareers(
    slots,
    career ? { slot: activeSlot, summary: careerSummary(career) } : undefined,
    pro.active,
  );
  const [first, ...others] = kept;
  const usable = pro.active ? SLOT_COUNT : FREE_SLOTS;
  const empty = firstEmptySlot(new Set(kept.map((k) => k.slot)), usable);

  const open = (entry: Kept) => {
    if (!entry.locked) {
      void openSlot(entry.slot);
      return;
    }
    if (!pro.offered) return;
    paywall.show(
      `${entry.summary.clubName} is kept in a Pro save slot. Subscribe to carry on with it.`,
      () => void openSlot(entry.slot),
    );
  };

  const startNew = () => {
    if (empty !== undefined) {
      // Nothing is replaced, so there is nothing to confirm.
      navigation.navigate('newCareer', { slot: empty });
    } else if (usable === 1) {
      setReplacing(0);
    } else {
      setPicking(true);
    }
  };

  const replaced = kept.find((k) => k.slot === replacing);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: spacing.xl * 2 + insets.top, paddingBottom: spacing.xl + insets.bottom },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.wordmark}>ELEVEN DEEP</Text>
      <View style={styles.rule} />
      <Text style={[textStyles.subtitle, styles.tagline]}>
        A club, a squad and a season at a time.
      </Text>

      {first ? (
        <ContinueCard
          summary={first.summary}
          locked={first.locked}
          onPress={() => (first.slot === activeSlot && career && !first.locked ? continueCareer() : open(first))}
        />
      ) : null}

      {others.length > 0 ? (
        <>
          <SectionTitle
            right={pro.active ? <Text style={styles.count}>{kept.length} of {usable}</Text> : undefined}
          >
            Other careers
          </SectionTitle>
          <View style={styles.rows}>
            {others.map((entry) => (
              <CareerRow key={entry.slot} entry={entry} disabled={busy} onPress={() => open(entry)} />
            ))}
          </View>
        </>
      ) : null}

      {/* One row for every slot Pro would add, not a locked row per slot. */}
      {pro.offered && !pro.active ? (
        <Pressable
          onPress={() => paywall.show('Keep up to three careers on this phone and switch between them here.')}
          accessibilityRole="button"
          accessibilityLabel="Keep three careers at once with Pro"
          style={({ pressed }) => [styles.upsell, pressed ? styles.rowPressed : null]}
        >
          <Lock color={colors.gold} size={16} />
          <Text style={styles.upsellText}>Keep three careers at once</Text>
          <Badge label="Pro" color={colors.gold} />
          <ChevronRight color={colors.muted} size={18} />
        </Pressable>
      ) : null}

      <Button
        label={first ? 'New career' : 'Start a career'}
        variant={first ? 'secondary' : 'primary'}
        onPress={startNew}
        style={styles.action}
      />
      {/*
        * Android with Play Games configured, and nothing anywhere else: this
        * app is developed against react-native-web, and a button that could
        * only ever do nothing is worse than no button.
        */}
      {playGamesAvailable() ? (
        <>
          <Button
            label="Leaderboards"
            variant="secondary"
            onPress={() => {
              void showLeaderboards().then((outcome) => setProblem(leaderboardProblem(outcome)));
            }}
            style={styles.action}
          />
          {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        </>
      ) : null}
      <Button
        label="Settings"
        variant="secondary"
        onPress={() => navigation.navigate('menuSettings')}
        style={styles.action}
      />

      {/*
        * The same three numbers the leaderboards rank, shown here because they
        * are the manager's record across every career and the title screen is
        * the only place that is about more than the current one. Shown on every
        * platform: the totals are kept regardless of whether Google is there to
        * receive them.
        */}
      <Record lifetime={lifetime} />

      {/*
        * Nothing is deleted here. Starting a career is what overwrites the
        * save, so backing out of the club picker costs you nothing -- and the
        * copy has to say so, or cancelling looks like the safe option when it
        * is simply the same option.
        */}
      <ConfirmDialog
        visible={replaced !== undefined}
        title="Start a new career?"
        message={
          replaced
            ? `${replaced.summary.clubName}, and every season you have played with them, will be deleted the moment you pick a new club. Until then nothing changes.`
            : ''
        }
        confirmLabel="Choose a club"
        destructive
        onConfirm={() => {
          const slot = replacing;
          setReplacing(undefined);
          navigation.navigate('newCareer', { slot });
        }}
        onCancel={() => setReplacing(undefined)}
      />

      <SlotPicker
        visible={picking}
        careers={[...kept].sort((a, b) => a.slot - b.slot)}
        onPick={(slot) => {
          setPicking(false);
          setReplacing(slot);
        }}
        onCancel={() => setPicking(false)}
      />

      {paywall.element}
    </ScrollView>
  );
}

function Record({ lifetime }: { lifetime: LifetimeRecord }) {
  // Nothing to boast about yet, and a row of zeroes reads as a bug.
  if (lifetime.matches === 0) return null;

  return (
    <Text style={styles.record}>
      {lifetime.matches} {lifetime.matches === 1 ? 'match' : 'matches'} ·{' '}
      {lifetime.seasons} {lifetime.seasons === 1 ? 'season' : 'seasons'}
      {lifetime.longestRun > 0 ? ` · best run ${lifetime.longestRun}` : ''}
    </Text>
  );
}

/** Every slot is in use: which career makes way. */
function SlotPicker({
  visible,
  careers,
  onPick,
  onCancel,
}: {
  visible: boolean;
  careers: Kept[];
  onPick: (slot: number) => void;
  onCancel: () => void;
}) {
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop} accessibilityViewIsModal>
        <Card style={styles.picker}>
          <Text style={styles.pickerTitle} accessibilityRole="header">
            Replace which career?
          </Text>
          <Text style={styles.pickerNote}>
            All {careers.length} save slots are in use. Nothing is deleted until you pick a club.
          </Text>
          <View style={styles.rows}>
            {careers.map((entry) => (
              <CareerRow key={entry.slot} entry={{ ...entry, locked: false }} onPress={() => onPick(entry.slot)} />
            ))}
          </View>
          <Button label="Cancel" variant="secondary" onPress={onCancel} style={styles.action} />
        </Card>
      </View>
    </Modal>
  );
}

function CareerRow({
  entry,
  onPress,
  disabled,
}: {
  entry: Kept;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { summary } = entry;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${summary.clubName}. ${spokenStanding(summary)}${entry.locked ? ' Pro save slot.' : ''}`}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowClub} numberOfLines={1}>
          {summary.clubName}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {summary.leagueName} · Season {summary.season}
          {summary.position === undefined ? '' : ` · ${ordinal(summary.position)}`}
        </Text>
      </View>
      {summary.sandbox ? <Badge label="Sandbox" color={colors.info} /> : null}
      {entry.locked ? <Lock color={colors.gold} size={16} /> : null}
      <ChevronRight color={colors.muted} size={18} />
    </Pressable>
  );
}

function ContinueCard({
  summary,
  locked,
  onPress,
}: {
  summary: CareerSummary;
  locked: boolean;
  onPress: () => void;
}) {
  const over = summary.next.kind === 'sacked';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${over ? 'See out' : 'Continue'} with ${summary.clubName}. ${spokenStanding(summary)} ${nextLine(summary.next)}`}
      style={styles.continueWrap}
    >
      {({ pressed }) => (
        <Card style={[styles.continueCard, pressed ? styles.continuePressed : null]}>
          <View style={styles.continueHead}>
            <View style={styles.continueText}>
              <Text style={[styles.continueLabel, locked ? styles.lockedLabel : null]}>
                {locked ? 'PRO SAVE SLOT' : over ? 'SEE IT OUT' : 'CONTINUE'}
                {summary.sandbox ? ' · SANDBOX' : ''}
              </Text>
              <Text style={styles.clubName} numberOfLines={1}>
                {summary.clubName}
              </Text>
              <Text style={styles.clubMeta} numberOfLines={1}>
                {summary.city} · {summary.leagueName}
              </Text>
            </View>
            <View style={styles.positionBox}>
              <Text style={styles.positionValue}>
                {summary.position === undefined ? '—' : ordinal(summary.position)}
              </Text>
              <Text style={styles.positionLabel}>
                {summary.position === undefined ? 'not started' : `${summary.points} pts`}
              </Text>
            </View>
          </View>

          <Text style={styles.seasonLine}>
            Season {summary.season} · {summary.played} of {summary.leagueGames} played
            {summary.seasonsInCharge > 0
              ? ` · ${summary.seasonsInCharge} full ${summary.seasonsInCharge === 1 ? 'season' : 'seasons'} in charge`
              : ''}
          </Text>
          <Text style={[styles.nextLine, over ? styles.nextOver : null]} numberOfLines={2}>
            {nextLine(summary.next)}
          </Text>
        </Card>
      )}
    </Pressable>
  );
}

function spokenStanding(summary: CareerSummary): string {
  if (summary.position === undefined) return `Season ${summary.season}, not yet started.`;
  return `${ordinal(summary.position)} on ${summary.points} points.`;
}

function nextLine(next: NextUp): string {
  switch (next.kind) {
    case 'sacked':
      return next.reason;
    case 'window':
      return 'The transfer window is open.';
    case 'seasonOver':
      return 'The season is over — there is a season to wrap up.';
    case 'bye':
      return 'No match this week.';
    case 'fixture':
      return next.isCup
        ? `${next.competition} — ${next.home ? 'home to' : 'away to'} ${next.opponent}`
        : `Round ${next.round} — ${next.home ? 'home to' : 'away to'} ${next.opponent}`;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },
  wordmark: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 4,
  },
  rule: {
    height: 3,
    width: 56,
    backgroundColor: colors.accent,
    borderRadius: 2,
    marginTop: spacing.sm,
  },
  tagline: { marginTop: spacing.md, marginBottom: spacing.xl },
  continueWrap: { marginBottom: spacing.lg },
  continueCard: { borderColor: colors.accent },
  continuePressed: { backgroundColor: colors.surfaceAlt, borderColor: colors.borderBright },
  continueHead: { flexDirection: 'row', alignItems: 'flex-start' },
  continueText: { flex: 1, paddingRight: spacing.md },
  continueLabel: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: spacing.xs,
  },
  clubName: { color: colors.text, fontSize: 20, fontWeight: '700' },
  clubMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  positionBox: { alignItems: 'flex-end' },
  positionValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  positionLabel: { color: colors.faint, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6 },
  seasonLine: { color: colors.muted, fontSize: 12, marginTop: spacing.md },
  nextLine: { color: colors.text, fontSize: 13, marginTop: spacing.xs, lineHeight: 18 },
  nextOver: { color: colors.danger },
  action: { marginTop: spacing.sm },
  lockedLabel: { color: colors.gold },
  count: { color: colors.faint, fontSize: 11, fontVariant: ['tabular-nums'] },
  rows: { gap: spacing.sm, marginBottom: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowPressed: { backgroundColor: colors.surfaceAlt, borderColor: colors.borderBright },
  rowText: { flex: 1 },
  rowClub: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  upsell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  upsellText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  picker: { width: '100%', maxWidth: 380 },
  pickerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  pickerNote: { color: colors.muted, fontSize: 13, marginTop: spacing.xs, marginBottom: spacing.md, lineHeight: 19 },
  problem: {
    color: colors.warn,
    fontSize: 12,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  record: {
    color: colors.faint,
    fontSize: 11,
    marginTop: spacing.lg,
    textAlign: 'center',
    letterSpacing: 0.4,
  },
});
