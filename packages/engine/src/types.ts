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
  /** Display name: a mononym for some players, otherwise "F. Lastname". */
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
  clubs: Club[];
}

export interface World {
  seed: number | string;
  league: League;
  /** Every player in the world, indexed by id, for O(1) lookup during a match. */
  players: Map<string, Player>;
  /** Players whose contracts expired and who no club has signed yet. */
  freeAgents: Player[];
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
  round: number;
  homeClubId: string;
  awayClubId: string;
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

/** The close-season window, while a human manager is acting in it. */
export interface TransferWindowState {
  open: boolean;
  season: number;
  /** Bids for the managed club's players, awaiting an answer. */
  incoming: TransferOffer[];
  /** Everything that has completed in this window, both halves. */
  completed: Transfer[];
}

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
  table: TableRow[];
  results: MatchResult[];
  /** Goals scored per player id, descending. */
  scorers: { playerId: string; playerName: string; clubName: string; goals: number }[];
}
