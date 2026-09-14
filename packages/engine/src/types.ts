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
   * Hidden ceiling on ability, 1-100. Development pushes ability toward it and
   * never past it. Drives the "wonderkid" stories once training exists.
   */
  potential: number;
  contract: Contract;
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
}

export interface Fixture {
  round: number;
  homeClubId: string;
  awayClubId: string;
}

export type MatchEventType = 'goal' | 'shot' | 'shot_on_target' | 'chance_missed';

export interface MatchEvent {
  minute: number;
  type: MatchEventType;
  clubId: string;
  playerId: string;
  assistPlayerId?: string;
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
