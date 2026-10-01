import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  currentAbility,
  formatMoney,
  shortlistRows,
  type AttributeKey,
  type ShortlistRow,
} from '@eleven-deep/engine';
import { Card, Chip, EmptyNote, SectionTitle } from '../components/ui';
import { ATTRIBUTE_GROUPS, ATTRIBUTE_LABELS } from '../attributes';
import { colors, spacing } from '../theme';
import { useGame } from '../game/GameContext';

const MAX_COMPARED = 3;

/**
 * Shortlisted players side by side. Nothing here is information the player
 * screens do not already show -- it is the same numbers, lined up so the
 * difference is what you read. Pro, reached from the shortlist.
 */
export function CompareScreen() {
  const { career, version } = useGame();
  const insets = useSafeAreaInsets();
  const rows = useMemo(() => (career ? shortlistRows(career) : []), [career, version]);
  const [chosen, setChosen] = useState<string[]>(() => rows.slice(0, MAX_COMPARED).map((r) => r.listing.player.id));
  if (!career) return null;

  const compared = chosen
    .map((id) => rows.find((r) => r.listing.player.id === id))
    .filter((r): r is ShortlistRow => r !== undefined);

  const toggle = (id: string) =>
    setChosen((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : current.length >= MAX_COMPARED
          ? [...current.slice(1), id]
          : [...current, id],
    );

  const keepers = compared.length > 0 && compared.every((r) => r.listing.player.position === 'GK');
  const groups = ATTRIBUTE_GROUPS.filter((g) => (keepers ? true : g.title !== 'Goalkeeping'));

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + insets.bottom }]}
    >
      <Text style={styles.intro}>Pick up to {MAX_COMPARED} players from your shortlist.</Text>
      <View style={styles.chips}>
        {rows.map((row) => (
          <Chip
            key={row.listing.player.id}
            label={row.listing.player.displayName}
            selected={chosen.includes(row.listing.player.id)}
            onPress={() => toggle(row.listing.player.id)}
          />
        ))}
      </View>

      {compared.length < 2 ? (
        <Card>
          <EmptyNote>
            {rows.length < 2
              ? 'Shortlist at least two players to compare them.'
              : 'Pick at least two players to compare.'}
          </EmptyNote>
        </Card>
      ) : (
        <>
          <Card>
            <Row label="" values={compared.map((r) => r.listing.player.displayName)} header />
            <Row label="Position" values={compared.map((r) => r.listing.player.position)} />
            <Row label="Club" values={compared.map((r) => r.listing.sellerClubName || 'Free agent')} />
            <Row label="Age" values={compared.map((r) => `${r.listing.player.age}`)} numbers={compared.map((r) => -r.listing.player.age)} />
            <Row
              label="Ability"
              values={compared.map((r) => currentAbility(r.listing.player).toFixed(0))}
              numbers={compared.map((r) => currentAbility(r.listing.player))}
            />
            <Row
              label="Could become"
              values={compared.map((r) => `${r.report.low}–${r.report.high}`)}
              numbers={compared.map((r) => r.report.estimate)}
            />
            <Row
              label="Asking"
              values={compared.map((r) => (r.forSale ? (r.listing.askingPrice === 0 ? 'Free' : formatMoney(r.listing.askingPrice)) : 'Not for sale'))}
              numbers={compared.map((r) => (r.forSale ? -r.listing.askingPrice : Number.NEGATIVE_INFINITY))}
            />
            <Row
              label="Wage"
              values={compared.map((r) => `${formatMoney(r.listing.expectedWage)}/wk`)}
              numbers={compared.map((r) => -r.listing.expectedWage)}
            />
            <Row label="Would join" values={compared.map((r) => (r.listing.wouldJoin ? 'Yes' : 'No'))} />
          </Card>

          {groups.map((group) => (
            <View key={group.title}>
              <SectionTitle>{group.title}</SectionTitle>
              <Card>
                {group.keys.map((key: AttributeKey) => (
                  <Row
                    key={key}
                    label={ATTRIBUTE_LABELS[key]}
                    values={compared.map((r) => `${r.listing.player.attributes[key]}`)}
                    numbers={compared.map((r) => r.listing.player.attributes[key])}
                  />
                ))}
              </Card>
            </View>
          ))}
          <Text style={styles.note}>The best of each row is in green. Potential is your scouts’ range, not the truth.</Text>
        </>
      )}
    </ScrollView>
  );
}

/**
 * One line of the comparison. With `numbers`, the best is picked out -- higher
 * is better, so a row where less is better passes its values negated.
 */
function Row({
  label,
  values,
  numbers,
  header,
}: {
  label: string;
  values: string[];
  numbers?: number[];
  header?: boolean;
}) {
  const best = numbers ? Math.max(...numbers) : undefined;
  const clear = numbers ? numbers.filter((n) => n === best).length === 1 : false;
  return (
    <View style={styles.row}>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      {values.map((value, index) => (
        <Text
          key={index}
          numberOfLines={header ? 2 : 1}
          style={[
            styles.value,
            header ? styles.header : null,
            clear && numbers![index] === best ? styles.best : null,
          ]}
        >
          {value}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },
  intro: { color: colors.muted, fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm, marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, gap: spacing.xs },
  label: { width: 92, color: colors.muted, fontSize: 12 },
  value: { flex: 1, color: colors.text, fontSize: 13, textAlign: 'right', fontVariant: ['tabular-nums'] },
  header: { fontWeight: '700', fontSize: 12 },
  best: { color: colors.accent, fontWeight: '700' },
  note: { color: colors.faint, fontSize: 11, marginTop: spacing.lg, textAlign: 'center', lineHeight: 16 },
});
