/**
 * Tuning harness for the engine. The mobile app never imports this file -- it is
 * here so the simulation can be exercised and calibrated without any UI.
 *
 *   pnpm sim season   [--seed X] [--clubs N]
 *   pnpm sim validate [--seasons N]
 *   pnpm sim match    [--seed X] [--home i] [--away j]
 *   pnpm sim squad    [--club i]
 */
import { Rng } from './rng/index.js';
import { validateEngine } from './analysis/validate.js';
import { simulateSeason } from './league/season.js';
import { clubStrength, computeTeamRating, selectLineup } from './match/ratings.js';
import { simulateMatch } from './match/engine.js';
import { createWorld, currentAbility } from './world/index.js';
import type { Club, World } from './types.js';

const args = process.argv.slice(2);
const command = args[0] ?? 'season';

function flag(name: string, fallback: string): string {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1]! : fallback;
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
  console.log(`\n${world.league.name}  -  final table\n`);
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
  console.log(`Simulating ${seasons} seasons...\n`);
  const report = validateEngine({ seasons, clubCount: num('clubs', 20) });

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
}

function commandMatch(): void {
  const world = buildWorld();
  const clubs = world.league.clubs;
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
  const club: Club = world.league.clubs[num('club', 1) - 1] ?? world.league.clubs[0]!;
  const lineup = selectLineup(club);
  const rating = computeTeamRating(lineup);
  const starters = new Set(lineup.slots.map((s) => s.player.id));

  console.log(`\n${club.name} (${club.city})  -  reputation ${club.reputation}, strength ${clubStrength(club).toFixed(1)}`);
  console.log(
    `Attack ${rating.attack.toFixed(1)}  Midfield ${rating.midfield.toFixed(1)}  ` +
    `Defence ${rating.defence.toFixed(1)}  Keeper ${rating.goalkeeping.toFixed(1)}\n`,
  );

  console.log(pad('', 5) + pad('Name', 20) + pad('Pos', 5) + pad('Nat', 5) + padLeft('Age', 4) + padLeft('Abi', 5) + padLeft('Pot', 5));
  console.log('-'.repeat(49));

  const ordered = [...club.squad].sort((a, b) => currentAbility(b) - currentAbility(a));
  for (const player of ordered) {
    console.log(
      pad(starters.has(player.id) ? '  XI' : '', 5) +
      pad(player.displayName, 20) + pad(player.position, 5) + pad(player.nationality, 5) +
      padLeft(player.age, 4) + padLeft(currentAbility(player).toFixed(0), 5) + padLeft(player.potential, 5),
    );
  }
}

const commands: Record<string, () => void> = {
  season: commandSeason,
  validate: commandValidate,
  match: commandMatch,
  squad: commandSquad,
};

const handler = commands[command];
if (!handler) {
  console.error(`Unknown command: ${command}\nAvailable: ${Object.keys(commands).join(', ')}`);
  process.exit(1);
}
handler();
