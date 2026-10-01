import { Rng } from '../rng/index.js';
import type { Club, ListingKind, Player, PotentialEstimate, TransferOffer } from '../types.js';
import {
  appraiseTarget,
  generateIncomingOffers,
  transferTargets,
  type BrowseOptions,
  type MarketListing,
} from '../transfers/market.js';
import { findClub } from '../world/index.js';
import { managedClub, ownsPlayer, scoutReport, transferWindow, type Career } from './controller.js';

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

// --- Listing your own players -----------------------------------------------

/**
 * Puts one of your players up for sale or for loan, or takes him off the market
 * with `undefined`. Returns any new bids it brought in.
 *
 * Listed for sale, a player draws more bids, and from clubs that would not
 * otherwise have bothered, at a little under the usual asking price. Listed
 * during an open window, the bids arrive straight away; listed during the
 * season, they arrive when the window opens.
 *
 * Listed for loan, he goes to a club that will play him when the next season
 * starts, unless you have already loaned him out yourself.
 */
export function setListing(
  career: Career,
  playerId: string,
  kind: ListingKind | undefined,
): TransferOffer[] {
  const player = managedClub(career).squad.find((p) => p.id === playerId);
  // Borrowed players are not yours to sell.
  if (!player || !ownsPlayer(career, player)) return [];

  if (kind === undefined) {
    delete career.listings[playerId];
    return [];
  }
  career.listings[playerId] = kind;
  return kind === 'transfer' ? refreshIncomingOffers(career, [playerId]) : [];
}

export function listingOf(career: Career, playerId: string): ListingKind | undefined {
  return career.listings[playerId];
}

/**
 * Fresh bids for players just listed in an open window.
 *
 * Drawn from a generator of its own rather than the career's, seeded from what
 * it is about: listing a player must not change the results of next season's
 * matches, which every other draw from the career generator would.
 */
export function refreshIncomingOffers(career: Career, playerIds: readonly string[]): TransferOffer[] {
  const window = transferWindow(career);
  if (!window || playerIds.length === 0) return [];

  const listed = new Set(
    Object.keys(career.listings).filter((id) => career.listings[id] === 'transfer'),
  );
  const rng = new Rng(`offers:${career.world.seed}:${window.season}:${[...playerIds].sort().join(',')}`);
  const offers = generateIncomingOffers(rng, career.world, career.managedClubId, {
    listed,
    onlyPlayerIds: new Set(playerIds),
    existing: window.incoming,
  });
  window.incoming.push(...offers);
  return offers;
}

// --- Lookups ---------------------------------------------------------------

/** The club a player is at, if any. */
export function clubOf(career: Career, player: Player): Club | undefined {
  return player.clubId ? findClub(career.world, player.clubId) : undefined;
}

