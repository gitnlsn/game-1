import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  effectiveWageBill,
  answerOffer,
  bidFor,
  browseTargets,
  currentAbility,
  expectedWage,
  formatMoney,
  incomingOffers,
  loanableSquad,
  loanSuitors,
  managedClub,
  playersOnLoan,
  sendOnLoan,
  release,
  renewContract,
  scoutPlayer,
  scoutReport,
  scoutsAvailable,
  transferWindow,
  wageBill,
  type BidRejection,
  type MarketListing,
  type Club,
  type Player,
  type PotentialEstimate,
} from '@prancheta/engine';
import { Badge, Button, Card, ChipRow, Divider, KeyValue, SectionTitle } from '../components/ui';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { colors, positionColor, ratingColor, spacing } from '../theme';
import { useGame } from '../game/GameContext';
import type { RootStackParamList } from '../nav/routes';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Tab = 'offers' | 'squad' | 'market';

const TABS = [
  { value: 'offers' as const, label: 'Offers' },
  { value: 'squad' as const, label: 'Your squad' },
  { value: 'market' as const, label: 'Market' },
];

const REJECTION: Record<BidRejection, string> = {
  below_asking: 'They want more than that.',
  no_budget: 'Not enough in the transfer budget.',
  no_wage_room: 'His wages would take you over budget.',
  would_not_join: 'He would not drop to a club of your standing.',
  seller_will_not_sell: 'They will not sell him.',
  buyer_squad_full: 'Your squad is full.',
  unknown_player: 'He is no longer available.',
};

export function TransfersScreen() {
  const navigation = useNavigation<Nav>();
  const { career, version, refresh } = useGame();
  const [tab, setTab] = useState<Tab>('offers');
  const [position, setPosition] = useState<string>('any');
  const [pending, setPending] = useState<MarketListing | undefined>();
  const [loaning, setLoaning] = useState<{ player: Player; suitor: Club } | undefined>();
  const [message, setMessage] = useState<string | undefined>();

  const club = career ? managedClub(career) : undefined;
  const window = career ? transferWindow(career) : undefined;

  const offers = useMemo(() => (career ? incomingOffers(career) : []), [career, version]);
  const targets = useMemo(
    () =>
      career
        ? browseTargets(career, {
            ...(position === 'any' ? {} : { position: position as never }),
            limit: 40,
          })
        : [],
    [career, position, version],
  );

  if (!career || !club) return null;

  if (!window) {
    return (
      <View style={styles.container}>
        <Card style={styles.closed}>
          <Text style={styles.closedText}>
            The window is shut. It opens again when the season ends.
          </Text>
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

  const confirmBid = () => {
    if (!pending) return;
    const outcome = bidFor(career, pending.player.id, pending.askingPrice);
    setMessage(
      outcome.accepted
        ? `${pending.player.displayName} signs.`
        : (REJECTION[outcome.reason ?? 'unknown_player'] ?? 'The deal fell through.'),
    );
    setPending(undefined);
    refresh();
  };

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

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {message ? (
          <Card style={styles.message}>
            <Text style={styles.messageText}>{message}</Text>
          </Card>
        ) : null}

        {tab === 'offers' ? (
          offers.length === 0 ? (
            <Card>
              <Text style={styles.empty}>Nobody has bid for your players.</Text>
            </Card>
          ) : (
            offers.map((offer) => {
              const player = career.world.players.get(offer.playerId);
              /*
               * What matters is not whether the fee beats his valuation -- a
               * selling club always asks a premium, so it always does -- but what
               * losing him would do to the squad.
               */
              const cover = player
                ? club.squad.filter((p) => p.position === player.position && p.id !== player.id)
                : [];
              const best = cover.length
                ? Math.max(...cover.map((p) => currentAbility(p)))
                : 0;
              const ability = player ? currentAbility(player) : 0;
              const dropOff = ability - best;

              return (
                <Card key={offer.id} style={styles.card}>
                  <Text style={styles.cardTitle}>{offer.playerName}</Text>
                  <Text style={styles.cardMeta}>
                    {offer.buyerClubName} are interested
                    {player ? ` · ${player.position} · rated ${ability.toFixed(0)}` : ''}
                  </Text>
                  <Divider />
                  <KeyValue label="Their offer" value={formatMoney(offer.fee)} bold />
                  <KeyValue
                    label="Cover behind him"
                    value={
                      cover.length === 0
                        ? 'None — he is your only one'
                        : `${cover.length}, best rated ${best.toFixed(0)}`
                    }
                    tint={cover.length === 0 ? colors.danger : dropOff > 8 ? colors.warn : colors.muted}
                  />
                  <KeyValue
                    label="You would drop"
                    value={cover.length === 0 ? '—' : `${dropOff > 0 ? dropOff.toFixed(0) : '0'} rating`}
                    tint={dropOff > 8 ? colors.warn : colors.muted}
                  />
                  <View style={styles.actions}>
                    <Button
                      label="Reject"
                      variant="secondary"
                      style={styles.action}
                      onPress={() => {
                        answerOffer(career, offer.id, 'reject');
                        setMessage(`You turn down ${offer.buyerClubName}.`);
                        refresh();
                      }}
                    />
                    <Button
                      label="Accept"
                      style={styles.action}
                      onPress={() => {
                        answerOffer(career, offer.id, 'accept');
                        setMessage(`${offer.playerName} joins ${offer.buyerClubName}.`);
                        refresh();
                      }}
                    />
                  </View>
                </Card>
              );
            })
          )
        ) : null}

        {tab === 'squad' ? (
          <>
            <SectionTitle>Contracts running down</SectionTitle>
            {club.squad
              .filter((p) => p.contract.yearsRemaining <= 1)
              .sort((a, b) => currentAbility(b) - currentAbility(a))
              .map((player) => (
                <SquadRow
                  key={player.id}
                  player={player}
                  onOpen={() => navigation.navigate('player', { playerId: player.id })}
                  onRenew={() => {
                    const wage = Math.round(expectedWage(player) * 1.1);
                    const ok = renewContract(career, player.id, wage, 3);
                    setMessage(
                      ok
                        ? `${player.displayName} signs on for three more years.`
                        : 'You cannot fit that contract into the wage budget.',
                    );
                    refresh();
                  }}
                  onRelease={() => {
                    const ok = release(career, player.id);
                    setMessage(
                      ok
                        ? `${player.displayName} is released.`
                        : 'You cannot go that short in his position.',
                    );
                    refresh();
                  }}
                />
              ))}
            {club.squad.every((p) => p.contract.yearsRemaining > 1) ? (
              <Card>
                <Text style={styles.empty}>Nobody is out of contract.</Text>
              </Card>
            ) : null}

            <SectionTitle>Out on loan</SectionTitle>
            {onLoan.length === 0 ? (
              <Card>
                <Text style={styles.empty}>Nobody is out on loan.</Text>
              </Card>
            ) : (
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
                const band = scoutReport(career, player);
                return (
                  <Card key={player.id} style={styles.card}>
                    <Pressable
                      onPress={() => navigation.navigate('player', { playerId: player.id })}
                      accessibilityRole="button"
                      accessibilityLabel={player.displayName}
                    >
                      <View style={styles.rowTop}>
                        <Text style={[styles.pos, { color: positionColor(player.position) }]}>
                          {player.position}
                        </Text>
                        <Text style={styles.cardTitle}>{player.displayName}</Text>
                        <Text style={[styles.rating, { color: ratingColor(currentAbility(player)) }]}>
                          {currentAbility(player).toFixed(0)}
                        </Text>
                      </View>
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
                        : `${suitors.length} club${suitors.length === 1 ? '' : 's'} would play him.`}
                    </Text>
                    {suitors.length > 0 ? (
                      <Button
                        label={`Loan to ${suitors[suitors.length - 1]!.name}`}
                        variant="secondary"
                        style={styles.bid}
                        onPress={() =>
                          setLoaning({ player, suitor: suitors[suitors.length - 1]! })
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
            </Card>
            <ChipRow
              style={styles.filter}
              options={[
                { value: 'any', label: 'All' },
                { value: 'GK', label: 'GK' },
                { value: 'CB', label: 'CB' },
                { value: 'CM', label: 'CM' },
                { value: 'ST', label: 'ST' },
              ]}
              value={position}
              onChange={setPosition}
            />
            {targets.map((listing) => (
              <TargetRow
                key={listing.player.id}
                listing={listing}
                band={scoutReport(career, listing.player)}
                canScout={scouts > 0}
                onOpen={() => navigation.navigate('player', { playerId: listing.player.id })}
                onScout={() => {
                  const sent = scoutPlayer(career, listing.player.id);
                  setMessage(
                    sent
                      ? `Your scouts file a report on ${listing.player.displayName}.`
                      : 'You have no scouts free this season.',
                  );
                  refresh();
                }}
                onBid={() => setPending(listing)}
              />
            ))}
          </>
        ) : null}
      </ScrollView>

      <ConfirmDialog
        visible={!!loaning}
        title={loaning ? `Loan out ${loaning.player.displayName}?` : ''}
        message={
          loaning
            ? `${loaning.suitor.name} will play him and pay ` +
              `${formatMoney(loaning.player.contract.wage * 0.6)} a week of his wages. ` +
              'He comes back at the end of the season.'
            : ''
        }
        confirmLabel="Agree the loan"
        onConfirm={() => {
          if (!loaning) return;
          const outcome = sendOnLoan(career, loaning.player.id, loaning.suitor.id);
          setMessage(
            outcome.agreed
              ? `${loaning.player.displayName} joins ${loaning.suitor.name} on loan.`
              : 'They have changed their mind.',
          );
          setLoaning(undefined);
          refresh();
        }}
        onCancel={() => setLoaning(undefined)}
      />

      <ConfirmDialog
        visible={!!pending}
        title={pending ? `Sign ${pending.player.displayName}?` : ''}
        message={
          pending
            ? `${formatMoney(pending.askingPrice)} to ${pending.sellerClubName}, about ` +
              `${formatMoney(pending.expectedWage)} a week in wages.`
            : ''
        }
        confirmLabel="Make the offer"
        onConfirm={confirmBid}
        onCancel={() => setPending(undefined)}
      />
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

function SquadRow({
  player,
  onOpen,
  onRenew,
  onRelease,
}: {
  player: Player;
  onOpen: () => void;
  onRenew: () => void;
  onRelease: () => void;
}) {
  return (
    <Card style={styles.card}>
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={player.displayName}>
        <View style={styles.rowTop}>
          <Text style={[styles.pos, { color: positionColor(player.position) }]}>
            {player.position}
          </Text>
          <Text style={styles.cardTitle}>{player.displayName}</Text>
          <Text style={[styles.rating, { color: ratingColor(currentAbility(player)) }]}>
            {currentAbility(player).toFixed(0)}
          </Text>
        </View>
        <Text style={styles.cardMeta}>
          {player.age} · {formatMoney(player.contract.wage)}/wk ·{' '}
          {player.contract.yearsRemaining === 0 ? 'expiring' : '1 year left'}
        </Text>
      </Pressable>
      <View style={styles.actions}>
        <Button label="Release" variant="danger" style={styles.action} onPress={onRelease} />
        <Button label="Renew" style={styles.action} onPress={onRenew} />
      </View>
    </Card>
  );
}

function TargetRow({
  listing,
  band,
  canScout,
  onOpen,
  onScout,
  onBid,
}: {
  listing: MarketListing;
  band: PotentialEstimate;
  canScout: boolean;
  onOpen: () => void;
  onScout: () => void;
  onBid: () => void;
}) {
  const { player } = listing;
  const blocked = !listing.wouldJoin || !listing.affordable;
  /*
   * Past this point another report buys almost nothing, and saying so is kinder
   * than letting someone spend their last scout on a player they already know.
   */
  const known = band.confidence >= 0.85;

  return (
    <Card style={styles.card}>
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={player.displayName}>
        <View style={styles.rowTop}>
          <Text style={[styles.pos, { color: positionColor(player.position) }]}>
            {player.position}
          </Text>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {player.displayName}
          </Text>
          <Text style={[styles.rating, { color: ratingColor(currentAbility(player)) }]}>
            {currentAbility(player).toFixed(0)}
          </Text>
        </View>
        <Text style={styles.cardMeta}>
          {player.age} · {listing.sellerClubName}
        </Text>
      </Pressable>
      <Divider />
      <KeyValue
        label="Asking price"
        value={listing.askingPrice === 0 ? 'Free' : formatMoney(listing.askingPrice)}
        bold
      />
      <KeyValue label="Wages" value={`${formatMoney(listing.expectedWage)}/wk`} />
      <KeyValue
        label="Could become"
        value={`${band.low}–${band.high} · ${band.label}`}
        tint={band.confidence >= 0.6 ? colors.text : colors.faint}
      />
      {blocked ? (
        <Badge
          label={!listing.wouldJoin ? 'Would not join you' : 'Beyond your budget'}
          color={colors.warn}
          style={styles.blocked}
        />
      ) : null}
      <View style={styles.actions}>
        <Button
          label={known ? 'Nothing more to learn' : 'Send a scout'}
          variant="secondary"
          style={styles.action}
          disabled={!canScout || known}
          onPress={onScout}
        />
        {blocked ? null : <Button label="Make an offer" style={styles.action} onPress={onBid} />}
      </View>
    </Card>
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
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  closed: { margin: spacing.lg },
  closedText: { color: colors.muted, fontSize: 13, fontStyle: 'italic' },
  message: { marginBottom: spacing.md, borderColor: colors.accent },
  messageText: { color: colors.text, fontSize: 13 },
  empty: { color: colors.faint, fontSize: 13, fontStyle: 'italic' },
  card: { marginBottom: spacing.sm },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  cardMeta: { color: colors.faint, fontSize: 12, marginTop: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pos: { fontSize: 11, fontWeight: '800', width: 28 },
  rating: { fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  action: { flex: 1 },
  bid: { marginTop: spacing.sm },
  blocked: { marginTop: spacing.sm },
  filter: { marginBottom: spacing.md },
  scouts: { marginBottom: spacing.md, borderColor: colors.border },
  loanNote: { color: colors.faint, fontSize: 12, marginTop: spacing.sm, fontStyle: 'italic' },
  scoutsCount: { color: colors.text, fontSize: 13, fontWeight: '700' },
  scoutsNote: { color: colors.faint, fontSize: 12, marginTop: 2 },
});
