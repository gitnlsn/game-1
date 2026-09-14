import { Rng } from '../rng/index.js';
import type { Club, Fixture, MatchResult, TableRow, World } from '../types.js';
import {
  createSeasonState,
  finaliseSeason,
  playRound,
  seasonComplete,
  upcomingRound,
  currentTable,
  type SeasonState,
} from '../league/season.js';
import { createWorld } from '../world/index.js';
import {
  createScoutingState,
  creditInheritedSquad,
  creditOpponent,
  creditOwnSquad,
  pruneScouting,
  scoutedPotential,
  scoutedValue,
} from '../world/scouting.js';
import type { PotentialEstimate, Player, ScoutingState } from '../types.js';
import { beginSeason, closeSeason, type SeasonSummary } from './career.js';

/**
 * A career being played rather than simulated: the world, the season in
 * progress, and which club the player manages. The tuning harness runs whole
 * seasons in a loop; a game needs to stop after every round and show what
 * happened, which is what this wraps.
 */
export interface Career {
  world: World;
  rng: Rng;
  managedClubId: string;
  season: SeasonState;
  /** Completed seasons, oldest first. */
  history: SeasonSummary[];
  /**
   * What this manager has learned about players. Lives on the Career, not the
   * World: it is one club's knowledge, the AI does not use it, and keeping it
   * here means the headless validators -- which never build a Career -- cannot
   * be affected by it.
   */
  scouting: ScoutingState;
}

export interface StartCareerOptions {
  seed: number | string;
  /** Club the player takes charge of. Defaults to the first club. */
  managedClubId?: string;
  clubCount?: number;
  leagueName?: string;
  nationality?: string;
}

export function startCareer(options: StartCareerOptions): Career {
  const world = createWorld({
    seed: options.seed,
    ...(options.clubCount !== undefined ? { clubCount: options.clubCount } : {}),
    ...(options.leagueName !== undefined ? { leagueName: options.leagueName } : {}),
    ...(options.nationality !== undefined ? { nationality: options.nationality } : {}),
  });

  const rng = new Rng(`${options.seed}:career`);
  const managedClubId = options.managedClubId ?? world.league.clubs[0]!.id;

  beginSeason(world);
  const season = createSeasonState(world, rng, { economy: true, playerState: true });

  const career: Career = {
    world,
    rng,
    managedClubId,
    season,
    history: [],
    scouting: createScoutingState(),
  };

  // You start knowing your own squad reasonably well: your coaches have watched
  // them every day, even if you have not seen them play yet.
  creditInheritedSquad(career.scouting, managedClub(career).squad, world.season);
  return career;
}

export function managedClub(career: Career): Club {
  const club = career.world.league.clubs.find((c) => c.id === career.managedClubId);
  if (!club) throw new Error(`managedClub: no club ${career.managedClubId}`);
  return club;
}

/** Plays the next round of fixtures. Returns every result, across all clubs. */
export function advanceRound(career: Career): MatchResult[] {
  const results = playRound(career.season);

  // Facing a side teaches you about it. Done here rather than inside the season
  // loop so the headless path stays free of scouting entirely.
  const own = results.find(
    (r) => r.homeClubId === career.managedClubId || r.awayClubId === career.managedClubId,
  );
  if (own) {
    const opponentId = own.homeClubId === career.managedClubId ? own.awayClubId : own.homeClubId;
    const opponent = career.world.league.clubs.find((c) => c.id === opponentId);
    if (opponent) {
      const active = new Set(
        own.events.filter((e) => e.clubId === opponentId).map((e) => e.playerId),
      );
      creditOpponent(career.scouting, opponent.squad, active, career.world.season);
    }
  }

  return results;
}

/** Your scouts' read on how good a player might become. Never an exact number. */
export function scoutReport(career: Career, player: Player): PotentialEstimate {
  return scoutedPotential(career.world.seed, career.scouting, player);
}

/** What a player looks worth on your reading, as opposed to what he will cost. */
export function scoutValuation(career: Career, player: Player): number {
  return scoutedValue(career.world.seed, career.scouting, player);
}

export function isSeasonComplete(career: Career): boolean {
  return seasonComplete(career.season);
}

export function leagueTable(career: Career): TableRow[] {
  return currentTable(career.season);
}

/** Where the managed club currently sits, 1-based. */
export function managedPosition(career: Career): number {
  const table = leagueTable(career);
  const index = table.findIndex((row) => row.clubId === career.managedClubId);
  return index < 0 ? table.length : index + 1;
}

export interface UpcomingFixture {
  fixture: Fixture;
  opponent: Club;
  home: boolean;
}

/** The managed club's next match, or undefined once the season is over. */
export function nextFixture(career: Career): UpcomingFixture | undefined {
  if (isSeasonComplete(career)) return undefined;

  const fixture = upcomingRound(career.season).find(
    (f) => f.homeClubId === career.managedClubId || f.awayClubId === career.managedClubId,
  );
  if (!fixture) return undefined;

  const home = fixture.homeClubId === career.managedClubId;
  const opponentId = home ? fixture.awayClubId : fixture.homeClubId;
  const opponent = career.world.league.clubs.find((c) => c.id === opponentId);
  if (!opponent) return undefined;

  return { fixture, opponent, home };
}

/** Results involving the managed club, most recent first. */
export function managedResults(career: Career): MatchResult[] {
  return career.season.results
    .filter((r) => r.homeClubId === career.managedClubId || r.awayClubId === career.managedClubId)
    .reverse();
}

/**
 * Wraps up the season and starts the next one. Only valid once every round has
 * been played.
 */
export function endSeason(career: Career): SeasonSummary {
  if (!isSeasonComplete(career)) {
    throw new Error('endSeason: the season still has rounds left to play');
  }

  const result = finaliseSeason(career.season);

  // Credit a season of watching your own players before closeSeason clears their
  // minutes.
  creditOwnSquad(career.scouting, managedClub(career).squad, career.world.season);

  const summary = closeSeason(career.world, career.rng, result);
  career.history.push(summary);

  // Retired and departed players would otherwise accumulate in every save.
  pruneScouting(career.scouting, new Set(career.world.players.keys()));

  beginSeason(career.world);
  career.season = createSeasonState(career.world, career.rng, {
    economy: true,
    playerState: true,
  });

  return summary;
}
