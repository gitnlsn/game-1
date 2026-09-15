import { Rng } from '../rng/index.js';
import { allClubs } from '../world/index.js';
import type {
  Club,
  Fixture,
  MatchEvent,
  MatchResult,
  Player,
  ScoutingState,
  TeamSheet,
  TransferWindowState,
} from '../types.js';
import { createSeasonState } from '../league/season.js';
import { ensurePlayerIdsAbove } from '../world/players.js';
import type { Career } from './controller.js';
import type { BoardState } from './board.js';
import { BOARD_TUNING, createBoardState, refreshExpectation } from './board.js';
import type { SeasonSummary } from './career.js';

export const SAVE_VERSION = 7;

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
  /**
   * Division metadata and membership. Clubs themselves stay in one flat list so
   * that every squad holds the same Player objects as the lookup table -- split
   * them per league and a transfer moves one copy while the map points at
   * another.
   */
  leagues: { id: string; name: string; nationality: string; tier: number; clubIds: string[] }[];
  clubs: Club[];
  freeAgents: Player[];
  /** Added in save version 4: an open close-season window. */
  transferWindow: TransferWindowState | undefined;
  season: {
    fixtures: Fixture[];
    results: MatchResult[];
    nextRound: number;
    totalRounds: number;
    points: [string, number][];
    played: [string, number][];
    /** Added in save version 3. */
    teamSheets: [string, TeamSheet][];
  };
  history: SeasonSummary[];
  /** Added in save version 2. */
  scouting: ScoutingState;
  /** Added in save version 7. */
  board: BoardState;
}

export function toSavedCareer(career: Career): SavedCareer {
  const { world, season } = career;

  return {
    version: SAVE_VERSION,
    seed: world.seed,
    rngState: career.rng.getState(),
    managedClubId: career.managedClubId,
    worldSeason: world.season,
    leagues: world.leagues.map((league) => ({
      id: league.id,
      name: league.name,
      nationality: league.nationality,
      tier: league.tier,
      clubIds: league.clubs.map((club) => club.id),
    })),
    clubs: allClubs(world),
    freeAgents: world.freeAgents,
    transferWindow: world.transferWindow,
    season: {
      fixtures: season.fixtures,
      results: trimResults(season.results, career.managedClubId),
      nextRound: season.nextRound,
      totalRounds: season.totalRounds,
      points: [...season.points.entries()],
      played: [...season.played.entries()],
      teamSheets: [...season.teamSheets.entries()],
    },
    history: career.history,
    scouting: career.scouting,
    board: career.board,
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
 */
const MIGRATIONS: Record<number, Migration> = {
  /**
   * v2 added scouting and renamed `potential` to `hiddenPotential`. A career from
   * v1 starts out knowing nothing, and every player has to be renamed -- miss
   * that and market values silently become NaN for everyone under 26, because
   * the youth premium is the only place that reads the field.
   */
  1: (saved) => {
    const renamePlayer = (player: Record<string, unknown>) => {
      if (player.hiddenPotential === undefined && player.potential !== undefined) {
        player.hiddenPotential = player.potential;
        delete player.potential;
      }
    };

    for (const club of (saved.clubs as { squad: Record<string, unknown>[] }[]) ?? []) {
      for (const player of club.squad ?? []) renamePlayer(player);
    }
    for (const player of (saved.freeAgents as Record<string, unknown>[]) ?? []) {
      renamePlayer(player);
    }

    return { ...saved, version: 2, scouting: { reports: {} } };
  },
  /** v3 added team selection. An existing career simply has no sheet set. */
  2: (saved) => {
    const season = (saved.season as Record<string, unknown>) ?? {};
    return { ...saved, version: 3, season: { ...season, teamSheets: [] } };
  },
  /**
   * v4 made the transfer window something a manager acts in. A career saved
   * before this has no window open -- the old flow ran it to completion inside
   * endSeason, so there was never one to be in.
   */
  3: (saved) => ({ ...saved, version: 4, transferWindow: undefined }),
  /** v5 gave scouting a per-season allowance. An existing career starts unspent. */
  4: (saved) => {
    const scouting = (saved.scouting as Record<string, unknown>) ?? { reports: {} };
    return { ...saved, version: 5, scouting: { ...scouting, capacityUsed: 0 } };
  },
  /**
   * v6 made the world a pyramid. A save from before it has exactly one division
   * holding every club, and its fixtures all belong to that division -- without
   * naming them, the table would find no fixtures to match results against and
   * every career would resume showing an empty league.
   */
  5: (saved) => {
    const league = (saved.league as { id?: string; name?: string; nationality?: string }) ?? {};
    const clubs = (saved.clubs as { id: string }[]) ?? [];
    const id = league.id ?? 'l1';
    const season = (saved.season as Record<string, unknown>) ?? {};
    const stamp = (rows: Record<string, unknown>[] | undefined) =>
      (rows ?? []).map((row) => ({ ...row, competitionId: row.competitionId ?? id }));
    const fixtures = stamp(season.fixtures as Record<string, unknown>[]);
    // Results need it as much as fixtures do: the table is filtered on it, so an
    // unstamped result counts towards nothing and the league reads as unplayed.
    const results = stamp(season.results as Record<string, unknown>[]);

    const next = {
      ...saved,
      version: 6,
      leagues: [
        {
          id,
          name: league.name ?? 'Liga Nacional',
          nationality: league.nationality ?? 'BRA',
          tier: 1,
          clubIds: clubs.map((club) => club.id),
        },
      ],
      season: { ...season, fixtures, results },
    };
    delete (next as Record<string, unknown>).league;
    return next;
  },
  /**
   * v7 gave the club a board. An existing manager is credited with the seasons
   * already served but starts on default confidence -- reconstructing what a
   * board would have made of a career it was not watching would be inventing
   * history, and inventing one that could sack someone retroactively.
   */
  6: (saved) => ({
    ...saved,
    version: 7,
    board: {
      confidence: BOARD_TUNING.startingConfidence,
      // 0 means "not known"; the loader computes it from the world, which a
      // pure data migration cannot see.
      expectation: 0,
      seasonsInCharge: ((saved.history as unknown[]) ?? []).length,
    },
  }),
};

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

  const clubById = new Map(saved.clubs.map((club) => [club.id, club]));
  const world = {
    seed: saved.seed,
    leagues: saved.leagues.map((league) => ({
      id: league.id,
      name: league.name,
      nationality: league.nationality,
      tier: league.tier,
      clubs: league.clubIds
        .map((id) => clubById.get(id))
        .filter((club): club is Club => club !== undefined),
    })),
    players,
    freeAgents: saved.freeAgents,
    season: saved.worldSeason,
    ...(saved.transferWindow ? { transferWindow: saved.transferWindow } : {}),
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
  season.teamSheets = new Map(saved.season.teamSheets ?? []);

  const board = saved.board ?? createBoardState(world, saved.managedClubId);
  /*
   * Only when it is unknown. Recomputing it on every load would let the target
   * drift as the manager trades -- sell your best player and the board quietly
   * expects less of you, which is not how a board works.
   */
  if (!board.expectation) refreshExpectation(board, world, saved.managedClubId);


  return {
    world,
    rng,
    managedClubId: saved.managedClubId,
    season,
    history: saved.history,
    scouting: saved.scouting ?? { reports: {}, capacityUsed: 0 },
    board,
  };
}

export function serializeCareer(career: Career): string {
  return JSON.stringify(toSavedCareer(career));
}

export function deserializeCareer(json: string): Career {
  return fromSavedCareer(JSON.parse(json) as SavedCareer);
}
