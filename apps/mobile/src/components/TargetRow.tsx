import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  currentAbility,
  formatMoney,
  type MarketListing,
  type MoveCheck,
  type PotentialEstimate,
  type SideComparison,
} from '@eleven-deep/engine';
import { Badge, Button, Card, Divider, KeyValue } from './ui';
import { colors, positionColor, ratingColor, spacing } from '../theme';
import { premium, sideLine } from '../game/compareText';
import { Consequence } from './Consequence';

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
  comparison,
  value,
  check,
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
  /** Where he would stand in your side, measured against your starter. */
  comparison?: SideComparison;
  /** His market value, to read the asking price against. */
  value?: number;
  /** Signing him, checked against the plan. Only while a window is open. */
  check?: MoveCheck | undefined;
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
      {comparison ? (
        <Text style={[styles.compare, { color: sideLine(comparison, player.position).tint }]}>
          {sideLine(comparison, player.position).text}
        </Text>
      ) : null}
      <KeyValue
        label="Asking price"
        value={listing.askingPrice === 0 ? 'Free' : formatMoney(listing.askingPrice)}
        bold
      />
      {value !== undefined && listing.askingPrice > 0 ? (
        <KeyValue
          label="His value"
          value={`${formatMoney(value)} · asking ${premium(listing.askingPrice, value).text}`}
          /*
           * Every club asks over value; a fringe player comes at about a sixth
           * more, a club's key man at double. That spread is what is worth seeing.
           */
          tint={listing.askingPrice <= value * 1.2 ? colors.accent : listing.askingPrice >= value * 1.8 ? colors.warn : colors.muted}
        />
      ) : null}
      {/* What signing him would actually cost a week, which is above what he expects to earn. */}
      <KeyValue label="Wages" value={`${formatMoney(check?.cost.wage ?? listing.expectedWage)}/wk`} />
      <KeyValue
        label="Could become"
        value={`${band.low}–${band.high} · ${band.label}`}
        tint={band.confidence >= 0.6 ? colors.text : colors.faint}
      />
      {blocked ? <Badge label={blocked} color={colors.warn} style={styles.blocked} /> : null}
      {check && !blocked && !action?.disabled ? (
        <Consequence
          text={`Signing: ${check.cost.budget === 0 ? 'no fee' : `${formatMoney(-check.cost.budget)} from the budget`} · +${formatMoney(check.cost.wage)}/wk · leaves ${formatMoney(Math.max(0, check.after.wageRoom))}/wk of wage room`}
          {...(check.problem ? { problem: check.problem } : {})}
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
  compare: { fontSize: 13, fontWeight: '600', marginBottom: spacing.xs },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pos: { fontSize: 11, fontWeight: '800', width: 28 },
  rating: { fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  star: { color: colors.faint, fontSize: 18 },
  starOn: { color: colors.gold },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  action: { flex: 1 },
  blocked: { marginTop: spacing.sm },
});
