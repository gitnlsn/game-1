import { Rng } from '../rng/index.js';
import type { Club, World } from '../types.js';
import { simulateCareer, type SeasonSummary } from '../career/career.js';
import { marketValue, wageBill } from '../economy/valuation.js';
import { expectedAnnualRevenue } from '../economy/finances.js';
import { ECONOMY_TUNING } from '../economy/finances.js';
import { currentAbility } from '../world/players.js';
import { createWorld } from '../world/index.js';
import type { Benchmark } from './validate.js';

/**
 * Economic benchmarks. Unlike the match engine, there is no real-world dataset
 * to calibrate against match-by-match, so these encode "a league that still
 * works after 20 years": clubs roughly break even, money does not pool in one
 * place, and the title does not belong to one club forever.
 */
export const ECONOMY_BENCHMARKS: readonly Benchmark[] = [
  { key: 'wageToRevenuePct', label: 'Wages as % of revenue', target: 57, tolerance: 13, decimals: 1 },
  /*
   * Real leagues are not tidy: a large share of clubs post losses in any given
   * year, and in some countries most of them carry debt permanently. 12% was
   * optimistic.
   */
  { key: 'clubsInDebtPct', label: 'Clubs in debt %', target: 18, tolerance: 12, decimals: 1 },
  /*
   * This league is closed: there are no foreign clubs to buy from or sell to, and
   * in reality most of a club's signings come from outside its own division.
   * Intra-league permanent transfers run at roughly one or two per club per
   * season, so ~30 across twenty clubs is the right order of magnitude -- not the
   * 45+ a league with an outside market would see.
   */
  { key: 'transfersPerWindow', label: 'Transfers per window', target: 30, tolerance: 15, decimals: 1 },
  { key: 'avgSquadSize', label: 'Average squad size', target: 25, tolerance: 3, decimals: 1 },
  { key: 'avgSquadAge', label: 'Average squad age', target: 25.5, tolerance: 2, decimals: 1 },
  /*
   * Both of these are deliberately horizon-independent. "Distinct champions as a
   * share of seasons" falls as the career lengthens even if nothing changes, and
   * "richest / median balance" divides by a median that sits near zero whenever
   * clubs carry debt. These two measure the same things without either flaw.
   */
  { key: 'titleDominancePct', label: 'Titles won by top club %', target: 22, tolerance: 15, decimals: 1 },
  { key: 'squadValueRatio', label: 'Top / median squad value', target: 4, tolerance: 2.5, decimals: 2 },
  { key: 'topTalentShare', label: 'Best-50 players at one club %', target: 14, tolerance: 10, decimals: 1 },
  {
    key: 'cashToRevenuePct',
    label: 'League cash as % of revenue',
    target: 25,
    tolerance: 25,
    decimals: 1,
  },
  { key: 'talentDriftPct', label: 'Squad quality vs season 1 %', target: 100, tolerance: 8, decimals: 1 },
];

export interface EconomyReport {
  seasons: number;
  metrics: Record<string, number>;
  checks: { benchmark: Benchmark; value: number; pass: boolean }[];
  passed: boolean;
  /** Champions in order, so a dynasty is visible at a glance. */
  champions: string[];
  /** Balance of every club at the end, richest first. */
  finalBalances: { clubName: string; balance: number; reputation: number; squadValue: number }[];
  summaries: SeasonSummary[];
}

export interface ValidateEconomyOptions {
  seasons?: number;
  clubCount?: number;
  seed?: number | string;
}

export function validateEconomy(options: ValidateEconomyOptions = {}): EconomyReport {
  const seasons = options.seasons ?? 20;
  const clubCount = options.clubCount ?? 20;
  const seed = options.seed ?? 'economy';

  const world = createWorld({ seed, clubCount });
  const rng = new Rng(`${seed}:career`);
  const startingTalent = averageFirstTeamAbility(world.league.clubs);

  const summaries = simulateCareer(world, rng, { seasons });

  // Averaged across every club-season, not just the final state.
  let wageTotal = 0;
  let revenueTotal = 0;
  let debtClubSeasons = 0;
  let clubSeasons = 0;
  let transferTotal = 0;

  for (const summary of summaries) {
    transferTotal += summary.transfers.length;
    for (const finance of summary.finances) {
      clubSeasons++;
      wageTotal += finance.wages;
      revenueTotal += finance.income;
      if (finance.balance < 0) debtClubSeasons++;
    }
  }

  const clubs = world.league.clubs;
  const squadValues = clubs
    .map((club) => club.squad.reduce((sum, p) => sum + marketValue(p), 0))
    .sort((a, b) => b - a);
  const medianSquadValue = squadValues[Math.floor(squadValues.length / 2)] ?? 1;
  const topSquadValue = squadValues[0] ?? 0;

  const champions = summaries.map((s) => s.championName);
  const titleCounts = new Map<string, number>();
  for (const champion of champions) titleCounts.set(champion, (titleCounts.get(champion) ?? 0) + 1);
  const mostTitles = Math.max(0, ...titleCounts.values());

  const metrics: Record<string, number> = {
    wageToRevenuePct: revenueTotal > 0 ? (wageTotal / revenueTotal) * 100 : 0,
    clubsInDebtPct: clubSeasons > 0 ? (debtClubSeasons / clubSeasons) * 100 : 0,
    transfersPerWindow: transferTotal / seasons,
    avgSquadSize: clubs.reduce((sum, c) => sum + c.squad.length, 0) / clubs.length,
    avgSquadAge: averageAge(clubs),
    titleDominancePct: (mostTitles / seasons) * 100,
    squadValueRatio: medianSquadValue > 0 ? topSquadValue / medianSquadValue : 1,
    topTalentShare: topTalentConcentration(world, 50),
    // Cash held relative to what the league earns in a season. Measuring growth
    // from the opening balance instead would say more about that arbitrary
    // starting figure than about whether the economy is stable.
    cashToRevenuePct: (totalBalance(clubs) / leagueRevenue(clubs)) * 100,
    talentDriftPct: (averageFirstTeamAbility(clubs) / startingTalent) * 100,
  };

  const checks = ECONOMY_BENCHMARKS.map((benchmark) => {
    const value = metrics[benchmark.key] ?? Number.NaN;
    return { benchmark, value, pass: Math.abs(value - benchmark.target) <= benchmark.tolerance };
  });

  return {
    seasons,
    metrics,
    checks,
    passed: checks.every((c) => c.pass),
    champions,
    finalBalances: clubs
      .map((club) => ({
        clubName: club.name,
        balance: club.finances.balance,
        reputation: club.reputation,
        squadValue: club.squad.reduce((sum, p) => sum + marketValue(p), 0),
      }))
      .sort((a, b) => b.balance - a.balance),
    summaries,
  };
}

function totalBalance(clubs: readonly Club[]): number {
  return clubs.reduce((sum, club) => sum + club.finances.balance, 0);
}

function leagueRevenue(clubs: readonly Club[]): number {
  return clubs.reduce((sum, club) => sum + expectedAnnualRevenue(club.reputation, clubs.length), 0);
}

/**
 * Mean ability of each club's best eleven. Compared against season one this
 * catches the league silently getting better or worse over a career -- which is
 * what happens if youth intake is not pitched at the right standard.
 */
function averageFirstTeamAbility(clubs: readonly Club[]): number {
  let total = 0;
  for (const club of clubs) {
    const best = [...club.squad]
      .map((player) => currentAbility(player))
      .sort((a, b) => b - a)
      .slice(0, 11);
    total += best.reduce((sum, ability) => sum + ability, 0) / Math.max(1, best.length);
  }
  return total / Math.max(1, clubs.length);
}

function averageAge(clubs: readonly Club[]): number {
  let total = 0;
  let count = 0;
  for (const club of clubs) {
    for (const player of club.squad) {
      total += player.age;
      count++;
    }
  }
  return count === 0 ? 0 : total / count;
}

/**
 * Share of the league's best players sitting at a single club. If one club
 * hoovers up the talent the game is over, so this is the key degeneracy check.
 */
function topTalentConcentration(world: World, topN: number): number {
  const ranked = [...world.players.values()]
    .sort((a, b) => currentAbility(b) - currentAbility(a))
    .slice(0, topN);

  const byClub = new Map<string, number>();
  for (const club of world.league.clubs) {
    for (const player of club.squad) {
      if (ranked.some((r) => r.id === player.id)) {
        byClub.set(club.id, (byClub.get(club.id) ?? 0) + 1);
      }
    }
  }

  const most = Math.max(0, ...byClub.values());
  return (most / topN) * 100;
}

/** Current wage-bill-to-revenue ratio for one club, for UI and debugging. */
export function wageRatio(club: Club): number {
  const annualWages = wageBill(club.squad) * ECONOMY_TUNING.wageWeeksPerSeason;
  const revenue = Math.max(1, club.finances.season.gateReceipts + club.finances.sponsorshipPerSeason);
  return annualWages / revenue;
}
