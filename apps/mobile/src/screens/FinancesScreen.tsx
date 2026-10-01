import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  answerSponsorOffer,
  effectiveTicketPrice,
  effectiveWageBill,
  leagueOf,
  ECONOMY_TUNING,
  expectedAnnualRevenue,
  formatMoney,
  managedClub,
  pendingSponsorOffers,
  recordExpense,
  recordIncome,
  sponsorDeals,
  sponsorOfferWeeksLeft,
  type SponsorOffer,
  sandboxGrant,
} from '@eleven-deep/engine';
import { Button, Card, Divider, KeyValue, ScreenHeader, SectionTitle } from '../components/ui';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ordinal } from '../format';
import { MoneyDecisions } from './MoneyDecisions';
import { colors, spacing } from '../theme';
import { useGame } from '../game/GameContext';

const SANDBOX_GRANTS = [5_000_000, 25_000_000, 100_000_000];

export function FinancesScreen() {
  const { career, version, refresh } = useGame();
  const [message, setMessage] = useState<string | undefined>();
  const [signing, setSigning] = useState<SponsorOffer | undefined>();
  const offers = useMemo(() => (career ? pendingSponsorOffers(career) : []), [career, version]);
  if (!career) return null;

  const club = managedClub(career);
  const { finances } = club;
  const season = finances.season;

  const income = recordIncome(season);
  const expense = recordExpense(season);
  const net = income - expense;

  const weeklyWages = effectiveWageBill(career.world, club);
  const annualWages = weeklyWages * ECONOMY_TUNING.wageWeeksPerSeason;
  const projectedRevenue = expectedAnnualRevenue(club.reputation, (leagueOf(career.world, club.id)?.clubs.length ?? 20));
  const wageRatio = projectedRevenue > 0 ? (annualWages / projectedRevenue) * 100 : 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader
        title="Money"
        subtitle="What the club earns, what it spends, and what the board will let you spend."
        metrics={[
          {
            label: 'Balance',
            value: formatMoney(finances.balance),
            tint: finances.balance >= 0 ? colors.accent : colors.danger,
          },
          {
            label: 'Season net',
            value: formatMoney(net),
            tint: net >= 0 ? colors.accent : colors.danger,
          },
          {
            label: 'Wages / rev',
            value: `${wageRatio.toFixed(0)}%`,
            tint: wageRatio > 75 ? colors.danger : wageRatio > 65 ? colors.warn : colors.accent,
          },
        ]}
      />

      {message ? (
        <Card style={styles.message}>
          <Text style={styles.messageText}>{message}</Text>
        </Card>
      ) : null}

      {offers.length > 0 ? <SectionTitle>Sponsor offers</SectionTitle> : null}
      {offers.map((offer) => {
        const weeks = sponsorOfferWeeksLeft(career, offer);
        return (
          <Card key={offer.id} style={styles.card}>
            <Text style={styles.cardTitle}>{offer.sponsorName}</Text>
            <Text style={styles.cardMeta}>
              {offerHeadline(offer)} · expires in {weeks} {weeks === 1 ? 'week' : 'weeks'}
            </Text>
            <Divider />
            <KeyValue label="Paid now" value={formatMoney(offer.upfront)} bold tint={colors.accent} />
            {offer.bonus && offer.targetPosition ? (
              <KeyValue
                label={`Bonus for finishing ${ordinal(offer.targetPosition)} or better`}
                value={formatMoney(offer.bonus)}
              />
            ) : null}
            <Text style={styles.catch}>{offerCatch(offer)}</Text>
            <View style={styles.actions}>
              <Button
                label="Decline"
                variant="secondary"
                style={styles.action}
                onPress={() => {
                  answerSponsorOffer(career, offer.id, 'decline');
                  setMessage(`You turn down ${offer.sponsorName}.`);
                  refresh();
                }}
              />
              <Button label="Sign" style={styles.action} onPress={() => setSigning(offer)} />
            </View>
          </Card>
        );
      })}

      {career.sandbox ? (
        <>
          <SectionTitle>Sandbox</SectionTitle>
          <Card style={styles.card}>
            <Text style={styles.cardMeta}>
              Money added here goes on the balance and the transfer budget at once.
            </Text>
            <View style={styles.actions}>
              {SANDBOX_GRANTS.map((amount) => (
                <Button
                  key={amount}
                  label={`+${formatMoney(amount)}`}
                  variant="secondary"
                  style={styles.action}
                  onPress={() => {
                    if (!sandboxGrant(career, amount)) return;
                    setMessage(`${formatMoney(amount)} added.`);
                    refresh();
                  }}
                />
              ))}
            </View>
          </Card>
        </>
      ) : null}

      <MoneyDecisions career={career} onChange={refresh} onMessage={setMessage} />

      <SectionTitle>This season</SectionTitle>
      <Card>
        <Text style={styles.groupLabel}>Income</Text>
        <KeyValue label="Gate receipts" value={formatMoney(season.gateReceipts)} />
        <KeyValue label="Sponsorship" value={formatMoney(season.sponsorship)} />
        <KeyValue label="Prize money" value={formatMoney(season.prizeMoney)} />
        <KeyValue label="Player sales" value={formatMoney(season.playerSales)} />
        <KeyValue label="Sponsor deals" value={formatMoney(season.sponsorDeals ?? 0)} />
        <KeyValue label="Total" value={formatMoney(income)} bold tint={colors.accent} />

        <Divider />

        <Text style={styles.groupLabel}>Expenditure</Text>
        <KeyValue label="Wages" value={formatMoney(season.wages)} />
        <KeyValue label="Running costs" value={formatMoney(season.operatingCosts)} />
        <KeyValue label="Transfers in" value={formatMoney(season.playerPurchases)} />
        <KeyValue label="Ground investment" value={formatMoney(season.infrastructure)} />
        <KeyValue label="Owner drawings" value={formatMoney(season.ownerDrawings)} />
        <KeyValue label="Total" value={formatMoney(expense)} bold tint={colors.danger} />
      </Card>

      <SectionTitle>Budgets</SectionTitle>
      <Card>
        <KeyValue label="Wage bill" value={`${formatMoney(weeklyWages)}/wk`} />
        <KeyValue label="Wage budget" value={`${formatMoney(finances.wageBudget)}/wk`} />
        <KeyValue label="Transfer budget" value={formatMoney(finances.transferBudget)} />
        <Divider />
        <KeyValue label="Stadium" value={`${finances.stadiumCapacity.toLocaleString()} seats`} />
        <KeyValue label="Ticket price" value={`${effectiveTicketPrice(club)}`} />
        <KeyValue label="Sponsorship / season" value={formatMoney(finances.sponsorshipPerSeason)} />
        {sponsorDeals(career).map((deal, index) =>
          deal.kind === 'performance' ? (
            <KeyValue
              key={index}
              label={`${deal.sponsorName} bonus, if ${ordinal(deal.targetPosition ?? 1)} or better`}
              value={formatMoney(deal.bonus ?? 0)}
            />
          ) : (
            <KeyValue
              key={index}
              label={`${deal.sponsorName} advance, off next season`}
              value={formatMoney(-(deal.nextSeasonCut ?? 0))}
              tint={colors.warn}
            />
          ),
        )}
      </Card>

      <ConfirmDialog
        visible={!!signing}
        title={signing ? `Sign with ${signing.sponsorName}?` : ''}
        message={signing ? `${formatMoney(signing.upfront)} now. ${offerCatch(signing)}` : ''}
        confirmLabel="Sign the deal"
        onConfirm={() => {
          if (!signing) return;
          const signed = answerSponsorOffer(career, signing.id, 'accept');
          setMessage(
            signed
              ? `You sign with ${signing.sponsorName}. ${formatMoney(signing.upfront)} is in the bank.`
              : 'That offer is no longer on the table.',
          );
          setSigning(undefined);
          refresh();
        }}
        onCancel={() => setSigning(undefined)}
      />

      <Text style={styles.footnote}>
        Money is in neutral units. Clubs run close to break-even: wages and running costs together
        take most of what comes in, and owners draw off anything well above the reserve.
      </Text>
    </ScrollView>
  );
}

function offerHeadline(offer: SponsorOffer): string {
  switch (offer.kind) {
    case 'advance':
      return 'Money up front';
    case 'performance':
      return 'Paid on results';
    case 'tour':
      return 'A friendly tour';
  }
}

/** The catch, in words, because every deal has one. */
function offerCatch(offer: SponsorOffer): string {
  switch (offer.kind) {
    case 'advance':
      return `Next season's sponsorship falls by ${formatMoney(offer.nextSeasonCut ?? 0)}.`;
    case 'performance':
      return `Miss ${ordinal(offer.targetPosition ?? 1)} and the bonus is not paid.`;
    case 'tour':
      return `The tour takes it out of the squad: every player loses ${offer.conditionCost ?? 0} condition.`;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  message: { marginBottom: spacing.md, borderColor: colors.accent },
  messageText: { color: colors.text, fontSize: 13 },
  card: { marginBottom: spacing.sm },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  cardMeta: { color: colors.faint, fontSize: 12, marginTop: 2 },
  catch: { color: colors.warn, fontSize: 12, marginTop: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  action: { flex: 1 },
  groupLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  footnote: {
    color: colors.faint,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.lg,
    fontStyle: 'italic',
  },
});
