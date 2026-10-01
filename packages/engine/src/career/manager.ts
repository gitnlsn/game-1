import type { Club, Player, PotentialEstimate } from '../types.js';
import { appraiseTarget, transferTargets, type BrowseOptions, type MarketListing } from '../transfers/market.js';
import { findClub } from '../world/index.js';
import { scoutReport, type Career } from './controller.js';

/*
 * What the manager does with individual players: who he is watching, who he
 * wants rid of, what they work on. All of it lives on the Career -- it is one
 * manager's business, and the AI neither reads nor needs it.
 */

// --- Shortlist -------------------------------------------------------------

export function isShortlisted(career: Career, playerId: string): boolean {
  return career.shortlist.some((entry) => entry.playerId === playerId);
}

/**
 * Adds a player to the shortlist, or takes him off it. Returns whether he is on
 * it now. Your own players cannot be shortlisted: you already know where they are.
 */
export function toggleShortlist(career: Career, playerId: string): boolean {
  if (isShortlisted(career, playerId)) {
    career.shortlist = career.shortlist.filter((entry) => entry.playerId !== playerId);
    return false;
  }
  const player = career.world.players.get(playerId);
  if (!player || ownsPlayer(career, player)) return false;
  career.shortlist.push({ playerId, addedSeason: career.world.season });
  return true;
}

export interface ShortlistRow {
  listing: MarketListing;
  report: PotentialEstimate;
  /** False when his club will not let him go right now. */
  forSale: boolean;
  addedSeason: number;
}

/** Everyone on the shortlist, priced as the market stands today. */
export function shortlistRows(career: Career): ShortlistRow[] {
  return career.shortlist.flatMap((entry) => {
    const appraised = appraiseTarget(career.world, career.managedClubId, entry.playerId);
    if (!appraised) return [];
    const { forSale, ...listing } = appraised;
    return [{ listing, report: scoutReport(career, listing.player), forSale, addedSeason: entry.addedSeason }];
  });
}

export interface CareerBrowseOptions extends BrowseOptions {
  /**
   * Only players your scouts think could reach this. Read off the top of the
   * scouted band -- "could become" -- never off the truth, which the manager
   * does not get to see.
   */
  minPotential?: number;
}

/** The market, with the filters only a manager's knowledge can apply. */
export function searchMarket(career: Career, options: CareerBrowseOptions = {}): MarketListing[] {
  const { minPotential, limit, ...rest } = options;
  const all = transferTargets(career.world, career.managedClubId, rest);
  const filtered =
    minPotential === undefined
      ? all
      : all.filter((listing) => scoutReport(career, listing.player).high >= minPotential);
  return limit ? filtered.slice(0, limit) : filtered;
}

// --- Housekeeping ------------------------------------------------------------

/** Whether a player belongs to the managed club, at it or out on loan from it. */
export function ownsPlayer(career: Career, player: Player): boolean {
  if (player.clubId === career.managedClubId) {
    // Borrowed players are at the club but not the club's.
    return !career.world.loans.some(
      (loan) => loan.playerId === player.id && loan.clubId === career.managedClubId,
    );
  }
  return career.world.loans.some(
    (loan) => loan.playerId === player.id && loan.parentClubId === career.managedClubId,
  );
}

/** The club a player is at, if any. */
export function clubOf(career: Career, player: Player): Club | undefined {
  return player.clubId ? findClub(career.world, player.clubId) : undefined;
}

/**
 * Drops what no longer applies: players who left the game, shortlisted players
 * who have since joined you, and listings, training and curves for players who
 * are not yours any more. Run whenever the squad may have changed hands.
 */
export function pruneManagerState(career: Career): void {
  const { players } = career.world;
  const own = (id: string) => {
    const player = players.get(id);
    return player !== undefined && ownsPlayer(career, player);
  };

  career.shortlist = career.shortlist.filter((entry) => {
    const player = players.get(entry.playerId);
    return player !== undefined && !ownsPlayer(career, player);
  });
  for (const id of Object.keys(career.listings)) if (!own(id)) delete career.listings[id];
  for (const id of Object.keys(career.training)) if (!own(id)) delete career.training[id];

  const watched = new Set(career.shortlist.map((entry) => entry.playerId));
  for (const id of Object.keys(career.progression)) {
    if (!own(id) && !watched.has(id)) delete career.progression[id];
  }
}
