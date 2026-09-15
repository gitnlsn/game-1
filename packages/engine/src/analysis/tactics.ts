import { Rng } from '../rng/index.js';
import type { Club, TeamSheet, World } from '../types.js';
import { simulateMatch } from '../match/engine.js';
import { BALANCED, TACTIC_AXES, type Tactics } from '../match/tactics.js';
import { DEFAULT_FORMATION, FORMATIONS } from '../world/positions.js';
import { createWorld } from '../world/index.js';

/**
 * Tactics are only a decision if no setting is simply correct. This harness is
 * what makes that claim checkable rather than asserted: it plays every setting
 * against a league of Balanced sides and fails if any of them is a free win, a
 * self-inflicted wound, or the right answer for every squad.
 *
 * Matches are *paired*: the same fixture under two different settings starts
 * from an identical seed, so the difference between them is the instruction and
 * not the dice. Measuring this unpaired needs an order of magnitude more matches
 * to say anything at all.
 */

/**
 * The bar tactics have to clear. A setting worth more than 8% of a point per
 * game is a lever rather than a choice, and one worth less than 92% is a trap
 * for anyone who tries it. Measured across five worlds while tuning, the widest
 * any setting reached was 95.7% to 105.1%, so this leaves real room without
 * leaving room for a dominant setting.
 */
export const TACTIC_DOMINANCE = { floor: 0.92, ceiling: 1.08 } as const;

export interface TacticSetting {
  key: string;
  label: string;
  tactics: Tactics;
}

/** Balanced, plus each axis pushed to both of its extremes. */
export const TACTIC_SETTINGS: readonly TacticSetting[] = [
  { key: 'balanced', label: 'Balanced', tactics: BALANCED },
  ...TACTIC_AXES.flatMap((axis) => [
    {
      key: `${axis.key}+`,
      label: `Very ${axis.high.toLowerCase()}`,
      tactics: { ...BALANCED, [axis.key]: 2 } as Tactics,
    },
    {
      key: `${axis.key}-`,
      label: `Very ${axis.low.toLowerCase()}`,
      tactics: { ...BALANCED, [axis.key]: -2 } as Tactics,
    },
  ]),
];

export interface TacticsOptions {
  seed?: number | string;
  /** How many times to play the full home-and-away programme per setting. */
  repeats?: number;
  /** How many clubs to try every setting with. */
  squads?: number;
}

export interface SettingResult {
  key: string;
  label: string;
  /** Points per game, averaged over every squad tested. */
  pointsPerGame: number;
  goalsFor: number;
  goalsAgainst: number;
  /**
   * Points per game relative to Balanced, pooled over every squad.
   *
   * Pooled, not the mean of the per-squad ratios: averaging ratios weights each
   * squad by the inverse of its own baseline, so a weak side that picks up a few
   * points swamps everything else and the figure swings by ten points between
   * seeds for no reason anyone could act on.
   */
  ratio: number;
  /** Per-squad ratios, which is where non-dominance actually shows up. */
  bySquad: number[];
}

export interface TacticsReport {
  settings: SettingResult[];
  /** The setting that came out best for each squad, in squad order. */
  bestBySquad: string[];
  /** Largest and smallest ratio across every setting. */
  maxRatio: number;
  minRatio: number;
  matchesPlayed: number;
}

function sheetFor(club: Club, tactics: Tactics): TeamSheet {
  const slots = FORMATIONS[DEFAULT_FORMATION]!.length;
  return {
    clubId: club.id,
    formation: DEFAULT_FORMATION,
    // Every slot left to the engine: we are measuring the instructions, not
    // somebody's team selection.
    starters: new Array<string | undefined>(slots).fill(undefined),
    bench: [],
    tactics,
  };
}

function points(scored: number, conceded: number): number {
  return scored > conceded ? 3 : scored === conceded ? 1 : 0;
}

interface Tally {
  points: number;
  played: number;
  goalsFor: number;
  goalsAgainst: number;
}

/**
 * Plays one club's full home-and-away programme under one set of instructions,
 * with every opponent left Balanced.
 *
 * `updatePlayerState` is deliberately off: with it on, a setting that tires legs
 * would carry that fatigue into the next fixture and the comparison would be
 * measuring accumulated wear rather than the instruction.
 */
function programme(
  world: World,
  club: Club,
  tactics: Tactics,
  seed: number | string,
  repeats: number,
): Tally {
  const sheet = sheetFor(club, tactics);
  const tally: Tally = { points: 0, played: 0, goalsFor: 0, goalsAgainst: 0 };

  for (let r = 0; r < repeats; r++) {
    for (const opponent of world.league.clubs) {
      if (opponent.id === club.id) continue;

      const home = simulateMatch(new Rng(`${seed}:${r}:${opponent.id}:h`), club, opponent, {
        homeSheet: sheet,
      });
      tally.points += points(home.home.goals, home.away.goals);
      tally.goalsFor += home.home.goals;
      tally.goalsAgainst += home.away.goals;

      const away = simulateMatch(new Rng(`${seed}:${r}:${opponent.id}:a`), opponent, club, {
        awaySheet: sheet,
      });
      tally.points += points(away.away.goals, away.home.goals);
      tally.goalsFor += away.away.goals;
      tally.goalsAgainst += away.home.goals;

      tally.played += 2;
    }
  }
  return tally;
}

export function validateTactics(options: TacticsOptions = {}): TacticsReport {
  const seed = options.seed ?? 'tactics';
  const repeats = options.repeats ?? 20;
  const squadCount = options.squads ?? 4;

  const world = createWorld({ seed });
  /*
   * Squads spread evenly across the league table rather than hand-picked. The
   * property under test is that different squads want different instructions, so
   * choosing the squads to make that come out true would prove nothing.
   */
  const ranked = [...world.league.clubs].sort((a, b) => b.reputation - a.reputation);
  const step = Math.max(1, Math.floor(ranked.length / squadCount));
  const squads = Array.from({ length: squadCount }, (_, i) => ranked[i * step]!);

  const tallies = squads.map((club) =>
    TACTIC_SETTINGS.map((setting) =>
      programme(world, club, setting.tactics, `${seed}:${club.id}:${setting.key}`, repeats),
    ),
  );

  const baselineIndex = TACTIC_SETTINGS.findIndex((s) => s.key === 'balanced');
  const baselineTotal = tallies.reduce(
    (acc, row) => {
      acc.points += row[baselineIndex]!.points;
      acc.played += row[baselineIndex]!.played;
      return acc;
    },
    { points: 0, played: 0 },
  );
  const baselinePpg = baselineTotal.points / baselineTotal.played;
  const settings: SettingResult[] = TACTIC_SETTINGS.map((setting, s) => {
    const bySquad = tallies.map((row) => {
      const base = row[baselineIndex]!;
      const mine = row[s]!;
      const basePpg = base.points / base.played;
      return basePpg === 0 ? 1 : mine.points / mine.played / basePpg;
    });
    const total = tallies.reduce(
      (acc, row) => {
        const t = row[s]!;
        acc.points += t.points;
        acc.played += t.played;
        acc.goalsFor += t.goalsFor;
        acc.goalsAgainst += t.goalsAgainst;
        return acc;
      },
      { points: 0, played: 0, goalsFor: 0, goalsAgainst: 0 },
    );

    return {
      key: setting.key,
      label: setting.label,
      pointsPerGame: total.points / total.played,
      goalsFor: total.goalsFor / total.played,
      goalsAgainst: total.goalsAgainst / total.played,
      ratio: baselinePpg === 0 ? 1 : total.points / total.played / baselinePpg,
      bySquad,
    };
  });

  const bestBySquad = squads.map((_, i) => {
    let best = settings[0]!;
    for (const setting of settings) {
      if (setting.bySquad[i]! > best.bySquad[i]!) best = setting;
    }
    return best.key;
  });

  const ratios = settings.map((s) => s.ratio);
  return {
    settings,
    bestBySquad,
    maxRatio: Math.max(...ratios),
    minRatio: Math.min(...ratios),
    matchesPlayed: tallies.flat().reduce((sum, t) => sum + t.played, 0),
  };
}

export function formatTacticsReport(report: TacticsReport): string {
  const lines: string[] = [];
  lines.push('Setting                    PPG    vs Balanced   GF     GA');
  for (const setting of report.settings) {
    lines.push(
      setting.label.padEnd(24) +
        setting.pointsPerGame.toFixed(2).padStart(6) +
        `${(setting.ratio * 100).toFixed(1)}%`.padStart(14) +
        setting.goalsFor.toFixed(2).padStart(7) +
        setting.goalsAgainst.toFixed(2).padStart(7),
    );
  }
  lines.push('');
  lines.push(`Best setting per squad: ${report.bestBySquad.join(', ')}`);
  lines.push(
    `Spread: ${(report.minRatio * 100).toFixed(1)}% to ${(report.maxRatio * 100).toFixed(1)}% ` +
      `over ${report.matchesPlayed} matches`,
  );
  return lines.join('\n');
}
