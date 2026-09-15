import { Rng } from '../rng/index.js';
import type {
  Club,
  Fixture,
  MatchResult,
  TableRow,
  TeamSheet,
  TeamSheetIssue,
  Transfer,
  TransferOffer,
  TransferWindowState,
  World,
} from '../types.js';
import {
  makeBid,
  offerContract,
  releasePlayer,
  respondToOffer,
  transferTargets,
  type BidOutcome,
  type BrowseOptions,
  type MarketListing,
} from '../transfers/market.js';
import {
  createSeasonState,
  finaliseSeason,
  playRound,
  seasonComplete,
  upcomingRound,
  currentTable,
  type SeasonState,
} from '../league/season.js';
import { DEFAULT_FORMATION, FORMATIONS } from '../world/positions.js';
import { resolveTeamSheet, type Lineup } from '../match/ratings.js';
import { createWorld } from '../world/index.js';
import {
  createScoutingState,
  creditInheritedSquad,
  creditOpponent,
  creditOwnSquad,
  pruneScouting,
  scoutedPotential,
  scoutedValue,
} from '../world/scouting.js';
import type { PotentialEstimate, Player, ScoutingState } from '../types.js';
import {
  beginSeason,
  closeSeason,
  completeTransferWindow,
  type SeasonSummary,
} from './career.js';

/**
 * A career being played rather than simulated: the world, the season in
 * progress, and which club the player manages. The tuning harness runs whole
 * seasons in a loop; a game needs to stop after every round and show what
 * happened, which is what this wraps.
 */
export interface Career {
  world: World;
  rng: Rng;
  managedClubId: string;
  season: SeasonState;
  /** Completed seasons, oldest first. */
  history: SeasonSummary[];
  /**
   * What this manager has learned about players. Lives on the Career, not the
   * World: it is one club's knowledge, the AI does not use it, and keeping it
   * here means the headless validators -- which never build a Career -- cannot
   * be affected by it.
   */
  scouting: ScoutingState;
}

export interface StartCareerOptions {
  seed: number | string;
  /** Club the player takes charge of. Defaults to the first club. */
  managedClubId?: string;
  clubCount?: number;
  leagueName?: string;
  nationality?: string;
}

export function startCareer(options: StartCareerOptions): Career {
  const world = createWorld({
    seed: options.seed,
    ...(options.clubCount !== undefined ? { clubCount: options.clubCount } : {}),
    ...(options.leagueName !== undefined ? { leagueName: options.leagueName } : {}),
    ...(options.nationality !== undefined ? { nationality: options.nationality } : {}),
  });

  const rng = new Rng(`${options.seed}:career`);
  const managedClubId = options.managedClubId ?? world.league.clubs[0]!.id;

  beginSeason(world);
  const season = createSeasonState(world, rng, { economy: true, playerState: true });

  const career: Career = {
    world,
    rng,
    managedClubId,
    season,
    history: [],
    scouting: createScoutingState(),
  };

  // You start knowing your own squad reasonably well: your coaches have watched
  // them every day, even if you have not seen them play yet.
  creditInheritedSquad(career.scouting, managedClub(career).squad, world.season);
  return career;
}

export function managedClub(career: Career): Club {
  const club = career.world.league.clubs.find((c) => c.id === career.managedClubId);
  if (!club) throw new Error(`managedClub: no club ${career.managedClubId}`);
  return club;
}

/** Plays the next round of fixtures. Returns every result, across all clubs. */
export function advanceRound(career: Career): MatchResult[] {
  const results = playRound(career.season);

  // Facing a side teaches you about it. Done here rather than inside the season
  // loop so the headless path stays free of scouting entirely.
  const own = results.find(
    (r) => r.homeClubId === career.managedClubId || r.awayClubId === career.managedClubId,
  );
  if (own) {
    const opponentId = own.homeClubId === career.managedClubId ? own.awayClubId : own.homeClubId;
    const opponent = career.world.league.clubs.find((c) => c.id === opponentId);
    if (opponent) {
      const active = new Set(
        own.events.filter((e) => e.clubId === opponentId).map((e) => e.playerId),
      );
      creditOpponent(career.scouting, opponent.squad, active, career.world.season);
    }
  }

  return results;
}

/** Your scouts' read on how good a player might become. Never an exact number. */
export function scoutReport(career: Career, player: Player): PotentialEstimate {
  return scoutedPotential(career.world.seed, career.scouting, player);
}

/** What a player looks worth on your reading, as opposed to what he will cost. */
export function scoutValuation(career: Career, player: Player): number {
  return scoutedValue(career.world.seed, career.scouting, player);
}

export function isSeasonComplete(career: Career): boolean {
  return seasonComplete(career.season);
}

export function leagueTable(career: Career): TableRow[] {
  return currentTable(career.season);
}

/** Where the managed club currently sits, 1-based. */
export function managedPosition(career: Career): number {
  const table = leagueTable(career);
  const index = table.findIndex((row) => row.clubId === career.managedClubId);
  return index < 0 ? table.length : index + 1;
}

export interface UpcomingFixture {
  fixture: Fixture;
  opponent: Club;
  home: boolean;
}

/** The managed club's next match, or undefined once the season is over. */
export function nextFixture(career: Career): UpcomingFixture | undefined {
  if (isSeasonComplete(career)) return undefined;

  const fixture = upcomingRound(career.season).find(
    (f) => f.homeClubId === career.managedClubId || f.awayClubId === career.managedClubId,
  );
  if (!fixture) return undefined;

  const home = fixture.homeClubId === career.managedClubId;
  const opponentId = home ? fixture.awayClubId : fixture.homeClubId;
  const opponent = career.world.league.clubs.find((c) => c.id === opponentId);
  if (!opponent) return undefined;

  return { fixture, opponent, home };
}

/** Results involving the managed club, most recent first. */
export function managedResults(career: Career): MatchResult[] {
  return career.season.results
    .filter((r) => r.homeClubId === career.managedClubId || r.awayClubId === career.managedClubId)
    .reverse();
}

/**
 * Wraps up the season and **opens the transfer window**, leaving it open for the
 * manager to act in. It no longer starts the next season -- call
 * `startNextSeason` once you are done trading.
 */
export function endSeason(career: Career): SeasonSummary {
  if (!isSeasonComplete(career)) {
    throw new Error('endSeason: the season still has rounds left to play');
  }

  const result = finaliseSeason(career.season);

  // Credit a season of watching your own players before closeSeason clears their
  // minutes.
  creditOwnSquad(career.scouting, managedClub(career).squad, career.world.season);

  const summary = closeSeason(career.world, career.rng, result, {
    deferWindow: true,
    managedClubId: career.managedClubId,
  });
  career.history.push(summary);

  return summary;
}

/**
 * Closes the window -- the AI does its own business -- and starts the new season.
 */
export function startNextSeason(career: Career): Transfer[] {
  const transfers = completeTransferWindow(career.world, career.rng, career.managedClubId);

  // The summary was written before the AI had traded; fold its business in.
  const last = career.history[career.history.length - 1];
  if (last) last.transfers = [...last.transfers, ...transfers];

  // Retired and departed players would otherwise accumulate in every save.
  pruneScouting(career.scouting, new Set(career.world.players.keys()));

  beginSeason(career.world);
  career.season = createSeasonState(career.world, career.rng, {
    economy: true,
    playerState: true,
  });

  return transfers;
}

// --- Acting in the window --------------------------------------------------

/** The open window, if there is one. */
export function transferWindow(career: Career): TransferWindowState | undefined {
  return career.world.transferWindow?.open ? career.world.transferWindow : undefined;
}

/** Bids on the table for your players. */
export function incomingOffers(career: Career): TransferOffer[] {
  return transferWindow(career)?.incoming.filter((o) => o.status === 'pending') ?? [];
}

/** Everyone you could sign, priced by the same rules the AI plays by. */
export function browseTargets(career: Career, options?: BrowseOptions): MarketListing[] {
  return transferTargets(career.world, career.managedClubId, options);
}

export function bidFor(
  career: Career,
  playerId: string,
  fee: number,
  wageOffer?: number,
): BidOutcome {
  return makeBid(career.rng, career.world, career.managedClubId, playerId, fee, wageOffer);
}

export function answerOffer(
  career: Career,
  offerId: string,
  response: 'accept' | 'reject',
): Transfer | undefined {
  return respondToOffer(career.world, offerId, response);
}

export function release(career: Career, playerId: string): boolean {
  return releasePlayer(career.world, career.managedClubId, playerId);
}

export function renewContract(
  career: Career,
  playerId: string,
  wage: number,
  years: number,
): boolean {
  return offerContract(career.world, career.managedClubId, playerId, wage, years);
}


// --- Team selection -------------------------------------------------------

/**
 * The eleven the engine would pick left to itself, expressed as a sheet. The
 * natural starting point for a selection screen, and identical to what happens
 * today if the manager never touches it.
 */
export function suggestedTeamSheet(career: Career, formation?: string): TeamSheet {
  const club = managedClub(career);
  const shape = formation && FORMATIONS[formation] ? formation : DEFAULT_FORMATION;
  const { lineup } = resolveTeamSheet(club, undefined, shape);

  return {
    clubId: club.id,
    formation: shape,
    starters: lineup.slots.map((slot) => slot.player.id),
    bench: lineup.bench.map((player) => player.id),
  };
}

/** The sheet that will be used for the next match, auto-picked if none is set. */
export function currentTeamSheet(career: Career): TeamSheet {
  return career.season.teamSheets.get(career.managedClubId) ?? suggestedTeamSheet(career);
}

/**
 * Who would actually take the pitch, and anything the engine had to correct.
 * A screen should call this immediately before kick-off as well as on open: a
 * player can pick up an injury between setting a sheet and playing it.
 */
export function previewLineup(career: Career): { lineup: Lineup; issues: TeamSheetIssue[] } {
  return resolveTeamSheet(
    managedClub(career),
    career.season.teamSheets.get(career.managedClubId),
    DEFAULT_FORMATION,
  );
}

/**
 * Stores a sheet and returns anything wrong with it. Deliberately does not throw:
 * a manager should be able to save a sheet containing a doubtful player and be
 * told about it, rather than have it rejected.
 */
export function setTeamSheet(career: Career, sheet: TeamSheet): TeamSheetIssue[] {
  career.season.teamSheets.set(career.managedClubId, {
    ...sheet,
    clubId: career.managedClubId,
  });
  return previewLineup(career).issues;
}

/** Hands selection back to the engine. */
export function clearTeamSheet(career: Career): void {
  career.season.teamSheets.delete(career.managedClubId);
}
