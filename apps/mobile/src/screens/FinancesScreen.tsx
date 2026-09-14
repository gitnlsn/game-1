import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  ECONOMY_TUNING,
  expectedAnnualRevenue,
  formatMoney,
  managedClub,
  recordExpense,
  recordIncome,
  wageBill,
} from '@game1/engine';
import { Card, Divider, KeyValue, SectionTitle, StatTile } from '../components/ui';
import { colors, spacing } from '../theme';
import { useGame } from '../game/GameContext';

export function FinancesScreen() {
  const { career } = useGame();
  if (!career) return null;

  const club = managedClub(career);
  const { finances } = club;
  const season = finances.season;

  const income = recordIncome(season);
  const expense = recordExpense(season);
  const net = income - expense;

  const annualWages = wageBill(club.squad) * ECONOMY_TUNING.wageWeeksPerSeason;
  const projectedRevenue = expectedAnnualRevenue(club.reputation, career.world.league.clubs.length);
  const wageRatio = projectedRevenue > 0 ? (annualWages / projectedRevenue) * 100 : 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <SectionTitle>Position</SectionTitle>
      <View style={styles.tiles}>
        <StatTile
          label="Balance"
          value={formatMoney(finances.balance)}
          tint={finances.balance >= 0 ? colors.accent : colors.danger}
        />
        <View style={styles.tileGap} />
        <StatTile
          label="Season net"
          value={formatMoney(net)}
          tint={net >= 0 ? colors.accent : colors.danger}
        />
        <View style={styles.tileGap} />
        <StatTile
          label="Wages / rev"
          value={`${wageRatio.toFixed(0)}%`}
          tint={wageRatio > 75 ? colors.danger : wageRatio > 65 ? colors.warn : colors.accent}
        />
      </View>

      <SectionTitle>This season</SectionTitle>
      <Card>
        <Text style={styles.groupLabel}>Income</Text>
        <KeyValue label="Gate receipts" value={formatMoney(season.gateReceipts)} />
        <KeyValue label="Sponsorship" value={formatMoney(season.sponsorship)} />
        <KeyValue label="Prize money" value={formatMoney(season.prizeMoney)} />
        <KeyValue label="Player sales" value={formatMoney(season.playerSales)} />
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
        <KeyValue label="Wage bill" value={`${formatMoney(wageBill(club.squad))}/wk`} />
        <KeyValue label="Wage budget" value={`${formatMoney(finances.wageBudget)}/wk`} />
        <KeyValue label="Transfer budget" value={formatMoney(finances.transferBudget)} />
        <Divider />
        <KeyValue label="Stadium" value={`${finances.stadiumCapacity.toLocaleString()} seats`} />
        <KeyValue label="Ticket price" value={`${finances.ticketPrice}`} />
        <KeyValue label="Sponsorship / season" value={formatMoney(finances.sponsorshipPerSeason)} />
      </Card>

      <Text style={styles.footnote}>
        Money is in neutral units. Clubs run close to break-even: wages and running costs together
        take most of what comes in, and owners draw off anything well above the reserve.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  tiles: { flexDirection: 'row', marginBottom: spacing.lg },
  tileGap: { width: spacing.sm },
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
