import { Rng } from '../rng/index.js';
import type { Player, World } from '../types.js';
import { generateClubs } from './clubs.js';
import { resetPlayerIds } from './players.js';

export interface CreateWorldOptions {
  seed: number | string;
  leagueName?: string;
  nationality?: string;
  clubCount?: number;
}

export function createWorld(options: CreateWorldOptions): World {
  const rng = new Rng(options.seed);
  const nationality = options.nationality ?? 'BRA';
  const clubCount = options.clubCount ?? 20;

  resetPlayerIds();
  const clubs = generateClubs(rng, { count: clubCount, nationality });

  const players = new Map<string, Player>();
  for (const club of clubs) {
    for (const player of club.squad) players.set(player.id, player);
  }

  return {
    seed: options.seed,
    freeAgents: [],
    season: 1,
    league: {
      id: 'l1',
      name: options.leagueName ?? 'Liga Nacional',
      nationality,
      clubs,
    },
    players,
  };
}

export * from './clubs.js';
export * from './names.js';
export * from './players.js';
export * from './positions.js';
export * from './status.js';
export * from './scouting.js';
