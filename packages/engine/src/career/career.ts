import { Rng, clamp } from '../rng/index.js';
import type { Club, Player, SeasonResult, TableRow, Transfer, World } from '../types.js';
import {
  applyCloseSeasonSpending,
  distributeSeasonIncome,
  resetSeasonRecord,
  setTransferBudgets,
} from '../economy/finances.js';
import { recordExpense, recordIncome } from '../economy/finances.js';
import { simulateSeason } from '../league/season.js';
import { processContracts, runTransferWindow, expireFreeAgents } from '../transfers/market.js';
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

export interface SeasonSummary {
  season: number;
  table: TableRow[];
  championName: string;
  topScorer: { playerName: string; goals: number } | undefined;
  transfers: Transfer[];
  retirements: number;
  youthPromoted: number;
  development: DevelopmentStats;
  finances: ClubSeasonFinance[];
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
  const clubs = world.league.clubs;
  for (const club of clubs) resetSeasonRecord(club);
  setTransferBudgets(clubs, clubs.length);
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
export function closeSeason(world: World, rng: Rng, season: SeasonResult): SeasonSummary {
  const clubs = world.league.clubs;
  distributeSeasonIncome(clubs, season.table);

  const finances = clubs.map((club) => toClubSeasonFinance(club));

  // Close season: age, retire, renew, promote, then trade.
  const seasonMatches = (clubs.length - 1) * 2;
  const development = createDevelopmentStats();
  const retirements = ageAndRetire(world, rng, seasonMatches, development);
  updateReputations(clubs, season.table);
  for (const club of clubs) applyCloseSeasonSpending(club, clubs.length);
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

  setTransferBudgets(clubs, clubs.length);
  const transfers = runTransferWindow(rng, world);
  expireFreeAgents(world);

  world.season += 1;

  return {
    season: world.season - 1,
    table: season.table,
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

  for (const club of world.league.clubs) {
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
 */
function updateReputations(clubs: readonly Club[], table: readonly TableRow[]): void {
  const C = CAREER_TUNING;
  const clubById = new Map(clubs.map((club) => [club.id, club]));

  table.forEach((row, index) => {
    const club = clubById.get(row.clubId);
    if (!club) return;
    const t = table.length <= 1 ? 0 : index / (table.length - 1);
    const deserved = C.reputationTop - (C.reputationTop - C.reputationBottom) * t;
    club.reputation = clamp(
      Math.round(club.reputation + (deserved - club.reputation) * C.reputationDrift),
      25,
      95,
    );
  });
}
