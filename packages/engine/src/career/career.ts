import { Rng, clamp } from '../rng/index.js';
import type { BoardVerdict } from './board.js';
import { allClubs } from '../world/index.js';
import type { Club, Player, SeasonResult, TableRow, Transfer, World } from '../types.js';
import {
  applyCloseSeasonSpending,
  distributeSeasonIncome,
  resetSeasonRecord,
  setTransferBudgets,
} from '../economy/finances.js';
import { recordExpense, recordIncome } from '../economy/finances.js';
import { simulateSeason } from '../league/season.js';
import {
  createTransferWindow,
  expireFreeAgents,
  generateIncomingOffers,
  prepareTransferWindow,
  processContracts,
  runTransferWindow,
  shopTransferWindow,
} from '../transfers/market.js';
import { TRANSFER_TUNING } from '../transfers/market.js';
import { coachingQuality, developPlayer, promoteYouth, shouldRetire } from './aging.js';
import { currentAbility } from '../world/players.js';
import { resetSeasonStatus } from '../world/status.js';

export const CAREER_TUNING = {
  /**
   * How fast club reputation follows results. Reputation drives budgets, squad
   * quality and who will sign, so this is the loop that lets a club rise or fall
   * over several seasons instead of the hierarchy being fixed forever.
   */
  reputationDrift: 0.15,
  /** Clubs going up and down between each pair of divisions. */
  promotionPlaces: 3,
  reputationTop: 88,
  reputationBottom: 45,
} as const;

export interface ClubSeasonFinance {
  clubId: string;
  clubName: string;
  balance: number;
  income: number;
  expense: number;
  wages: number;
  transfersIn: number;
  transfersOut: number;
}

/**
 * Whether the development model is actually doing its job. The gap between the
 * first two numbers is the whole point of tying development to playing time: a
 * prospect who plays should pull clear of one who does not.
 */
export interface DevelopmentStats {
  /** Mean ability gained by under-21s who played most of the season. */
  regularYouthGain: number;
  /** Mean ability gained by under-21s who barely featured. */
  benchYouthGain: number;
  /** Mean ability lost by players over 31. */
  veteranDecline: number;
  regularYouthCount: number;
  benchYouthCount: number;
  /** Biggest single-season riser, for a bit of colour. */
  breakthrough: { playerName: string; clubName: string; age: number; gain: number } | undefined;
}

/** A club changing division. */
export interface PromotionChange {
  clubId: string;
  clubName: string;
  from: number;
  to: number;
}

export interface SeasonSummary {
  season: number;
  table: TableRow[];
  /** Every division's table, top tier first. */
  tables: TableRow[][];
  /** Who went up and who went down. */
  promotions: PromotionChange[];
  championName: string;
  topScorer: { playerName: string; goals: number } | undefined;
  transfers: Transfer[];
  retirements: number;
  youthPromoted: number;
  development: DevelopmentStats;
  finances: ClubSeasonFinance[];
  /** What the board made of it. Set by the career controller, not by closeSeason. */
  verdict?: BoardVerdict;
}

export interface SimulateCareerOptions {
  seasons: number;
  /** Called at the end of each season, for progress reporting. */
  onSeason?: (summary: SeasonSummary) => void;
}

/**
 * Runs the full year-on-year loop: play the season, pay everyone, age the
 * players, retire the old ones, promote youth, then open the transfer window.
 */
export function simulateCareer(
  world: World,
  rng: Rng,
  options: SimulateCareerOptions,
): SeasonSummary[] {
  const summaries: SeasonSummary[] = [];

  for (let i = 0; i < options.seasons; i++) {
    const summary = simulateCareerSeason(world, rng);
    summaries.push(summary);
    options.onSeason?.(summary);
  }

  return summaries;
}

/** Prepares clubs for a new season: clears the books and sets budgets. */
export function beginSeason(world: World): void {
  const clubs = allClubs(world);
  for (const club of clubs) resetSeasonRecord(club);
  for (const league of world.leagues) {
    setTransferBudgets(league.clubs, league.clubs.length, league.tier);
  }
}

export function simulateCareerSeason(world: World, rng: Rng): SeasonSummary {
  beginSeason(world);
  const season: SeasonResult = simulateSeason(world, rng, { economy: true, playerState: true });
  return closeSeason(world, rng, season);
}

/**
 * Everything that happens once the last match is played: prize money, ageing,
 * retirements, contracts, the academy intake and the transfer window.
 */
export interface CloseSeasonOptions {
  /**
   * Stop before the AI goes shopping and leave the window open, so a human
   * manager can act in it. `completeTransferWindow` finishes the job.
   */
  deferWindow?: boolean;
  /** The club the AI must not shop on behalf of. */
  managedClubId?: string;
}

export function closeSeason(
  world: World,
  rng: Rng,
  season: SeasonResult,
  options: CloseSeasonOptions = {},
): SeasonSummary {
  const clubs = allClubs(world);
  distributeSeasonIncome(clubs, season.tables ?? [season.table]);

  const finances = clubs.map((club) => toClubSeasonFinance(club));

  // Close season: age, retire, renew, promote, then trade.
  // A club plays its own division, so depth and minutes are sized off that.
  const seasonMatches = (world.leagues[0]?.clubs.length ?? clubs.length) * 2 - 2;
  const development = createDevelopmentStats();
  /*
   * Last summer's unsigned free agents drop out of the game now, at the *start*
   * of the close season rather than the end. Expiring them last meant a player
   * released in July was deleted in the same breath, so the pool was always
   * empty and nobody could ever be signed from it.
   */
  expireFreeAgents(world);

  const retirements = ageAndRetire(world, rng, seasonMatches, development);
  updateReputations(world, season.tables ?? [season.table]);
  const promotions = applyPromotionAndRelegation(world, season.tables ?? [season.table]);
  // After the swap, so a promoted club spends like a top-flight club.
  for (const league of world.leagues) {
    for (const club of league.clubs) {
      applyCloseSeasonSpending(club, league.clubs.length, league.tier);
    }
  }
  processContracts(rng, world);

  // One registry for the whole division, so an academy intake cannot reuse a
  // name that already belongs to someone at another club.
  const leagueNames = new Set<string>();
  for (const club of clubs) {
    for (const player of club.squad) leagueNames.add(player.displayName);
  }
  for (const player of world.freeAgents) leagueNames.add(player.displayName);

  let youthPromoted = 0;
  for (const club of clubs) {
    youthPromoted += promoteYouth(rng, club, TRANSFER_TUNING.targetSquadSize, leagueNames).length;
    for (const player of club.squad) world.players.set(player.id, player);
  }

  for (const league of world.leagues) {
    setTransferBudgets(league.clubs, league.clubs.length, league.tier);
  }

  /*
   * With no options this is exactly the single call it always was, so the
   * headless validators cannot move. Deferring instead runs only the
   * housekeeping half -- clubs trimming squads and selling to cover debts --
   * which has to happen before a manager looks at the market, or the free-agent
   * pool is empty and nobody has listed anyone.
   */
  let transfers: Transfer[];
  if (options.deferWindow) {
    transfers = prepareTransferWindow(rng, world, {
      ...(options.managedClubId ? { skipClubIds: [options.managedClubId] } : {}),
    });
    const window = createTransferWindow(world.season);
    window.completed.push(...transfers);
    if (options.managedClubId) {
      window.incoming = generateIncomingOffers(rng, world, options.managedClubId);
    }
    world.transferWindow = window;
  } else {
    transfers = runTransferWindow(rng, world);
    world.season += 1;
  }

  return {
    season: world.season - 1,
    table: season.table,
    tables: season.tables ?? [season.table],
    promotions,
    championName: season.table[0]?.clubName ?? '',
    topScorer: season.scorers[0]
      ? { playerName: season.scorers[0].playerName, goals: season.scorers[0].goals }
      : undefined,
    transfers,
    retirements,
    youthPromoted,
    development: finaliseDevelopmentStats(development),
    finances,
  };
}

function toClubSeasonFinance(club: Club): ClubSeasonFinance {
  return {
    clubId: club.id,
    clubName: club.name,
    balance: club.finances.balance,
    income: recordIncome(club.finances.season),
    expense: recordExpense(club.finances.season),
    wages: club.finances.season.wages,
    transfersIn: club.finances.season.playerPurchases,
    transfersOut: club.finances.season.playerSales,
  };
}

interface DevelopmentAccumulator {
  regularYouthTotal: number;
  regularYouthCount: number;
  benchYouthTotal: number;
  benchYouthCount: number;
  veteranTotal: number;
  veteranCount: number;
  breakthrough: DevelopmentStats['breakthrough'];
}

function createDevelopmentStats(): DevelopmentAccumulator {
  return {
    regularYouthTotal: 0, regularYouthCount: 0,
    benchYouthTotal: 0, benchYouthCount: 0,
    veteranTotal: 0, veteranCount: 0,
    breakthrough: undefined,
  };
}

function finaliseDevelopmentStats(acc: DevelopmentAccumulator): DevelopmentStats {
  return {
    regularYouthGain: acc.regularYouthCount > 0 ? acc.regularYouthTotal / acc.regularYouthCount : 0,
    benchYouthGain: acc.benchYouthCount > 0 ? acc.benchYouthTotal / acc.benchYouthCount : 0,
    veteranDecline: acc.veteranCount > 0 ? acc.veteranTotal / acc.veteranCount : 0,
    regularYouthCount: acc.regularYouthCount,
    benchYouthCount: acc.benchYouthCount,
    breakthrough: acc.breakthrough,
  };
}

function recordDevelopment(
  acc: DevelopmentAccumulator,
  player: Player,
  clubName: string,
  gain: number,
  minutesShare: number,
): void {
  // Age is already incremented at this point, so under-22 here means they spent
  // the season as an under-21.
  if (player.age <= 22) {
    if (minutesShare >= 0.5) {
      acc.regularYouthTotal += gain;
      acc.regularYouthCount++;
    } else if (minutesShare < 0.2) {
      acc.benchYouthTotal += gain;
      acc.benchYouthCount++;
    }
    if (!acc.breakthrough || gain > acc.breakthrough.gain) {
      acc.breakthrough = { playerName: player.displayName, clubName, age: player.age, gain };
    }
  } else if (player.age >= 32) {
    acc.veteranTotal += gain;
    acc.veteranCount++;
  }
}

function ageAndRetire(
  world: World,
  rng: Rng,
  seasonMatches: number,
  development: DevelopmentAccumulator,
): number {
  let retirements = 0;

  for (const club of allClubs(world)) {
    const coaching = coachingQuality(club.reputation);
    const staying: Player[] = [];

    for (const player of club.squad) {
      const minutes = player.status.minutes;
      const before = currentAbility(player);
      developPlayer(rng, player, { minutes, seasonMatches, coaching });
      recordDevelopment(
        development,
        player,
        club.name,
        currentAbility(player) - before,
        minutes / (seasonMatches * 90),
      );
      if (shouldRetire(rng, player, minutes)) {
        world.players.delete(player.id);
        retirements++;
      } else {
        resetSeasonStatus(player);
        staying.push(player);
      }
    }
    club.squad = staying;
  }

  // Free agents age too, with no club to coach them, and drop out if they retire.
  world.freeAgents = world.freeAgents.filter((player) => {
    developPlayer(rng, player, { minutes: 0, seasonMatches, coaching: 0.85 });
    if (shouldRetire(rng, player, 0)) {
      world.players.delete(player.id);
      retirements++;
      return false;
    }
    resetSeasonStatus(player);
    return true;
  });

  return retirements;
}

/**
 * Reputation follows league position, slowly. A club that finishes top climbs
 * toward elite status over several seasons; one that keeps finishing bottom
 * slides. Without this the pecking order set at world generation never changes.
 *
 * Position is read across the whole pyramid, not within a division: winning the
 * second tier has to be worth less than winning the first, or a club could
 * bounce between divisions and ratchet its reputation up every time it went
 * down and won promotion again.
 */
function updateReputations(world: World, tables: readonly (readonly TableRow[])[]): void {
  const C = CAREER_TUNING;
  const clubById = new Map(allClubs(world).map((club) => [club.id, club]));
  const totalPlaces = tables.reduce((sum, table) => sum + table.length, 0);

  let placesAbove = 0;
  for (const table of tables) {
    table.forEach((row, index) => {
      const club = clubById.get(row.clubId);
      if (!club) return;
      const overall = placesAbove + index;
      const t = totalPlaces <= 1 ? 0 : overall / (totalPlaces - 1);
      const deserved = C.reputationTop - (C.reputationTop - C.reputationBottom) * t;
      club.reputation = clamp(
        Math.round(club.reputation + (deserved - club.reputation) * C.reputationDrift),
        25,
        95,
      );
    });
    placesAbove += table.length;
  }
}

/**
 * Swaps the bottom of each division with the top of the one below.
 *
 * Done after reputations are updated and before budgets are set, so a promoted
 * club goes into the window with its new division's money and a relegated one
 * with the drop already priced in -- which is the point of the whole exercise.
 */
export function applyPromotionAndRelegation(
  world: World,
  tables: readonly (readonly TableRow[])[],
): PromotionChange[] {
  const C = CAREER_TUNING;
  const changes: PromotionChange[] = [];
  const clubById = new Map(allClubs(world).map((club) => [club.id, club]));

  for (let i = 0; i + 1 < world.leagues.length; i++) {
    const upper = world.leagues[i]!;
    const lower = world.leagues[i + 1]!;
    const upperTable = tables[i];
    const lowerTable = tables[i + 1];
    if (!upperTable || !lowerTable) continue;

    const count = Math.min(C.promotionPlaces, upperTable.length, lowerTable.length);
    if (count === 0) continue;

    const relegated = upperTable.slice(-count).map((row) => row.clubId);
    const promoted = lowerTable.slice(0, count).map((row) => row.clubId);

    const relegatedSet = new Set(relegated);
    const promotedSet = new Set(promoted);
    upper.clubs = upper.clubs.filter((club) => !relegatedSet.has(club.id));
    lower.clubs = lower.clubs.filter((club) => !promotedSet.has(club.id));

    for (const id of promoted) {
      const club = clubById.get(id);
      if (!club) continue;
      upper.clubs.push(club);
      changes.push({ clubId: id, clubName: club.name, from: lower.tier, to: upper.tier });
    }
    for (const id of relegated) {
      const club = clubById.get(id);
      if (!club) continue;
      lower.clubs.push(club);
      changes.push({ clubId: id, clubName: club.name, from: upper.tier, to: lower.tier });
    }
  }

  return changes;
}


/**
 * Runs the AI half of a deferred window and rolls the world into the new season.
 * The managed club is skipped: whatever the manager did is already done.
 */
export function completeTransferWindow(
  world: World,
  rng: Rng,
  managedClubId?: string,
): Transfer[] {
  const transfers = shopTransferWindow(rng, world, {
    ...(managedClubId ? { skipClubIds: [managedClubId] } : {}),
  });

  world.transferWindow?.completed.push(...transfers);
  if (world.transferWindow) world.transferWindow.open = false;
  world.season += 1;

  return transfers;
}
