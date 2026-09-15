import type { Club, Loan, Player, World } from '../types.js';
import { allClubs, findClub } from '../world/index.js';
import { joinSquad, leaveSquad, moveSquad } from '../world/squads.js';
import { currentAbility } from '../world/players.js';
import { TRANSFER_TUNING } from './market.js';

/**
 * Loans exist for one reason: a young player develops by playing, and a good
 * young player at a good club does not play. Without somewhere to send him, the
 * only options are to block a prospect's development or to sell him, and neither
 * is the decision a manager actually wants to make.
 */
export const LOAN_TUNING = {
  /** Oldest a club will send out to get games. */
  maxAge: 23,
  /** How far below the starting eleven he has to be before it is worth it. */
  minGapToStarter: 4,
  /** Squad must be at least this big before anyone is lent out. */
  minSquadToLend: TRANSFER_TUNING.minSquadSize + 1,
  /** Share of the wage the borrowing club picks up. */
  wageShare: 0.6,
  /**
   * A borrowing club will not go beyond this squad size.
   *
   * The hard maximum, not the target. Every club is generated AT the target, so
   * a ceiling set there means nobody in the world can borrow anybody -- the same
   * mistake that once froze the transfer market, where the sale guard sat
   * exactly at the size squads were built to.
   */
  maxSquadWhenBorrowing: TRANSFER_TUNING.maxSquadSize,
  /** He has to be better than what the borrower already has there. */
  minImprovement: 2,
  /**
   * Most a club will send out in one window. Without a cap every club lent out
   * every fringe youngster it had, 139 of them across forty clubs -- a third of
   * the under-23s in the world moving at once, which is churn rather than a
   * decision.
   */
  maxPerClub: 3,
} as const;

export type LoanRejection =
  | 'not_owned'
  | 'already_on_loan'
  | 'too_valuable'
  | 'squad_too_small'
  | 'borrower_full'
  | 'borrower_will_not_take'
  | 'unknown_club';

export interface LoanOutcome {
  agreed: boolean;
  loan?: Loan;
  reason?: LoanRejection;
}

export function loansFor(world: World, clubId: string): Loan[] {
  return world.loans.filter((loan) => loan.parentClubId === clubId);
}

export function loanOf(world: World, playerId: string): Loan | undefined {
  return world.loans.find((loan) => loan.playerId === playerId);
}

/**
 * Sends a player out on loan.
 *
 * The borrowing club takes most of the wage but pays no fee, which is the whole
 * trade: the parent club keeps the player and saves money, and gets him back a
 * season older having actually played.
 */
export function loanOut(
  world: World,
  parentClubId: string,
  toClubId: string,
  playerId: string,
): LoanOutcome {
  const parent = findClub(world, parentClubId);
  const borrower = findClub(world, toClubId);
  if (!parent || !borrower) return { agreed: false, reason: 'unknown_club' };

  const player = parent.squad.find((p) => p.id === playerId);
  if (!player) return { agreed: false, reason: 'not_owned' };
  if (loanOf(world, playerId)) return { agreed: false, reason: 'already_on_loan' };
  if (parent.squad.length <= TRANSFER_TUNING.minSquadSize) {
    return { agreed: false, reason: 'squad_too_small' };
  }
  if (borrower.squad.length >= TRANSFER_TUNING.maxSquadSize) {
    return { agreed: false, reason: 'borrower_full' };
  }
  if (!wouldTake(borrower, player)) {
    return { agreed: false, reason: 'borrower_will_not_take' };
  }

  moveSquad(parent, borrower, player);
  const loan: Loan = {
    playerId,
    parentClubId,
    clubId: toClubId,
    season: world.season,
    wageShare: LOAN_TUNING.wageShare,
  };
  world.loans.push(loan);
  return { agreed: true, loan };
}

/**
 * Whether a club would take a player on loan: he has to improve on what they
 * already have, and they have to have room.
 */
export function wouldTake(borrower: Club, player: Player): boolean {
  const L = LOAN_TUNING;
  if (borrower.squad.length >= L.maxSquadWhenBorrowing) return false;

  const samePosition = borrower.squad.filter((p) => p.position === player.position);
  const best = samePosition.length === 0 ? 0 : Math.max(...samePosition.map(currentAbility));
  return currentAbility(player) >= best + L.minImprovement || samePosition.length < 2;
}

/**
 * Brings every loan home. Called at the close season, before contracts and
 * transfers, so a returning player is available to be kept, sold or sent out
 * again like anybody else.
 */
export function recallLoans(world: World): Loan[] {
  const returning = [...world.loans];

  for (const loan of returning) {
    const borrower = findClub(world, loan.clubId);
    const parent = findClub(world, loan.parentClubId);
    const player = world.players.get(loan.playerId);
    if (!player) continue;

    if (borrower) leaveSquad(borrower, loan.playerId);
    /*
     * If the parent club has gone, he is a free agent rather than nobody's: a
     * player pointing at a club that no longer exists is how squads and the
     * lookup table drift apart.
     */
    if (parent) joinSquad(parent, player);
    else if (!world.freeAgents.some((p) => p.id === player.id)) world.freeAgents.push(player);
  }

  world.loans = [];
  return returning;
}

/** What a club actually pays in wages, with loans in and out accounted for. */
export function effectiveWageBill(world: World, club: Club): number {
  let total = 0;

  for (const player of club.squad) {
    const loan = loanOf(world, player.id);
    // Someone else's player: we pay our agreed share of him.
    total += loan ? player.contract.wage * loan.wageShare : player.contract.wage;
  }
  // And we keep paying the rest for the ones we have sent out.
  for (const loan of loansFor(world, club.id)) {
    const player = world.players.get(loan.playerId);
    if (player) total += player.contract.wage * (1 - loan.wageShare);
  }
  return total;
}

/**
 * Players a club would be better off lending out: young, some way short of the
 * side, and therefore not going to play.
 */
export function loanCandidates(world: World, clubId: string): Player[] {
  const L = LOAN_TUNING;
  const club = findClub(world, clubId);
  if (!club || club.squad.length < L.minSquadToLend) return [];

  const byPosition = new Map<string, number>();
  for (const player of club.squad) {
    const best = byPosition.get(player.position) ?? 0;
    byPosition.set(player.position, Math.max(best, currentAbility(player)));
  }

  return club.squad
    .filter((player) => {
      if (player.age > L.maxAge) return false;
      if (loanOf(world, player.id)) return false;
      const best = byPosition.get(player.position) ?? 0;
      return best - currentAbility(player) >= L.minGapToStarter;
    })
    .sort((a, b) => b.hiddenPotential - a.hiddenPotential);
}

/**
 * The AI's loan business for one close season.
 *
 * Runs after the transfer window, so a club lends out whoever it still has no
 * room for once it has finished buying and selling.
 */
export function runLoanWindow(world: World, skipClubIds?: ReadonlySet<string>): Loan[] {
  const agreed: Loan[] = [];

  for (const club of allClubs(world)) {
    if (skipClubIds?.has(club.id)) continue;

    /*
     * Loans go DOWN, and smallest first. A prospect is being sent away because he
     * will not play; sending him to a club as big as the one he left, or bigger,
     * is the same problem with a different badge on it. Before this constraint
     * two thirds of loans went sideways or upwards.
     */
    const takers = allClubs(world)
      .filter((c) => c.id !== club.id && c.reputation < club.reputation && !skipClubIds?.has(c.id))
      .sort((a, b) => a.reputation - b.reputation);

    let sent = 0;
    for (const player of loanCandidates(world, club.id)) {
      if (sent >= LOAN_TUNING.maxPerClub) break;

      for (const borrower of takers) {
        if (!wouldTake(borrower, player)) continue;
        const outcome = loanOut(world, club.id, borrower.id, player.id);
        if (outcome.agreed && outcome.loan) {
          agreed.push(outcome.loan);
          sent++;
          break;
        }
      }
    }
  }

  return agreed;
}
