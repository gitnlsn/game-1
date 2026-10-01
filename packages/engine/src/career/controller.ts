import { Rng } from '../rng/index.js';
import type {
  Club,
  Fixture,
  MatchResult,
  League,
  Loan,
  SponsorDeal,
  SponsorOffer,
  TableRow,
  TeamSheet,
  TeamSheetIssue,
  Transfer,
  TransferOffer,
  TransferWindowState,
  World,
} from '../types.js';
import {
  createTransferWindow,
  generateIncomingOffers,
  makeBid,
  offerContract,
  prepareTransferWindow,
  shopTransferWindow,
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
  playFixture,
  isMidweek,
  fixtureCrowd,
  sponsorContext,
  type SeasonState,
} from '../league/season.js';
import { acceptSponsorOffer, rollSponsorOffer } from '../economy/sponsors.js';
import { availableCapacity, matchdayIncome } from '../economy/finances.js';
import {
  clampTicketLevel,
  staffLevels,
  startGroundWorks,
  type ExpansionOutcome,
} from '../economy/levers.js';
import type { StaffLevel, StaffLevels } from '../types.js';
import { DEFAULT_FORMATION, FORMATIONS } from '../world/positions.js';
import { shortNameFor } from '../world/clubs.js';
import { resolveTeamSheet, type Lineup } from '../match/ratings.js';
import {
  finishMatch,
  matchComplete,
  startMatch,
  stepMatch,
  type MatchInProgress,
} from '../match/engine.js';
import type { CupState, CupTie } from '../league/cup.js';
import {
  loanCandidates,
  loanOf,
  loanOut,
  loansFor,
  wouldTake,
  type LoanOutcome,
} from '../transfers/loans.js';
import { resolveTactics, type Tactics } from '../match/tactics.js';
import {
  boardMood,
  createBoardState,
  judgeSeason,
  refreshExpectation,
  type BoardState,
  type BoardVerdict,
} from './board.js';
import { allClubs, createWorld, findClub, leagueOf } from '../world/index.js';
import {
  createScoutingState,
  creditInheritedSquad,
  creditOpponent,
  creditOwnSquad,
  pruneScouting,
  resetScoutingCapacity,
  scoutedPotential,
  scoutedValue,
  scoutingRemaining,
  assignScout,
} from '../world/scouting.js';
import type {
  ListingKind,
  PotentialEstimate,
  Player,
  ProgressionPoint,
  ScoutingState,
  ShortlistEntry,
  TrainingFocus,
} from '../types.js';
import {
  beginSeason,
  closeSeason,
  completeTransferWindow,
  type SeasonSummary,
} from './career.js';
import { exactAbility } from './aging.js';
import { createRecords, recordSeason, type ClubRecords } from './records.js';
import {
  abilitySnapshot,
  DEVELOPMENT_TUNING,
  developWorld,
  leagueWeeks,
} from './seasonDevelopment.js';

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
  /** What the board makes of you. */
  board: BoardState;
  /**
   * Sponsor offers waiting for the manager's answer. Every other club's are
   * answered by the AI inside the season loop; only this club's wait here.
   */
  sponsorOffers: SponsorOffer[];
  /** Players the manager is watching, at other clubs or as free agents. */
  shortlist: ShortlistEntry[];
  /** Own players the manager has put up for sale or for loan. */
  listings: Record<string, ListingKind>;
  /** Training focus per own player. A player missing from it trains balanced. */
  training: Record<string, TrainingFocus>;
  /** Progression curve per player, for the squad and the shortlist. */
  progression: Record<string, ProgressionPoint[]>;
  /** League weeks of this season that players have already developed through. */
  developedWeeks: number;
  /** Every player's ability as this season began, to measure the season against. */
  seasonStartAbility: Record<string, number>;
  /** The managed club's history: seasons, players, records. */
  records: ClubRecords;
  /**
   * A sandbox career: the board cannot sack, and money can be added at will.
   * Fixed when the career starts. The app keeps sandbox careers off the
   * leaderboards, since nothing in them was earned.
   */
  sandbox: boolean;
}

/** What a career plays, as opposed to what the harnesses measure. */
export const CAREER_DEFAULTS = { divisions: 2, cup: true } as const;

export interface StartCareerOptions {
  seed: number | string;
  /** Club the player takes charge of. Defaults to the first club. */
  managedClubId?: string;
  clubCount?: number;
  leagueName?: string;
  nationality?: string;
  /**
   * Divisions in the pyramid. A career plays a two-division pyramid with a cup
   * by default; the headless harnesses build their own single-division worlds,
   * because what they measure is the shape of one division.
   */
  divisions?: number;
  /** Play a knockout cup alongside the league. On by default for a career. */
  cup?: boolean;
  /** Start a sandbox career; see `Career.sandbox`. */
  sandbox?: boolean;
}

export function startCareer(options: StartCareerOptions): Career {
  const world = createWorld({
    seed: options.seed,
    ...(options.clubCount !== undefined ? { clubCount: options.clubCount } : {}),
    divisions: options.divisions ?? CAREER_DEFAULTS.divisions,
    ...(options.leagueName !== undefined ? { leagueName: options.leagueName } : {}),
    ...(options.nationality !== undefined ? { nationality: options.nationality } : {}),
  });

  const rng = new Rng(`${options.seed}:career`);
  const managedClubId = options.managedClubId ?? allClubs(world)[0]!.id;

  beginSeason(world);
  const season = createSeasonState(world, rng, {
    economy: true,
    playerState: true,
    cup: options.cup ?? CAREER_DEFAULTS.cup,
  });

  const career: Career = {
    world,
    rng,
    managedClubId,
    season,
    history: [],
    scouting: createScoutingState(),
    board: createBoardState(world, managedClubId),
    sponsorOffers: [],
    shortlist: [],
    listings: {},
    training: {},
    progression: {},
    developedWeeks: 0,
    seasonStartAbility: {},
    records: createRecords(),
    sandbox: options.sandbox === true,
  };

  // You start knowing your own squad reasonably well: your coaches have watched
  // them every day, even if you have not seen them play yet.
  creditInheritedSquad(career.scouting, managedClub(career).squad, world.season);
  openSeasonDevelopment(career);
  return career;
}

export function managedClub(career: Career): Club {
  const club = allClubs(career.world).find((c) => c.id === career.managedClubId);
  if (!club) throw new Error(`managedClub: no club ${career.managedClubId}`);
  return club;
}

/** Plays the next round of fixtures. Returns every result, across all clubs. */
export function advanceRound(career: Career): MatchResult[] {
  closeMidSeasonWindowIfDue(career);
  const results = playRound(career.season, { humanClubId: career.managedClubId });

  // Facing a side teaches you about it. Done here rather than inside the season
  // loop so the headless path stays free of scouting entirely.
  const own = results.find(
    (r) => r.homeClubId === career.managedClubId || r.awayClubId === career.managedClubId,
  );
  if (own) {
    const opponentId = own.homeClubId === career.managedClubId ? own.awayClubId : own.homeClubId;
    const opponent = findClub(career.world, opponentId);
    if (opponent) {
      const active = new Set(
        own.events.filter((e) => e.clubId === opponentId).map((e) => e.playerId),
      );
      creditOpponent(career.scouting, opponent.squad, active, career.world.season);
    }
  }

  offerManagedSponsor(career, results);
  developIfDue(career);
  openMidSeasonWindowIfDue(career);
  return results;
}

// --- The mid-season window --------------------------------------------------

/**
 * A second, smaller window halfway through the league season, open to every
 * club. It runs alongside the matches rather than stopping them: while it is
 * open the manager trades as in the close season, and when it shuts the AI
 * clubs make their own, fewer, signings.
 *
 * Only a played career has one. The headless harnesses simulate seasons
 * without the controller, so what they measure is unchanged.
 */
export const MID_SEASON_WINDOW = {
  /** Opens once this share of the season's matchdays has been played. */
  opensAt: 0.5,
  /** Matchdays it stays open for. */
  matchdays: 4,
  /** Signings per AI club when it shuts, against four in the close season. */
  maxSignings: 1,
  positionsShopped: 2,
} as const;

function openMidSeasonWindowIfDue(career: Career): void {
  const { world, season } = career;
  const existing = world.transferWindow;
  if (existing?.open) return;
  if (existing?.midSeason && existing.season === world.season) return;

  const played = season.nextRound - 1;
  if (played < Math.ceil(season.totalRounds * MID_SEASON_WINDOW.opensAt)) return;
  // Not so late that it would still be open when the season ends.
  if (season.totalRounds - played <= MID_SEASON_WINDOW.matchdays) return;

  // Clubs clear the decks first, exactly as before a close-season window.
  const transfers = prepareTransferWindow(career.rng, world, { skipClubIds: [career.managedClubId] });
  const window = createTransferWindow(world.season);
  window.midSeason = true;
  window.closesBeforeRound = season.nextRound + MID_SEASON_WINDOW.matchdays;
  window.completed.push(...transfers);
  window.incoming = generateIncomingOffers(career.rng, world, career.managedClubId, {
    listed: new Set(Object.keys(career.listings).filter((id) => career.listings[id] === 'transfer')),
  });
  world.transferWindow = window;
}

function closeMidSeasonWindowIfDue(career: Career): void {
  const window = transferWindow(career);
  if (!window?.midSeason) return;
  if (career.season.nextRound < (window.closesBeforeRound ?? 0) && !isSeasonComplete(career)) return;
  closeMidSeasonWindow(career);
}

/** Shuts the mid-season window: the AI's signings, then nothing more until summer. */
export function closeMidSeasonWindow(career: Career): Transfer[] {
  const window = transferWindow(career);
  if (!window?.midSeason) return [];
  const transfers = shopTransferWindow(career.rng, career.world, {
    skipClubIds: [career.managedClubId],
    maxSignings: MID_SEASON_WINDOW.maxSignings,
    positionsShopped: MID_SEASON_WINDOW.positionsShopped,
  });
  window.completed.push(...transfers);
  window.open = false;
  pruneManagerState(career);
  return transfers;
}

/** Whether the open window, if any, is the mid-season one. */
export function isMidSeasonWindow(career: Career): boolean {
  return transferWindow(career)?.midSeason === true;
}

/**
 * Once a round is over: drops offers that have run out, and rolls for a new one
 * for the managed club, which is left waiting for the manager to answer.
 */
function offerManagedSponsor(career: Career, roundResults: readonly MatchResult[]): void {
  const state = career.season;
  const round = state.nextRound - 1;
  career.sponsorOffers = career.sponsorOffers.filter(
    (offer) => offer.season === career.world.season && offer.expiresRound >= state.nextRound,
  );
  if (!state.options.economy || isMidweek(state, round)) return;

  const club = managedClub(career);
  const league = managedLeague(career);
  const ctx = sponsorContext(
    state,
    club,
    league,
    currentTable(state, league.id),
    round,
    roundResults,
    career.sponsorOffers.length > 0,
  );
  const offer = rollSponsorOffer(new Rng(`sponsor:${state.rng.getState()}:${club.id}`), club, ctx);
  if (!offer) return;

  club.finances.lastSponsorOfferRound = round;
  career.sponsorOffers.push(offer);
}

/** Sponsor offers the manager has yet to answer. */
export function pendingSponsorOffers(career: Career): SponsorOffer[] {
  return career.sponsorOffers.filter(
    (offer) =>
      offer.season === career.world.season && offer.expiresRound >= career.season.nextRound,
  );
}

/** Rounds left to answer an offer, counting the one about to be played. */
export function sponsorOfferWeeksLeft(career: Career, offer: SponsorOffer): number {
  return Math.max(0, offer.expiresRound - career.season.nextRound + 1);
}

/**
 * Signs or turns down a sponsor offer. Returns false when the offer is no longer
 * on the table -- it ran out, or it has already been answered.
 */
export function answerSponsorOffer(
  career: Career,
  offerId: string,
  response: 'accept' | 'decline',
): boolean {
  const offer = pendingSponsorOffers(career).find((o) => o.id === offerId);
  if (!offer) return false;

  career.sponsorOffers = career.sponsorOffers.filter((o) => o.id !== offerId);
  if (response === 'accept') acceptSponsorOffer(managedClub(career), offer);
  return true;
}

// --- Running the club's money ---------------------------------------------

/** Sets the ticket price, as a multiple of normal. Returns the level applied. */
export function setTicketLevel(career: Career, level: number): number {
  const applied = clampTicketLevel(level);
  const finances = managedClub(career).finances;
  if (applied === 1) delete finances.ticketPriceLevel;
  else finances.ticketPriceLevel = applied;
  return applied;
}

export interface GateForecast {
  attendance: number;
  capacity: number;
  revenue: number;
  /** Same match at the normal price, for comparison. */
  normalAttendance: number;
  normalRevenue: number;
}

/**
 * What the next home match would draw and earn at a given price. Priced against
 * a typical visitor so the forecast does not jump about with the fixture list.
 */
export function gateForecast(career: Career, level: number): GateForecast {
  const club = managedClub(career);
  const games = career.season.played.get(club.id) ?? 0;
  const pointsPerGame = games === 0 ? 1.3 : (career.season.points.get(club.id) ?? 0) / games;
  const typical = { ...club, reputation: 60 };
  const at = matchdayIncome(club, typical, pointsPerGame, clampTicketLevel(level));
  const normal = matchdayIncome(club, typical, pointsPerGame, 1);
  return {
    attendance: at.attendance,
    // The seats on sale, which is fewer than the ground holds while it is being rebuilt.
    capacity: availableCapacity(club),
    revenue: at.revenue,
    normalAttendance: normal.attendance,
    normalRevenue: normal.revenue,
  };
}

/** Sets how much the club spends on one line of staff. */
export function setStaffLevel(career: Career, key: keyof StaffLevels, level: StaffLevel): void {
  const finances = managedClub(career).finances;
  const next = { ...staffLevels(managedClub(career)), [key]: level };
  if (next.medical === 0 && next.coaching === 0 && next.academy === 0) delete finances.staff;
  else finances.staff = next;
}

/**
 * Starts expanding the ground. During the season part of it closes while the
 * work goes on; between seasons it is done before the next one starts.
 */
export function expandGround(career: Career, seats: number): ExpansionOutcome {
  return startGroundWorks(managedClub(career), seats, !isSeasonComplete(career));
}

/** Signed deals still to settle: bonuses to earn, advances to pay back. */
export function sponsorDeals(career: Career): SponsorDeal[] {
  return managedClub(career).finances.sponsorDeals ?? [];
}

/** Your scouts' read on how good a player might become. Never an exact number. */
export function scoutReport(career: Career, player: Player): PotentialEstimate {
  return scoutedPotential(career.world.seed, career.scouting, player);
}

/** What a player looks worth on your reading, as opposed to what he will cost. */
export function scoutValuation(career: Career, player: Player): number {
  return scoutedValue(career.world.seed, career.scouting, player);
}

/** Scouting assignments left this close season. */
export function scoutsAvailable(career: Career): number {
  return scoutingRemaining(career.scouting, managedClub(career).reputation);
}

/**
 * Sends a scout to watch a player. Returns false when there is no capacity left
 * -- you cannot look closely at everyone, which is what makes choosing who to
 * look at a decision.
 */
export function scoutPlayer(career: Career, playerId: string): boolean {
  const player = career.world.players.get(playerId);
  if (!player) return false;
  return assignScout(
    career.scouting,
    player,
    managedClub(career).reputation,
    career.world.season,
  );
}

export function isSeasonComplete(career: Career): boolean {
  return seasonComplete(career.season);
}

export function leagueTable(career: Career): TableRow[] {
  /*
   * The manager's OWN division, not the top one. Defaulting to tier 1 meant a
   * second-division manager's club screen read "0/38 played, not started" all
   * season, because their club was nowhere in the table being consulted.
   */
  return currentTable(career.season, managedLeague(career).id);
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
  /** What the match is: the division's name, or the cup's. */
  competition: string;
  isCup: boolean;
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
  const opponent = findClub(career.world, opponentId);
  if (!opponent) return undefined;

  const isCup = fixture.competitionId === career.season.cup?.competitionId;
  const competition = isCup
    ? (career.season.cup?.name ?? 'Cup')
    : (career.world.leagues.find((l) => l.id === fixture.competitionId)?.name ?? '');

  return { fixture, opponent, home, competition, isCup };
}

/** Every division with its table, top tier first. */
export function divisionTables(career: Career): { league: League; table: TableRow[] }[] {
  return career.world.leagues.map((league) => ({
    league,
    table: currentTable(career.season, league.id),
  }));
}

/** The division the managed club is in. */
export function managedLeague(career: Career): League {
  return leagueOf(career.world, career.managedClubId) ?? career.world.leagues[0]!;
}

/** The knockout in progress, if there is one. */
export function currentCup(career: Career): CupState | undefined {
  return career.season.cup;
}

export interface CupProgress {
  name: string;
  /** Ties the managed club has played, earliest first. */
  ties: CupTie[];
  /** True while they are still in it. */
  stillIn: boolean;
  /** The round they went out in, or won in. */
  roundsSurvived: number;
  won: boolean;
  /** How many clubs are left, for naming the round a screen is showing. */
  remaining: number;
}

/** How the managed club's cup run is going. */
export function cupRun(career: Career): CupProgress | undefined {
  const cup = career.season.cup;
  if (!cup) return undefined;

  const ties = cup.ties.filter(
    (tie) => tie.homeClubId === career.managedClubId || tie.awayClubId === career.managedClubId,
  );
  const stillIn = cup.remaining.includes(career.managedClubId);

  return {
    name: cup.name,
    ties,
    stillIn,
    roundsSurvived: ties.filter((tie) => tie.winnerClubId === career.managedClubId).length,
    won: cup.winnerClubId === career.managedClubId,
    remaining: cup.remaining.length,
  };
}

/**
 * What to call a round with this many clubs left. A screen should not have to
 * work out that four clubs left means the semi-finals.
 */
export function cupRoundName(clubsRemaining: number): string {
  if (clubsRemaining <= 1) return 'Winners';
  if (clubsRemaining === 2) return 'Final';
  if (clubsRemaining <= 4) return 'Semi-finals';
  if (clubsRemaining <= 8) return 'Quarter-finals';
  /*
   * "Round of 40" would be wrong: in the first round only the sixteen smallest
   * clubs play, and the other twenty-four have byes. A round is only "of n" once
   * everybody left is actually in it, which is to say once n is a power of two.
   */
  const isPowerOfTwo = (clubsRemaining & (clubsRemaining - 1)) === 0;
  return isPowerOfTwo ? `Round of ${clubsRemaining}` : 'First round';
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

  // Whatever is left of the season's development, while minutes still count.
  developThrough(career, leagueWeeks(career.season).played);

  // The mid-season window's business belongs in this season's summary, and
  // the close-season window is about to take its place.
  closeMidSeasonWindow(career);
  const midSeason = career.world.transferWindow;
  const midSeasonTransfers =
    midSeason?.midSeason && midSeason.season === career.world.season ? midSeason.completed : [];

  const result = finaliseSeason(career.season);
  // An offer cannot outlive the season it was made in.
  career.sponsorOffers = [];

  // Credit a season of watching your own players before closeSeason clears their
  // minutes.
  creditOwnSquad(career.scouting, managedClub(career).squad, career.world.season);

  /*
   * The board judges the season BEFORE the close season moves anybody, so the
   * table it reads is the division that was actually played in. Judge after and
   * a relegated club is measured against its new division, where it finished
   * nowhere at all.
   */
  const league = leagueOf(career.world, career.managedClubId)!;
  const tierIndex = career.world.leagues.indexOf(league);
  const table = result.tables[tierIndex] ?? result.table;
  const cup = career.season.cup;
  const cupResult = cupOutcome(career, cup);

  /*
   * The records are written before closeSeason too: it wipes every player's
   * numbers for the new season and starts moving players on. Promotion is not
   * known yet, so the line's movement is filled in once it is.
   */
  const club = managedClub(career);
  const run = cupRun(career);
  recordSeason(career.records, {
    season: career.world.season,
    clubId: club.id,
    clubName: club.name,
    squad: club.squad,
    borrowed: new Set(
      career.world.loans.filter((loan) => loan.clubId === club.id).map((loan) => loan.playerId),
    ),
    league,
    table,
    results: career.season.results,
    clubNames: (id) => findClub(career.world, id)?.name ?? 'Unknown',
    ...(run ? { cup: { name: run.name, roundsWon: run.roundsSurvived, finish: cupResult } } : {}),
  });

  const summary = closeSeason(career.world, career.rng, result, {
    deferWindow: true,
    managedClubId: career.managedClubId,
    listedPlayerIds: Object.keys(career.listings).filter((id) => career.listings[id] === 'transfer'),
    developedInSeason: career.seasonStartAbility,
  });
  summary.transfers = [...midSeasonTransfers, ...summary.transfers];
  career.history.push(summary);

  const moved = summary.promotions.find((p) => p.clubId === career.managedClubId);
  const line = career.records.seasons[career.records.seasons.length - 1];
  if (line && moved) line.movement = moved.to < moved.from ? 'promoted' : 'relegated';

  summary.verdict = judgeSeason(career.board, {
    cannotSack: career.sandbox,
    table,
    clubId: career.managedClubId,
    league,
    relegated: moved !== undefined && moved.to > moved.from,
    promoted: moved !== undefined && moved.to < moved.from,
    ...(cupResult ? { cupResult } : {}),
  });

  return summary;
}

/** How far the managed club went in the cup, if there was one. */
function cupOutcome(career: Career, cup: CupState | undefined): 'won' | 'final' | undefined {
  if (!cup) return undefined;
  if (cup.winnerClubId === career.managedClubId) return 'won';
  const last = cup.ties[cup.ties.length - 1];
  if (last && (last.homeClubId === career.managedClubId || last.awayClubId === career.managedClubId)) {
    return 'final';
  }
  return undefined;
}

/** What the board makes of you right now. */
export function boardConfidence(career: Career): {
  confidence: number;
  mood: string;
  expectation: number;
  sacked: boolean;
} {
  return {
    confidence: Math.round(career.board.confidence),
    mood: boardMood(career.board.confidence),
    expectation: career.board.expectation,
    sacked: career.board.sacked === true,
  };
}

/** True once the board has dismissed you and the career is over. */
export function isSacked(career: Career): boolean {
  return career.board.sacked === true;
}

/**
 * Closes the window -- the AI does its own business -- and starts the new season.
 */
export function startNextSeason(career: Career): Transfer[] {
  // The mid-season window is open while matches are still being played.
  if (!isSeasonComplete(career)) {
    throw new Error('startNextSeason: the season is still being played');
  }
  // Before the AI trades, so a listed player goes where you would have sent him
  // and not to whoever the loan market happens to reach first.
  placeListedLoans(career);
  const transfers = completeTransferWindow(career.world, career.rng, career.managedClubId);

  // The summary was written before the AI had traded; fold its business in.
  const last = career.history[career.history.length - 1];
  if (last) last.transfers = [...last.transfers, ...transfers];

  // Retired and departed players would otherwise accumulate in every save.
  pruneScouting(career.scouting, new Set(career.world.players.keys()));
  pruneManagerState(career);
  resetScoutingCapacity(career.scouting);
  // The board re-reads the squad it has just paid for, in the division it is
  // now in -- a promoted club is asked to survive, not to finish where it did.
  refreshExpectation(career.board, career.world, career.managedClubId);

  beginSeason(career.world);
  career.season = createSeasonState(career.world, career.rng, {
    economy: true,
    playerState: true,
    cup: career.season.options.cup ?? CAREER_DEFAULTS.cup,
  });
  openSeasonDevelopment(career);

  return transfers;
}

// --- Acting in the window --------------------------------------------------

/** A match the manager is watching and running, minute by minute. */
export interface LiveMatch {
  match: MatchInProgress;
  fixture: Fixture;
  /** Which side of the match is the manager's. */
  side: 'home' | 'away';
  /** Everybody else's results from the same round, played already. */
  otherResults: MatchResult[];
}

/**
 * Starts the managed club's next match and holds the round open.
 *
 * Every other fixture in the round is played immediately -- only this one waits.
 * The alternative, pausing the whole world, would mean the league table moved in
 * jumps around whatever minute the manager happened to be watching.
 */
export function beginLiveMatch(career: Career): LiveMatch | undefined {
  closeMidSeasonWindowIfDue(career);
  const upcoming = nextFixture(career);
  if (!upcoming) return undefined;

  const otherResults = playRound(career.season, {
    skipClubId: career.managedClubId,
    humanClubId: career.managedClubId,
  });

  const home = findClub(career.world, upcoming.fixture.homeClubId);
  const away = findClub(career.world, upcoming.fixture.awayClubId);
  if (!home || !away) return undefined;

  const side = upcoming.home ? 'home' : 'away';
  const ownSheet = career.season.teamSheets.get(career.managedClubId);
  const opponentSheet = career.season.teamSheets.get(upcoming.opponent.id);

  const homeCrowd = fixtureCrowd(career.season, home, away);
  const match = startMatch(career.rng, home, away, {
    updatePlayerState: true,
    manualSide: side,
    ...(homeCrowd !== 1 ? { homeCrowd } : {}),
    ...(upcoming.home
      ? {
          ...(ownSheet ? { homeSheet: ownSheet } : {}),
          ...(opponentSheet ? { awaySheet: opponentSheet } : {}),
        }
      : {
          ...(opponentSheet ? { homeSheet: opponentSheet } : {}),
          ...(ownSheet ? { awaySheet: ownSheet } : {}),
        }),
  });

  return { match, fixture: upcoming.fixture, side, otherResults };
}

/** Blows the whistle, books the result and closes the round. */
export function endLiveMatch(live: LiveMatch, career: Career): MatchResult {
  while (!matchComplete(live.match)) stepMatch(live.match);
  const result = playFixture(career.season, live.fixture, finishMatch(live.match));
  offerManagedSponsor(career, [result]);
  developIfDue(career);
  openMidSeasonWindowIfDue(career);
  return result;
}

/** Players the manager could send out to get football. */
export function loanableSquad(career: Career): Player[] {
  return loanCandidates(career.world, career.managedClubId);
}

/** Clubs that would take this player, best-fitting first. */
export function loanSuitors(career: Career, playerId: string): Club[] {
  const player = career.world.players.get(playerId);
  if (!player) return [];

  return allClubs(career.world)
    .filter((club) => club.id !== career.managedClubId && wouldTake(club, player))
    .sort((a, b) => b.reputation - a.reputation);
}

/** Sends a player out on loan. Only while the window is open. */
export function sendOnLoan(career: Career, playerId: string, toClubId: string): LoanOutcome {
  if (!transferWindow(career)) return { agreed: false, reason: 'window_closed' };
  return loanOut(career.world, career.managedClubId, toClubId, playerId);
}

export interface LoanRecord {
  loan: Loan;
  player: Player;
  otherClub: Club | undefined;
}

/** Players the managed club has sent out. */
export function playersOnLoan(career: Career): LoanRecord[] {
  return loansFor(career.world, career.managedClubId).flatMap((loan) => {
    const player = career.world.players.get(loan.playerId);
    return player
      ? [{ loan, player, otherClub: findClub(career.world, loan.clubId) }]
      : [];
  });
}

/** Players in the managed squad who belong to somebody else. */
export function playersBorrowed(career: Career): LoanRecord[] {
  return career.world.loans
    .filter((loan) => loan.clubId === career.managedClubId)
    .flatMap((loan) => {
      const player = career.world.players.get(loan.playerId);
      return player
        ? [{ loan, player, otherClub: findClub(career.world, loan.parentClubId) }]
        : [];
    });
}

/** Where a player actually is, for a screen that has one to describe. */
export function loanStatus(
  career: Career,
  playerId: string,
): { kind: 'out' | 'in'; otherClub: Club | undefined } | undefined {
  const loan = loanOf(career.world, playerId);
  if (!loan) return undefined;

  return loan.parentClubId === career.managedClubId
    ? { kind: 'out', otherClub: findClub(career.world, loan.clubId) }
    : { kind: 'in', otherClub: findClub(career.world, loan.parentClubId) };
}

/** The open window, if there is one. */
export function transferWindow(career: Career): TransferWindowState | undefined {
  return career.world.transferWindow?.open ? career.world.transferWindow : undefined;
}

/** Bids on the table for your players -- still unanswered, for players still at the club. */
export function incomingOffers(career: Career): TransferOffer[] {
  const squad = new Set(managedClub(career).squad.map((p) => p.id));
  return (
    transferWindow(career)?.incoming.filter(
      (o) => o.status === 'pending' && squad.has(o.playerId),
    ) ?? []
  );
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
  if (!transferWindow(career)) return { accepted: false, reason: 'window_closed' };
  return makeBid(career.rng, career.world, career.managedClubId, playerId, fee, wageOffer);
}

export function answerOffer(
  career: Career,
  offerId: string,
  response: 'accept' | 'reject',
): Transfer | undefined {
  // A closed window keeps its unanswered bids on record; they are history now.
  if (!transferWindow(career)) return undefined;
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
  /*
   * A sheet with no `tactics` means the caller is not talking about tactics, not
   * that it wants them cleared -- so the standing instructions survive. Without
   * this, a selection screen that saves the eleven at kick-off silently wipes
   * whatever the manager set up, because the two are edited at different moments
   * and the eleven is the one that gets written last.
   */
  const existing = career.season.teamSheets.get(career.managedClubId);
  career.season.teamSheets.set(career.managedClubId, {
    ...sheet,
    clubId: career.managedClubId,
    ...(sheet.tactics ?? existing?.tactics
      ? { tactics: sheet.tactics ?? existing!.tactics! }
      : {}),
  });
  return previewLineup(career).issues;
}

/** Hands selection back to the engine. */
export function clearTeamSheet(career: Career): void {
  career.season.teamSheets.delete(career.managedClubId);
}

/** How the side is currently set up. Balanced until the manager says otherwise. */
export function tactics(career: Career): Tactics {
  return resolveTactics(career.season.teamSheets.get(career.managedClubId)?.tactics);
}

/**
 * Changes how the side is set up without touching who is in it.
 *
 * Separate from `setTeamSheet` on purpose: instructions and selection are
 * different decisions made at different moments, and going through the sheet
 * would mean a screen that only wants to change the mentality has to hold a
 * whole eleven correctly to avoid clobbering it.
 */
export function setTactics(career: Career, patch: Partial<Tactics>): Tactics {
  const sheet = currentTeamSheet(career);
  const next = resolveTactics({ ...tactics(career), ...patch });
  career.season.teamSheets.set(career.managedClubId, {
    ...sheet,
    clubId: career.managedClubId,
    tactics: next,
  });
  return next;
}

// --- The manager's own records -------------------------------------------

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

/**
 * Sends out everyone listed for loan who is still at the club, to the smallest
 * club that would play him: a loan is for minutes, and those are surest where
 * he would walk into the side. Runs as the window closes.
 */
export function placeListedLoans(career: Career): { playerId: string; clubName: string }[] {
  const placed: { playerId: string; clubName: string }[] = [];
  for (const [playerId, kind] of Object.entries(career.listings)) {
    if (kind !== 'loan') continue;
    if (loanOf(career.world, playerId)) continue;
    const suitors = loanSuitors(career, playerId);
    const club = suitors[suitors.length - 1];
    if (!club) continue;
    if (sendOnLoan(career, playerId, club.id).agreed) {
      placed.push({ playerId, clubName: club.name });
      delete career.listings[playerId];
    }
  }
  return placed;
}


// --- Development through the season -----------------------------------------

/** Runs a development step if a month has gone by since the last. */
function developIfDue(career: Career): void {
  const { played } = leagueWeeks(career.season);
  if (played - career.developedWeeks >= DEVELOPMENT_TUNING.weeksPerStep) developThrough(career, played);
}

/** Develops the world through to `week`, your players with their training focus. */
function developThrough(career: Career, week: number): void {
  if (week <= career.developedWeeks) return;
  developWorld(career.world, career.season, career.developedWeeks, week, (id) => career.training[id]);
  career.developedWeeks = week;
  recordProgression(career, week);
}

/** Starts a season's development: nothing developed yet, and where everyone starts from. */
function openSeasonDevelopment(career: Career): void {
  career.developedWeeks = 0;
  career.seasonStartAbility = abilitySnapshot(career.world);
  recordProgression(career, 0);
}

/** Players worth drawing a curve for: your own, and the ones you are watching. */
function trackedPlayers(career: Career): Player[] {
  const own = [
    ...managedClub(career).squad.filter((p) => ownsPlayer(career, p)),
    ...playersOnLoan(career).map((record) => record.player),
  ];
  const watched = career.shortlist.flatMap((entry) => {
    const player = career.world.players.get(entry.playerId);
    return player ? [player] : [];
  });
  return [...own, ...watched];
}

function recordProgression(career: Career, week: number): void {
  const season = career.world.season;
  for (const player of trackedPlayers(career)) {
    const report = scoutReport(career, player);
    const point: ProgressionPoint = [
      season,
      week,
      Math.round(exactAbility(player) * 10) / 10,
      report.low,
      report.high,
    ];
    const curve = (career.progression[player.id] ??= []);
    const last = curve[curve.length - 1];
    if (last && last[0] === season && last[1] === week) curve[curve.length - 1] = point;
    else curve.push(point);
    career.progression[player.id] = compactCurve(curve, season);
  }
}

/** Older seasons keep only their last point, so a long career does not bloat the save. */
function compactCurve(curve: ProgressionPoint[], season: number): ProgressionPoint[] {
  const from = season - DEVELOPMENT_TUNING.detailedSeasons + 1;
  return curve.filter((point, index) => {
    if (point[0] >= from) return true;
    const next = curve[index + 1];
    return !next || next[0] !== point[0];
  });
}

/** A player's curve, oldest point first. Empty until there is something to draw. */
export function progressionOf(career: Career, playerId: string): ProgressionPoint[] {
  return career.progression[playerId] ?? [];
}

/** How much a player has moved this season, to the decimal. */
export function seasonChange(career: Career, player: Player): number | undefined {
  const start = career.seasonStartAbility[player.id];
  return start === undefined ? undefined : exactAbility(player) - start;
}

/** What a player is working on in training. */
export function trainingFocus(career: Career, playerId: string): TrainingFocus {
  return career.training[playerId] ?? 'balanced';
}

/** Sets what one of your players works on. Returns false for anyone not yours. */
export function setTrainingFocus(career: Career, playerId: string, focus: TrainingFocus): boolean {
  const player = career.world.players.get(playerId);
  if (!player || !ownsPlayer(career, player)) return false;
  if (focus === 'balanced') delete career.training[playerId];
  else career.training[playerId] = focus;
  return true;
}

// --- Sandbox and editor ---------------------------------------------------

/**
 * Adds money to the managed club, spendable straight away: bids are capped by
 * the transfer budget rather than the balance, so both go up. The budget is
 * worked out from cash again at the next season's start, as it always is.
 * Sandbox careers only; false otherwise.
 */
export function sandboxGrant(career: Career, amount: number): boolean {
  if (!career.sandbox || !(amount > 0)) return false;
  const finances = managedClub(career).finances;
  finances.balance += amount;
  finances.transferBudget += amount;
  return true;
}

/** The longest name the editor accepts, so a name always fits on a row. */
export const MAX_NAME_LENGTH = 28;

function cleanName(name: string): string | undefined {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) return undefined;
  return trimmed;
}

/**
 * Renames a player anywhere in the world. The name is shown as typed; the
 * first and last names follow it so anything that sorts or abbreviates by
 * them keeps agreeing with what is on screen. History keeps the old name:
 * last season's records describe last season.
 */
export function renamePlayer(career: Career, playerId: string, name: string): boolean {
  const cleaned = cleanName(name);
  const player = cleaned ? findPlayerAnywhere(career, playerId) : undefined;
  if (!cleaned || !player) return false;
  const parts = cleaned.split(' ');
  player.displayName = cleaned;
  player.firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : cleaned;
  player.lastName = parts[parts.length - 1]!;
  return true;
}

/** Renames a club, and optionally its city. The short name follows the name. */
export function renameClub(
  career: Career,
  clubId: string,
  edit: { name?: string; city?: string },
): boolean {
  const club = findClub(career.world, clubId);
  if (!club) return false;
  const name = edit.name !== undefined ? cleanName(edit.name) : club.name;
  const city = edit.city !== undefined ? cleanName(edit.city) : club.city;
  if (!name || !city) return false;
  club.name = name;
  club.city = city;
  club.shortName = shortNameFor(name);
  return true;
}

function findPlayerAnywhere(career: Career, playerId: string): Player | undefined {
  for (const club of allClubs(career.world)) {
    const player = club.squad.find((p) => p.id === playerId);
    if (player) return player;
  }
  return career.world.freeAgents.find((p) => p.id === playerId);
}
