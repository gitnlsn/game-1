import type { Player, Position, TransferOffer } from '../types.js';
import { expectedWage, formatMoney, marketValue } from '../economy/valuation.js';
import { TRANSFER_TUNING, type MarketListing } from '../transfers/market.js';
import { LOAN_TUNING } from '../transfers/loans.js';
import { DEFAULT_FORMATION, FORMATIONS } from '../world/positions.js';
import {
  browseTargets,
  currentTeamSheet,
  incomingOffers,
  loanableSquad,
  loanSuitors,
  managedClub,
  scoutReport,
  transferWindow,
  type Career,
} from './controller.js';
import {
  movePlayerId,
  planMove,
  plannedMoves,
  planPreview,
  signingWage,
  type MoveRequest,
} from './plan.js';
import {
  contractAdvice,
  departureImpact,
  sideComparer,
  squadMembers,
  type DepartureImpact,
} from './squadView.js';

/*
 * The assistant drafts a window: the moves a sensible manager would make, each
 * with the reason, added to the plan like any other. It decides nothing -- the
 * manager reviews the plan and confirms or strikes out what he likes.
 *
 * The order is the point. Wages are what stop renewals and signings, and the
 * wage ceiling is the wage budget itself, so a club over it cannot even renew a
 * man on the same money. Departures come first, then the renewals that matter,
 * then signings with whatever is left.
 */

export const ASSISTANT_TUNING = {
  /** Age from which a starter is sold if the side barely notices. */
  veteranAge: 30,
  /** Most the eleven may lose, in rating points, for a veteran starter to be sold. */
  veteranMaxDrop: 3,
  /** Below this scouting confidence a player is an unknown quantity... */
  unscoutedConfidence: 0.3,
  /** ...and is not bought for more than this share of the budget. */
  unscoutedBudgetShare: 0.5,
  /** Most of the remaining budget spent on cover for a position with none. */
  coverBudgetShare: 0.25,
} as const;

export type AssistantMove = MoveRequest & { reason: string };

export interface AssistantPlan {
  moves: AssistantMove[];
  /** What it wanted to do and could not, said so rather than left out silently. */
  notes: string[];
}

function yearsFor(age: number): number {
  if (age <= 23) return 4;
  if (age <= 29) return 3;
  if (age <= 31) return 2;
  return 1;
}

/** The moves the assistant would add to the current plan. Changes nothing. */
/** "69.4 → 68.1": the eleven's average with a player and without him. */
function averageFall(impact: DepartureImpact): string {
  return `${impact.averageBefore.toFixed(1)} → ${impact.averageAfter.toFixed(1)}`;
}

export function assistantPlan(career: Career): AssistantPlan {
  const A = ASSISTANT_TUNING;
  const T = TRANSFER_TUNING;
  if (!transferWindow(career)) return { moves: [], notes: [] };

  const club = managedClub(career);
  // Start from where the manager's own plan already leaves the club.
  const preview = planPreview(career);
  let budget = preview.after.transferBudget;
  let wageRoom = preview.after.wageRoom;
  let squadSize = preview.after.squadSize;

  const existing = plannedMoves(career);
  const taken = new Set(existing.flatMap((m) => movePlayerId(career, m) ?? []));
  const departing = new Set(
    existing
      .filter((m) => m.kind === 'sell' || m.kind === 'release' || m.kind === 'loanOut')
      .flatMap((m) => movePlayerId(career, m) ?? []),
  );

  /*
   * Every departure is made before any arrival, so the squad floor applies to
   * the squad with everyone gone and nobody yet arrived -- not to where it ends.
   */
  let lowest = preview.before.squadSize - departing.size;

  const depth = new Map<Position, number>();
  for (const player of club.squad) {
    if (!departing.has(player.id)) depth.set(player.position, (depth.get(player.position) ?? 0) + 1);
  }
  const formation = FORMATIONS[currentTeamSheet(career).formation] ?? FORMATIONS[DEFAULT_FORMATION]!;
  const slots = (position: Position) => formation.filter((p) => p === position).length;

  const members = squadMembers(career).filter((m) => !m.loanedTo && !taken.has(m.player.id));
  const moves: AssistantMove[] = [];
  const notes: string[] = [];

  const add = (move: AssistantMove, player: Player) => {
    moves.push(move);
    taken.add(player.id);
  };
  // Never below the squad floor, nor fewer at a position than the formation plays.
  const canLose = (player: Player) =>
    lowest - 1 >= T.minSquadSize &&
    (depth.get(player.position) ?? 0) - 1 >= Math.max(1, slots(player.position));
  const leave = (player: Player, wageSaved: number) => {
    squadSize -= 1;
    lowest -= 1;
    depth.set(player.position, (depth.get(player.position) ?? 0) - 1);
    wageRoom += wageSaved;
  };

  // 1. Bids. Sell who the side can spare, at the best price on the table.
  const bids = new Map<string, TransferOffer[]>();
  /** Bids turned down for a starter, revisited if a signing takes his place. */
  const turnedDown = new Map<string, TransferOffer[]>();
  for (const offer of incomingOffers(career)) {
    if (taken.has(offer.playerId)) continue;
    bids.set(offer.playerId, [...(bids.get(offer.playerId) ?? []), offer]);
  }
  for (const [playerId, offers] of bids) {
    const member = members.find((m) => m.player.id === playerId);
    if (!member) continue;
    const { player, role } = member;
    offers.sort((a, b) => b.fee - a.fee);
    const best = offers[0]!;
    const impact = departureImpact(career, player);
    const expiring = player.contract.yearsRemaining <= 1;

    const why = !impact.starts && role !== 'prospect'
      ? 'Not in your best eleven'
      : player.age >= A.veteranAge && impact.drop <= A.veteranMaxDrop
        ? `${player.age} and past his peak, and the side barely notices`
        : expiring && contractAdvice(role, player.age) !== 'renew'
          ? 'In his last year: sell now or lose him for nothing'
          : undefined;

    if (why && canLose(player)) {
      const pct = Math.round((best.fee / Math.max(1, marketValue(player)) - 1) * 100);
      add({
        kind: 'sell',
        offerId: best.id,
        reason: `${why}. ${best.buyerClubName} pay ${formatMoney(best.fee)}, ${pct}% over his value.`,
      }, player);
      leave(player, player.contract.wage);
    } else {
      const reason = impact.starts
        ? `First choice: without him the eleven's average falls ${averageFall(impact)}.`
        : role === 'prospect'
          ? 'A prospect with more to come.'
          : 'You cannot spare him at his position.';
      for (const offer of offers) add({ kind: 'reject', offerId: offer.id, reason }, player);
      if (impact.starts) turnedDown.set(player.id, offers);
    }
  }

  // 2. Releases: biggest wage saving first.
  const releasable = members
    .filter((m) => !taken.has(m.player.id))
    .filter(
      (m) =>
        m.role === 'surplus' ||
        (m.player.contract.yearsRemaining <= 1 && contractAdvice(m.role, m.player.age) === 'release'),
    )
    .sort((a, b) => b.player.contract.wage - a.player.contract.wage);
  for (const { player, role } of releasable) {
    if (!canLose(player)) continue;
    const saving = `saves ${formatMoney(player.contract.wage)}/wk`;
    add({
      kind: 'release',
      playerId: player.id,
      reason: role === 'surplus'
        ? `More ${player.position}s than you need, and not good enough to play; ${saving}.`
        : `${player.age}, a backup in his last year; ${saving}.`,
    }, player);
    leave(player, player.contract.wage);
  }

  // 3. Loans: prospects who would sit on the bench, to clubs that would play them.
  const prospects = new Set(members.filter((m) => m.role === 'prospect').map((m) => m.player.id));
  for (const player of loanableSquad(career)) {
    if (!prospects.has(player.id) || taken.has(player.id) || !canLose(player)) continue;
    // Loans are made before renewals, and a player out on loan cannot be
    // renewed: one in his last year is kept and renewed instead.
    if (player.contract.yearsRemaining <= 1) continue;
    // The least ambitious taker, as the window screen offers: the likeliest to play him.
    const suitors = loanSuitors(career, player.id);
    const to = suitors[suitors.length - 1];
    if (!to) continue;
    add({
      kind: 'loanOut',
      playerId: player.id,
      toClubId: to.id,
      reason: `A prospect outside your eleven: games at ${to.name} will develop him.`,
    }, player);
    leave(player, player.contract.wage * LOAN_TUNING.wageShare);
  }

  // 4. Renewals: the starters the side would miss most, then prospects.
  const renewals = members
    .filter((m) => !taken.has(m.player.id) && m.player.contract.yearsRemaining <= 1)
    .filter((m) => contractAdvice(m.role, m.player.age) === 'renew')
    .map((m) => ({ ...m, impact: departureImpact(career, m.player) }))
    .sort((a, b) => b.impact.drop - a.impact.drop);
  const unaffordable: string[] = [];
  for (const { player, role, impact } of renewals) {
    const wage = Math.max(expectedWage(player), player.contract.wage);
    const rise = wage - player.contract.wage;
    if (wageRoom - rise < 0) {
      unaffordable.push(`${player.displayName} (${formatMoney(wage)}/wk)`);
      continue;
    }
    const band = scoutReport(career, player);
    add({
      kind: 'renew',
      playerId: player.id,
      wage,
      years: yearsFor(player.age),
      reason: role === 'key'
        ? `First choice: without him the eleven's average falls ${averageFall(impact)}.`
        : `A prospect who could become ${band.low}–${band.high}.`,
    }, player);
    wageRoom -= rise;
  }
  // One note for all of them: the advice is the same whoever it is about.
  if (unaffordable.length > 0) {
    notes.push(
      `No wage room to renew ${unaffordable.join(', ')}. Free up wages, or they leave when their contracts end.`,
    );
  }

  // 5. Signings with what is left: the biggest upgrade first, one per position,
  // since after one arrives the comparison for the next is out of date.
  const compare = sideComparer(career);
  const targets = browseTargets(career, { limit: 400 }).filter(
    (l) => l.wouldJoin && !taken.has(l.player.id),
  );
  const signedAt = new Set<Position>();
  /*
   * One signing per selling club. A club's asking price depends on whether the
   * player starts for them, so buying one of their men can promote another and
   * raise his price between planning and confirming.
   */
  const boughtFrom = new Set<string>();
  const affordable = (listing: MarketListing) =>
    listing.askingPrice <= budget &&
    signingWage(listing.player) <= wageRoom &&
    squadSize + 1 <= T.maxSquadSize &&
    (listing.sellerClubId === '' || !boughtFrom.has(listing.sellerClubId));
  const sign = (listing: MarketListing, reason: string) => {
    const { player, askingPrice: fee } = listing;
    add({ kind: 'buy', playerId: player.id, fee, reason }, player);
    if (listing.sellerClubId) boughtFrom.add(listing.sellerClubId);
    budget -= fee;
    wageRoom -= signingWage(player);
    squadSize += 1;
    depth.set(player.position, (depth.get(player.position) ?? 0) + 1);
    signedAt.add(player.position);
  };

  const upgrades = targets
    .map((listing) => ({ listing, comparison: compare(listing.player) }))
    .filter(({ comparison }) => comparison.verdict === 'upgrade')
    .sort((a, b) => b.comparison.difference - a.comparison.difference);
  for (const { listing, comparison } of upgrades) {
    const { player, askingPrice } = listing;
    if (signedAt.has(player.position) || !affordable(listing)) continue;
    const band = scoutReport(career, player);
    if (band.confidence < A.unscoutedConfidence && askingPrice > budget * A.unscoutedBudgetShare) continue;
    sign(
      listing,
      `Would start: ${Math.round(comparison.difference)} better than ${comparison.rival?.displayName ?? 'your starter'}.`,
    );
  }

  // A starter whose bid was turned down is spare once an upgrade takes his place.
  for (const move of [...moves]) {
    if (move.kind !== 'buy') continue;
    const signed = upgrades.find((u) => u.listing.player.id === move.playerId);
    const displaced = signed?.comparison.rival;
    const offers = displaced && turnedDown.get(displaced.id);
    if (!displaced || !offers || !canLose(displaced)) continue;
    const best = offers[0]!;
    const rejected = new Set(offers.map((o) => o.id));
    moves.splice(0, moves.length, ...moves.filter((m) => !('offerId' in m && rejected.has(m.offerId))));
    const pct = Math.round((best.fee / Math.max(1, marketValue(displaced)) - 1) * 100);
    moves.push({
      kind: 'sell',
      offerId: best.id,
      reason: `${signed.listing.player.displayName} takes his place. ${best.buyerClubName} pay ${formatMoney(best.fee)}, ${pct}% over his value.`,
    });
    leave(displaced, displaced.contract.wage);
    turnedDown.delete(displaced.id);
  }

  // Cover for any position the formation plays with nobody behind the starters.
  const uncovered: Position[] = [];
  for (const position of new Set(formation)) {
    if (signedAt.has(position) || (depth.get(position) ?? 0) > slots(position)) continue;
    const cover = targets
      .filter((l) => l.player.position === position && !taken.has(l.player.id))
      .filter((l) => l.askingPrice <= budget * A.coverBudgetShare && affordable(l))
      .sort((a, b) => compare(b.player).rating - compare(a.player).rating)[0];
    if (!cover) {
      uncovered.push(position);
      continue;
    }
    sign(cover, `No cover at ${position}: one injury and someone plays out of position.`);
  }

  if (uncovered.length > 0) {
    const list = uncovered.length === 1
      ? uncovered[0]
      : `${uncovered.slice(0, -1).join(', ')} or ${uncovered[uncovered.length - 1]}`;
    notes.push(`Nobody you can afford to cover ${list}.`);
  }

  if (!moves.some((m) => m.kind === 'buy') && wageRoom <= 0) {
    notes.push('No wage room left for signings once the rest is done.');
  }

  return { moves, notes };
}

/** Adds the assistant's moves to the plan, and says what it could not do. */
export function draftAssistantPlan(career: Career): AssistantPlan {
  const plan = assistantPlan(career);
  for (const move of plan.moves) planMove(career, move);
  return plan;
}
