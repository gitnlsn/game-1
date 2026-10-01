import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  currentAbility,
  formatMoney,
  type MarketListing,
  type PotentialEstimate,
} from '@eleven-deep/engine';
import { Badge, Button, Card, Divider, KeyValue } from './ui';
import { colors, positionColor, ratingColor, spacing } from '../theme';

/**
 * A player at another club, as the market prices him. Shared by the transfer
 * window and the scouting screen so a player reads the same wherever you meet him.
 */
export function TargetRow({
  listing,
  band,
  canScout,
  onOpen,
  onScout,
  action,
  shortlisted,
  onToggleShortlist,
  blockedReason,
}: {
  listing: MarketListing;
  band: PotentialEstimate;
  canScout: boolean;
  onOpen: () => void;
  onScout: () => void;
  /** The main thing to do with him -- make an offer, add him to the plan. */
  action?: { label: string; onPress: () => void; disabled?: boolean };
  shortlisted?: boolean;
  onToggleShortlist?: () => void;
  /** Overrides the usual reasons he is out of reach, e.g. his club will not sell. */
  blockedReason?: string;
}) {
  const { player } = listing;
  const blocked = blockedReason ?? (!listing.wouldJoin
    ? 'Would not join you'
    : !listing.affordable
      ? 'Beyond your budget'
      : undefined);
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
          {onToggleShortlist ? (
            <Pressable
              onPress={onToggleShortlist}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={shortlisted ? 'Remove from shortlist' : 'Add to shortlist'}
              accessibilityState={{ selected: !!shortlisted }}
            >
              <Text style={[styles.star, shortlisted ? styles.starOn : null]}>
                {shortlisted ? '★' : '☆'}
              </Text>
            </Pressable>
          ) : null}
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
      {blocked ? <Badge label={blocked} color={colors.warn} style={styles.blocked} /> : null}
      <View style={styles.actions}>
        <Button
          label={known ? 'Nothing more to learn' : 'Send a scout'}
          variant="secondary"
          style={styles.action}
          disabled={!canScout || known}
          onPress={onScout}
        />
        {action && !blocked ? (
          <Button
            label={action.label}
            style={styles.action}
            disabled={action.disabled}
            onPress={action.onPress}
          />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.sm },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  cardMeta: { color: colors.faint, fontSize: 12, marginTop: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pos: { fontSize: 11, fontWeight: '800', width: 28 },
  rating: { fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  star: { color: colors.faint, fontSize: 18 },
  starOn: { color: colors.gold },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  action: { flex: 1 },
  blocked: { marginTop: spacing.sm },
});
