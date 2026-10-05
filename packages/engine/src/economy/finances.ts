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
  /**
   * What each division down is worth relative to the one above, for central
   * money only. Real second-tier clubs live on a small fraction of top-flight
   * television income, and that gap is the entire reason relegation is feared
   * and promotion chased.
   */
  tierDecay: 0.2,
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
  /**
   * How hard gate demand falls as a manager raises the price: demand scales by
   * exp(-sensitivity * (level - 1)). At 1, gate revenue for a ground with seats
   * to spare peaks at the normal price -- dearer loses more fans than it earns,
   * cheaper fills seats but earns less. Only a ground with more demand than
   * seats can charge more for free, which is what a sell-out should mean.
   */
  priceSensitivity: 1,
  /** Demand above capacity a sell-out can hold before a price rise bites. */
  maxDemand: 1.3,
  /** Share of the ground closed while it is being rebuilt. */
  groundWorksClosedShare: 0.15,
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
    sponsorDeals: 0,
  };
}

export function recordIncome(record: FinancialRecord): number {
  return (
    record.gateReceipts +
    record.sponsorship +
    record.prizeMoney +
    record.playerSales +
    (record.sponsorDeals ?? 0)
  );
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

/**
 * What a division is worth, relative to the top flight.
 *
 * Only the central money is scaled. A relegated club still has its ground and
 * most of its support, so gate receipts and sponsorship keep following its
 * reputation -- what actually falls off a cliff is the television deal, which is
 * why relegation is the financial event it is.
 */
export function tierShare(tier: number): number {
  const E = ECONOMY_TUNING;
  return Math.pow(E.tierDecay, Math.max(0, tier - 1));
}

/** Rough annual revenue, used to size budgets before a season is played. */
export function expectedAnnualRevenue(
  reputation: number,
  clubCount: number,
  tier = 1,
): number {
  const E = ECONOMY_TUNING;
  const homeMatches = clubCount - 1;
  const averageGate = stadiumCapacity(reputation) * 0.78 * ticketPrice(reputation);
  const midTableMerit = (E.meritTop + E.meritFloor) / 2;
  const central = (E.tvEqualShare + midTableMerit) * tierShare(tier);
  return averageGate * homeMatches + sponsorshipIncome(reputation) + central;
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

/** Ticket price as a multiple of normal. The AI never moves it off 1. */
export function ticketLevel(club: Club): number {
  return club.finances.ticketPriceLevel ?? 1;
}

/** What the gate actually charges. */
export function effectiveTicketPrice(club: Club): number {
  return Math.round(club.finances.ticketPrice * ticketLevel(club));
}

/** How demand responds to the price. 1 at the normal price. */
export function priceDemandFactor(level: number): number {
  return Math.exp(-ECONOMY_TUNING.priceSensitivity * (level - 1));
}

/** Seats on sale this week: fewer while part of the ground is being rebuilt. */
export function availableCapacity(club: Club): number {
  const capacity = club.finances.stadiumCapacity;
  return club.finances.groundWorks
    ? Math.round(capacity * (1 - ECONOMY_TUNING.groundWorksClosedShare))
    : capacity;
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
  /** Ticket level to price at; the club's own unless asked what-if. */
  level = ticketLevel(home),
): { attendance: number; revenue: number; fill: number } {
  const E = ECONOMY_TUNING;
  const baseFill = E.baseFillFloor + ((home.reputation - 40) / 100) * E.baseFillScale;
  const formBonus = (homePointsPerGame - 1.3) * E.formFillWeight;
  const opponentBonus = ((away.reputation - 60) / 100) * E.opponentFillWeight;

  // Demand can exceed the seats, which is what lets a sell-out raise its prices;
  // at the normal price this is exactly the old clamp to a full ground.
  const demand = clamp(baseFill + formBonus + opponentBonus, 0.35, E.maxDemand);
  const fill = clamp(demand * priceDemandFactor(level), 0.1, 1);
  const attendance = Math.round(availableCapacity(home) * fill);
  const price = Math.round(home.finances.ticketPrice * level);

  return { attendance, revenue: attendance * price, fill };
}

/**
 * The crowd a match draws against the one it would at the normal price. Cheap
 * tickets pack the ground and lift the side; dear ones thin it out. Exactly 1 for
 * any club charging the normal price, so the AI plays the game it always did.
 */
export function crowdEffect(home: Club, away: Club, homePointsPerGame: number): number {
  if (ticketLevel(home) === 1) return 1;
  const { fill } = matchdayIncome(home, away, homePointsPerGame);
  const normal = matchdayIncome(home, away, homePointsPerGame, 1).fill;
  return normal > 0 ? fill / normal : 1;
}

export function applyMatchdayIncome(home: Club, away: Club, homePointsPerGame: number): number {
  const { revenue } = matchdayIncome(home, away, homePointsPerGame);
  home.finances.balance += revenue;
  home.finances.season.gateReceipts += revenue;
  return revenue;
}

/** One week's wages. Called once per league round. */
/**
 * `bill` is passed in rather than read off the squad so a loan can split it: the
 * borrowing club pays its agreed share and the parent keeps paying the rest.
 * Omitted, it is the squad's own wages, which is what it always was.
 */
export function payWeeklyWages(club: Club, bill = wageBill(club.squad)): number {
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
export function payWeeklyOperatingCosts(club: Club, clubCount: number, tier = 1): number {
  const E = ECONOMY_TUNING;
  const revenue = expectedAnnualRevenue(club.reputation, clubCount, tier);
  // A club in the red cuts its cloth: austerity is what stops a bad season
  // turning into a permanent debt spiral.
  const austerity = club.finances.balance < 0 ? E.austerityFactor : 1;
  const weekly = Math.round((revenue * E.operatingCostShare * austerity) / E.wageWeeksPerSeason);
  club.finances.balance -= weekly;
  club.finances.season.operatingCosts += weekly;
  return weekly;
}

/** Merit payment plus the equal broadcast share, paid at the end of a season. */
export function prizeMoney(position: number, clubCount: number, tier = 1): number {
  const E = ECONOMY_TUNING;
  const t = clubCount <= 1 ? 0 : (position - 1) / (clubCount - 1);
  const merit = E.meritTop - (E.meritTop - E.meritFloor) * t;
  return Math.round((merit + E.tvEqualShare) * tierShare(tier));
}

/**
 * Prize money, paid once the season is decided. Sponsorship arrives weekly.
 *
 * Takes one table per division, so the second tier is paid second-tier money.
 */
export function distributeSeasonIncome(
  clubs: readonly Club[],
  tables: readonly (readonly TableRow[])[],
): void {
  const clubById = new Map(clubs.map((club) => [club.id, club]));

  tables.forEach((table, tierIndex) => {
    table.forEach((row, index) => {
      const club = clubById.get(row.clubId);
      if (!club) return;
      const prize = prizeMoney(index + 1, table.length, tierIndex + 1);
      club.finances.balance += prize;
      club.finances.season.prizeMoney += prize;
    });
  });
}

/**
 * Sets the budgets a club takes into the transfer window. A club in debt gets
 * nothing to spend, which is the main brake on runaway squads.
 */
export function setTransferBudgets(clubs: readonly Club[], clubCount: number, tier = 1): void {
  const E = ECONOMY_TUNING;

  for (const club of clubs) {
    const revenue = expectedAnnualRevenue(club.reputation, clubCount, tier);
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
/**
 * `autoExpand` is off for a club a person runs: they decide when to build, and
 * the board expanding the ground behind their back would take the decision away.
 */
export function applyCloseSeasonSpending(
  club: Club,
  clubCount: number,
  tier = 1,
  autoExpand = true,
): void {
  const E = ECONOMY_TUNING;
  const revenue = expectedAnnualRevenue(club.reputation, clubCount, tier);
  const reserveTarget = revenue * E.cashReserveShare;

  const homeMatches = Math.max(1, clubCount - 1);
  const attendance = club.finances.season.gateReceipts / Math.max(1, effectiveTicketPrice(club));
  const fill = attendance / (homeMatches * club.finances.stadiumCapacity);

  let surplus = club.finances.balance - reserveTarget;

  if (autoExpand && surplus > 0 && fill >= E.expansionFillThreshold) {
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

  // An advance taken last season is paid back out of this one's deal.
  const deals = club.finances.sponsorDeals ?? [];
  for (const deal of deals) {
    if (deal.kind === 'advance' && deal.nextSeasonCut) {
      club.finances.sponsorshipPerSeason = Math.max(
        0,
        club.finances.sponsorshipPerSeason - deal.nextSeasonCut,
      );
    }
  }
  club.finances.sponsorDeals = deals.filter((deal) => deal.kind !== 'advance');
}

export function resetSeasonRecord(club: Club): void {
  club.finances.season = emptyFinancialRecord();
  delete club.finances.lastSponsorOfferRound;
}

/**
 * Re-sizes a club's opening finances for the league it actually plays in.
 *
 * Clubs are generated in one batch for the whole pyramid, so their finances are
 * first sized for a single league of every club at top-flight money. Left like
 * that, wages are fitted to a budget the club never has: the season starts,
 * budgets are set for the real league -- half the home games, a lower tier's TV
 * share -- and half the clubs in a two-division world are over their wage budget
 * before a ball is kicked.
 */
export function sizeFinancesForLeague(
  club: Club,
  generatedFor: { clubCount: number; tier: number },
  league: { clubCount: number; tier: number },
): void {
  const E = ECONOMY_TUNING;
  const before = expectedAnnualRevenue(club.reputation, generatedFor.clubCount, generatedFor.tier);
  const after = expectedAnnualRevenue(club.reputation, league.clubCount, league.tier);
  if (before === after || before <= 0) return;

  club.finances.balance = Math.round(club.finances.balance * (after / before));
  club.finances.wageBudget = Math.round((after * E.wageBudgetShare) / E.wageWeeksPerSeason);
  fitWagesToBudget(club);
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
