import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  isShortlisted,
  managedClub,
  scoutCapacity,
  scoutPlayer,
  scoutReport,
  scoutsAvailable,
  searchMarket,
  shortlistRows,
  toggleShortlist,
  transferWindow,
  type CareerBrowseOptions,
  type Position,
} from '@eleven-deep/engine';
import { Card, ChipRow, EmptyNote, SectionTitle, Segmented } from '../components/ui';
import { TargetRow } from '../components/TargetRow';
import { colors, spacing } from '../theme';
import { useGame } from '../game/GameContext';
import type { RootStackParamList } from '../nav/routes';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Tab = 'shortlist' | 'search';

const POSITIONS = [
  { value: 'any', label: 'All' },
  ...(['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'] as const).map((p) => ({
    value: p,
    label: p,
  })),
];

const AGES = [
  { value: 'any', label: 'Any age' },
  { value: 'u21', label: '21 and under' },
  { value: 'u24', label: '23 and under' },
  { value: 'prime', label: '24–29' },
  { value: 'veteran', label: '30+' },
] as const;

const POTENTIAL = [
  { value: 'any', label: 'Any ceiling' },
  { value: '65', label: 'Could reach 65' },
  { value: '72', label: 'Could reach 72' },
  { value: '80', label: 'Could reach 80' },
] as const;

const REACH = [
  { value: 'any', label: 'Everyone' },
  { value: 'affordable', label: 'Within budget' },
] as const;

const AGE_RANGES: Record<(typeof AGES)[number]['value'], Pick<CareerBrowseOptions, 'minAge' | 'maxAge'>> = {
  any: {},
  u21: { maxAge: 21 },
  u24: { maxAge: 23 },
  prime: { minAge: 24, maxAge: 29 },
  veteran: { minAge: 30 },
};

/**
 * Where you decide who is worth a closer look. Scouting is the one thing in the
 * game you cannot do for everyone, so this screen is built around the allowance:
 * how many looks you have left, and who you are spending them on.
 */
export function ScoutingScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { career, version, refresh } = useGame();
  const [view, setView] = useState<Tab>('shortlist');
  const [position, setPosition] = useState<string>('any');
  const [age, setAge] = useState<(typeof AGES)[number]['value']>('any');
  const [potential, setPotential] = useState<(typeof POTENTIAL)[number]['value']>('any');
  const [reach, setReach] = useState<(typeof REACH)[number]['value']>('any');
  const [message, setMessage] = useState<string | undefined>();

  const shortlist = useMemo(() => (career ? shortlistRows(career) : []), [career, version]);
  const results = useMemo(
    () =>
      career && view === 'search'
        ? searchMarket(career, {
            ...(position === 'any' ? {} : { position: position as Position }),
            ...AGE_RANGES[age],
            ...(potential === 'any' ? {} : { minPotential: Number(potential) }),
            ...(reach === 'affordable' ? { affordableOnly: true } : {}),
            limit: 30,
          })
        : [],
    [career, version, view, position, age, potential, reach],
  );

  if (!career) return null;

  const club = managedClub(career);
  const left = scoutsAvailable(career);
  const total = scoutCapacity(club.reputation);
  const windowOpen = transferWindow(career) !== undefined;

  const scout = (playerId: string, name: string) => {
    const sent = scoutPlayer(career, playerId);
    setMessage(sent ? `Your scouts file a report on ${name}.` : 'You have no scouts free this season.');
    refresh();
  };
  const toggle = (playerId: string) => {
    toggleShortlist(career, playerId);
    refresh();
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: spacing.xl * 2 + insets.bottom }]}
      showsVerticalScrollIndicator={false}
    >
      <Card style={styles.explainer}>
        <Text style={styles.count}>
          {left} of {total} scouting trips left this season
        </Text>
        <Text style={styles.note}>
          Nobody knows exactly how good a player will become. Your staff give a range — "could
          become 64–78" — and every scouting trip narrows it. Playing against someone teaches you a
          little too. You get more trips as the club's reputation grows; they refill each season.
        </Text>
        <Text style={styles.note}>
          Shortlist the players you are interested in during the season, scout the ones that
          matter, and you go into the window knowing who is worth the money.
        </Text>
      </Card>

      <Segmented
        fill
        style={styles.segmented}
        options={[
          { value: 'shortlist', label: `Shortlist (${shortlist.length})` },
          { value: 'search', label: 'Search' },
        ]}
        value={view}
        onChange={setView}
      />

      {message ? (
        <Card style={styles.message}>
          <Text style={styles.messageText}>{message}</Text>
        </Card>
      ) : null}

      {view === 'shortlist' ? (
        shortlist.length === 0 ? (
          <Card>
            <EmptyNote>
              Nobody on your shortlist yet. Search the market and tap ☆ on anyone worth watching.
            </EmptyNote>
          </Card>
        ) : (
          shortlist.map((row) => (
            <TargetRow
              key={row.listing.player.id}
              listing={row.listing}
              band={row.report}
              canScout={left > 0}
              shortlisted
              onToggleShortlist={() => toggle(row.listing.player.id)}
              onOpen={() => navigation.navigate('player', { playerId: row.listing.player.id })}
              onScout={() => scout(row.listing.player.id, row.listing.player.displayName)}
              {...(row.forSale ? {} : { blockedReason: 'His club will not sell him now' })}
              {...(windowOpen
                ? { action: { label: 'Go to the window', onPress: () => navigation.navigate('transfers') } }
                : {})}
            />
          ))
        )
      ) : (
        <>
          <SectionTitle>Filters</SectionTitle>
          <ChipRow style={styles.filter} options={POSITIONS} value={position} onChange={setPosition} />
          <ChipRow style={styles.filter} options={AGES} value={age} onChange={setAge} />
          <ChipRow style={styles.filter} options={POTENTIAL} value={potential} onChange={setPotential} />
          <ChipRow style={styles.filter} options={REACH} value={reach} onChange={setReach} />
          {potential !== 'any' ? (
            <Text style={styles.hint}>
              "Could reach" goes by the top of your scouts' range, so it includes players you know
              little about. Scout them to find out.
            </Text>
          ) : null}

          {results.length === 0 ? (
            <Card>
              <EmptyNote>Nobody matches those filters.</EmptyNote>
            </Card>
          ) : (
            results.map((listing) => (
              <TargetRow
                key={listing.player.id}
                listing={listing}
                band={scoutReport(career, listing.player)}
                canScout={left > 0}
                shortlisted={isShortlisted(career, listing.player.id)}
                onToggleShortlist={() => toggle(listing.player.id)}
                onOpen={() => navigation.navigate('player', { playerId: listing.player.id })}
                onScout={() => scout(listing.player.id, listing.player.displayName)}
              />
            ))
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },
  explainer: { marginBottom: spacing.md },
  count: { color: colors.text, fontSize: 15, fontWeight: '800' },
  note: { color: colors.muted, fontSize: 12, marginTop: spacing.sm, lineHeight: 17 },
  segmented: { marginBottom: spacing.md },
  message: { marginBottom: spacing.md, borderColor: colors.accent },
  messageText: { color: colors.text, fontSize: 13 },
  filter: { marginBottom: spacing.sm },
  hint: { color: colors.faint, fontSize: 11, fontStyle: 'italic', marginBottom: spacing.md },
});
