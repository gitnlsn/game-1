import { useGame } from './GameContext';

/**
 * What Eleven Deep Pro adds, in the order the paywall lists it. Only what has
 * shipped goes here: a perk on this list is a promise.
 */
export const PRO_PERKS = [
  { id: 'slots', title: 'Three careers at once', detail: 'Keep up to three save slots and switch between them from the title screen.' },
  { id: 'sim', title: 'Sim to the end of the season', detail: 'Play out the rest of the season in one go. It stops for anything that needs you.' },
  { id: 'window', title: 'Your assistant drafts the window', detail: 'One tap plans the renewals, sales, loans and signings worth making, each with the reason. You review it and confirm.' },
  { id: 'assistant', title: 'Your assistant picks the team', detail: 'Before every match, the fittest and most in-form eleven in your formation. Your instructions stay as you set them.' },
  { id: 'countries', title: 'Eight more countries', detail: 'England, Spain, Italy, Germany, France, Argentina, Portugal and the Netherlands, each with its own clubs and players.' },
  { id: 'records', title: 'Club records and player histories', detail: 'Every season, all-time appearances and scorers, biggest wins, and each player’s seasons at your club.' },
  { id: 'editor', title: 'Editor', detail: 'Rename any player, club or town, and the game uses your names everywhere.' },
  { id: 'compare', title: 'Compare players side by side', detail: 'Line up to three players from your shortlist, with the best of every row picked out.' },
  { id: 'sandbox', title: 'Sandbox careers', detail: 'Add money whenever you like, and the board never sacks you. Kept off the leaderboards.' },
] as const;

export type ProPerk = (typeof PRO_PERKS)[number]['id'];

export interface ProState {
  /**
   * Whether Pro exists on this device at all. False on web and iOS, and until
   * billing is configured: a locked feature with nothing to buy is just a
   * broken one, so screens show no Pro surface at all when this is false.
   */
  offered: boolean;
  /** Whether this player has it. */
  active: boolean;
}

/**
 * Worked out in GameContext rather than here, because the game itself needs it
 * too -- the assistant and the season sim only run for subscribers.
 */
export function usePro(): ProState {
  return useGame().pro;
}
