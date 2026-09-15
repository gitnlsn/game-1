import { Rng } from '../rng/index.js';
import type { Club, League, Player, World } from '../types.js';
import { generateClubs } from './clubs.js';
import { resetPlayerIds } from './players.js';

export interface CreateWorldOptions {
  seed: number | string;
  leagueName?: string;
  nationality?: string;
  /** Clubs per division. */
  clubCount?: number;
  /**
   * Divisions in the pyramid. One is the world as it was before the pyramid
   * existed, and the analysis harnesses keep using it: they measure the shape of
   * a division, and a second one would only add noise to that.
   */
  divisions?: number;
}

/** Names for the divisions, top tier first. */
const DIVISION_NAMES = ['Liga Nacional', 'Segunda Divisao', 'Terceira Divisao'];

export function createWorld(options: CreateWorldOptions): World {
  const rng = new Rng(options.seed);
  const nationality = options.nationality ?? 'BRA';
  const clubCount = options.clubCount ?? 20;

  const divisions = options.divisions ?? 1;

  resetPlayerIds();
  /*
   * Every club in the pyramid is generated in one call, then split by
   * reputation. Generating each division separately would draw from the
   * generator in a different order and change every world, and it would also
   * produce two self-contained bands rather than one continuous ladder -- the
   * best club in the second tier should be better than the worst in the first.
   */
  const clubs = generateClubs(rng, { count: clubCount * divisions, nationality });

  const players = new Map<string, Player>();
  for (const club of clubs) {
    for (const player of club.squad) players.set(player.id, player);
  }

  const ranked = divisions === 1 ? clubs : [...clubs].sort((a, b) => b.reputation - a.reputation);
  const leagues: League[] = Array.from({ length: divisions }, (_, i) => ({
    id: `l${i + 1}`,
    name: i === 0 && options.leagueName ? options.leagueName : (DIVISION_NAMES[i] ?? `Divisao ${i + 1}`),
    nationality,
    tier: i + 1,
    clubs: ranked.slice(i * clubCount, (i + 1) * clubCount),
  }));

  return {
    seed: options.seed,
    freeAgents: [],
    season: 1,
    leagues,
    players,
  };
}

/** Every club in the world, across every division. */
export function allClubs(world: World): Club[] {
  return world.leagues.flatMap((league) => league.clubs);
}

export function findClub(world: World, clubId: string): Club | undefined {
  for (const league of world.leagues) {
    const club = league.clubs.find((c) => c.id === clubId);
    if (club) return club;
  }
  return undefined;
}

/** The division a club plays in. */
export function leagueOf(world: World, clubId: string): League | undefined {
  return world.leagues.find((league) => league.clubs.some((club) => club.id === clubId));
}

/** The top division. */
export function topLeague(world: World): League {
  return world.leagues[0]!;
}

export * from './clubs.js';
export * from './names.js';
export * from './players.js';
export * from './positions.js';
export * from './status.js';
export * from './scouting.js';
