import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  browseTargets,
  checkMove,
  contractAdvice,
  currentAbility,
  departureImpact,
  draftAssistantPlan,
  expectedWage,
  effectiveWageBill,
  formatMoney,
  incomingOffers,
  isShortlisted,
  loanableSquad,
  loanSuitors,
  managedClub,
  marketValue,
  plannedFor,
  plannedMoves,
  planMove,
  planPreview,
  playersOnLoan,
  scoutPlayer,
  scoutReport,
  scoutsAvailable,
  setListing,
  sideComparer,
  squadMembers,
  toggleShortlist,
  transferWindow,
  unplanMove,
  type ContractAdvice,
  type MarketListing,
  type MoveCheck,
  type MoveRequest,
  type PlannedMove,
  type Player,
  type TransferOffer,
} from '@eleven-deep/engine';
import { Badge, Button, Card, ChipRow, Divider, KeyValue, SectionTitle } from '../components/ui';
import { ContractRow } from '../components/ContractRow';
import { OfferCard } from '../components/OfferCard';
import { CompareSheet, type CompareTarget } from '../components/CompareSheet';
import { ProButton, usePaywall } from '../components/ProGate';
import { TargetRow } from '../components/TargetRow';
import { RenewDialog } from '../components/RenewDialog';
import { colors, positionColor, ratingColor, spacing } from '../theme';
import { useGame } from '../game/GameContext';
import type { RootStackParamList } from '../nav/routes';
import { plannedLabel } from '../game/moveText';
import { POSITION_FILTERS } from '../game/positionFilters';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Tab = 'offers' | 'squad' | 'market';

const TABS = [
  { value: 'offers' as const, label: 'Offers' },
  { value: 'squad' as const, label: 'Your squad' },
  { value: 'market' as const, label: 'Market' },
];

/**
 * The window, as a plan. Nothing on this screen happens straight away: every
 * button drafts a move, the footer keeps a running total, and the plan screen is
 * where you see the whole of it and confirm. Business done one deal at a time
 * is business done without knowing where the last deal leaves you.
 */
export function TransfersScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { career, version, refresh } = useGame();
  const [tab, setTab] = useState<Tab>('offers');
  const [position, setPosition] = useState<string>('any');
  const [message, setMessage] = useState<string | undefined>();
  const [renewing, setRenewing] = useState<Player | undefined>();
  const paywall = usePaywall();
  const [comparing, setComparing] = useState<CompareTarget | undefined>();

  const club = career ? managedClub(career) : undefined;
  const window = career ? transferWindow(career) : undefined;

  const offers = useMemo(() => (career ? incomingOffers(career) : []), [career, version]);
  /*
   * The engine lists who you could sign with today's wage room first. What
   * matters in a window is the room your plan leaves, so take a wider list and
   * re-sort it on that: players the plan can afford first, best first.
   */
  const signable = (t: { listing: MarketListing; check: MoveCheck | undefined }) =>
    t.listing.wouldJoin && !t.check?.problem;
  const targets = useMemo(() => {
    if (!career || !transferWindow(career)) return [];
    return browseTargets(career, {
      ...(position === 'any' ? {} : { position: position as never }),
      limit: 150,
    })
      .map((listing) => ({
        listing,
        check: checkMove(career, { kind: 'buy', playerId: listing.player.id, fee: listing.askingPrice }),
      }))
      .sort(
        (a, b) =>
          Number(signable(b)) - Number(signable(a)) ||
          currentAbility(b.listing.player) - currentAbility(a.listing.player),
      )
      .slice(0, 40);
  }, [career, position, version]);
  const preview = useMemo(() => (career && window ? planPreview(career) : undefined), [career, window, version]);
  const compare = useMemo(() => (career ? sideComparer(career) : undefined), [career, version]);
  // One entry per player, bids highest first, so rival bids for him sit side by side.
  const bidsByPlayer = useMemo(() => {
    const grouped = new Map<string, TransferOffer[]>();
    for (const offer of offers) grouped.set(offer.playerId, [...(grouped.get(offer.playerId) ?? []), offer]);
    return [...grouped.values()].map((bids) => bids.sort((a, b) => b.fee - a.fee));
  }, [offers]);

  if (!career || !club) return null;

  if (!window) {
    return (
      <View style={styles.container}>
        <Card style={styles.closed}>
          <Text style={styles.closedText}>
            The window is shut. It opens halfway through the season for a few matchdays, and again
            when the season ends — use the time between to shortlist and scout the players you want.
          </Text>
          <Button
            label="Your shortlist"
            variant="secondary"
            style={styles.bid}
            onPress={() => navigation.navigate('scouting')}
          />
        </Card>
      </View>
    );
  }

  const budget = club.finances.transferBudget;
  // Not `wageBill(club.squad)`: a player sent out on loan leaves the squad but
  // his club still pays a share of him, and room you do not have is not room.
  const wageRoom = club.finances.wageBudget - effectiveWageBill(career.world, club);
  const scouts = scoutsAvailable(career);
  const loanable = loanableSquad(career);
  const onLoan = playersOnLoan(career);
  const planned = plannedMoves(career);
  const listed = club.squad.filter((p) => career.listings[p.id] === 'transfer');
  const expiring = squadMembers(career)
    .filter((m) => !m.loanedTo && m.player.contract.yearsRemaining <= 1)
    .map((m) => ({ ...m, advice: contractAdvice(m.role, m.player.age) }))
    .sort((a, b) => currentAbility(b.player) - currentAbility(a.player));

  const plan = (request: MoveRequest, note: string) => {
    planMove(career, request);
    setMessage(note);
    refresh();
  };
  const undo = (move: PlannedMove) => {
    unplanMove(career, move.id);
    setMessage(undefined);
    refresh();
  };
  const open = (player: Player) => navigation.navigate('player', { playerId: player.id });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.budgets}>
          <Budget label="Transfer budget" value={formatMoney(budget)} />
          <Budget
            label="Wage room"
            value={`${formatMoney(wageRoom)}/wk`}
            tint={wageRoom <= 0 ? colors.danger : colors.text}
          />
        </View>
        <ChipRow options={TABS} value={tab} onChange={setTab} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xl * 5 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        <ProButton
          label="Assistant's plan"
          reason="Your assistant drafts the window for you: renewals, sales, loans and signings, each with the reason."
          onLocked={paywall.show}
          onPress={() => {
            const drafted = draftAssistantPlan(career);
            setMessage(
              [
                drafted.moves.length === 0
                  ? 'Your assistant has nothing to add to the plan.'
                  : `Your assistant added ${drafted.moves.length} move${drafted.moves.length === 1 ? '' : 's'} to the plan. Review them before confirming.`,
                ...drafted.notes,
              ].join('\n\n'),
            );
            refresh();
          }}
          style={styles.assistant}
        />

        {message ? (
          <Card style={styles.message}>
            <Text style={styles.messageText}>{message}</Text>
          </Card>
        ) : null}

        {tab === 'offers' ? (
          offers.length === 0 ? (
            <Card>
              <Text style={styles.empty}>
                Nobody has bid for your players. List a player for sale from his page and buyers
                come looking.
              </Text>
            </Card>
          ) : (
            bidsByPlayer.map((bids) => {
              const player = career.world.players.get(bids[0]!.playerId);
              if (!player) return null;
              return (
                <OfferCard
                  key={player.id}
                  player={player}
                  offers={bids}
                  impact={departureImpact(career, player)}
                  band={scoutReport(career, player)}
                  value={marketValue(player)}
                  acceptCheck={checkMove(career, { kind: 'sell', offerId: bids[0]!.id })}
                  listed={career.listings[player.id] === 'transfer'}
                  moveFor={(offer) => plannedFor(career, { offerId: offer.id })[0]}
                  onOpen={() => open(player)}
                  onAccept={(offer) =>
                    plan({ kind: 'sell', offerId: offer.id }, `Planned: ${offer.playerName} to ${offer.buyerClubName}.`)
                  }
                  onRejectAll={(rejected) => {
                    for (const offer of rejected) planMove(career, { kind: 'reject', offerId: offer.id });
                    setMessage(
                      rejected.length === 1
                        ? `Planned: turn down ${rejected[0]!.buyerClubName}.`
                        : `Planned: turn down all ${rejected.length} bids for ${player.displayName}.`,
                    );
                    refresh();
                  }}
                  onUndo={undo}
                />
              );
            })
          )
        ) : null}

        {tab === 'squad' ? (
          <>
            {expiring.length === 0 ? (
              <>
                <SectionTitle>Contracts running down</SectionTitle>
                <Card>
                  <Text style={styles.empty}>Nobody is out of contract.</Text>
                </Card>
              </>
            ) : (
              CONTRACT_GROUPS.map(({ advice, title, note }) => {
                const group = expiring.filter((e) => e.advice === advice);
                if (group.length === 0) return null;
                return (
                  <View key={advice}>
                    <SectionTitle>{title}</SectionTitle>
                    <Text style={styles.groupNote}>{note}</Text>
                    {group.map(({ player, role }) => (
                      <ContractRow
                        key={player.id}
                        player={player}
                        role={role}
                        advice={advice}
                        impact={departureImpact(career, player)}
                        move={plannedFor(career, { playerId: player.id }).find(
                          (m) => m.kind === 'release' || m.kind === 'renew',
                        )}
                        renewCheck={checkMove(career, {
                          kind: 'renew',
                          playerId: player.id,
                          wage: Math.max(expectedWage(player), player.contract.wage),
                          years: 3,
                        })}
                        onOpen={() => open(player)}
                        onRenew={() => setRenewing(player)}
                        onRelease={() =>
                          plan({ kind: 'release', playerId: player.id }, `Planned: release ${player.displayName}.`)
                        }
                        onUndo={undo}
                      />
                    ))}
                  </View>
                );
              })
            )}

            {/* Only when there is something to say: an empty list is not a decision. */}
            {listed.length > 0 ? (
              <>
                <SectionTitle>Listed for sale</SectionTitle>
                {listed.map((player) => (
                  <Card key={player.id} style={styles.card}>
                    <Pressable onPress={() => open(player)} accessibilityRole="button">
                      <PlayerLine player={player} />
                      <Text style={styles.cardMeta}>
                        {offers.filter((o) => o.playerId === player.id).length} bid(s) on the table
                      </Text>
                    </Pressable>
                    <Button
                      label="Take off the list"
                      variant="secondary"
                      style={styles.bid}
                      onPress={() => {
                        setListing(career, player.id, undefined);
                        refresh();
                      }}
                    />
                  </Card>
                ))}
              </>
            ) : null}

            {onLoan.length === 0 ? null : <SectionTitle>Out on loan</SectionTitle>}
            {onLoan.length === 0 ? null : (
              onLoan.map(({ player, otherClub, loan }) => (
                <Card key={player.id} style={styles.card}>
                  <Text style={styles.cardTitle}>{player.displayName}</Text>
                  <Text style={styles.cardMeta}>
                    {player.position} · {player.age} · at {otherClub?.name ?? 'another club'}
                  </Text>
                  <Divider />
                  <KeyValue
                    label="They pay"
                    value={`${formatMoney(player.contract.wage * loan.wageShare)}/wk`}
                  />
                  <KeyValue
                    label="You still pay"
                    value={`${formatMoney(player.contract.wage * (1 - loan.wageShare))}/wk`}
                  />
                  <Text style={styles.loanNote}>He comes back at the end of the season.</Text>
                </Card>
              ))
            )}

            <SectionTitle>Send out for games</SectionTitle>
            {loanable.length === 0 ? (
              <Card>
                <Text style={styles.empty}>
                  Nobody young enough is far enough from your side to need a loan.
                </Text>
              </Card>
            ) : (
              loanable.map((player) => {
                const suitors = loanSuitors(career, player.id);
                const suitor = suitors[suitors.length - 1];
                const band = scoutReport(career, player);
                const move = plannedFor(career, { playerId: player.id }).find((m) => m.kind !== 'renew');
                return (
                  <Card key={player.id} style={styles.card}>
                    <Pressable onPress={() => open(player)} accessibilityRole="button">
                      <PlayerLine player={player} />
                      <Text style={styles.cardMeta}>
                        {player.age} · could become {band.low}–{band.high}
                      </Text>
                    </Pressable>
                    <Divider />
                    <Text style={styles.loanNote}>
                      {/*
                        * Minutes are what develop a young player, so saying who
                        * would play him is the whole basis of the decision.
                        */}
                      {suitors.length === 0
                        ? 'No club would take him right now.'
                        : `${suitors.length} club${suitors.length === 1 ? '' : 's'} would play him. ` +
                          `${suitor!.name} would pay ${formatMoney(player.contract.wage * 0.6)}/wk of his wages.`}
                    </Text>
                    {move ? (
                      <PlannedState move={move} onUndo={() => undo(move)} />
                    ) : suitor ? (
                      <Button
                        label={`Loan to ${suitor.name}`}
                        variant="secondary"
                        style={styles.bid}
                        onPress={() =>
                          plan(
                            { kind: 'loanOut', playerId: player.id, toClubId: suitor.id },
                            `Planned: ${player.displayName} on loan to ${suitor.name}.`,
                          )
                        }
                      />
                    ) : null}
                  </Card>
                );
              })
            )}
          </>
        ) : null}

        {tab === 'market' ? (
          <>
            <Card style={styles.scouts}>
              <Text style={styles.scoutsCount}>
                {scouts === 0 ? 'No scouts left' : `${scouts} scout${scouts === 1 ? '' : 's'} free`}
              </Text>
              <Text style={styles.scoutsNote}>
                {scouts === 0
                  ? 'Your staff are stretched until next season. What you already know is what you go on.'
                  : 'Send one to watch a player and you will get a tighter read on how good he might become.'}
              </Text>
              <Button
                label={`Shortlist (${career.shortlist.length}) and search`}
                variant="secondary"
                style={styles.bid}
                onPress={() => navigation.navigate('scouting')}
              />
            </Card>
            <ChipRow
              style={styles.filter}
              options={POSITION_FILTERS}
              value={position}
              onChange={setPosition}
            />
            {targets.map(({ listing, check }) => {
              const inPlan = plannedFor(career, { playerId: listing.player.id }).length > 0;
              return (
                <TargetRow
                  key={listing.player.id}
                  listing={listing}
                  band={scoutReport(career, listing.player)}
                  {...(compare ? { comparison: compare(listing.player) } : {})}
                  check={check}
                  {...(compare
                    ? {
                        onCompare: () =>
                          setComparing({
                            player: listing.player,
                            comparison: compare(listing.player),
                            wage: check?.cost.wage ?? listing.expectedWage,
                          }),
                      }
                    : {})}
                  value={marketValue(listing.player)}
                  canScout={scouts > 0}
                  onOpen={() => open(listing.player)}
                  onScout={() => {
                    const sent = scoutPlayer(career, listing.player.id);
                    setMessage(
                      sent
                        ? `Your scouts file a report on ${listing.player.displayName}.`
                        : 'You have no scouts free this season.',
                    );
                    refresh();
                  }}
                  shortlisted={isShortlisted(career, listing.player.id)}
                  onToggleShortlist={() => {
                    toggleShortlist(career, listing.player.id);
                    refresh();
                  }}
                  action={{
                    label: inPlan ? 'In your plan' : 'Add to plan',
                    disabled: inPlan,
                    onPress: () =>
                      plan(
                        { kind: 'buy', playerId: listing.player.id, fee: listing.askingPrice },
                        `Planned: sign ${listing.player.displayName}` +
                          (listing.askingPrice > 0 ? ` for ${formatMoney(listing.askingPrice)}.` : ' on a free.'),
                      ),
                  }}
                />
              );
            })}
          </>
        ) : null}
      </ScrollView>

      <RenewDialog
        player={renewing}
        wageRoom={preview?.after.wageRoom ?? wageRoom}
        onCancel={() => setRenewing(undefined)}
        onPlan={(wage, years) => {
          if (!renewing) return;
          plan(
            { kind: 'renew', playerId: renewing.id, wage, years },
            `Planned: ${years} more year${years === 1 ? '' : 's'} for ${renewing.displayName}.`,
          );
          setRenewing(undefined);
        }}
      />

      {paywall.element}
      <CompareSheet target={comparing} onClose={() => setComparing(undefined)} />

      {planned.length > 0 && preview ? (
        <View style={[styles.footer, { paddingBottom: spacing.md + insets.bottom }]}>
          <View style={styles.footerText}>
            <Text style={styles.footerTitle}>
              {planned.length} planned move{planned.length === 1 ? '' : 's'}
              {preview.warnings.length > 0 ? ` · ${preview.warnings.length} warning${preview.warnings.length === 1 ? '' : 's'}` : ''}
            </Text>
            <Text style={styles.footerMeta}>
              Budget after {formatMoney(preview.after.transferBudget)} · wage room{' '}
              {formatMoney(preview.after.wageRoom)}/wk
            </Text>
          </View>
          <Button label="Review" onPress={() => navigation.navigate('windowPlan')} />
        </View>
      ) : null}
    </View>
  );
}

const CONTRACT_GROUPS: { advice: ContractAdvice; title: string; note: string }[] = [
  {
    advice: 'renew',
    title: 'Renew these',
    note: 'First-choice players and prospects. Let them run down and they leave for nothing.',
  },
  {
    advice: 'decide',
    title: 'Your call',
    note: 'Useful, not essential. Renew if the wage is worth it to you.',
  },
  {
    advice: 'release',
    title: 'Let them go',
    note: 'Surplus, or past it and not starting. Releasing frees their wages now.',
  },
];

function PlayerLine({ player }: { player: Player }) {
  return (
    <View style={styles.rowTop}>
      <Text style={[styles.pos, { color: positionColor(player.position) }]}>{player.position}</Text>
      <Text style={styles.cardTitle} numberOfLines={1}>
        {player.displayName}
      </Text>
      <Text style={[styles.rating, { color: ratingColor(currentAbility(player)) }]}>
        {currentAbility(player).toFixed(0)}
      </Text>
    </View>
  );
}

function PlannedState({ move, onUndo }: { move: PlannedMove; onUndo: () => void }) {
  return (
    <View style={styles.plannedRow}>
      <Badge label={plannedLabel(move)} color={colors.info} />
      <Pressable onPress={onUndo} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove from plan">
        <Text style={styles.undo}>Undo</Text>
      </Pressable>
    </View>
  );
}

function Budget({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <View style={styles.budget}>
      <Text style={styles.budgetLabel}>{label}</Text>
      <Text style={[styles.budgetValue, tint ? { color: tint } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  budgets: { flexDirection: 'row', gap: spacing.sm },
  budget: { flex: 1 },
  budgetLabel: {
    color: colors.faint, fontSize: 9, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  budgetValue: {
    color: colors.text, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'],
  },
  content: { padding: spacing.lg },
  closed: { margin: spacing.lg },
  closedText: { color: colors.muted, fontSize: 13, fontStyle: 'italic' },
  message: { marginBottom: spacing.md, borderColor: colors.accent },
  assistant: { marginBottom: spacing.md },
  messageText: { color: colors.text, fontSize: 13 },
  empty: { color: colors.faint, fontSize: 13, fontStyle: 'italic' },
  groupNote: { color: colors.muted, fontSize: 12, marginTop: -spacing.xs, marginBottom: spacing.sm, lineHeight: 17 },
  card: { marginBottom: spacing.sm },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  cardMeta: { color: colors.faint, fontSize: 12, marginTop: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pos: { fontSize: 11, fontWeight: '800', width: 28 },
  rating: { fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  action: { flex: 1 },
  bid: { marginTop: spacing.sm },
  filter: { marginBottom: spacing.md },
  scouts: { marginBottom: spacing.md, borderColor: colors.border },
  loanNote: { color: colors.faint, fontSize: 12, marginTop: spacing.sm, fontStyle: 'italic' },
  scoutsCount: { color: colors.text, fontSize: 13, fontWeight: '700' },
  scoutsNote: { color: colors.faint, fontSize: 12, marginTop: 2 },
  plannedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  undo: { color: colors.info, fontSize: 13, fontWeight: '700' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerText: { flex: 1 },
  footerTitle: { color: colors.text, fontSize: 13, fontWeight: '800' },
  footerMeta: { color: colors.muted, fontSize: 11, marginTop: 2, fontVariant: ['tabular-nums'] },
});
