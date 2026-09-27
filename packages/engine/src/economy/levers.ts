import { clamp } from '../rng/index.js';
import type { Club, StaffLevel, StaffLevels } from '../types.js';
import { ECONOMY_TUNING, expectedAnnualRevenue, stadiumCapacity } from './finances.js';

/**
 * The decisions a manager can make about the club's money during a season:
 * what to charge at the gate, what to spend on staff, and when to build.
 *
 * Every lever's neutral setting is exactly what the club did before the lever
 * existed, and the AI never moves off it. So the headless calibration measures
 * the same league it always did, and a lever only matters once a person pulls
 * it -- which is why each one has to cost something as well as give something.
 */
export const LEVER_TUNING = {
  /** Ticket price range, as a multiple of the club's normal price. */
  ticketLevelMin: 0.7,
  ticketLevelMax: 1.5,
  ticketLevelStep: 0.1,

  /**
   * Staff spending as a share of the club's expected annual revenue, per level
   * away from standard. Elite costs this much more; basic saves a little less
   * than that, because cutting staff is never quite as cheap as it looks.
   */
  staffCost: { medical: 0.025, coaching: 0.03, academy: 0.02 },
  staffSaving: 0.8,
  /** Medical: recovery between matches, and how long injuries last. */
  recoveryPerLevel: 0.15,
  injuryLengthPerLevel: 0.25,
  /** Coaching: multiplies coaching quality. Narrow, like coaching itself. */
  coachingPerLevel: 0.05,
  /** Academy: ability points added to the level an intake is pitched at. */
  academyPerLevel: 3,

  /** Ground works: how long they take. The seats closed are in ECONOMY_TUNING. */
  groundWorksWeeks: 8,
  /** Sizes a manager can build in. */
  expansionSizes: [2_000, 5_000, 10_000],
} as const;

// --- Tickets -------------------------------------------------------------

/** Snaps a requested level to the allowed steps. */
export function clampTicketLevel(level: number): number {
  const T = LEVER_TUNING;
  const stepped = Math.round(level / T.ticketLevelStep) * T.ticketLevelStep;
  return Math.round(clamp(stepped, T.ticketLevelMin, T.ticketLevelMax) * 100) / 100;
}

// --- Staff ---------------------------------------------------------------

export const STANDARD_STAFF: StaffLevels = { medical: 0, coaching: 0, academy: 0 };

export function staffLevels(club: Club): StaffLevels {
  return club.finances.staff ?? STANDARD_STAFF;
}

/** Extra spending on staff over a season, relative to standard. Negative saves. */
export function staffCostPerSeason(club: Club, clubCount: number, tier = 1): number {
  const T = LEVER_TUNING;
  const revenue = expectedAnnualRevenue(club.reputation, clubCount, tier);
  const levels = staffLevels(club);
  let share = 0;
  for (const key of ['medical', 'coaching', 'academy'] as const) {
    const level = levels[key];
    share += level * T.staffCost[key] * (level < 0 ? T.staffSaving : 1);
  }
  return Math.round(revenue * share);
}

/** What one staff line would cost a season at a given level, for a screen to show. */
export function staffLineCost(
  club: Club,
  key: keyof StaffLevels,
  level: StaffLevel,
  clubCount: number,
  tier = 1,
): number {
  const T = LEVER_TUNING;
  const revenue = expectedAnnualRevenue(club.reputation, clubCount, tier);
  return Math.round(revenue * level * T.staffCost[key] * (level < 0 ? T.staffSaving : 1));
}

/** One week of the staff spending above or below standard. */
export function payWeeklyStaffCosts(club: Club, clubCount: number, tier = 1): number {
  const weekly = Math.round(staffCostPerSeason(club, clubCount, tier) / ECONOMY_TUNING.wageWeeksPerSeason);
  if (weekly === 0) return 0;
  club.finances.balance -= weekly;
  club.finances.season.operatingCosts += weekly;
  return weekly;
}

/** Notes a week at the current coaching and academy levels. */
export function recordStaffWeek(club: Club): void {
  const levels = staffLevels(club);
  const weeks = (club.finances.staffWeeks ??= { coaching: 0, academy: 0, weeks: 0 });
  weeks.coaching += levels.coaching;
  weeks.academy += levels.academy;
  weeks.weeks += 1;
}

/** The season's average level for a line whose payoff comes at season end. */
export function seasonStaffLevel(club: Club, key: 'coaching' | 'academy'): number {
  const weeks = club.finances.staffWeeks;
  if (!weeks || weeks.weeks === 0) return 0;
  return weeks[key] / weeks.weeks;
}

export function recoveryFactor(club: Club): number {
  return 1 + staffLevels(club).medical * LEVER_TUNING.recoveryPerLevel;
}

export function injuryLengthFactor(club: Club): number {
  return 1 - staffLevels(club).medical * LEVER_TUNING.injuryLengthPerLevel;
}

export function coachingFactor(club: Club): number {
  return 1 + seasonStaffLevel(club, 'coaching') * LEVER_TUNING.coachingPerLevel;
}

export function academyBoost(club: Club): number {
  return seasonStaffLevel(club, 'academy') * LEVER_TUNING.academyPerLevel;
}

// --- The ground ----------------------------------------------------------

/** Seats the ground can still grow by. */
export function expansionRoom(club: Club): number {
  const max = Math.round(stadiumCapacity(club.reputation) * ECONOMY_TUNING.maxStadiumMultiple);
  const planned = club.finances.groundWorks?.seats ?? 0;
  return Math.max(0, max - club.finances.stadiumCapacity - planned);
}

export function expansionCost(seats: number): number {
  return seats * ECONOMY_TUNING.costPerSeat;
}

export type ExpansionOutcome =
  | { ok: true; cost: number; weeks: number }
  | { ok: false; reason: 'underway' | 'no_room' | 'cannot_afford' };

/**
 * Starts building. Paid up front. During the season part of the ground closes
 * while the work goes on; in the close season it is finished before anyone
 * turns up, which is why that is when a sensible club builds.
 */
export function startGroundWorks(club: Club, seats: number, inSeason: boolean): ExpansionOutcome {
  if (club.finances.groundWorks) return { ok: false, reason: 'underway' };
  if (seats <= 0 || seats > expansionRoom(club)) return { ok: false, reason: 'no_room' };
  const cost = expansionCost(seats);
  if (club.finances.balance < cost) return { ok: false, reason: 'cannot_afford' };

  club.finances.balance -= cost;
  club.finances.season.infrastructure += cost;

  if (!inSeason) {
    club.finances.stadiumCapacity += seats;
    return { ok: true, cost, weeks: 0 };
  }
  club.finances.groundWorks = { seats, weeksLeft: LEVER_TUNING.groundWorksWeeks };
  return { ok: true, cost, weeks: LEVER_TUNING.groundWorksWeeks };
}

/** A week of building. Returns the seats opened, if the work finished. */
export function advanceGroundWorks(club: Club): number {
  const works = club.finances.groundWorks;
  if (!works) return 0;
  works.weeksLeft -= 1;
  if (works.weeksLeft > 0) return 0;
  club.finances.stadiumCapacity += works.seats;
  delete club.finances.groundWorks;
  return works.seats;
}

/** Work left unfinished at season end is completed over the summer. */
export function finishGroundWorks(club: Club): void {
  const works = club.finances.groundWorks;
  if (!works) return;
  club.finances.stadiumCapacity += works.seats;
  delete club.finances.groundWorks;
}
