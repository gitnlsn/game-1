/**
 * Tuning harness for the engine. The mobile app never imports this file -- it is
 * here so the simulation can be exercised and calibrated without any UI.
 *
 *   pnpm sim season   [--seed X] [--clubs N]
 *   pnpm sim validate [--seasons N]
 *   pnpm sim match    [--seed X] [--home i] [--away j]
 *   pnpm sim squad    [--club i]
 *   pnpm sim economy  [--seasons N]   multi-season economic health check
 *   pnpm sim career   [--seasons N]   season-by-season career summary
 */
import { Rng } from './rng/index.js';
import { validateEngine } from './analysis/validate.js';
import { simulateSeason } from './league/season.js';
import { clubStrength, computeTeamRating, selectLineup } from './match/ratings.js';
import { simulateMatch } from './match/engine.js';
import { allClubs, createWorld, currentAbility } from './world/index.js';
import { validateEconomy } from './analysis/economy.js';
import {
  formatTacticsReport,
  TACTIC_DOMINANCE,
  validateTactics,
} from './analysis/tactics.js';
import { simulateCareer } from './career/career.js';
import { formatMoney, marketValue, wageBill } from './economy/valuation.js';
import { expectedAnnualRevenue } from './economy/finances.js';
import type { Club, World } from './types.js';

const args = process.argv.slice(2);
const command = args[0] ?? 'season';

function flag(name: string, fallback: string): string {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1]! : fallback;
}

function has(name: string): boolean {
  return args.includes(`--${name}`);
}

function num(name: string, fallback: number): number {
  const value = Number(flag(name, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}

const pad = (value: string | number, width: number) => String(value).padEnd(width);
const padLeft = (value: string | number, width: number) => String(value).padStart(width);

function buildWorld(): World {
  return createWorld({ seed: flag('seed', 'default'), clubCount: num('clubs', 20) });
}

function printTable(world: World, seasonResult: ReturnType<typeof simulateSeason>): void {
  console.log(`\n${world.leagues[0]!.name}  -  final table\n`);
  console.log(
    pad('#', 4) + pad('Club', 22) + padLeft('P', 4) + padLeft('W', 4) +
    padLeft('D', 4) + padLeft('L', 4) + padLeft('GF', 5) + padLeft('GA', 5) +
    padLeft('GD', 5) + padLeft('Pts', 5),
  );
  console.log('-'.repeat(62));

  seasonResult.table.forEach((row, index) => {
    const marker = index === 0 ? '*' : index >= seasonResult.table.length - 3 ? 'v' : ' ';
    console.log(
      pad(`${index + 1}${marker}`, 4) + pad(row.clubName, 22) +
      padLeft(row.played, 4) + padLeft(row.won, 4) + padLeft(row.drawn, 4) +
      padLeft(row.lost, 4) + padLeft(row.goalsFor, 5) + padLeft(row.goalsAgainst, 5) +
      padLeft(row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference, 5) +
      padLeft(row.points, 5),
    );
  });
}

function commandSeason(): void {
  const world = buildWorld();
  const rng = new Rng(flag('seed', 'default') + ':season');
  const result = simulateSeason(world, rng);

  printTable(world, result);

  console.log('\nTop scorers\n');
  result.scorers.slice(0, 10).forEach((scorer, index) => {
    console.log(
      pad(`${index + 1}.`, 4) + pad(scorer.playerName, 20) +
      pad(scorer.clubName, 22) + padLeft(scorer.goals, 3),
    );
  });

  const goals = result.results.reduce((sum, r) => sum + r.home.goals + r.away.goals, 0);
  console.log(`\n${result.results.length} matches, ${goals} goals (${(goals / result.results.length).toFixed(2)} per match)`);
}

function commandValidate(): void {
  const seasons = num('seasons', 50);
  const report = validateEngine({ seasons, clubCount: num('clubs', 20) });

  // A machine-readable digest, so a change can be shown to have moved nothing.
  if (has('json')) {
    console.log(JSON.stringify(report.metrics, null, 2));
    return;
  }

  console.log(`Simulating ${seasons} seasons...\n`);

  console.log(pad('Metric', 28) + padLeft('Value', 9) + padLeft('Target', 16) + '   Status');
  console.log('-'.repeat(68));
  for (const check of report.checks) {
    const decimals = check.benchmark.decimals ?? 1;
    console.log(
      pad(check.benchmark.label, 28) +
      padLeft(check.value.toFixed(decimals), 9) +
      padLeft(`${check.benchmark.target} +/- ${check.benchmark.tolerance}`, 16) +
      (check.pass ? '   ok' : '   OFF'),
    );
  }

  console.log(`\nStrength/position correlation: ${report.strengthPositionCorrelation.toFixed(3)}  (real leagues ~0.75-0.85)`);
  console.log('\nMost common scorelines');
  for (const line of report.scorelines) {
    const bar = '#'.repeat(Math.round(line.pct));
    console.log('  ' + pad(line.score, 6) + padLeft(line.pct.toFixed(1) + '%', 6) + '  ' + bar);
  }

  console.log(`\n${report.matches} matches simulated. ${report.passed ? 'All benchmarks within tolerance.' : 'Some benchmarks are off.'}`);
  // Non-zero on failure so CI can gate on calibration, not just on tests.
  if (!report.passed) process.exitCode = 1;
}

function commandMatch(): void {
  const world = buildWorld();
  const clubs = allClubs(world);
  const home = clubs[num('home', 1) - 1] ?? clubs[0]!;
  const away = clubs[num('away', 2) - 1] ?? clubs[1]!;
  const rng = new Rng(flag('seed', 'default') + ':match');

  const result = simulateMatch(rng, home, away);

  console.log(`\n${home.name}  ${result.home.goals} - ${result.away.goals}  ${away.name}\n`);
  for (const event of result.events) {
    if (event.type !== 'goal') continue;
    const scorer = world.players.get(event.playerId);
    const assist = event.assistPlayerId ? world.players.get(event.assistPlayerId) : undefined;
    const club = event.clubId === home.id ? home : away;
    console.log(
      `  ${padLeft(event.minute + "'", 4)}  ${pad(scorer?.displayName ?? '?', 18)}` +
      `${pad(club.shortName, 5)}${assist ? `(assist: ${assist.displayName})` : ''}`,
    );
  }

  console.log(`\n${pad('', 12)}${padLeft(home.shortName, 6)}${padLeft(away.shortName, 6)}`);
  console.log(pad('  Possession', 12) + padLeft(result.home.possession + '%', 6) + padLeft(result.away.possession + '%', 6));
  console.log(pad('  Shots', 12) + padLeft(result.home.shots, 6) + padLeft(result.away.shots, 6));
  console.log(pad('  On target', 12) + padLeft(result.home.shotsOnTarget, 6) + padLeft(result.away.shotsOnTarget, 6));
}

function commandSquad(): void {
  const world = buildWorld();
  const club: Club = allClubs(world)[num('club', 1) - 1] ?? allClubs(world)[0]!;
  const lineup = selectLineup(club);
  const rating = computeTeamRating(lineup);
  const starters = new Set(lineup.slots.map((s) => s.player.id));

  console.log(`\n${club.name} (${club.city})  -  reputation ${club.reputation}, strength ${clubStrength(club).toFixed(1)}`);
  console.log(
    `Attack ${rating.attack.toFixed(1)}  Midfield ${rating.midfield.toFixed(1)}  ` +
    `Defence ${rating.defence.toFixed(1)}  Keeper ${rating.goalkeeping.toFixed(1)}\n`,
  );

  console.log(
    `Squad value ${formatMoney(club.squad.reduce((sum, p) => sum + marketValue(p), 0))}   ` +
    `Wages ${formatMoney(wageBill(club.squad))}/wk   ` +
    `Balance ${formatMoney(club.finances.balance)}   ` +
    `Stadium ${club.finances.stadiumCapacity.toLocaleString()} @ ${club.finances.ticketPrice}\n`,
  );

  console.log(
    pad('', 5) + pad('Name', 20) + pad('Pos', 5) + pad('Nat', 5) + padLeft('Age', 4) +
    padLeft('Abi', 5) + padLeft('Pot', 5) + padLeft('Value', 9) + padLeft('Wage', 8) + padLeft('Ctr', 5),
  );
  console.log('-'.repeat(71));

  const ordered = [...club.squad].sort((a, b) => currentAbility(b) - currentAbility(a));
  for (const player of ordered) {
    console.log(
      pad(starters.has(player.id) ? '  XI' : '', 5) +
      pad(player.displayName, 20) + pad(player.position, 5) + pad(player.nationality, 5) +
      padLeft(player.age, 4) + padLeft(currentAbility(player).toFixed(0), 5) + padLeft(player.hiddenPotential, 5) +
      padLeft(formatMoney(marketValue(player)), 9) + padLeft(formatMoney(player.contract.wage), 8) +
      padLeft(`${player.contract.yearsRemaining}y`, 5) +
      padLeft(player.status.condition.toFixed(0), 6) +
      padLeft(player.status.morale.toFixed(0), 5) + '  ' +
      pad(
        player.status.injuryMatches > 0
          ? `injured ${player.status.injuryMatches}`
          : player.status.suspensionMatches > 0
            ? `banned ${player.status.suspensionMatches}`
            : '',
        12,
      ),
    );
  }
}

function commandEconomy(): void {
  const seasons = num('seasons', 20);
  const report = validateEconomy({ seasons, seed: flag('seed', 'economy'), clubCount: num('clubs', 20) });

  if (has('json')) {
    console.log(JSON.stringify(report.metrics, null, 2));
    return;
  }

  console.log(`Simulating a ${seasons}-season career...\n`);

  console.log(pad('Metric', 30) + padLeft('Value', 9) + padLeft('Target', 16) + '   Status');
  console.log('-'.repeat(70));
  for (const check of report.checks) {
    const decimals = check.benchmark.decimals ?? 1;
    console.log(
      pad(check.benchmark.label, 30) +
      padLeft(check.value.toFixed(decimals), 9) +
      padLeft(`${check.benchmark.target} +/- ${check.benchmark.tolerance}`, 16) +
      (check.pass ? '   ok' : '   OFF'),
    );
  }

  console.log('\nFinal balances\n');
  console.log(pad('Club', 22) + padLeft('Balance', 11) + padLeft('Rep', 6) + padLeft('Squad value', 13));
  for (const row of report.finalBalances) {
    console.log(
      pad(row.clubName, 22) + padLeft(formatMoney(row.balance), 11) +
      padLeft(row.reputation, 6) + padLeft(formatMoney(row.squadValue), 13),
    );
  }

  const counts = new Map<string, number>();
  for (const champion of report.champions) counts.set(champion, (counts.get(champion) ?? 0) + 1);
  console.log('\nTitles won');
  for (const [club, wins] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log('  ' + pad(club, 22) + '#'.repeat(wins) + ' ' + wins);
  }

  console.log(`\n${report.passed ? 'Economy stable across all checks.' : 'Some economic checks are off.'}`);
  if (!report.passed) process.exitCode = 1;
}

function commandCareer(): void {
  const world = buildWorld();
  const rng = new Rng(flag('seed', 'default') + ':career');
  const seasons = num('seasons', 10);

  console.log(pad('Sn', 4) + pad('Champion', 22) + pad('Top scorer', 20) +
    padLeft('Gls', 4) + padLeft('Xfers', 7) + padLeft('Spend', 10) + padLeft('Retire', 7) +
    padLeft('Youth', 7) + '   ' + pad('Breakthrough', 22));
  console.log('-'.repeat(107));

  simulateCareer(world, rng, {
    seasons,
    onSeason: (summary) => {
      const spend = summary.transfers.reduce((sum, t) => sum + t.fee, 0);
      console.log(
        pad(summary.season, 4) + pad(summary.championName, 22) +
        pad(summary.topScorer?.playerName ?? '-', 20) +
        padLeft(summary.topScorer?.goals ?? 0, 4) +
        padLeft(summary.transfers.length, 7) + padLeft(formatMoney(spend), 10) +
        padLeft(summary.retirements, 7) + padLeft(summary.youthPromoted, 7) + '   ' +
        pad(
          summary.development.breakthrough
            ? `${summary.development.breakthrough.playerName} (${summary.development.breakthrough.age}) +${summary.development.breakthrough.gain.toFixed(0)}`
            : '',
          22,
        ),
      );
    },
  });

  console.log('\nBiggest squads by value now\n');
  const ranked = [...allClubs(world)]
    .map((club) => ({
      club,
      value: club.squad.reduce((sum, p) => sum + marketValue(p), 0),
    }))
    .sort((a, b) => b.value - a.value);

  console.log(pad('Club', 22) + padLeft('Rep', 5) + padLeft('Squad value', 13) +
    padLeft('Wages/wk', 11) + padLeft('Balance', 11) + padLeft('Revenue', 11));
  for (const { club, value } of ranked) {
    console.log(
      pad(club.name, 22) + padLeft(club.reputation, 5) + padLeft(formatMoney(value), 13) +
      padLeft(formatMoney(wageBill(club.squad)), 11) +
      padLeft(formatMoney(club.finances.balance), 11) +
      padLeft(formatMoney(expectedAnnualRevenue(club.reputation, allClubs(world).length)), 11),
    );
  }
}

/**
 * The non-dominance check. Tactics are only a decision if no setting is simply
 * correct, so this exits non-zero when one is -- the same gate `validate` and
 * `economy` apply to the benchmarks.
 */
function commandTactics(): void {
  const report = validateTactics({
    seed: flag('seed', 'tactics'),
    repeats: num('repeats', 20),
    squads: num('squads', 4),
  });

  if (has('json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(formatTacticsReport(report));

  const failures: string[] = [];
  for (const setting of report.settings) {
    if (setting.ratio > TACTIC_DOMINANCE.ceiling) {
      failures.push(`${setting.label} is a free win at ${(setting.ratio * 100).toFixed(1)}%`);
    }
    if (setting.ratio < TACTIC_DOMINANCE.floor) {
      failures.push(`${setting.label} is a trap at ${(setting.ratio * 100).toFixed(1)}%`);
    }
  }
  if (new Set(report.bestBySquad).size < 2) {
    failures.push(`${report.bestBySquad[0]} is the best setting for every squad tested`);
  }

  console.log('');
  if (failures.length > 0) {
    for (const failure of failures) console.log(`OFF: ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('No setting dominates.');
}

const commands: Record<string, () => void> = {
  season: commandSeason,
  economy: commandEconomy,
  career: commandCareer,
  validate: commandValidate,
  tactics: commandTactics,
  match: commandMatch,
  squad: commandSquad,
};

const handler = commands[command];
if (!handler) {
  console.error(`Unknown command: ${command}\nAvailable: ${Object.keys(commands).join(', ')}`);
  process.exit(1);
}
handler();
