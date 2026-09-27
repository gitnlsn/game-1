import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  expandGround,
  expansionCost,
  expansionRoom,
  formatMoney,
  gateForecast,
  isSeasonComplete,
  leagueOf,
  LEVER_TUNING,
  managedClub,
  setStaffLevel,
  setTicketLevel,
  staffLevels,
  staffLineCost,
  ticketLevel,
  type Career,
  type StaffLevel,
  type StaffLevels,
} from '@eleven-deep/engine';
import { Button, Card, Divider, KeyValue, SectionTitle, Segmented } from '../components/ui';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { colors, spacing } from '../theme';

const LEVELS = [
  { value: '-1', label: 'Basic' },
  { value: '0', label: 'Standard' },
  { value: '1', label: 'Elite' },
] as const;

const STAFF_LINES: { key: keyof StaffLevels; title: string; effect: Record<StaffLevel, string> }[] = [
  {
    key: 'medical',
    title: 'Medical and fitness',
    effect: {
      [-1]: 'Players recover more slowly between matches, and injuries last longer.',
      0: 'The usual recovery between matches.',
      1: 'Players recover faster between matches, and come back from injury sooner.',
    },
  },
  {
    key: 'coaching',
    title: 'Coaching',
    effect: {
      [-1]: 'Players improve less over the season.',
      0: 'The usual development over the season.',
      1: 'Players improve more over the season. Judged on the whole season, not the last week.',
    },
  },
  {
    key: 'academy',
    title: 'Youth academy',
    effect: {
      [-1]: 'Next summer’s academy graduates come through weaker.',
      0: 'The usual standard of academy graduate.',
      1: 'Next summer’s academy graduates come through better. Judged on the whole season.',
    },
  },
];

/**
 * The decisions a manager can make about the club's money: the gate, the staff
 * and the ground. Each one takes effect straight away and costs something.
 */
export function MoneyDecisions({
  career,
  onChange,
  onMessage,
}: {
  career: Career;
  onChange: () => void;
  onMessage: (message: string) => void;
}) {
  const [building, setBuilding] = useState<number | undefined>();
  const club = managedClub(career);
  const league = leagueOf(career.world, club.id);
  const clubCount = league?.clubs.length ?? 20;
  const tier = league?.tier ?? 1;

  const level = ticketLevel(club);
  const forecast = gateForecast(career, level);
  const gateChange = forecast.revenue - forecast.normalRevenue;
  const levels = staffLevels(club);
  const works = club.finances.groundWorks;
  const room = expansionRoom(club);
  const inSeason = !isSeasonComplete(career);

  const changeTicket = (next: number) => {
    setTicketLevel(career, next);
    onChange();
  };

  return (
    <>
      <SectionTitle>Tickets</SectionTitle>
      <Card style={styles.card}>
        <View style={styles.stepper}>
          <Button
            label="−"
            variant="secondary"
            style={styles.step}
            disabled={level <= LEVER_TUNING.ticketLevelMin}
            onPress={() => changeTicket(level - LEVER_TUNING.ticketLevelStep)}
          />
          <View style={styles.stepValue}>
            <Text style={styles.price}>{Math.round(club.finances.ticketPrice * level)}</Text>
            <Text style={styles.priceNote}>
              {level === 1 ? 'Normal price' : `${Math.round(level * 100)}% of normal`}
            </Text>
          </View>
          <Button
            label="+"
            variant="secondary"
            style={styles.step}
            disabled={level >= LEVER_TUNING.ticketLevelMax}
            onPress={() => changeTicket(level + LEVER_TUNING.ticketLevelStep)}
          />
        </View>
        <Divider />
        <KeyValue
          label="Crowd at a typical home match"
          value={`${forecast.attendance.toLocaleString()} of ${forecast.capacity.toLocaleString()}`}
        />
        <KeyValue
          label="Gate per match"
          value={
            level === 1
              ? formatMoney(forecast.revenue)
              : `${formatMoney(forecast.revenue)} (${gateChange >= 0 ? '+' : ''}${formatMoney(gateChange)})`
          }
          tint={level === 1 ? undefined : gateChange >= 0 ? colors.accent : colors.warn}
        />
        <Text style={styles.note}>
          Dearer tickets only pay when more fans want in than you have seats. A fuller ground
          lifts the side at home; an emptier one does the opposite.
        </Text>
      </Card>

      <SectionTitle>Staff</SectionTitle>
      {STAFF_LINES.map((line) => {
        const current = levels[line.key];
        const cost = staffLineCost(club, line.key, current, clubCount, tier);
        return (
          <Card key={line.key} style={styles.card}>
            <Text style={styles.cardTitle}>{line.title}</Text>
            <Segmented
              fill
              style={styles.segmented}
              options={LEVELS}
              value={String(current) as (typeof LEVELS)[number]['value']}
              onChange={(value) => {
                setStaffLevel(career, line.key, Number(value) as StaffLevel);
                onChange();
              }}
            />
            <Text style={styles.effect}>{line.effect[current]}</Text>
            {current !== 0 ? (
              <KeyValue
                label={cost > 0 ? 'Extra cost / season' : 'Saving / season'}
                value={formatMoney(Math.abs(cost))}
                tint={cost > 0 ? colors.warn : colors.accent}
              />
            ) : null}
          </Card>
        );
      })}

      <SectionTitle>Ground</SectionTitle>
      <Card style={styles.card}>
        <KeyValue label="Capacity" value={`${club.finances.stadiumCapacity.toLocaleString()} seats`} />
        {works ? (
          <>
            <KeyValue
              label="Being built"
              value={`+${works.seats.toLocaleString()} in ${works.weeksLeft} ${works.weeksLeft === 1 ? 'week' : 'weeks'}`}
              tint={colors.gold}
            />
            <Text style={styles.note}>
              Part of the ground is closed while the work goes on, so crowds are smaller until it
              is done.
            </Text>
          </>
        ) : room <= 0 ? (
          <Text style={styles.note}>The ground is as big as a club of this standing can fill.</Text>
        ) : (
          <>
            <Text style={styles.note}>
              {inSeason
                ? `Building now takes ${LEVER_TUNING.groundWorksWeeks} weeks and closes part of the ground meanwhile. Built between seasons, it is ready for the first match.`
                : 'Built now, between seasons, the new seats are ready for the first match.'}
            </Text>
            <View style={styles.sizes}>
              {LEVER_TUNING.expansionSizes
                .filter((seats) => seats <= room)
                .map((seats) => (
                  <Button
                    key={seats}
                    label={`+${seats.toLocaleString()}`}
                    variant="secondary"
                    style={styles.size}
                    disabled={club.finances.balance < expansionCost(seats)}
                    onPress={() => setBuilding(seats)}
                  />
                ))}
            </View>
            <Text style={styles.priceNote}>
              {formatMoney(expansionCost(1000))} per thousand seats · room for{' '}
              {room.toLocaleString()} more
            </Text>
          </>
        )}
      </Card>

      <ConfirmDialog
        visible={building !== undefined}
        title={building ? `Add ${building.toLocaleString()} seats?` : ''}
        message={
          building
            ? `It costs ${formatMoney(expansionCost(building))}, paid now. ` +
              (inSeason
                ? `The work takes ${LEVER_TUNING.groundWorksWeeks} weeks, and part of the ground is closed until it is finished.`
                : 'The seats are ready for the start of next season.')
            : ''
        }
        confirmLabel="Start building"
        onConfirm={() => {
          if (!building) return;
          const outcome = expandGround(career, building);
          onMessage(
            outcome.ok
              ? outcome.weeks > 0
                ? `Work starts on ${building.toLocaleString()} new seats. Ready in ${outcome.weeks} weeks.`
                : `${building.toLocaleString()} new seats will be ready for next season.`
              : outcome.reason === 'cannot_afford'
                ? 'The club cannot afford that.'
                : 'That cannot be built right now.',
          );
          setBuilding(undefined);
          onChange();
        }}
        onCancel={() => setBuilding(undefined)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.sm },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  step: { width: 52 },
  stepValue: { flex: 1, alignItems: 'center' },
  price: { color: colors.text, fontSize: 22, fontWeight: '700' },
  priceNote: { color: colors.faint, fontSize: 12, marginTop: 2 },
  segmented: { marginTop: spacing.sm },
  effect: { color: colors.muted, fontSize: 12, marginTop: spacing.sm, lineHeight: 17 },
  note: { color: colors.faint, fontSize: 12, marginTop: spacing.sm, lineHeight: 17 },
  sizes: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  size: { flex: 1 },
});
