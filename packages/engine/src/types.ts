import type { Tactics } from './match/tactics.js';

/** Every attribute is on a 1-100 scale. 50 is a competent lower-division pro. */
export interface Attributes {
  // Technical
  finishing: number;
  passing: number;
  dribbling: number;
  crossing: number;
  tackling: number;
  heading: number;
  // Mental
  vision: number;
  composure: number;
  positioning: number;
  workRate: number;
  // Physical
  pace: number;
  strength: number;
  stamina: number;
  // Goalkeeping (near-zero for outfield players)
  reflexes: number;
  handling: number;
  distribution: number;
}

export type AttributeKey = keyof Attributes;

export type Position = 'GK' | 'CB' | 'LB' | 'RB' | 'DM' | 'CM' | 'AM' | 'LW' | 'RW' | 'ST';

export type PositionGroup = 'GK' | 'DEF' | 'MID' | 'FWD';

export interface Contract {
  /** Weekly wage, in the engine's neutral money units. */
  wage: number;
  /** Seasons left to run. At 0 the player leaves on a free transfer. */
  yearsRemaining: number;
}

/**
 * Everything about a player that changes week to week rather than season to
 * season. Condition, form and morale all feed into how well they actually play,
 * so a tired, out-of-form player is measurably worse than their ability implies.
 */
export interface PlayerStatus {
  /** Match fitness, 0-100. Falls with minutes played, recovers with rest. */
  condition: number;
  /** Short-term form, -10 to +10. Moves with performances and results. */
  form: number;
  /** Morale, 0-100. Driven by results and by getting a game. */
  morale: number;
  /** Matches still to sit out injured. 0 means fit. */
  injuryMatches: number;
  /** Matches still to sit out suspended. */
  suspensionMatches: number;
  /** Yellow cards this season; enough of them earns a ban. */
  yellowCards: number;
  redCards: number;
  appearances: number;
  minutes: number;
  goals: number;
  assists: number;
}

export interface Player {
  id: string;
  firstName: string;
  lastName: string;
  /** Display name: a nickname, two forenames, "F. Lastname" or, for Brazilians and Portuguese, the full name. */
  displayName: string;
  nationality: string;
  age: number;
  position: Position;
  attributes: Attributes;
  /**
   * True ceiling on ability, 1-100. Development pushes ability toward it and
   * never past it.
   *
   * ENGINE-PRIVATE. This is the simulation's ground truth and nothing
   * player-facing may read it -- the UI goes through `scoutedPotential`, which
   * returns a range rather than a number. The AI is deliberately allowed to read
   * it directly; see the note in `world/scouting.ts` for why.
   */
  hiddenPotential: number;
  contract: Contract;
  status: PlayerStatus;
  /**
   * The club whose squad he is in, or undefined for a free agent.
   *
   * Maintained alongside squad membership rather than replacing it: squads stay
   * arrays because order matters for selection, but "which club is this player
   * at" is now O(1) instead of a scan of every squad in the world -- and a loan
   * needs somewhere to say that where he plays is not who owns him.
   */
  clubId: string | undefined;
  /**
   * Development that has not yet added up to a whole attribute point, in
   * ability points. Only set for careers, which develop players through the
   * season in steps too small to land on whole-number attributes.
   */
  abilityCarry?: number;
  /** The same, per attribute, for a player training with a focus. */
  progress?: Partial<Record<AttributeKey, number>>;
}

/**
 * Money in and out for a single season. Positive numbers throughout; `wages`
 * and `playerPurchases` are costs, not negative income.
 */
export interface FinancialRecord {
  gateReceipts: number;
  sponsorship: number;
  prizeMoney: number;
  playerSales: number;
  wages: number;
  /** Staff, stadium, academy, travel, admin -- everything that is not wages. */
  operatingCosts: number;
  /** Ground expansion and other capital spending. */
  infrastructure: number;
  /** Profit taken out by the owners once reserves are comfortable. */
  ownerDrawings: number;
  playerPurchases: number;
  /**
   * Money from sponsor deals signed during the season, kept apart from the
   * regular sponsorship so the books show what the deals actually brought in.
   * Optional because saves from before the deals existed do not have it.
   */
  sponsorDeals?: number;
}

export interface ClubFinances {
  /** Cash in the bank. Going negative is debt, not an error. */
  balance: number;
  stadiumCapacity: number;
  ticketPrice: number;
  sponsorshipPerSeason: number;
  /** Cash the club is willing to commit to fees this window. */
  transferBudget: number;
  /** Weekly wage ceiling the club will not knowingly exceed. */
  wageBudget: number;
  season: FinancialRecord;
  /** Sponsor deals signed but not settled yet: a bonus to earn, a cut to take. */
  sponsorDeals?: SponsorDeal[];
  /** League round of this season's last sponsor offer, for the cooldown. */
  lastSponsorOfferRound?: number;
  /**
   * Ticket price as a multiple of the club's normal price. Absent means 1: the
   * AI never touches it, and a club that has never been told otherwise charges
   * what it always did.
   */
  ticketPriceLevel?: number;
  /** Spending on staff. Absent means standard across the board. */
  staff?: StaffLevels;
  /**
   * Weeks spent at each coaching and academy level this season, summed. Their
   * payoff comes at season end, and is judged on the season's average rather
   * than the level on the last day -- otherwise going elite for one week buys a
   * whole season's development.
   */
  staffWeeks?: { coaching: number; academy: number; weeks: number };
  /** Ground expansion under way, if any. */
  groundWorks?: GroundWorks;
}

/** -1 basic, 0 standard, 1 elite. */
export type StaffLevel = -1 | 0 | 1;

export interface StaffLevels {
  medical: StaffLevel;
  coaching: StaffLevel;
  academy: StaffLevel;
}

export interface GroundWorks {
  /** Seats added when the work is finished. */
  seats: number;
  /** League weeks until it is. */
  weeksLeft: number;
}

export type SponsorOfferKind = 'advance' | 'performance' | 'tour';

/**
 * A sponsor's proposal made during the season. Every kind has a catch: money
 * now is paid back from next season, a bonus has to be earned, and a tour
 * costs the squad its legs.
 */
export interface SponsorOffer {
  /** Built from saved data, so ids stay unique across a restart. */
  id: string;
  kind: SponsorOfferKind;
  clubId: string;
  sponsorName: string;
  /** Paid the moment the deal is signed. */
  upfront: number;
  /** performance: paid at season end if the club finishes `targetPosition` or better. */
  bonus?: number;
  targetPosition?: number;
  /** advance: taken off next season's sponsorship. */
  nextSeasonCut?: number;
  /** tour: condition every player in the squad loses. */
  conditionCost?: number;
  /** Season and round the offer was made in. */
  season: number;
  offeredRound: number;
  /** Last round the offer can still be accepted before. */
  expiresRound: number;
}

/** What is left to settle of a signed sponsor offer. */
export interface SponsorDeal {
  kind: 'performance' | 'advance';
  sponsorName: string;
  /** performance: the bonus and the place that earns it. */
  bonus?: number;
  targetPosition?: number;
  /** advance: what comes off next season's sponsorship. */
  nextSeasonCut?: number;
}

/** What a manager has learned about one player. */
export interface ScoutingReport {
  playerId: string;
  /** Accumulated familiarity. Higher means a tighter estimate. */
  knowledge: number;
  /** Season the report was last added to, so the UI can say it is going stale. */
  updatedSeason: number;
}

export interface ScoutingState {
  reports: Record<string, ScoutingReport>;
  /** Scouting assignments spent this season. */
  capacityUsed: number;
}

/**
 * A read on how good a player might become. Never an exact number: that is the
 * point. `low` and `high` bound it, and `confidence` says how much to trust it.
 */
export interface PotentialEstimate {
  estimate: number;
  low: number;
  high: number;
  /** 0 is a pure guess, 1 is as good as knowing. */
  confidence: number;
  /** A phrase a UI can show instead of numbers when confidence is very low. */
  label: string;
}

export interface Club {
  id: string;
  name: string;
  shortName: string;
  city: string;
  nationality: string;
  /** 1-100. Drives squad quality now, and budgets/transfer pull later. */
  reputation: number;
  squad: Player[];
  finances: ClubFinances;
}

export interface League {
  id: string;
  name: string;
  nationality: string;
  /** 1 is the top division. Clubs are promoted into lower numbers. */
  tier: number;
  clubs: Club[];
}

export type CompetitionKind = 'league' | 'cup';

/**
 * Anything that produces fixtures. Leagues are competitions too, so a fixture
 * can always name what it belongs to -- without that a cup result would land in
 * the league table, which is the reason `Fixture` carries an id at all.
 */
export interface Competition {
  id: string;
  name: string;
  kind: CompetitionKind;
  /** Set for leagues only. */
  tier?: number;
}

/** A player at one club while another still owns him. */
export interface Loan {
  playerId: string;
  /** Who owns him and takes him back. */
  parentClubId: string;
  /** Who he is playing for. */
  clubId: string;
  /** Season the loan was agreed in; it ends at that season's close. */
  season: number;
  /** Share of his wage the borrowing club pays, 0 to 1. */
  wageShare: number;
}

export interface World {
  seed: number | string;
  /** The divisions of the pyramid, top tier first. */
  leagues: League[];
  /** Every player in the world, indexed by id, for O(1) lookup during a match. */
  players: Map<string, Player>;
  /** Players whose contracts expired and who no club has signed yet. */
  freeAgents: Player[];
  /** Players playing somewhere other than the club that owns them. */
  loans: Loan[];
  /** Seasons played so far. */
  season: number;
  /** Set while a close-season window is open for a human manager. */
  transferWindow?: TransferWindowState;
}

/**
 * A manager's instructions for one match. Held as ids rather than as players or
 * a built lineup, so it survives a save, a transfer and an injury without going
 * stale -- a Lineup carries abilities computed when it was built, which are
 * already wrong by kick-off once a week of recovery has run.
 */
export interface TeamSheet {
  clubId: string;
  /** Formation key. Falls back to the default if it is not recognised. */
  formation: string;
  /**
   * One entry per formation slot, in formation order. `undefined` means "pick
   * the best available for this slot", so a half-filled sheet is valid: pin the
   * three players you care about and let the engine sort out the rest.
   */
  starters: (string | undefined)[];
  /** Preferred substitutes, best first. Short lists are topped up automatically. */
  bench: string[];
  /**
   * How the side is set up. Omitted means Balanced, which is an exact no-op --
   * so a sheet written before tactics existed plays identically.
   */
  tactics?: Tactics;
}

export type TeamSheetIssueKind =
  | 'unknown_formation'
  | 'wrong_length'
  | 'not_in_squad'
  | 'injured'
  | 'suspended'
  | 'duplicate';

/** Something the engine had to correct when reading a team sheet. */
export interface TeamSheetIssue {
  kind: TeamSheetIssueKind;
  slotIndex?: number;
  playerId?: string;
  /** Who took the slot instead. */
  replacementId?: string;
}

export interface Fixture {
  /** Matchday within the season, 1-based, shared across every competition. */
  round: number;
  homeClubId: string;
  awayClubId: string;
  /** Which competition this belongs to. */
  competitionId: string;
}

export type MatchEventType =
  | 'goal'
  | 'shot'
  | 'shot_on_target'
  | 'chance_missed'
  | 'yellow_card'
  | 'red_card'
  | 'injury'
  | 'substitution';

export interface MatchEvent {
  minute: number;
  type: MatchEventType;
  clubId: string;
  playerId: string;
  assistPlayerId?: string;
  /** For a substitution, the player coming on. */
  replacementPlayerId?: string;
}

export interface TeamMatchStats {
  clubId: string;
  goals: number;
  shots: number;
  shotsOnTarget: number;
  /** Share of possession as a percentage, 0-100. */
  possession: number;
}

export interface MatchResult {
  homeClubId: string;
  awayClubId: string;
  /**
   * Which competition this was played in. Set by the season, not the match
   * engine, which does not know or care. Matching results to a league by who
   * played is not enough: two clubs from the same division drawn together in
   * the cup produce a result whose pairing the league fixture list also
   * contains, and it lands in the table.
   */
  competitionId?: string;
  home: TeamMatchStats;
  away: TeamMatchStats;
  events: MatchEvent[];
}

export interface Transfer {
  playerId: string;
  playerName: string;
  fromClubId: string;
  toClubId: string;
  fee: number;
  /** Weekly wage agreed at the new club. */
  wage: number;
  /** A free transfer is a player whose contract expired. */
  free: boolean;
}

/** A bid on the table, from an AI club for one of your players. */
export interface TransferOffer {
  id: string;
  playerId: string;
  playerName: string;
  buyerClubId: string;
  buyerClubName: string;
  sellerClubId: string;
  fee: number;
  /** What the buyer would pay him weekly. */
  wage: number;
  years: number;
  status: 'pending' | 'accepted' | 'rejected';
}

/**
 * A move the manager has drafted but not yet made. Nothing happens until the
 * plan is confirmed, and then everything is checked again at the moment it is
 * made: a plan is an intention, not a reservation.
 */
export type PlannedMove =
  | { id: string; kind: 'buy'; playerId: string; fee: number }
  /** Accept a bid on the table for one of your players. */
  | { id: string; kind: 'sell'; offerId: string }
  | { id: string; kind: 'reject'; offerId: string }
  | { id: string; kind: 'loanOut'; playerId: string; toClubId: string }
  | { id: string; kind: 'release'; playerId: string }
  | { id: string; kind: 'renew'; playerId: string; wage: number; years: number };

/** The close-season window, while a human manager is acting in it. */
export interface TransferWindowState {
  open: boolean;
  season: number;
  /** Bids for the managed club's players, awaiting an answer. */
  incoming: TransferOffer[];
  /** Everything that has completed in this window, both halves. */
  completed: Transfer[];
  /**
   * Moves the manager has drafted and not yet confirmed. Optional because
   * windows saved before planning existed have none.
   */
  planned?: PlannedMove[];
}

/** A player the manager is keeping an eye on. */
export interface ShortlistEntry {
  playerId: string;
  addedSeason: number;
}

/** Putting one of your own players on the market. */
export type ListingKind = 'transfer' | 'loan';

/** What a player works on in training. Decides where his growth lands, not how much. */
export type TrainingFocus =
  | 'balanced'
  | 'finishing'
  | 'passing'
  | 'defending'
  | 'physical'
  | 'aerial'
  | 'goalkeeping';

/**
 * One point on a player's progression curve, as the manager saw him at the time:
 * season, round, ability, and the scouted potential band. A tuple because a
 * squad's worth of these over many seasons is the largest thing a save grows by.
 */
export type ProgressionPoint = [season: number, round: number, ability: number, low: number, high: number];

export interface TableRow {
  clubId: string;
  clubName: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

export interface SeasonResult {
  /** The top division's table. Shorthand for `tables[0]`. */
  table: TableRow[];
  /** Every division's table, top tier first. */
  tables: TableRow[][];
  results: MatchResult[];
  /** Goals scored per player id, descending. */
  scorers: { playerId: string; playerName: string; clubName: string; goals: number }[];
}
