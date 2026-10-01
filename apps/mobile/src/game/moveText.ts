import type { MoveFailure, PlannedMove } from '@eleven-deep/engine';

/** Why a planned move did not go through, in a sentence a manager would say. */
export const MOVE_FAILURE: Record<MoveFailure, string> = {
  below_asking: 'His club now wants more than you planned to pay.',
  no_budget: 'Not enough left in the transfer budget.',
  no_wage_room: 'His wages would take you over the wage budget.',
  would_not_join: 'He would not drop to a club of your standing.',
  seller_will_not_sell: 'His club will not sell him now.',
  buyer_squad_full: 'Your squad is full.',
  unknown_player: 'He is no longer available.',
  window_closed: 'The window is shut.',
  not_owned: 'He is no longer yours to loan.',
  already_on_loan: 'He is already out on loan.',
  too_valuable: 'He is too valuable to loan out.',
  squad_too_small: 'Your squad would be too small.',
  borrower_full: 'Their squad is full.',
  borrower_will_not_take: 'They no longer want him.',
  unknown_club: 'That club is no longer there.',
  offer_gone: 'That bid is no longer on the table.',
  release_refused: 'You cannot go that short in his position, or the squad that small.',
  renew_refused: 'He wants more than that, or the wage budget will not take it.',
};

/** What a planned move will do, said from the club's side. */
export function plannedLabel(move: PlannedMove): string {
  switch (move.kind) {
    case 'sell':
      return 'Planned: accept';
    case 'reject':
      return 'Planned: turn down';
    case 'release':
      return 'Planned: release';
    case 'loanOut':
      return 'Planned: loan out';
    case 'renew':
      return 'Planned: renew';
    case 'buy':
      return 'Planned: sign';
  }
}


/** Said when a season is about to start over moves never confirmed. */
export function unconfirmedWarning(count: number): string {
  return (
    `You have ${count} planned move${count === 1 ? '' : 's'} you have not confirmed. ` +
    'Starting the season shuts the window and they will not happen.'
  );
}
