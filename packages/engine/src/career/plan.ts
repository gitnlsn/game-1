import type { PlannedMove, Player, PositionGroup, TransferOffer } from '../types.js';
import { expectedWage, formatMoney } from '../economy/valuation.js';
import {
  appraiseTarget,
  TRANSFER_TUNING,
  type BidRejection,
} from '../transfers/market.js';
import { effectiveWageBill, LOAN_TUNING, type LoanRejection } from '../transfers/loans.js';
import { findClub } from '../world/index.js';
import { POSITION_GROUP } from '../world/positions.js';
import { depthAt } from '../transfers/needs.js';
import {
  answerOffer,
  bidFor,
  incomingOffers,
  managedClub,
  pruneManagerState,
  release,
  renewContract,
  sendOnLoan,
  transferWindow,
  type Career,
} from './controller.js';

/*
 * The window as a plan: draft every move, see where it leaves the club, then
 * make them all at once. Nothing is reserved while it is only planned -- the
 * market can move under a plan -- so every move is checked again at the moment
 * it is made, and the ones that no longer work are reported, not forced.
 */

/** A move without its id, as a screen asks for it. */
export type MoveRequest = PlannedMove extends infer M
  ? M extends PlannedMove
    ? Omit<M, 'id'>
    : never
  : never;

export function plannedMoves(career: Career): PlannedMove[] {
  return transferWindow(career)?.planned ?? [];
}

/** The player a move is about, whichever way it names him. */
export function movePlayerId(career: Career, move: PlannedMove | MoveRequest): string | undefined {
  if ('playerId' in move) return move.playerId;
  return transferWindow(career)?.incoming.find((o) => o.id === move.offerId)?.playerId;
}

/** Moves that take a player out of the squad. A player can only leave one way. */
const DEPARTURES = new Set<PlannedMove['kind']>(['sell', 'loanOut', 'release']);

/**
 * Adds a move to the plan, replacing whatever it contradicts: selling a player
 * replaces loaning or releasing him, accepting a bid replaces rejecting it, and
 * releasing him drops any renewal. Returns the plan as it now stands, or
 * undefined when there is no window to plan in.
 */
export function planMove(career: Career, request: MoveRequest): PlannedMove[] | undefined {
  const window = transferWindow(career);
  if (!window) return undefined;

  const playerId = movePlayerId(career, request);
  const planned = window.planned ?? [];

  const kept = planned.filter((existing) => {
    const samePlayer = playerId !== undefined && movePlayerId(career, existing) === playerId;
    if ('offerId' in request && 'offerId' in existing && existing.offerId === request.offerId) {
      return false;
    }
    if (!samePlayer) return true;
    if (existing.kind === request.kind && existing.kind !== 'reject') return false;
    if (DEPARTURES.has(request.kind) && DEPARTURES.has(existing.kind)) return false;
    if (request.kind === 'release' && existing.kind === 'renew') return false;
    if (request.kind === 'renew' && existing.kind === 'release') return false;
    return true;
  });

  const move = { ...request, id: nextMoveId(planned) } as PlannedMove;
  window.planned = [...kept, move];
  return window.planned;
}

function nextMoveId(planned: readonly PlannedMove[]): string {
  const highest = planned.reduce((max, move) => Math.max(max, Number(move.id.slice(1)) || 0), 0);
  return `m${highest + 1}`;
}

export function unplanMove(career: Career, moveId: string): void {
  const window = transferWindow(career);
  if (!window?.planned) return;
  window.planned = window.planned.filter((move) => move.id !== moveId);
}

export function clearPlan(career: Career): void {
  const window = transferWindow(career);
  if (window) window.planned = [];
}

/** The planned move for a player or offer, if there is one, for a screen to show. */
export function plannedFor(
  career: Career,
  key: { playerId?: string; offerId?: string },
): PlannedMove[] {
  return plannedMoves(career).filter(
    (move) =>
      (key.offerId !== undefined && 'offerId' in move && move.offerId === key.offerId) ||
      (key.playerId !== undefined && movePlayerId(career, move) === key.playerId),
  );
}

// --- Preview -----------------------------------------------------------------

export interface PlanTotals {
  transferBudget: number;
  /** Wage budget less the effective wage bill, loans accounted for. */
  wageRoom: number;
  squadSize: number;
  depth: Record<PositionGroup, number>;
}

export type PlanWarningKind =
  | 'over_budget'
  | 'over_wages'
  | 'squad_too_small'
  | 'squad_too_big'
  | 'no_goalkeeper'
  | 'stale_move';

export interface PlanWarning {
  kind: PlanWarningKind;
  message: string;
  moveId?: string;
}

export interface PlannedLine {
  move: PlannedMove;
  player: Player | undefined;
  /** Short description: "Sell to Riverside for 2.1m". */
  title: string;
  /** Money in (positive) or out (negative) on the transfer budget's side. */
  fee: number;
  /** Weekly change to the wage bill. */
  wageChange: number;
  direction: 'out' | 'in' | 'contract';
}

export interface PlanPreview {
  before: PlanTotals;
  after: PlanTotals;
  lines: PlannedLine[];
  warnings: PlanWarning[];
  /** Money from sales goes to the club's balance, not to the transfer budget. */
  salesIncome: number;
}

function totals(career: Career): PlanTotals {
  const club = managedClub(career);
  const depth: Record<PositionGroup, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const player of club.squad) depth[POSITION_GROUP[player.position]] += 1;
  return {
    transferBudget: club.finances.transferBudget,
    wageRoom: club.finances.wageBudget - effectiveWageBill(career.world, club),
    squadSize: club.squad.length,
    depth,
  };
}

/** What a buy would cost in wages: what `makeBid` pays when no wage is offered. */
export function signingWage(player: Player): number {
  const T = TRANSFER_TUNING;
  return Math.max(
    Math.round(expectedWage(player) * T.moveWageMin),
    Math.round(expectedWage(player) * T.moveWageMax),
  );
}

/**
 * Where the plan leaves the club, if every move goes through. Changes nothing.
 * The same arithmetic `confirmPlan` will do, so a plan that is confirmed in full
 * lands exactly on these numbers.
 */
export function planPreview(career: Career): PlanPreview {
  const before = totals(career);
  const after: PlanTotals = { ...before, depth: { ...before.depth } };
  const lines: PlannedLine[] = [];
  const warnings: PlanWarning[] = [];
  const offers = new Map<string, TransferOffer>(incomingOffers(career).map((o) => [o.id, o]));
  const club = managedClub(career);
  let salesIncome = 0;

  const stale = (move: PlannedMove, message: string) =>
    warnings.push({ kind: 'stale_move', moveId: move.id, message });

  for (const move of orderForExecution(plannedMoves(career))) {
    const player = (() => {
      const id = movePlayerId(career, move);
      return id ? career.world.players.get(id) : undefined;
    })();
    const group = player ? POSITION_GROUP[player.position] : undefined;

    switch (move.kind) {
      case 'reject': {
        const offer = offers.get(move.offerId);
        if (!offer) stale(move, 'That bid has been withdrawn.');
        lines.push({
          move, player, fee: 0, wageChange: 0, direction: 'contract',
          title: `Turn down ${offer?.buyerClubName ?? 'the bid'}`,
        });
        break;
      }
      case 'sell': {
        const offer = offers.get(move.offerId);
        const inSquad = player && club.squad.some((p) => p.id === player.id);
        if (!offer || !inSquad) {
          stale(move, `${player?.displayName ?? 'He'} can no longer be sold on those terms.`);
        } else {
          salesIncome += offer.fee;
          after.squadSize -= 1;
          after.wageRoom += player.contract.wage;
          if (group) after.depth[group] -= 1;
        }
        lines.push({
          move, player, fee: offer?.fee ?? 0, wageChange: -(player?.contract.wage ?? 0),
          direction: 'out', title: `Sell to ${offer?.buyerClubName ?? 'buyer'}`,
        });
        break;
      }
      case 'release': {
        if (!player || !club.squad.some((p) => p.id === player.id)) {
          stale(move, 'He is no longer in the squad.');
        } else {
          after.squadSize -= 1;
          after.wageRoom += player.contract.wage;
          if (group) after.depth[group] -= 1;
        }
        lines.push({
          move, player, fee: 0, wageChange: -(player?.contract.wage ?? 0),
          direction: 'out', title: 'Release on a free',
        });
        break;
      }
      case 'loanOut': {
        const to = findClub(career.world, move.toClubId);
        const saving = player ? player.contract.wage * LOAN_TUNING.wageShare : 0;
        if (!player || !club.squad.some((p) => p.id === player.id)) {
          stale(move, 'He is no longer in the squad.');
        } else {
          after.squadSize -= 1;
          after.wageRoom += saving;
          if (group) after.depth[group] -= 1;
        }
        lines.push({
          move, player, fee: 0, wageChange: -saving,
          direction: 'out', title: `Loan to ${to?.name ?? 'another club'}`,
        });
        break;
      }
      case 'renew': {
        const change = player ? move.wage - player.contract.wage : 0;
        if (!player) stale(move, 'He is no longer at the club.');
        else after.wageRoom -= change;
        lines.push({
          move, player, fee: 0, wageChange: change,
          direction: 'contract', title: `Renew for ${move.years} years`,
        });
        break;
      }
      case 'buy': {
        const listing = appraiseTarget(career.world, career.managedClubId, move.playerId);
        const free = listing?.sellerClubId === '';
        const fee = free ? 0 : move.fee;
        const wage = player ? signingWage(player) : 0;
        if (!listing || !listing.forSale) {
          stale(move, `${player?.displayName ?? 'He'} is no longer for sale.`);
        } else {
          after.transferBudget -= fee;
          after.squadSize += 1;
          after.wageRoom -= wage;
          if (group) after.depth[group] += 1;
        }
        lines.push({
          move, player, fee: -fee, wageChange: wage,
          direction: 'in', title: free ? 'Sign on a free' : `Buy from ${listing?.sellerClubName ?? 'his club'}`,
        });
        break;
      }
    }
  }

  const signing = lines.some((line) => line.direction === 'in');
  if (after.transferBudget < 0) {
    warnings.push({ kind: 'over_budget', message: 'The signings cost more than the transfer budget. The last ones will be refused.' });
  }
  // Only worth saying when something is being signed: wages are what stop a
  // signing, and a club already over budget can still sell and release.
  if (signing && after.wageRoom < 0) {
    warnings.push({
      kind: 'over_wages',
      message:
        before.wageRoom < 0
          ? 'You are already over the wage budget. Sell or release before signing, or the signings will be refused.'
          : 'The wage bill would go over budget. Some signings will be refused.',
    });
  }
  if (after.squadSize < TRANSFER_TUNING.minSquadSize) {
    warnings.push({ kind: 'squad_too_small', message: `A squad cannot go below ${TRANSFER_TUNING.minSquadSize}. Some departures will be refused.` });
  }
  if (after.squadSize > TRANSFER_TUNING.maxSquadSize) {
    warnings.push({ kind: 'squad_too_big', message: `A squad cannot go above ${TRANSFER_TUNING.maxSquadSize}. Some signings will be refused.` });
  }
  if (after.depth.GK === 0) {
    warnings.push({ kind: 'no_goalkeeper', message: 'That would leave you without a goalkeeper.' });
  }

  return { before, after, lines, warnings, salesIncome };
}

// --- Checking one move before it is planned ------------------------------------

export interface MoveCheck {
  /** What this move alone changes, given the rest of the plan. */
  cost: {
    /** Transfer budget: negative for a fee paid. */
    budget: number;
    /** Club bank balance: a sale's fee lands here, not in the transfer budget. */
    bank: number;
    /** Weekly wage bill: positive is more paid. */
    wage: number;
  };
  /** Where the whole plan would leave the club with this move in it. */
  after: { transferBudget: number; wageRoom: number; squadSize: number };
  /** Why it would be refused when the plan is confirmed, in a sentence. */
  problem?: string;
}

/**
 * What a move would cost and whether it would go through, said before it is
 * planned -- so a manager learns about the wage budget from the button, not
 * from a refusal after confirming. Changes nothing: the move is planned on the
 * real plan, previewed, and the plan put back as it was.
 */
export function checkMove(career: Career, request: MoveRequest): MoveCheck | undefined {
  const window = transferWindow(career);
  if (!window) return undefined;

  const saved = window.planned;
  let preview: PlanPreview;
  let moveId: string | undefined;
  try {
    const planned = planMove(career, request) ?? [];
    moveId = planned[planned.length - 1]?.id;
    preview = planPreview(career);
  } finally {
    if (saved) window.planned = saved;
    else delete window.planned;
  }

  const line = preview.lines.find((l) => l.move.id === moveId);
  const { after } = preview;
  const T = TRANSFER_TUNING;
  const club = managedClub(career);
  const player = line?.player;

  const cost = {
    budget: line?.direction === 'in' ? line.fee : 0,
    bank: line?.move.kind === 'sell' ? line.fee : 0,
    wage: line?.wageChange ?? 0,
  };

  const wageShort = () => `Needs ${formatMoney(-after.wageRoom)}/wk more wage room`;
  const stale = preview.warnings.find((w) => w.moveId === moveId)?.message;
  let problem: string | undefined = stale;

  if (!problem) {
    switch (request.kind) {
      case 'renew':
        if (cost.wage > 0 && after.wageRoom < 0) problem = wageShort();
        break;
      case 'buy': {
        const listing = appraiseTarget(career.world, career.managedClubId, request.playerId);
        if (listing && !listing.wouldJoin) problem = 'He would not join a club of your standing';
        else if (after.transferBudget < 0) problem = `${formatMoney(-after.transferBudget)} over your transfer budget`;
        else if (after.wageRoom < 0) problem = wageShort();
        else if (after.squadSize > T.maxSquadSize) problem = `Your squad would be over ${T.maxSquadSize}`;
        break;
      }
      case 'release':
        if (player && depthAt(club, player.position) <= 1) {
          problem = `Your only ${player.position}: he cannot be released`;
          break;
        }
      // falls through: a release also cannot take the squad below the floor
      case 'sell':
      case 'loanOut':
        if (after.squadSize < T.minSquadSize) problem = `Your squad would drop below ${T.minSquadSize}`;
        break;
    }
  }

  return {
    cost,
    after: { transferBudget: after.transferBudget, wageRoom: after.wageRoom, squadSize: after.squadSize },
    ...(problem ? { problem } : {}),
  };
}

// --- Confirming ----------------------------------------------------------------

export type MoveFailure =
  | BidRejection
  | LoanRejection
  | 'offer_gone'
  | 'release_refused'
  | 'renew_refused'
  | 'unknown_player';

export interface MoveResult {
  move: PlannedMove;
  playerName: string;
  ok: boolean;
  reason?: MoveFailure;
}

/**
 * Departures before arrivals: turning bids down and selling first frees the
 * squad places and wages that signings need. Within a kind, the order planned.
 */
const EXECUTION_ORDER: PlannedMove['kind'][] = ['reject', 'sell', 'release', 'loanOut', 'renew', 'buy'];

function orderForExecution(moves: readonly PlannedMove[]): PlannedMove[] {
  return [...moves].sort(
    (a, b) => EXECUTION_ORDER.indexOf(a.kind) - EXECUTION_ORDER.indexOf(b.kind),
  );
}

/**
 * Makes every planned move, best effort, and reports each one. Moves that went
 * through leave the plan; moves that failed stay in it, to be changed or
 * dropped. The window stays open either way.
 */
export function confirmPlan(career: Career): MoveResult[] {
  const window = transferWindow(career);
  if (!window) return [];

  const results: MoveResult[] = [];
  for (const move of orderForExecution(window.planned ?? [])) {
    const id = movePlayerId(career, move);
    const playerName = (id && career.world.players.get(id)?.displayName) || 'Unknown player';
    const result = (ok: boolean, reason?: MoveFailure): MoveResult =>
      ({ move, playerName, ok, ...(reason ? { reason } : {}) });

    switch (move.kind) {
      case 'reject':
      case 'sell': {
        const pending = incomingOffers(career).some((o) => o.id === move.offerId);
        if (!pending) {
          results.push(result(false, 'offer_gone'));
          break;
        }
        const transfer = answerOffer(career, move.offerId, move.kind === 'sell' ? 'accept' : 'reject');
        results.push(move.kind === 'reject' || transfer ? result(true) : result(false, 'offer_gone'));
        break;
      }
      case 'release':
        results.push(release(career, move.playerId) ? result(true) : result(false, 'release_refused'));
        break;
      case 'loanOut': {
        const outcome = sendOnLoan(career, move.playerId, move.toClubId);
        results.push(outcome.agreed ? result(true) : result(false, outcome.reason ?? 'unknown_club'));
        break;
      }
      case 'renew':
        results.push(
          renewContract(career, move.playerId, move.wage, move.years)
            ? result(true)
            : result(false, 'renew_refused'),
        );
        break;
      case 'buy': {
        const outcome = bidFor(career, move.playerId, move.fee);
        results.push(outcome.accepted ? result(true) : result(false, outcome.reason ?? 'unknown_player'));
        break;
      }
    }
  }

  const done = new Set(results.filter((r) => r.ok).map((r) => r.move.id));
  window.planned = (window.planned ?? []).filter((move) => !done.has(move.id));
  // A sold player's listing, a released player's training: none of it applies now.
  pruneManagerState(career);
  return results;
}
