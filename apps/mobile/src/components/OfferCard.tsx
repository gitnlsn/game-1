import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  currentAbility,
  formatMoney,
  type DepartureImpact,
  type PlannedMove,
  type Player,
  type PotentialEstimate,
  type TransferOffer,
} from '@eleven-deep/engine';
import { Badge, Button, Card, Divider, KeyValue } from './ui';
import { colors, positionColor, ratingColor, spacing } from '../theme';
import { departureLine, premium } from '../game/compareText';
import { plannedLabel } from '../game/moveText';

/**
 * Every bid for one of your players, on one card with what selling him would
 * mean. One card per player, not per bid: two clubs after the same man is one
 * decision -- whether to sell, and to whom -- and it needs the bids side by side.
 */
export function OfferCard({
  player,
  offers,
  impact,
  band,
  value,
  listed,
  moveFor,
  onOpen,
  onAccept,
  onRejectAll,
  onUndo,
}: {
  player: Player;
  /** Highest first. */
  offers: TransferOffer[];
  impact: DepartureImpact;
  band: PotentialEstimate;
  value: number;
  listed: boolean;
  moveFor: (offer: TransferOffer) => PlannedMove | undefined;
  onOpen: () => void;
  onAccept: (offer: TransferOffer) => void;
  onRejectAll: (offers: TransferOffer[]) => void;
  onUndo: (move: PlannedMove) => void;
}) {
  const ability = currentAbility(player);
  const side = departureLine(impact);
  const years = player.contract.yearsRemaining;
  const { appearances, goals, assists } = player.status;
  const sale = offers.find((offer) => moveFor(offer)?.kind === 'sell');
  const open = offers.filter((offer) => !moveFor(offer));

  return (
    <Card style={styles.card}>
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={player.displayName}>
        <View style={styles.rowTop}>
          <Text style={[styles.pos, { color: positionColor(player.position) }]}>{player.position}</Text>
          <Text style={styles.name} numberOfLines={1}>
            {player.displayName}
          </Text>
          <Text style={[styles.rating, { color: ratingColor(ability) }]}>{ability.toFixed(0)}</Text>
        </View>
        <Text style={styles.meta}>
          {player.age} · {formatMoney(player.contract.wage)}/wk
          {listed ? ' · listed' : ''}
        </Text>
      </Pressable>

      <Divider />
      <Text style={[styles.side, { color: side.tint }]}>{side.text}</Text>
      <KeyValue
        label="Contract"
        value={years === 0 ? 'Expiring: he leaves for nothing' : years === 1 ? 'Last year: sell or lose him' : `${years} years left`}
        tint={years <= 1 ? colors.warn : colors.muted}
      />
      {/*
        * Past 30 the scouted ceiling is a ceiling he will never reach: decline
        * has started, and a range in the 80s beside a 69 only misleads.
        */}
      <KeyValue
        label="Could become"
        value={player.age >= 30 ? 'Past his peak' : `${band.low}–${band.high} · ${band.label}`}
        // Selling a young player with a lot still to come is the sale most often regretted.
        tint={
          player.age >= 30
            ? colors.muted
            : player.age <= 23 && band.low > ability + 6
              ? colors.accent
              : band.confidence >= 0.6
                ? colors.text
                : colors.faint
        }
      />
      <KeyValue
        label="This season"
        value={
          appearances === 0
            ? 'Not played'
            : `${appearances} app${appearances === 1 ? '' : 's'} · ${goals} goal${goals === 1 ? '' : 's'} · ${assists} assist${assists === 1 ? '' : 's'}`
        }
      />
      <KeyValue label="Wages saved" value={`${formatMoney(player.contract.wage)}/wk`} />

      <Divider />
      <KeyValue label="His value" value={formatMoney(value)} />
      {offers.map((offer, index) => {
        const move = moveFor(offer);
        const fee = premium(offer.fee, value);
        // Once a sale is planned the other bids are moot; they stay visible to compare.
        const moot = sale !== undefined && sale !== offer;
        return (
          <View key={offer.id} style={[styles.bid, moot ? styles.moot : null]}>
            <View style={styles.bidText}>
              <View style={styles.bidHead}>
                <Text style={styles.buyer} numberOfLines={1}>
                  {offer.buyerClubName}
                </Text>
                {offers.length > 1 && index === 0 ? <Badge label="Best" color={colors.accent} /> : null}
              </View>
              <Text style={styles.fee}>
                {formatMoney(offer.fee)}{' '}
                <Text style={{ color: fee.pct >= 50 ? colors.accent : colors.muted }}>· {fee.text}</Text>
              </Text>
            </View>
            {move ? (
              <View style={styles.planned}>
                <Badge label={plannedLabel(move)} color={colors.info} />
                <Pressable
                  onPress={() => onUndo(move)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Undo for ${offer.buyerClubName}`}
                >
                  <Text style={styles.undo}>Undo</Text>
                </Pressable>
              </View>
            ) : moot ? null : (
              <Button label="Accept" style={styles.accept} onPress={() => onAccept(offer)} />
            )}
          </View>
        );
      })}

      {!sale && open.length > 0 ? (
        <Button
          label={open.length === 1 ? 'Turn down' : `Turn down all ${open.length}`}
          variant="secondary"
          style={styles.reject}
          onPress={() => onRejectAll(open)}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.sm },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pos: { fontSize: 11, fontWeight: '800', width: 28 },
  name: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  rating: { fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  meta: { color: colors.faint, fontSize: 12, marginTop: 2 },
  side: { fontSize: 13, fontWeight: '600', marginBottom: spacing.xs },
  bid: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  moot: { opacity: 0.45 },
  bidText: { flex: 1 },
  bidHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  buyer: { color: colors.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  fee: { color: colors.text, fontSize: 13, marginTop: 2, fontVariant: ['tabular-nums'] },
  accept: { paddingHorizontal: spacing.lg, minWidth: 96 },
  planned: { alignItems: 'flex-end', gap: spacing.xs },
  undo: { color: colors.info, fontSize: 13, fontWeight: '700' },
  reject: { marginTop: spacing.sm },
});
