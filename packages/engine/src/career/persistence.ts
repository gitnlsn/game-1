import { Rng } from '../rng/index.js';
import type { Club, Fixture, MatchEvent, MatchResult, Player } from '../types.js';
import { createSeasonState } from '../league/season.js';
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

export function fromSavedCareer(saved: SavedCareer): Career {
  if (saved.version !== SAVE_VERSION) {
    throw new Error(`Unsupported save version ${saved.version}; expected ${SAVE_VERSION}`);
  }

  // Players must be the *same objects* the squads hold, or a transfer would move
  // one copy and leave the lookup table pointing at another.
  const players = new Map<string, Player>();
  for (const club of saved.clubs) {
    for (const player of club.squad) players.set(player.id, player);
  }
  for (const player of saved.freeAgents) players.set(player.id, player);

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
