import { Rng } from '../rng/index.js';
import type { Club, Fixture, MatchEvent, MatchResult, Player } from '../types.js';
import { createSeasonState } from '../league/season.js';
import { ensurePlayerIdsAbove } from '../world/players.js';
import type { Career } from './controller.js';
import type { SeasonSummary } from './career.js';

export const SAVE_VERSION = 1;

/**
 * What a saved match keeps. Goals are kept everywhere because the scorer charts
 * are rebuilt from them; the rest is only kept for the player's own recent
 * matches, which are the only ones ever shown in detail. Shot events are never
 * kept -- shot counts already live in the team stats.
 *
 * A full season of unabridged logs is about 900 KB, most of it substitutions in
 * matches nobody will look at. This keeps a save comfortably under 400 KB.
 */
const DETAILED_EVENT_TYPES = new Set<MatchEvent['type']>([
  'goal',
  'yellow_card',
  'red_card',
  'injury',
  'substitution',
]);

/** Managed-club matches kept with their full event log. */
const DETAILED_MATCH_HISTORY = 10;

export interface SavedCareer {
  version: number;
  seed: number | string;
  rngState: number;
  managedClubId: string;
  worldSeason: number;
  league: { id: string; name: string; nationality: string };
  clubs: Club[];
  freeAgents: Player[];
  season: {
    fixtures: Fixture[];
    results: MatchResult[];
    nextRound: number;
    totalRounds: number;
    points: [string, number][];
    played: [string, number][];
  };
  history: SeasonSummary[];
}

export function toSavedCareer(career: Career): SavedCareer {
  const { world, season } = career;

  return {
    version: SAVE_VERSION,
    seed: world.seed,
    rngState: career.rng.getState(),
    managedClubId: career.managedClubId,
    worldSeason: world.season,
    league: {
      id: world.league.id,
      name: world.league.name,
      nationality: world.league.nationality,
    },
    clubs: world.league.clubs,
    freeAgents: world.freeAgents,
    season: {
      fixtures: season.fixtures,
      results: trimResults(season.results, career.managedClubId),
      nextRound: season.nextRound,
      totalRounds: season.totalRounds,
      points: [...season.points.entries()],
      played: [...season.played.entries()],
    },
    history: career.history,
  };
}

function trimResults(results: readonly MatchResult[], managedClubId: string): MatchResult[] {
  const involvesManaged = (result: MatchResult) =>
    result.homeClubId === managedClubId || result.awayClubId === managedClubId;

  // Index of the earliest managed match that keeps its full log.
  const managedIndices = results.reduce<number[]>((acc, result, index) => {
    if (involvesManaged(result)) acc.push(index);
    return acc;
  }, []);
  const detailedFrom = managedIndices[Math.max(0, managedIndices.length - DETAILED_MATCH_HISTORY)] ?? 0;

  return results.map((result, index) => {
    const detailed = involvesManaged(result) && index >= detailedFrom;
    const keep = detailed
      ? (event: MatchEvent) => DETAILED_EVENT_TYPES.has(event.type)
      : (event: MatchEvent) => event.type === 'goal';
    return { ...result, events: result.events.filter(keep) };
  });
}

/** A save in any historical shape. Migrations narrow it one version at a time. */
export type AnySave = { version: number } & Record<string, unknown>;

type Migration = (saved: AnySave) => AnySave;

/**
 * One entry per version, keyed by the version it upgrades *from*. Migrations are
 * pure data shaping with no randomness, so a migrated career resumes on exactly
 * the RNG sequence it would have.
 *
 * There is nothing here yet -- the save format has only ever had one shape. The
 * chain exists so that the first shape change does not delete everyone's career,
 * which is what the previous throw-and-wipe did.
 */
const MIGRATIONS: Record<number, Migration> = {};

/** Raised when a save cannot be brought up to the current format. */
export class UnsupportedSaveError extends Error {
  constructor(
    message: string,
    readonly saveVersion: number,
    readonly reason: 'too_new' | 'no_migration_path',
  ) {
    super(message);
    this.name = 'UnsupportedSaveError';
  }
}

export function migrateSave(saved: AnySave): SavedCareer {
  let current = saved;

  while (current.version < SAVE_VERSION) {
    const step = MIGRATIONS[current.version];
    if (!step) {
      throw new UnsupportedSaveError(
        `This save was made by an older build and cannot be upgraded (version ${current.version}).`,
        current.version,
        'no_migration_path',
      );
    }
    current = step(current);
  }

  if (current.version > SAVE_VERSION) {
    throw new UnsupportedSaveError(
      `This save was made by a newer build (version ${current.version}); update the app.`,
      current.version,
      'too_new',
    );
  }

  return current as unknown as SavedCareer;
}

export function fromSavedCareer(input: SavedCareer | AnySave): Career {
  const saved = migrateSave(input as AnySave);

  // Players must be the *same objects* the squads hold, or a transfer would move
  // one copy and leave the lookup table pointing at another.
  const players = new Map<string, Player>();
  for (const club of saved.clubs) {
    for (const player of club.squad) players.set(player.id, player);
  }
  for (const player of saved.freeAgents) players.set(player.id, player);

  // Without this, the next academy intake in a freshly launched app mints ids
  // that are already taken and silently overwrites existing players.
  ensurePlayerIdsAbove(players.values());

  const world = {
    seed: saved.seed,
    league: { ...saved.league, clubs: saved.clubs },
    players,
    freeAgents: saved.freeAgents,
    season: saved.worldSeason,
  };

  const rng = new Rng(`${saved.seed}:career`);
  rng.setState(saved.rngState);

  const season = createSeasonState(world, rng, {
    economy: true,
    playerState: true,
    fixtures: saved.season.fixtures,
  });
  season.results = saved.season.results;
  season.nextRound = saved.season.nextRound;
  season.totalRounds = saved.season.totalRounds;
  season.points = new Map(saved.season.points);
  season.played = new Map(saved.season.played);

  return {
    world,
    rng,
    managedClubId: saved.managedClubId,
    season,
    history: saved.history,
  };
}

export function serializeCareer(career: Career): string {
  return JSON.stringify(toSavedCareer(career));
}

export function deserializeCareer(json: string): Career {
  return fromSavedCareer(JSON.parse(json) as SavedCareer);
}
