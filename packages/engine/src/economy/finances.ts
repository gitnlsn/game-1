import { Rng, clamp } from '../rng/index.js';
import type { Club, ClubFinances, FinancialRecord, Player, TableRow } from '../types.js';
import { expectedWage, wageBill } from './valuation.js';

/**
 * The economy's tuning knobs. Balance here matters more than correctness: the
 * code is trivial, but making it so a player cannot trivially snowball takes
 * many simulated seasons. See `pnpm sim economy`.
 */
export const ECONOMY_TUNING = {
  /** Stadium size by reputation: capacity = floor + (rep/100)^3 * scale. */
  stadiumFloor: 4_000,
  stadiumScale: 95_000,
  /** Ticket price by reputation. */
  ticketFloor: 8,
  ticketScale: 45,
  /** Annual commercial income by reputation. */
  sponsorshipFloor: 1_000_000,
  sponsorshipScale: 70_000_000,
  /** Broadcast money split equally between every club in the division. */
  tvEqualShare: 12_000_000,
  /** Merit payment for finishing first; last place gets `meritFloor`. */
  meritTop: 25_000_000,
  meritFloor: 2_000_000,
  /** Baseline share of the stadium that turns up, before form and opponent. */
  baseFillFloor: 0.62,
  baseFillScale: 0.5,
  /** How strongly recent results move the gate. */
  formFillWeight: 0.12,
  /** How strongly a glamorous opponent moves the gate. */
  opponentFillWeight: 0.25,
  /** Spread applied to each club's ground size and opening cash. */
  clubVariation: 0.1,
  /** Opening balance as a share of a club's expected annual revenue. */
  openingBalanceShare: 0.18,
  /** Clubs will carry a wage bill up to this share of expected revenue. */
  wageBudgetShare: 0.68,
  /**
   * Everything that is not wages: coaching and admin staff, stadium upkeep,
   * academy, travel, agent fees, tax. Real clubs run near break-even -- without
   * this the league simply prints money and every club ends up a billionaire.
   *
   * This is deliberately a catch-all. A real league also loses money to clubs
   * abroad; a closed league has no such sink, so this share absorbs it and is
   * calibrated to keep the money supply roughly flat rather than measured from
   * any single real-world line item.
   */
  operatingCostShare: 0.44,
  /** Share of free cash a club will commit to transfer fees in a window. */
  transferBudgetShare: 0.55,
  /** Cash a club aims to keep in reserve, as a share of annual revenue. */
  cashReserveShare: 0.35,
  /** Share of surplus above the reserve put into the ground each season. */
  infrastructureShare: 0.7,
  /** Cost of adding one seat. */
  costPerSeat: 4_000,
  /** A ground will not be expanded beyond this multiple of its natural size. */
  maxStadiumMultiple: 1.8,
  /** Expansion only makes sense once the ground is filling up. */
  expansionFillThreshold: 0.9,
  /**
   * Surplus above this multiple of the reserve target is taken out by the owners
   * each season. Without a sink of some kind, clubs that cannot spend past their
   * wage ceiling accumulate cash forever and budgets stop meaning anything.
   */
  drawingsThreshold: 1.5,
  drawingsRate: 0.4,
  /** Spending cut applied while a club is in the red. */
  austerityFactor: 0.82,
  /** A season is this many wage payments. */
  wageWeeksPerSeason: 42,
} as const;

export function emptyFinancialRecord(): FinancialRecord {
  return {
    gateReceipts: 0,
    sponsorship: 0,
    prizeMoney: 0,
    playerSales: 0,
    wages: 0,
    operatingCosts: 0,
    infrastructure: 0,
    ownerDrawings: 0,
    playerPurchases: 0,
  };
}

export function recordIncome(record: FinancialRecord): number {
  return record.gateReceipts + record.sponsorship + record.prizeMoney + record.playerSales;
}

export function recordExpense(record: FinancialRecord): number {
  return (
    record.wages +
    record.operatingCosts +
    record.infrastructure +
    record.ownerDrawings +
    record.playerPurchases
  );
}

export function stadiumCapacity(reputation: number): number {
  const E = ECONOMY_TUNING;
  return Math.round(E.stadiumFloor + Math.pow(reputation / 100, 3) * E.stadiumScale);
}

export function ticketPrice(reputation: number): number {
  const E = ECONOMY_TUNING;
  return Math.round(E.ticketFloor + Math.pow(reputation / 100, 2) * E.ticketScale);
}

export function sponsorshipIncome(reputation: number): number {
  const E = ECONOMY_TUNING;
  return Math.round(E.sponsorshipFloor + Math.pow(reputation / 100, 3) * E.sponsorshipScale);
}

/** Rough annual revenue, used to size budgets before a season is played. */
export function expectedAnnualRevenue(reputation: number, clubCount: number): number {
  const E = ECONOMY_TUNING;
  const homeMatches = clubCount - 1;
  const averageGate = stadiumCapacity(reputation) * 0.78 * ticketPrice(reputation);
  const midTableMerit = (E.meritTop + E.meritFloor) / 2;
  return averageGate * homeMatches + sponsorshipIncome(reputation) + E.tvEqualShare + midTableMerit;
}

export function createClubFinances(
  reputation: number,
  squad: readonly Player[],
  clubCount: number,
  rng?: Rng,
): ClubFinances {
  const E = ECONOMY_TUNING;
  const revenue = expectedAnnualRevenue(reputation, clubCount);

  // Clubs of equal standing should not be identical down to the seat: a little
  // variation in ground size and cash reserves makes each one its own place.
  const groundVariation = rng ? rng.float(1 - E.clubVariation, 1 + E.clubVariation) : 1;
  const cashVariation = rng ? rng.float(1 - E.clubVariation * 2, 1 + E.clubVariation * 2) : 1;

  return {
    balance: Math.round(revenue * E.openingBalanceShare * cashVariation),
    stadiumCapacity: Math.round(stadiumCapacity(reputation) * groundVariation),
    ticketPrice: ticketPrice(reputation),
    sponsorshipPerSeason: sponsorshipIncome(reputation),
    transferBudget: 0,
    wageBudget: Math.round((revenue * E.wageBudgetShare) / E.wageWeeksPerSeason),
    season: emptyFinancialRecord(),
  };
}

/**
 * Gate receipts for one home match. Attendance responds to how the season is
 * going and to who the visitors are, which is what makes a good run pay for
 * itself.
 */
export function matchdayIncome(
  home: Club,
  away: Club,
  homePointsPerGame: number,
): { attendance: number; revenue: number } {
  const E = ECONOMY_TUNING;
  const baseFill = E.baseFillFloor + ((home.reputation - 40) / 100) * E.baseFillScale;
  const formBonus = (homePointsPerGame - 1.3) * E.formFillWeight;
  const opponentBonus = ((away.reputation - 60) / 100) * E.opponentFillWeight;

  const fill = clamp(baseFill + formBonus + opponentBonus, 0.35, 1);
  const attendance = Math.round(home.finances.stadiumCapacity * fill);

  return { attendance, revenue: attendance * home.finances.ticketPrice };
}

export function applyMatchdayIncome(home: Club, away: Club, homePointsPerGame: number): number {
  const { revenue } = matchdayIncome(home, away, homePointsPerGame);
  home.finances.balance += revenue;
  home.finances.season.gateReceipts += revenue;
  return revenue;
}

/** One week's wages. Called once per league round. */
export function payWeeklyWages(club: Club): number {
  const bill = wageBill(club.squad);
  club.finances.balance -= bill;
  club.finances.season.wages += bill;
  return bill;
}

/**
 * One week's share of commercial income. Paid through the season rather than as
 * a lump at the end, which is both how sponsorship deals actually pay out and
 * what keeps clubs from spending the season technically insolvent.
 */
export function payWeeklySponsorship(club: Club): number {
  const E = ECONOMY_TUNING;
  const weekly = Math.round(club.finances.sponsorshipPerSeason / E.wageWeeksPerSeason);
  club.finances.balance += weekly;
  club.finances.season.sponsorship += weekly;
  return weekly;
}

/** One week's share of the club's non-wage running costs. */
export function payWeeklyOperatingCosts(club: Club, clubCount: number): number {
  const E = ECONOMY_TUNING;
  const revenue = expectedAnnualRevenue(club.reputation, clubCount);
  // A club in the red cuts its cloth: austerity is what stops a bad season
  // turning into a permanent debt spiral.
  const austerity = club.finances.balance < 0 ? E.austerityFactor : 1;
  const weekly = Math.round((revenue * E.operatingCostShare * austerity) / E.wageWeeksPerSeason);
  club.finances.balance -= weekly;
  club.finances.season.operatingCosts += weekly;
  return weekly;
}

/** Merit payment plus the equal broadcast share, paid at the end of a season. */
export function prizeMoney(position: number, clubCount: number): number {
  const E = ECONOMY_TUNING;
  const t = clubCount <= 1 ? 0 : (position - 1) / (clubCount - 1);
  const merit = E.meritTop - (E.meritTop - E.meritFloor) * t;
  return Math.round(merit + E.tvEqualShare);
}

/** Prize money, paid once the season is decided. Sponsorship arrives weekly. */
export function distributeSeasonIncome(clubs: readonly Club[], table: readonly TableRow[]): void {
  const clubById = new Map(clubs.map((club) => [club.id, club]));

  table.forEach((row, index) => {
    const club = clubById.get(row.clubId);
    if (!club) return;
    const prize = prizeMoney(index + 1, table.length);
    club.finances.balance += prize;
    club.finances.season.prizeMoney += prize;
  });

}

/**
 * Sets the budgets a club takes into the transfer window. A club in debt gets
 * nothing to spend, which is the main brake on runaway squads.
 */
export function setTransferBudgets(clubs: readonly Club[], clubCount: number): void {
  const E = ECONOMY_TUNING;

  for (const club of clubs) {
    const revenue = expectedAnnualRevenue(club.reputation, clubCount);
    const freeCash = Math.max(0, club.finances.balance);

    club.finances.transferBudget = Math.round(freeCash * E.transferBudgetShare);
    club.finances.wageBudget = Math.round((revenue * E.wageBudgetShare) / E.wageWeeksPerSeason);
  }
}

/**
 * Close-season capital spending. A club with money in the bank and a full ground
 * expands it, which raises future gate income -- the reward for running a club
 * well. Anything left far above the reserve target is drawn out by the owners.
 */
export function applyCloseSeasonSpending(club: Club, clubCount: number): void {
  const E = ECONOMY_TUNING;
  const revenue = expectedAnnualRevenue(club.reputation, clubCount);
  const reserveTarget = revenue * E.cashReserveShare;

  const homeMatches = Math.max(1, clubCount - 1);
  const attendance = club.finances.season.gateReceipts / Math.max(1, club.finances.ticketPrice);
  const fill = attendance / (homeMatches * club.finances.stadiumCapacity);

  let surplus = club.finances.balance - reserveTarget;

  if (surplus > 0 && fill >= E.expansionFillThreshold) {
    const naturalCapacity = stadiumCapacity(club.reputation);
    const maxCapacity = Math.round(naturalCapacity * E.maxStadiumMultiple);
    const room = maxCapacity - club.finances.stadiumCapacity;

    if (room > 0) {
      const affordable = Math.floor((surplus * E.infrastructureShare) / E.costPerSeat);
      const seats = Math.min(room, affordable);
      if (seats > 0) {
        const cost = seats * E.costPerSeat;
        club.finances.stadiumCapacity += seats;
        club.finances.balance -= cost;
        club.finances.season.infrastructure += cost;
        surplus -= cost;
      }
    }
  }

  // Owners take a cut of anything still well above the reserve target.
  const drawingsFloor = reserveTarget * E.drawingsThreshold;
  if (club.finances.balance > drawingsFloor) {
    const drawings = Math.round((club.finances.balance - drawingsFloor) * E.drawingsRate);
    club.finances.balance -= drawings;
    club.finances.season.ownerDrawings += drawings;
  }

  // Ticket prices track the club's standing. Ground size is deliberately left
  // alone: it only ever changes through expansion above.
  club.finances.ticketPrice = ticketPrice(club.reputation);
  club.finances.sponsorshipPerSeason = sponsorshipIncome(club.reputation);
}

export function resetSeasonRecord(club: Club): void {
  club.finances.season = emptyFinancialRecord();
}

/**
 * Brings a freshly generated squad inside the club's wage budget by scaling every
 * contract proportionally.
 *
 * Squads and budgets are generated independently -- squad quality varies around
 * what a club's reputation implies -- so without this a third of clubs start the
 * game already over budget, and a few above their entire revenue. The structure
 * of who earns most is preserved; players simply signed on better terms for the
 * club, which is what an overachieving squad looks like from the books.
 */
export function fitWagesToBudget(club: Club): void {
  const budget = club.finances.wageBudget * 0.95;
  const bill = wageBill(club.squad);
  if (bill <= budget || bill <= 0) return;

  const scale = budget / bill;
  for (const player of club.squad) {
    player.contract.wage = Math.max(100, Math.round((player.contract.wage * scale) / 100) * 100);
  }
}

/** Assigns a contract at the wage the player expects, with a random length. */
export function issueContract(rng: Rng, player: Player, wageMultiplier = 1): void {
  player.contract = {
    wage: Math.round(expectedWage(player) * wageMultiplier),
    yearsRemaining: rng.int(1, 4),
  };
}
