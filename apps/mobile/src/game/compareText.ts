import { type DepartureImpact, type SideComparison } from '@eleven-deep/engine';
import { colors } from '../theme';

/** A rating gap as a whole number, which is how ratings are shown everywhere else. */
function points(n: number): string {
  return Math.abs(n).toFixed(0);
}

/**
 * One line saying where a player from elsewhere would stand in your side,
 * coloured by whether that is a reason to want him.
 */
export function sideLine(c: SideComparison, position: string): { text: string; tint: string } {
  const rival = c.rival?.displayName;
  switch (c.verdict) {
    case 'upgrade':
      return { text: `Would start: ${points(c.difference)} better than ${rival}`, tint: colors.accent };
    case 'level':
      return { text: `Level with ${rival}, a fight for the shirt`, tint: colors.text };
    case 'backup':
      return { text: `Backup: ${points(c.difference)} short of ${rival}`, tint: colors.muted };
    case 'no_slot':
      return {
        text: rival
          ? `Your formation has no ${position}. Your best is ${rival}, ${c.rivalRating.toFixed(0)}`
          : `Your formation has no ${position}, and you have none`,
        tint: colors.faint,
      };
  }
}

/** What losing one of your own does to the eleven, for the offer card. */
export function departureLine(impact: DepartureImpact): { text: string; tint: string } {
  if (!impact.starts) {
    return {
      text: impact.behind
        ? `Not in your best eleven. ${impact.behind.displayName} starts ahead of him`
        : 'Not in your best eleven',
      tint: colors.muted,
    };
  }
  if (!impact.replacement) return { text: 'Starts, and nobody can replace him', tint: colors.danger };
  const drop = Math.round(impact.drop);
  return {
    text:
      drop === 0
        ? `Starts. ${impact.replacement.displayName} comes in, no weaker`
        : `Starts. ${impact.replacement.displayName} comes in, side ${drop} weaker`,
    tint: drop >= 8 ? colors.danger : drop >= 3 ? colors.warn : colors.muted,
  };
}

/**
 * A fee against what the market values him at: "+30% on value". Clubs always ask
 * over value, so the sign is not the news -- the size of the premium is, and the
 * caller colours it from whichever side of the deal it is on.
 */
export function premium(fee: number, value: number): { pct: number; text: string } {
  const pct = value > 0 ? Math.round((fee / value - 1) * 100) : 0;
  return { pct, text: pct === 0 ? 'his value' : `${pct > 0 ? '+' : '−'}${Math.abs(pct)}% on value` };
}
