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
import { developPlayer, promoteYouth, shouldRetire } from './aging.js';

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

export interface SeasonSummary {
  season: number;
  table: TableRow[];
  championName: string;
  topScorer: { playerName: string; goals: number } | undefined;
  transfers: Transfer[];
  retirements: number;
  youthPromoted: number;
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

export function simulateCareerSeason(world: World, rng: Rng): SeasonSummary {
  const clubs = world.league.clubs;

  for (const club of clubs) resetSeasonRecord(club);
  setTransferBudgets(clubs, clubs.length);

  const season: SeasonResult = simulateSeason(world, rng, { economy: true });
  distributeSeasonIncome(clubs, season.table);

  const finances = clubs.map((club) => toClubSeasonFinance(club));

  // Close season: age, retire, renew, promote, then trade.
  const retirements = ageAndRetire(world, rng);
  updateReputations(clubs, season.table);
  for (const club of clubs) applyCloseSeasonSpending(club, clubs.length);
  processContracts(rng, world);

  let youthPromoted = 0;
  for (const club of clubs) {
    youthPromoted += promoteYouth(rng, club, TRANSFER_TUNING.targetSquadSize).length;
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

function ageAndRetire(world: World, rng: Rng): number {
  let retirements = 0;

  for (const club of world.league.clubs) {
    const staying: Player[] = [];
    for (const player of club.squad) {
      developPlayer(rng, player);
      if (shouldRetire(rng, player)) {
        world.players.delete(player.id);
        retirements++;
      } else {
        staying.push(player);
      }
    }
    club.squad = staying;
  }

  // Free agents age too, and drop out if they retire.
  world.freeAgents = world.freeAgents.filter((player) => {
    developPlayer(rng, player);
    if (shouldRetire(rng, player)) {
      world.players.delete(player.id);
      retirements++;
      return false;
    }
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
