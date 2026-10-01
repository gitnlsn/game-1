import type { League, MatchResult, Player, TableRow } from '../types.js';
import { exactAbility } from './aging.js';

/**
 * A club's history as the manager lived it: who played, what they scored, how
 * each season ended. The season summaries keep every division's table, but not
 * what one player did across six seasons -- a player's numbers are wiped at
 * every close season -- so this is written down at the moment they are wiped.
 *
 * Kept for every career whether or not anyone is looking: a subscriber who
 * signs up in season five should see seasons one to four.
 */

export interface PlayerSeasonLine {
  season: number;
  clubId: string;
  clubName: string;
  /** As the player was known that season; a rename does not rewrite history. */
  playerName: string;
  position: string;
  age: number;
  appearances: number;
  minutes: number;
  goals: number;
  assists: number;
  /** Ability at the end of the season, whole number. */
  ability: number;
  /** True for a player borrowed from another club that season. */
  onLoan?: boolean;
}

export type CupFinish = 'won' | 'final' | undefined;

export interface ClubSeasonLine {
  season: number;
  clubName: string;
  leagueName: string;
  tier: number;
  position: number;
  clubs: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  cupName?: string;
  /** How far the cup went: rounds won, and whether it ended in a final or a trophy. */
  cupRoundsWon?: number;
  cupFinish?: CupFinish;
  movement?: 'promoted' | 'relegated';
  topScorer?: { playerId: string; playerName: string; goals: number };
}

export interface MatchRecord {
  season: number;
  opponentName: string;
  goalsFor: number;
  goalsAgainst: number;
  home: boolean;
  cup: boolean;
}

export interface ClubRecords {
  /** Every season each player spent in the managed squad, oldest first. */
  players: Record<string, PlayerSeasonLine[]>;
  seasons: ClubSeasonLine[];
  biggestWin?: MatchRecord;
  heaviestDefeat?: MatchRecord;
}

export function createRecords(): ClubRecords {
  return { players: {}, seasons: [] };
}

export interface SeasonToRecord {
  season: number;
  clubId: string;
  clubName: string;
  squad: readonly Player[];
  /** Ids of players in the squad who are only borrowed. */
  borrowed: ReadonlySet<string>;
  league: League;
  table: readonly TableRow[];
  results: readonly MatchResult[];
  clubNames: (clubId: string) => string;
  cup?: { name: string; roundsWon: number; finish: CupFinish };
  movement?: 'promoted' | 'relegated';
}

/**
 * Writes a finished season down. Must run before the close season resets the
 * players' numbers, and before anybody is transferred out.
 */
export function recordSeason(records: ClubRecords, input: SeasonToRecord): void {
  let topScorer: ClubSeasonLine['topScorer'];
  for (const player of input.squad) {
    const status = player.status;
    if (!status || (status.appearances === 0 && status.minutes === 0)) continue;
    const line: PlayerSeasonLine = {
      season: input.season,
      clubId: input.clubId,
      clubName: input.clubName,
      playerName: player.displayName,
      position: player.position,
      age: player.age,
      appearances: status.appearances,
      minutes: status.minutes,
      goals: status.goals,
      assists: status.assists,
      ability: Math.round(exactAbility(player)),
      ...(input.borrowed.has(player.id) ? { onLoan: true } : {}),
    };
    (records.players[player.id] ??= []).push(line);
    if (status.goals > 0 && (!topScorer || status.goals > topScorer.goals)) {
      topScorer = { playerId: player.id, playerName: player.displayName, goals: status.goals };
    }
  }

  const index = input.table.findIndex((row) => row.clubId === input.clubId);
  const row = input.table[index];
  records.seasons.push({
    season: input.season,
    clubName: input.clubName,
    leagueName: input.league.name,
    tier: input.league.tier,
    position: index + 1,
    clubs: input.table.length,
    played: row?.played ?? 0,
    won: row?.won ?? 0,
    drawn: row?.drawn ?? 0,
    lost: row?.lost ?? 0,
    goalsFor: row?.goalsFor ?? 0,
    goalsAgainst: row?.goalsAgainst ?? 0,
    points: row?.points ?? 0,
    ...(input.cup
      ? { cupName: input.cup.name, cupRoundsWon: input.cup.roundsWon, cupFinish: input.cup.finish }
      : {}),
    ...(input.movement ? { movement: input.movement } : {}),
    ...(topScorer ? { topScorer } : {}),
  });

  for (const result of input.results) {
    const home = result.homeClubId === input.clubId;
    if (!home && result.awayClubId !== input.clubId) continue;
    const match: MatchRecord = {
      season: input.season,
      opponentName: input.clubNames(home ? result.awayClubId : result.homeClubId),
      goalsFor: home ? result.home.goals : result.away.goals,
      goalsAgainst: home ? result.away.goals : result.home.goals,
      home,
      cup: result.competitionId !== input.league.id,
    };
    if (beats(match, records.biggestWin, 1)) records.biggestWin = match;
    if (beats(match, records.heaviestDefeat, -1)) records.heaviestDefeat = match;
  }
}

/**
 * Whether `match` is a bigger win (`sign` 1) or a heavier defeat (-1) than the
 * record. Margin first, then goals scored for a win and conceded for a defeat;
 * the first to set a record keeps it on a tie.
 */
function beats(match: MatchRecord, record: MatchRecord | undefined, sign: 1 | -1): boolean {
  const margin = (match.goalsFor - match.goalsAgainst) * sign;
  if (margin <= 0) return false;
  if (!record) return true;
  const recordMargin = (record.goalsFor - record.goalsAgainst) * sign;
  if (margin !== recordMargin) return margin > recordMargin;
  const goals = sign === 1 ? match.goalsFor : match.goalsAgainst;
  const recordGoals = sign === 1 ? record.goalsFor : record.goalsAgainst;
  return goals > recordGoals;
}

export interface AllTimeLine {
  playerId: string;
  /** The most recent name the records hold for them. */
  playerName: string;
  seasons: number;
  appearances: number;
  goals: number;
  assists: number;
}

/** Totals for every player who has played for this club, most appearances first. */
export function allTimeAtClub(records: ClubRecords, clubId: string): AllTimeLine[] {
  const lines: AllTimeLine[] = [];
  for (const [playerId, seasons] of Object.entries(records.players)) {
    const here = seasons.filter((line) => line.clubId === clubId);
    if (here.length === 0) continue;
    lines.push({
      playerId,
      playerName: here[here.length - 1]!.playerName,
      seasons: here.length,
      appearances: here.reduce((sum, line) => sum + line.appearances, 0),
      goals: here.reduce((sum, line) => sum + line.goals, 0),
      assists: here.reduce((sum, line) => sum + line.assists, 0),
    });
  }
  return lines.sort((a, b) => b.appearances - a.appearances || b.goals - a.goals);
}

export interface Honours {
  /** Titles won in the top division. */
  titles: number;
  /** Lower divisions won. */
  divisionTitles: number;
  cups: number;
  promotions: number;
  relegations: number;
  bestFinish: ClubSeasonLine | undefined;
}

export function honoursOf(records: ClubRecords): Honours {
  let best: ClubSeasonLine | undefined;
  for (const line of records.seasons) {
    if (!best || line.tier < best.tier || (line.tier === best.tier && line.position < best.position)) {
      best = line;
    }
  }
  return {
    titles: records.seasons.filter((l) => l.position === 1 && l.tier === 1).length,
    divisionTitles: records.seasons.filter((l) => l.position === 1 && l.tier > 1).length,
    cups: records.seasons.filter((l) => l.cupFinish === 'won').length,
    promotions: records.seasons.filter((l) => l.movement === 'promoted').length,
    relegations: records.seasons.filter((l) => l.movement === 'relegated').length,
    bestFinish: best,
  };
}

/**
 * Rebuilds what can be rebuilt for a career saved before records were kept:
 * how each season ended, from the tables the summaries kept. Who played and
 * who scored is gone with the numbers the close season wiped.
 */
export function recordsFromHistory(
  history: readonly { season: number; tables: TableRow[][]; promotions: { clubId: string; from: number; to: number }[] }[],
  clubId: string,
  leagues: readonly { name: string; tier: number }[],
): ClubRecords {
  const records = createRecords();
  for (const summary of history) {
    const tierIndex = summary.tables.findIndex((rows) => rows.some((row) => row.clubId === clubId));
    if (tierIndex < 0) continue;
    const table = summary.tables[tierIndex]!;
    const index = table.findIndex((row) => row.clubId === clubId);
    const row = table[index]!;
    const moved = summary.promotions.find((p) => p.clubId === clubId);
    const league = leagues.find((l) => l.tier === tierIndex + 1);
    records.seasons.push({
      season: summary.season,
      clubName: row.clubName,
      leagueName: league?.name ?? `Division ${tierIndex + 1}`,
      tier: tierIndex + 1,
      position: index + 1,
      clubs: table.length,
      played: row.played,
      won: row.won,
      drawn: row.drawn,
      lost: row.lost,
      goalsFor: row.goalsFor,
      goalsAgainst: row.goalsAgainst,
      points: row.points,
      ...(moved ? { movement: moved.to < moved.from ? 'promoted' as const : 'relegated' as const } : {}),
    });
  }
  return records;
}
